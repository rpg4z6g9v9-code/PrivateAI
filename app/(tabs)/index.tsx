import secureStorage from '@/services/secureStorage';
import { tavilySearch, shouldSearch, buildSearchContext } from '@/services/webSearch';
import { networkMonitor } from '@/services/networkMonitor';
import { controlRoomEvents } from '@/services/controlRoom';
import Voice, { SpeechResultsEvent, SpeechErrorEvent } from '@react-native-voice/voice';
import { Ionicons } from '@expo/vector-icons';
import { AudioPlayer, createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import PersonaAvatar from '@/components/PersonaAvatar';
import SacredGeometryBackground from '@/components/chat/SacredGeometryBackground';
import MedicalModals from '@/components/chat/MedicalModals';
import KnowledgeBaseModal from '@/components/chat/KnowledgeBaseModal';
import Sidebar from '@/components/chat/Sidebar';
import {
  Message, AttachmentImage, Persona, VoiceSettings, ConnectorSettings,
  AvatarMode, LocalModelStatus,
  FONT, DEFAULT_SETTINGS, DEFAULT_CONNECTORS, PERSONAS,
  PERSONA_DESCS, PERSONA_PLACEHOLDER, PERSONA_VOICES,
  extractSources, stripMarkdown, stripEmoji, stripEmojiDisplay,
  stripMarkdownForTTS, cleanSummary,
} from '@/components/chat/types';
import { loadMemory, extractPatterns, buildMemoryPrompt, clearMemory, relativeDate, MemoryEntry } from '@/services/memory';
import { buildPersonaSharedContext, detectAndSaveGoals, getProfile, saveProfile } from '@/services/sharedMemory';
import { extractKnowledge, shouldExtract } from '@/services/knowledgeExtractor';
import { ingestExtraction, decayConfidence } from '@/services/knowledgeGraph';
import {
  fetchTodayEvents, fetchTomorrowEvents, fetchWeekEvents,
  requestCalendarPermissions, hasCalendarPermission, formatEventsForPrompt,
} from '@/services/calendarService';
import {
  saveNote, listNotes, searchNotes,
  formatNotesForPrompt, formatNoteContentForPrompt, extractTitle,
} from '@/services/notesService';
import {
  requestRemindersPermissions, hasRemindersPermission,
  fetchUpcomingReminders, createReminder, parseDueDate,
  formatRemindersForPrompt,
} from '@/services/remindersService';
import {
  pickAndStoreFiles, listFiles, searchFiles, deleteFile,
  formatFilesForPrompt, formatFileContentForPrompt,
  type StoredFile,
} from '@/services/filesService';
import {
  KnowledgeEntry, listEntries, addEntry, deleteEntry,
  pickAndAddEntry, buildKnowledgePrompt, relKbDate, fmtKbSize,
} from '@/services/knowledgeBase';
import { initKnowledgeGraph, extractAndIndexConcepts as kgIndex, prevalidateForKG } from '@/services/knowledgeGraph';
import {
  isModelDownloaded, downloadModel, initModel, releaseModel, generateLocal,
  extractPatternsLocal, isModelLoaded, buildLocalSystemPrompt, deleteModelFile,
} from '@/services/localAI';
import * as Speech from 'expo-speech';
import * as LocalAuth from 'expo-local-authentication';
import { canAccessVault, unlockVault, lockVault } from '@/services/dataVault';
import { pickAndIndexFolder, safeIndexFile, type IndexProgress } from '@/services/fileIndexer';
import { CLOUD_PROMPTS } from '@/services/personaPrompts';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Image } from 'react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import {
  kernelClassify, scoreConfidence, buildKernelSynthesisContext, kernelBannerText,
  type KernelPlan, type PersonaResult,
} from '@/services/kernel';
import {
  getRecentEntries, addEntry as addMedEntry, deleteEntry as deleteMedEntry,
  extractLocalMedical, checkUrgent, generateAppointmentSummary,
  entryTypeLabel, entryTypeColor, entryRelativeDate,
  getPatterns, runPatternDetection,
  patternTypeLabel, patternTypeColor, confidenceBar,
  type MedicalEntry, type EntryDraft, type PatternSummary,
} from '@/services/medicalMemory';
import {
  checkInjection, sanitizeOutput, classifyData,
  checkAnomaly, resetSessionLock, buildMedicalContext,
  logSecurityEvent,
} from '@/services/securityGateway';
import { routeAI } from '@/services/aiRouter';
import { setAssistantName, type PromptMode } from '@/services/atomPrompts';
import type { ConversationMessage } from '@/services/claude';
import { updateContext } from '@/services/contextMemory';
import { summarizeConversation, storeSummary } from '@/services/conversationSummarizer';

const IS_REAL_DEVICE = Constants.isDevice ?? false;
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
const AsyncStorage = secureStorage; // all data is AES-256 encrypted via device secure enclave

const CLAUDE_API_KEY = process.env.EXPO_PUBLIC_CLAUDE_API_KEY ?? '';

// Monotonic message ID — Date.now() alone can repeat within a sync block
let _msgSeq = 0;
const uid = () => `${Date.now()}_${++_msgSeq}`;
const ELEVENLABS_KEY = process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY ?? '';

const SETTINGS_KEY = 'voiceSettings_v4';
const EL_VOICE_KEY = 'elVoiceId_v1';
const TEAM_MODE_KEY = 'teamMode_v1';
const LOCAL_MODE_KEY = 'localMode_v1';
const OFFLINE_MODE_KEY = 'offlineMode_v1';
const AVATAR_MODE_KEY = 'avatarMode_v1';

const RACHEL_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';
const PERSONA_VOICE_KEY = (id: string) => `personaVoice_v1_${id}`;
const SIDEBAR_WIDTH = Math.round(Dimensions.get('window').width * 0.78);
const EL_BASE = 'https://api.elevenlabs.io/v1';

interface ConvItem {
  personaId:    string;
  personaLabel: string;
  personaColor: string;
  title:        string;
  preview:      string;
  quote:        string;
  messageCount: number;
}
interface ELVoice { voice_id: string; name: string; category: string; labels: Record<string, string>; preview_url: string; }

const RATE_OPTIONS = [{ label: 'slow', value: 0.6 }, { label: 'normal', value: 0.95 }, { label: 'fast', value: 1.4 }];
const PITCH_OPTIONS = [{ label: 'low', value: 0.7 }, { label: 'normal', value: 1.0 }, { label: 'high', value: 1.4 }];
const EL_STABILITY_OPTIONS = [{ label: 'expressive', value: 0.25 }, { label: 'balanced', value: 0.5 }, { label: 'stable', value: 0.75 }];
const EL_SIMILARITY_OPTIONS = [{ label: 'low', value: 0.5 }, { label: 'mid', value: 0.75 }, { label: 'high', value: 1.0 }];
const EL_STYLE_OPTIONS = [{ label: 'subtle', value: 0.3 }, { label: 'moderate', value: 0.5 }, { label: 'strong', value: 0.8 }];

const CONNECTORS_KEY = 'connectors_v1';

// ── Claude helper ─────────────────────────────────────────────

async function callClaude(
  apiKey: string,
  system: string,
  messages: { role: string; content: string }[],
  maxTokens = 512,
): Promise<string> {
  // Strip entries with empty/whitespace content — Claude API rejects them with 400
  const safeMessages = messages.filter(m => m.content?.trim());
  if (safeMessages.length === 0 || safeMessages[safeMessages.length - 1]?.role !== 'user') {
    console.warn('[callClaude] no valid user message to send');
    return '';
  }
  try {
    const bodyPayload = JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: maxTokens, system, messages: safeMessages });
    networkMonitor.logCall({
      destination:         'claude_api',
      url:                 'api.anthropic.com/v1/messages',
      dataSizeBytes:       bodyPayload.length,
      description:         `claude api — ${safeMessages.length} context messages, ${maxTokens} max tokens`,
      containsMedicalAlert: false,
      safety:              'safe',
    });
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: bodyPayload,
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('[callClaude] API error', res.status, JSON.stringify(data));
      return `[API error ${res.status}: ${data?.error?.message ?? 'unknown'}]`;
    }
    return data?.content?.[0]?.text ?? '';
  } catch (e) {
    console.error('[callClaude] fetch error', e);
    return '';
  }
}

// SacredGeometryBackground extracted to @/components/chat/SacredGeometryBackground

export default function HomeScreen() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settings, setSettings] = useState<VoiceSettings>(DEFAULT_SETTINGS);
  const [activePersona, setActivePersona] = useState<Persona>(PERSONAS[0]);

  // Team mode
  const [teamMode, setTeamMode] = useState(false); // Disabled — only Atom active
  const [loadingPersonaId, setLoadingPersonaId] = useState<string | null>(null);

  // Local AI mode
  const [localMode, setLocalMode] = useState(false);
  const [offlineMode, setOfflineMode] = useState(false);
  const [localModelStatus, setLocalModelStatus] = useState<LocalModelStatus>('idle');
  const [localModelProgress, setLocalModelProgress] = useState(0);
  const [localModelError, setLocalModelError] = useState('');

  const isDark = true; // always dark

  // Avatar display mode
  const [avatarMode, setAvatarMode] = useState<AvatarMode>('full');

  // Security Gateway
  const [sessionLocked, setSessionLocked] = useState(false);
  const [authLocked, setAuthLocked] = useState(true);   // Face ID gate — locked until auth passes
  const [safeMode, setSafeMode] = useState(false);      // Injection → disable cloud + web search
  const avatarTapTimestamps = useRef<number[]>([]);     // Panic lock: triple-tap tracker

  // Conversation search
  const [convSearch, setConvSearch] = useState('');
  const [convSearchFocused, setConvSearchFocused] = useState(false);
  const [allConversations, setAllConversations] = useState<ConvItem[]>([]);

  // Persona picker popup
  const [personaPickerVisible, setPersonaPickerVisible] = useState(false);

  // Image attachment
  const [attachment, setAttachment] = useState<AttachmentImage | null>(null);
  const [attachMenuVisible, setAttachMenuVisible] = useState(false);

  // Medical Memory
  const [medEntries, setMedEntries] = useState<MedicalEntry[]>([]);
  const [medPatterns, setMedPatterns] = useState<PatternSummary[]>([]);
  const [medAddVisible, setMedAddVisible] = useState(false);
  const [medRawInput, setMedRawInput] = useState('');
  const [medExtracting, setMedExtracting] = useState(false);
  const [medPending, setMedPending] = useState<EntryDraft | null>(null);
  const [medConfirmVisible, setMedConfirmVisible] = useState(false);
  const [medUrgent, setMedUrgent] = useState(false);
  const [medSummaryVisible, setMedSummaryVisible] = useState(false);
  const [medSummaryText, setMedSummaryText] = useState('');
  const [medSummaryLoading, setMedSummaryLoading] = useState(false);

  // Knowledge base
  const [kbEntries, setKbEntries] = useState<KnowledgeEntry[]>([]);
  const [kbModalVisible, setKbModalVisible] = useState(false);
  const [kbModalTitle, setKbModalTitle] = useState('');
  const [kbModalContent, setKbModalContent] = useState('');
  const [kbModalError, setKbModalError] = useState('');

  // File indexer
  const [indexProgress, setIndexProgress] = useState<IndexProgress | null>(null);
  // File picker lock — prevents concurrent getDocumentAsync() calls
  const [filePicking, setFilePicking] = useState(false);
  const filePickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [kbPicking, setKbPicking] = useState(false);
  const kbPickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Memory
  const [memoryEntries, setMemoryEntries] = useState<MemoryEntry[]>([]);

  // Connectors
  const [connectors, setConnectors] = useState<ConnectorSettings>(DEFAULT_CONNECTORS);
  const [storedFiles, setStoredFiles] = useState<StoredFile[]>([]);

  // ElevenLabs
  const [elVoices, setElVoices] = useState<ELVoice[]>([]);
  const [elVoiceId, setElVoiceId] = useState<string>(RACHEL_VOICE_ID);
  const [elLoading, setElLoading] = useState(false);
  const [elSpeakError, setElSpeakError] = useState('');
  const [elError, setElError] = useState('');
  const [ttsSource, setTtsSource] = useState<'elevenlabs' | 'system' | ''>('');
  const [isSearching, setIsSearching] = useState(false);

  // Persona activity dots — driven by controlRoomEvents
  type DotStatus = 'idle' | 'thinking' | 'complete';
  const [dotStatuses, setDotStatuses] = useState<Record<string, DotStatus>>({
    pete: 'idle', architect: 'idle', researcher: 'idle', critic: 'idle', builder: 'idle',
  });
  const dotPulse = useRef(new Animated.Value(0)).current;

  // Subscribe to Control Room events to drive header dots
  useEffect(() => {
    const handler = (event: import('@/services/controlRoom').ControlRoomEvent) => {
      if (event.name === 'persona_start' && event.personaId) {
        setDotStatuses(prev => ({ ...prev, [event.personaId!]: 'thinking' }));
      } else if (event.name === 'persona_complete' && event.personaId) {
        setDotStatuses(prev => ({ ...prev, [event.personaId!]: 'complete' }));
        setTimeout(() => {
          setDotStatuses(prev => {
            if (prev[event.personaId!] === 'complete') return { ...prev, [event.personaId!]: 'idle' };
            return prev;
          });
        }, 3000);
      }
    };
    controlRoomEvents.on(handler);
    return () => controlRoomEvents.off(handler);
  }, []);

  // Pulse animation — loops while any dot is thinking
  useEffect(() => {
    const anyThinking = Object.values(dotStatuses).some(s => s === 'thinking');
    if (anyThinking) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(dotPulse, { toValue: 1, duration: 600, useNativeDriver: true }),
          Animated.timing(dotPulse, { toValue: 0, duration: 600, useNativeDriver: true }),
        ])
      ).start();
    } else {
      dotPulse.stopAnimation();
      dotPulse.setValue(0);
    }
  }, [dotStatuses, dotPulse]);

  const scrollViewRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  const voiceDoneRef = useRef(false);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputTextRef = useRef(''); // tracks latest inputText for silence timer
  const sendMessageRef = useRef<(text: string) => void>(() => {}); // avoids stale closure in silence timer
  const soundRef = useRef<AudioPlayer | null>(null);
  const sidebarX = useRef(new Animated.Value(-SIDEBAR_WIDTH)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const backgroundedAt = useRef<number | null>(null);
  const BACKGROUND_LOCK_MS = 5 * 60 * 1000; // 5 minutes

  // ── Face ID authentication ────────────────────────────────
  const authenticate = useCallback(async () => {
    const hasHardware = await LocalAuth.hasHardwareAsync();
    const isEnrolled  = await LocalAuth.isEnrolledAsync();
    if (!hasHardware || !isEnrolled) {
      // No biometrics available — unlock silently (simulator / no enrollment)
      setAuthLocked(false);
      await unlockVault();
      return;
    }
    const result = await LocalAuth.authenticateAsync({
      promptMessage: 'PrivateAI — verify identity',
      fallbackLabel: 'Use Passcode',
      cancelLabel: 'Cancel',
      disableDeviceFallback: false,
    });
    if (result.success) {
      setAuthLocked(false);
      await unlockVault();
    }
    // If cancelled/failed, authLocked stays true — user must retry
  }, []);

  // Launch auth + AppState listener for background lock
  useEffect(() => {
    authenticate();

    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'background' || next === 'inactive') {
        backgroundedAt.current = Date.now();
      } else if (next === 'active' && backgroundedAt.current !== null) {
        const elapsed = Date.now() - backgroundedAt.current;
        backgroundedAt.current = null;
        if (elapsed >= BACKGROUND_LOCK_MS) {
          lockVault();
          setAuthLocked(true);
          authenticate();
        }
      }
    });
    return () => sub.remove();
  }, [authenticate]);

  useEffect(() => {
    loadHistory(PERSONAS[0].id);
    loadSettings();
    loadElVoiceId();
    setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
    loadMemory(PERSONAS[0].id).then(setMemoryEntries);
    getRecentEntries(90).then(entries => {
      setMedEntries(entries);
      getPatterns().then(setMedPatterns);
      // Run detection on startup (rate-limited to once per day internally)
      if (entries.length > 0) runPatternDetection(entries).then(setMedPatterns).catch(() => {});
    });
    loadConnectors();
    // Team mode disabled — only Atom active
    setTeamMode(false);
    AsyncStorage.getItem(OFFLINE_MODE_KEY).then(v => { if (v !== null) setOfflineMode(v === 'true'); });
    AsyncStorage.getItem(AVATAR_MODE_KEY).then(v => { if (v === 'mini' || v === 'hidden' || v === 'full') setAvatarMode(v); });
    listEntries(PERSONAS[0].id).then(setKbEntries);
    initKnowledgeGraph().then(() => decayConfidence().catch(() => {}));
    // Run data integrity checks on startup (non-blocking)
    import('@/services/integrityCheck').then(({ runIntegrityChecks }) => {
      runIntegrityChecks().then(result => {
        if (!result.passed) {
          Alert.alert(
            'Security Alert',
            `Data integrity check failed for: ${result.tamperedStores.join(', ')}. Your data may have been modified outside the app.`,
            [{ text: 'Acknowledge', style: 'destructive' }],
          );
        }
      });
    });
    // Seed shared profile if not set
    (async () => {
      try {
        const existing = await getProfile();
        console.log('[SharedMemory] Profile check:', existing ? 'exists' : 'missing');
        if (!existing) {
          await saveProfile({
            name: 'Pete',
            role: 'privacy-first AI product builder',
            values: ['privacy', 'local-first', 'security', 'user sovereignty'],
            updatedAt: new Date().toISOString(),
          });
          console.log('[SharedMemory] Seeded default profile');
        }
      } catch (e) {
        console.error('[SharedMemory] Profile seed failed:', e);
      }
    })();
    // Phase 2/3 disabled — re-enable when ready
    // Restore local mode preference and check if model is already on disk.
    // On simulator, local mode is never available — erase any stale 'true' value.
    AsyncStorage.getItem(LOCAL_MODE_KEY).then(async v => {
      const wasLocal = v === 'true';
      if (wasLocal) setLocalMode(true);
      const downloaded = await isModelDownloaded();
      if (downloaded) {
        setLocalModelStatus('loading');
        try { await initModel(); setLocalModelStatus('ready'); } catch (e) { console.warn('[UI] init local model on mount:', e); setLocalModelStatus('error'); }
      }
    });
  }, []);

  // ── Silence auto-stop: if no speech activity for 4s, stop and send ──
  const SILENCE_TIMEOUT_MS = 4000;

  const resetSilenceTimer = () => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = setTimeout(() => {
      // Auto-stop after silence — stop recording, clear state, send text
      if (!voiceDoneRef.current) {
        voiceDoneRef.current = true;
        const text = inputTextRef.current.trim();
        Voice.stop().catch(() => {});
        setIsRecording(false);
        setInputText('');
        if (text) sendMessageRef.current(text);
      }
    }, SILENCE_TIMEOUT_MS);
  };

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
  };

  useEffect(() => {
    Voice.onSpeechStart = () => {
      setIsRecording(true);
      resetSilenceTimer();
    };
    Voice.onSpeechEnd = () => {
      clearSilenceTimer();
      setIsRecording(false);
    };
    Voice.onSpeechPartialResults = (e: SpeechResultsEvent) => {
      if (voiceDoneRef.current) return;
      const val = e.value?.[0] ?? '';
      inputTextRef.current = val;
      setInputText(val);
      resetSilenceTimer(); // user is still talking — reset silence clock
    };
    Voice.onSpeechResults = (e: SpeechResultsEvent) => {
      if (voiceDoneRef.current) return;
      const val = e.value?.[0] ?? '';
      inputTextRef.current = val;
      setInputText(val);
      clearSilenceTimer();
    };
    Voice.onSpeechError = (_e: SpeechErrorEvent) => {
      clearSilenceTimer();
      setIsRecording(false);
    };
    return () => {
      clearSilenceTimer();
      Voice.destroy().then(Voice.removeAllListeners);
    };
  }, []);

  // ── Persistence ──────────────────────────────────────────────

  const loadSettings = async () => {
    try {
      const saved = await AsyncStorage.getItem(SETTINGS_KEY);
      if (saved) setSettings(JSON.parse(saved));
    } catch (e) { console.warn('[UI] load voice settings:', e); }
  };

  const saveSettings = async (s: VoiceSettings) => {
    try { await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { console.warn('[UI] save voice settings:', e); }
  };

  const updateSettings = (patch: Partial<VoiceSettings>) => {
    setSettings(prev => { const next = { ...prev, ...patch }; saveSettings(next); return next; });
  };

  // ── Local AI handlers ─────────────────────────────────────────

  const handleLocalModeToggle = async (v: boolean) => {
    console.log('[Settings] localMode toggled to:', v);
    setLocalMode(v);
    AsyncStorage.setItem(LOCAL_MODE_KEY, String(v));
    if (v && localModelStatus === 'idle') {
      // Model may be on disk already (e.g. re-opened app) — try to load it
      const downloaded = await isModelDownloaded();
      if (downloaded) {
        setLocalModelStatus('loading');
        try { await initModel(); setLocalModelStatus('ready'); } catch (e) { console.warn('[UI] init local model on toggle:', e); setLocalModelStatus('error'); }
      }
      // else: user needs to tap download
    }
  };

  const handleDownloadModel = async () => {
    setLocalModelStatus('downloading');
    setLocalModelProgress(0);
    setLocalModelError('');
    try {
      // Release any existing context before download/re-download
      await releaseModel();
      await downloadModel(pct => {
        // Negative value = indeterminate (no Content-Length from CDN)
        setLocalModelProgress(pct < 0 ? 0 : pct);
      });
      setLocalModelStatus('loading');
      await initModel();
      setLocalModelStatus('ready');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log('[LocalAI] download/init error:', msg);
      setLocalModelError(msg);
      setLocalModelStatus('error');
    }
  };

  const saveAvatarMode = async (mode: AvatarMode) => {
    setAvatarMode(mode);
    try { await AsyncStorage.setItem(AVATAR_MODE_KEY, mode); } catch (e) { console.warn('[UI] save avatar mode:', e); }
  };

  // ── Medical Memory handlers ───────────────────────────────────

  const handleMedSubmit = () => {
    if (!medRawInput.trim()) return;
    setMedExtracting(true);
    const draft = extractLocalMedical(medRawInput.trim());
    const urgent = checkUrgent(medRawInput);
    setMedPending(draft);
    setMedUrgent(urgent);
    setMedAddVisible(false);
    setMedExtracting(false);
    setMedConfirmVisible(true);
  };

  const handleMedConfirm = async () => {
    if (!medPending) return;
    await addMedEntry(medPending);
    setMedConfirmVisible(false);
    setMedPending(null);
    setMedRawInput('');
    getRecentEntries(90).then(entries => {
      setMedEntries(entries);
      runPatternDetection(entries, true).then(setMedPatterns).catch(() => {});
    });
  };

  const handleMedSummary = async () => {
    if (medEntries.length === 0) return;
    setMedSummaryLoading(true);
    setMedSummaryText('');
    setMedSummaryVisible(true);
    try {
      const text = await generateAppointmentSummary(medEntries, CLAUDE_API_KEY);
      setMedSummaryText(text);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setMedSummaryText(`Error: ${msg}`);
    }
    setMedSummaryLoading(false);
  };

  const handleMedShare = async () => {
    if (!medSummaryText) return;
    // Warn user before sharing medical data externally
    Alert.alert(
      'Share Health Summary',
      'This summary contains medical information. It will be shared as plain text via the system share sheet.\n\nOnly share with trusted recipients (e.g. your doctor).',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Share',
          onPress: async () => {
            try {
              logSecurityEvent('medical_export', activePersona.id).catch(() => {});
              await Share.share({
                message: cleanSummary(medSummaryText),
                title: 'Health Summary — PrivateAI',
              });
            } catch (e) { console.warn('[UI] share medical summary:', e); }
          },
        },
      ],
    );
  };

  // Returns the saved voice for a persona, falling back to the default
  const loadPersonaVoice = async (personaId: string): Promise<string> => {
    try {
      // Check new per-persona key first, then legacy global key for Pete
      const saved = await AsyncStorage.getItem(PERSONA_VOICE_KEY(personaId))
        ?? (personaId === 'pete' ? await AsyncStorage.getItem(EL_VOICE_KEY) : null);
      return saved ?? PERSONA_VOICES[personaId] ?? RACHEL_VOICE_ID;
    } catch (e) {
      console.warn('[UI] load persona voice:', e);
      return PERSONA_VOICES[personaId] ?? RACHEL_VOICE_ID;
    }
  };

  const loadElVoiceId = async () => {
    const id = await loadPersonaVoice(PERSONAS[0].id);
    setElVoiceId(id);
  };

  const selectElVoice = (id: string) => {
    setElVoiceId(id);
    try { AsyncStorage.setItem(PERSONA_VOICE_KEY(activePersona.id), id); } catch (e) { console.warn('[UI] save persona voice selection:', e); }
  };

  const loadHistory = async (personaId: string) => {
    try {
      const saved = await AsyncStorage.getItem(`chatHistory_${personaId}`);
      setMessages(saved ? JSON.parse(saved) : []);
    } catch (e) { console.warn('[UI] load chat history:', e); }
  };

  const saveHistory = async (msgs: Message[], personaId: string) => {
    try { await AsyncStorage.setItem(`chatHistory_${personaId}`, JSON.stringify(msgs)); } catch (e) { console.warn('[UI] save chat history:', e); }
  };

  const loadConnectors = async () => {
    try {
      const saved = await AsyncStorage.getItem(CONNECTORS_KEY);
      if (saved) setConnectors(JSON.parse(saved));
    } catch (e) { console.warn('[UI] load connectors:', e); }
  };

  const saveConnectors = async (c: ConnectorSettings) => {
    try { await AsyncStorage.setItem(CONNECTORS_KEY, JSON.stringify(c)); } catch (e) { console.warn('[UI] save connectors:', e); }
  };

  const updateConnectors = (patch: Partial<ConnectorSettings>) => {
    setConnectors(prev => { const next = { ...prev, ...patch }; saveConnectors(next); return next; });
  };

  const toggleCalendar = async (enabled: boolean) => {
    if (enabled) {
      const granted = await requestCalendarPermissions();
      if (!granted) return;
    }
    updateConnectors({ calendar: enabled });
  };

  const toggleReminders = async (enabled: boolean) => {
    if (enabled) {
      const granted = await requestRemindersPermissions();
      if (!granted) return;
    }
    updateConnectors({ reminders: enabled });
  };

  const toggleFiles = async (enabled: boolean) => {
    updateConnectors({ files: enabled });
    if (enabled) {
      listFiles().then(setStoredFiles);
    }
  };

  const pickFile = useCallback(async () => {
    if (filePicking) {
      console.log('[Files] Already picking, ignoring duplicate tap');
      return;
    }
    setFilePicking(true);
    console.log('[Files] Starting file picker');

    // Auto-reset if picker hangs for 10s
    filePickTimeoutRef.current = setTimeout(() => {
      console.warn('[Files] Picker timeout after 10s, resetting');
      setFilePicking(false);
    }, 10_000);

    try {
      const result = await pickAndStoreFiles();
      clearTimeout(filePickTimeoutRef.current);

      // Index each stored file into the knowledge graph via fileIndexer
      for (const file of result.stored) {
        if (file.uri) {
          const ok = await safeIndexFile(file.uri, file.name);
          console.log(`[Files] ${ok ? 'Indexed' : 'Index failed'}: ${file.name}`);
        }
      }

      // Refresh file list
      if (result.stored.length > 0) {
        listFiles().then(setStoredFiles);
      }

      // Alert for skipped PDFs (extraction failures)
      if (result.skippedPdfs.length > 0) {
        Alert.alert(
          'PDF Processing Failed',
          `Could not extract text from: ${result.skippedPdfs.join(', ')}`,
        );
      }

      // Alert for unsupported file types (including images)
      if (result.errors.length > 0) {
        const imageErrors = result.errors.filter(e => e.startsWith('Image not supported:'));
        const otherErrors = result.errors.filter(e => !e.startsWith('Image not supported:'));

        if (imageErrors.length > 0) {
          const names = imageErrors.map(e => e.replace('Image not supported: ', ''));
          Alert.alert(
            'Image Files Not Supported',
            `${names.join(', ')}\n\nSupported file types:\n` +
            '• Text: .txt, .md\n• Code: .ts, .tsx, .js, .py, .swift\n• Data: .json, .csv, .yml',
          );
        }
        if (otherErrors.length > 0) {
          Alert.alert(
            'Unsupported File Type',
            otherErrors.map(e => e.replace('Unsupported file type: ', '')).join(', ') +
            '\n\nSupported:\n• .txt, .md, .ts, .tsx, .js, .py, .swift, .json, .csv, .yml',
          );
        }
      }
    } catch (e) {
      console.error('[Files] pickFile error:', e);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: 'File pick failed. Please try again.',
      }]);
    } finally {
      clearTimeout(filePickTimeoutRef.current);
      setFilePicking(false);
    }
  }, [filePicking]);

  // ── ElevenLabs ───────────────────────────────────────────────

  const fetchElVoices = async () => {
    if (elVoices.length > 0) return;
    if (!ELEVENLABS_KEY) {
      setElError('ElevenLabs API key not set');
      console.log('[EL] fetchElVoices: ELEVENLABS_KEY is empty');
      return;
    }
    setElLoading(true);
    setElError('');
    try {
      console.log('[EL] fetching voices...');
      const res = await fetch(`${EL_BASE}/voices`, {
        headers: { 'xi-api-key': ELEVENLABS_KEY },
      });
      console.log('[EL] voices response status:', res.status);
      if (!res.ok) {
        const body = await res.text();
        console.log('[EL] voices error body:', body);
        throw new Error(`${res.status}`);
      }
      const data = await res.json();
      const premade = (data.voices ?? []).filter((v: ELVoice) => v.category === 'premade');
      console.log('[EL] voices loaded:', premade.length, 'premade (of', data.voices?.length ?? 0, 'total)');
      setElVoices(premade);
      // Reset saved voice to Rachel if it's no longer in the premade list
      const savedId = await AsyncStorage.getItem(EL_VOICE_KEY);
      const validIds = new Set(premade.map((v: ELVoice) => v.voice_id));
      if (savedId && !validIds.has(savedId)) {
        console.log('[EL] saved voice', savedId, 'not premade — resetting to Rachel');
        selectElVoice(RACHEL_VOICE_ID);
      }
    } catch (e: any) {
      setElError(`failed to load voices: ${e.message}`);
    }
    setElLoading(false);
  };

  const stopAudio = () => {
    try {
      if (soundRef.current) {
        soundRef.current.pause();   // halt audio output immediately
        soundRef.current.remove();  // release native resources
        soundRef.current = null;
      }
    } catch (e) {
      console.log('[AUDIO] stopAudio error:', e);
    }
    setIsSpeaking(false);
  };

  const playAudioFromUri = (uri: string) => {
    stopAudio();
    setIsSpeaking(true);
    try {
      const player = createAudioPlayer({ uri });
      soundRef.current = player;
      const subscription = player.addListener('playbackStatusUpdate', status => {
        if (status.didJustFinish) {
          subscription.remove();
          player.remove();
          soundRef.current = null;
          setIsSpeaking(false);
        }
      });
      player.play();
    } catch (e) {
      console.warn('[UI] play audio from URI:', e);
      setIsSpeaking(false);
    }
  };

  const speakSystemFallback = (text: string) => {
    const cleanText = stripEmoji(stripMarkdownForTTS(text));
    console.log('[TTS] System fallback — expo-speech, chars:', cleanText.length);
    setTtsSource('system');
    Speech.stop();
    setIsSpeaking(true);
    Speech.speak(cleanText, {
      rate: settings.rate,
      pitch: settings.pitch,
      onDone: () => { setIsSpeaking(false); setTtsSource(''); },
      onStopped: () => { setIsSpeaking(false); setTtsSource(''); },
      onError: () => { setIsSpeaking(false); setTtsSource(''); },
    });
  };

  const speakWithElevenLabs = async (text: string, voiceId: string) => {
    const model_id = 'eleven_multilingual_v2';
    const cleanText = stripEmoji(stripMarkdownForTTS(text));
    console.log('[TTS] Using:', voiceId, model_id, `stability=${settings.elStability} similarity=${settings.elSimilarity} style=${settings.elStyle}`);
    console.log('[TTS] Clean text length:', cleanText.length, 'first 80:', cleanText.slice(0, 80));
    setElSpeakError('');
    setTtsSource('elevenlabs');
    try {
      networkMonitor.logCall({
        destination:          'elevenlabs',
        url:                  `api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        dataSizeBytes:        cleanText.length,
        description:          `elevenlabs tts — ${cleanText.length} chars voice synthesis`,
        containsMedicalAlert: false,
        safety:               'safe',
      });
      const res = await fetch(`${EL_BASE}/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'xi-api-key': ELEVENLABS_KEY,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text: cleanText,
          model_id,
          voice_settings: { stability: settings.elStability, similarity_boost: settings.elSimilarity, style: settings.elStyle, use_speaker_boost: true },
        }),
      });
      if (!res.ok) {
        const errBody = await res.text();
        // Quota exceeded or any billing error → silent fallback to system TTS
        const isQuotaError = res.status === 429 || errBody.toLowerCase().includes('quota') || errBody.toLowerCase().includes('limit');
        if (isQuotaError) {
          console.log('[TTS] ElevenLabs quota exceeded (status:', res.status, ') — falling back to system TTS');
          console.log('[TTS] Error body:', errBody.slice(0, 200));
          setElSpeakError('ElevenLabs quota exceeded — using system voice');
          speakSystemFallback(text);
          return;
        }
        throw new Error(`ElevenLabs ${res.status}: ${errBody}`);
      }
      const buffer = await res.arrayBuffer();
      console.log('[TTS] ElevenLabs audio received:', buffer.byteLength, 'bytes');
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);
      playAudioFromUri(`data:audio/mpeg;base64,${base64}`);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      console.log('[TTS] ElevenLabs error:', msg);
      setTtsSource('');
      setElSpeakError(`voice error: ${msg}`);
    }
  };

  const speak = async (text: string, personaId?: string) => {
    if (settings.isMuted) return;
    const voiceId = await loadPersonaVoice(personaId ?? activePersona.id);
    if (voiceId) {
      await speakWithElevenLabs(text, voiceId);
    } else {
      Speech.stop();
      setIsSpeaking(true);
      Speech.speak(text, {
        rate: settings.rate,
        pitch: settings.pitch,
        onDone: () => setIsSpeaking(false),
        onStopped: () => setIsSpeaking(false),
        onError: () => setIsSpeaking(false),
      });
    }
  };

  const previewElVoice = async (voice: ELVoice) => {
    if (isSpeaking) return;
    await speakWithElevenLabs("Hello, I'm ready to help you build PrivateAI.", voice.voice_id);
  };

  // ── Sidebar ──────────────────────────────────────────────────

  // ── Image attachment ──────────────────────────────────────────

  const processPickerResult = async (result: ImagePicker.ImagePickerResult) => {
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    // Resize to max 1024px on longest side, convert to JPEG
    const manipulated = await ImageManipulator.manipulateAsync(
      asset.uri,
      [{ resize: asset.width > asset.height ? { width: 1024 } : { height: 1024 } }],
      { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG, base64: true },
    );
    setAttachment({ uri: manipulated.uri, base64: manipulated.base64!, mimeType: 'image/jpeg' });
    setAttachMenuVisible(false);
  };

  const pickFromLibrary = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
    });
    await processPickerResult(result);
  };

  const pickFromCamera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchCameraAsync({ quality: 1 });
    await processPickerResult(result);
  };

  const loadAllConversations = async () => {
    const items: ConvItem[] = [];
    for (const p of PERSONAS) {
      try {
        const saved = await AsyncStorage.getItem(`chatHistory_${p.id}`);
        if (!saved) continue;
        const msgs: Message[] = JSON.parse(saved);
        if (msgs.length === 0) continue;
        const userMsgs      = msgs.filter(m => m.role === 'user');
        const assistantMsgs = msgs.filter(m => m.role === 'assistant');
        items.push({
          personaId:    p.id,
          personaLabel: p.label,
          personaColor: p.color,
          title:        (userMsgs[0]?.content ?? '').slice(0, 60),
          preview:      (msgs[msgs.length - 1]?.content ?? '').slice(0, 80),
          quote:        (assistantMsgs[0]?.content ?? '').slice(0, 80),
          messageCount: msgs.length,
        });
      } catch (e) { console.warn('[UI] load conversation for persona:', e); }
    }
    setAllConversations(items);
  };

  const openSidebar = () => {
    fetchElVoices();
    if (connectors.files) listFiles().then(setStoredFiles);
    loadAllConversations();
    setSidebarOpen(true);
    Animated.parallel([
      Animated.timing(sidebarX, { toValue: 0, duration: 260, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: 260, useNativeDriver: true }),
    ]).start();
  };

  const closeSidebar = () => {
    Animated.parallel([
      Animated.timing(sidebarX, { toValue: -SIDEBAR_WIDTH, duration: 220, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start(() => { setSidebarOpen(false); setConvSearch(''); });
  };

  // ── Chat ─────────────────────────────────────────────────────

  const switchPersona = (persona: Persona) => {
    if (persona.id === activePersona.id) return;
    stopAudio();
    setActivePersona(persona);
    // Update base prompt identity to match active persona — prevents identity bleed
    setAssistantName(persona.label);
    setInputText('');
    loadHistory(persona.id);
    loadMemory(persona.id).then(setMemoryEntries);
    loadPersonaVoice(persona.id).then(setElVoiceId);
    listEntries(persona.id).then(setKbEntries);
  };

  const clearPersonaMemory = async () => {
    await clearMemory(activePersona.id);
    setMemoryEntries([]);
  };

  // ── Knowledge Base ────────────────────────────────────────────

  const pickKbFile = useCallback(async () => {
    if (kbPicking) {
      console.log('[KB] Already picking, ignoring duplicate tap');
      return;
    }
    setKbPicking(true);
    console.log('[KB] Starting KB file picker');

    kbPickTimeoutRef.current = setTimeout(() => {
      console.warn('[KB] Picker timeout after 10s, resetting');
      setKbPicking(false);
    }, 10_000);

    try {
      const { entry, error } = await pickAndAddEntry(activePersona.id);
      clearTimeout(kbPickTimeoutRef.current);

      if (entry) {
        listEntries(activePersona.id).then(setKbEntries);
        // Also index into KG for cross-persona search
        if (entry.content) {
          kgIndex(entry.content, { source: entry.title }).catch(e =>
            console.warn('[KB] KG index failed for', entry.title, e),
          );
        }
        console.log(`[KB] Indexed: ${entry.title}`);
      } else if (error) {
        if (error.includes('PDF') || error.includes('Unsupported')) {
          Alert.alert('File Type Not Supported', error + '\n\nSupported: pdf, txt, md, ts, tsx, js, py, swift, json, csv, yml');
        } else {
          setMessages(prev => [...prev, {
            id: Date.now().toString(),
            role: 'assistant',
            content: `File error: ${error}`,
          }]);
        }
      }
    } catch (e) {
      console.error('[KB] pickKbFile error:', e);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: 'File picker failed unexpectedly. Please try again.',
      }]);
    } finally {
      clearTimeout(kbPickTimeoutRef.current);
      setKbPicking(false);
    }
  }, [kbPicking, activePersona.id]);

  const saveKbText = async () => {
    if (!kbModalContent.trim()) { setKbModalError('Content cannot be empty.'); return; }
    const { entry, error } = await addEntry(activePersona.id, kbModalTitle, kbModalContent, 'paste');
    if (entry) {
      listEntries(activePersona.id).then(setKbEntries);
      setKbModalVisible(false);
      setKbModalTitle('');
      setKbModalContent('');
      setKbModalError('');
    } else if (error) {
      setKbModalError(error);
    }
  };

  const deleteKbEntry = async (id: string) => {
    await deleteEntry(activePersona.id, id);
    listEntries(activePersona.id).then(setKbEntries);
  };

  // ── File Indexer ─────────────────────────────────────────────────

  const handleIndexFolder = async () => {
    if (indexProgress?.phase === 'indexing' || indexProgress?.phase === 'reading') return;
    await pickAndIndexFolder(setIndexProgress);
  };

  const toggleVoice = async () => {
    if (isRecording) {
      // Set the gate FIRST — blocks onSpeechResults/onSpeechPartialResults immediately
      voiceDoneRef.current = true;
      clearSilenceTimer();
      const text = inputText.trim();
      setInputText('');
      inputRef.current?.clear();
      // Explicitly clear recording state — don't rely on onSpeechEnd firing
      setIsRecording(false);
      await Voice.stop();
      // Native layer may fire one final callback after stop returns — clear again
      setInputText('');
      inputRef.current?.clear();
      setTimeout(() => { setInputText(''); inputRef.current?.clear(); }, 150);
      if (text) sendMessageWithText(text);
    } else {
      // Re-enable speech callbacks only at the moment a new recording begins
      voiceDoneRef.current = false;
      setInputText('');
      await Voice.start('en-US');
    }
  };

  const buildConnectorContext = async (text: string): Promise<string> => {
    const lower = text.toLowerCase();
    const parts: string[] = [];

    // ── Notes ──────────────────────────────────────────────────
    if (connectors.notes) {
      // Save intent: "save a note: X", "note: X", "jot this: X", "remember: X"
      const saveMatch =
        text.match(/^(?:save\s+(?:a\s+|this\s+)?note|note|jot(?:\s+this)?|write\s+down|remember\s+this)[:\s]+(.+)$/is) ||
        text.match(/(?:make|create)\s+a\s+note[:\s]+(.+)$/is);

      if (saveMatch) {
        const content = saveMatch[1].trim();
        const title = extractTitle(content);
        const saved = await saveNote(title, content);
        parts.push(`[ACTION COMPLETED] Saved a note to Pete's private on-device storage.\nTitle: "${saved.title}"\nContent preview: ${content.slice(0, 200)}`);

      // Search intent: "what did I write about X", "search notes for X", "find my note about X"
      } else if (/what did i (?:write|note|save|jot)|search.*?notes?|find.*?notes?/i.test(lower)) {
        const qMatch =
          text.match(/(?:about|for|regarding|on)\s+(.+?)(?:\?|$)/i) ||
          text.match(/(?:write|note|save).*?\s+(.{3,})(?:\?|$)/i);
        if (qMatch) {
          const results = await searchNotes(qMatch[1].trim());
          parts.push(formatNotesForPrompt(results, `search results for "${qMatch[1].trim()}"`));
          // If exactly one result, include full content so Claude can discuss it
          if (results.length === 1) {
            parts.push(formatNoteContentForPrompt(results[0]));
          }
        }

      // List intent: "show my notes", "list my notes", "what notes do I have"
      } else if (/(?:my notes|show notes|list notes|all (?:my )?notes|what notes)/i.test(lower)) {
        const notes = await listNotes(10);
        parts.push(formatNotesForPrompt(notes));
      }
    }

    // ── Calendar ───────────────────────────────────────────────
    if (connectors.calendar) {
      const hasCalIntent = /\b(?:schedule|calendar|today|tomorrow|this week|next week|meeting|appointment|event|what(?:'s| is| do i| am i).*?(?:on|happening|doing)|do i have|what do i have)\b/i.test(text);
      if (hasCalIntent) {
        const permitted = await hasCalendarPermission();
        if (permitted) {
          const wantsWeek     = /this week|next \d+ days?|upcoming|week|7 days/i.test(lower);
          const wantsTomorrow = /tomorrow/i.test(lower);
          const events = wantsWeek
            ? await fetchWeekEvents()
            : wantsTomorrow
              ? await fetchTomorrowEvents()
              : await fetchTodayEvents();
          const label = wantsWeek ? 'next 7 days' : wantsTomorrow ? 'tomorrow' : 'today';
          parts.push(formatEventsForPrompt(events, label));
        }
      }
    }

    // ── Reminders ──────────────────────────────────────────────
    if (connectors.reminders) {
      // Create intent: "remind me to X"
      const createMatch = text.match(/\bremind\s+me\s+to\s+(.+)/i);
      if (createMatch) {
        const title = createMatch[1].trim();
        const dueDate = parseDueDate(text);
        const permitted = await hasRemindersPermission();
        if (permitted) {
          const id = await createReminder(title, dueDate);
          const dueStr = dueDate
            ? ` due ${dueDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
            : '';
          parts.push(id
            ? `[ACTION COMPLETED] Created a reminder: "${title}"${dueStr}.`
            : `[ACTION FAILED] Could not create reminder — check Reminders app permissions.`);
        }

      // List intent: "what are my reminders?", "show reminders", "upcoming reminders"
      } else if (/\b(?:my reminders?|show reminders?|list reminders?|what.*?reminders?|upcoming reminders?)\b/i.test(lower)) {
        const permitted = await hasRemindersPermission();
        if (permitted) {
          const reminders = await fetchUpcomingReminders();
          parts.push(formatRemindersForPrompt(reminders));
        }
      }
    }

    // ── Files ───────────────────────────────────────────────────
    if (connectors.files) {
      // Search intent: "search my files for X", "find X in my files", "what does [file] say about X"
      const fileSearchMatch =
        text.match(/search\s+(?:my\s+)?files?\s+(?:for\s+)?(.+?)(?:\?|$)/i) ||
        text.match(/find\s+(.+?)\s+in\s+(?:my\s+)?files?/i) ||
        text.match(/what.*?(?:file|document).*?(?:say|about|contain)\s+(.+?)(?:\?|$)/i);

      if (fileSearchMatch) {
        const results = await searchFiles(fileSearchMatch[1].trim());
        parts.push(formatFilesForPrompt(results.length > 0 ? results : []));
        if (results.length === 1) {
          parts.push(formatFileContentForPrompt(results[0]));
        } else if (results.length > 1) {
          // Include content of top match
          parts.push(formatFileContentForPrompt(results[0]));
        }

      // List intent: "what files do I have?", "show my files", "my documents"
      } else if (/(?:my files?|show files?|list files?|my documents?|what files)/i.test(lower)) {
        const files = await listFiles();
        parts.push(formatFilesForPrompt(files));

      // Light context: inject file count for any other message
      } else {
        const files = await listFiles();
        if (files.length > 0) {
          parts.push(`Pete has ${files.length} file${files.length === 1 ? '' : 's'} stored: ${files.slice(0, 3).map(f => `"${f.name}"`).join(', ')}${files.length > 3 ? '...' : ''}.`);
        }
      }
    }

    if (parts.length === 0) return '';
    return `\n\n[CONNECTOR CONTEXT — on-device data, not sent anywhere]\n${parts.join('\n\n')}`;
  };

  const toApiMessages = (msgs: Message[]) => {
    // Claude API requires strictly alternating user/assistant.
    // Team mode saves multiple consecutive assistant messages (opening + guests + synthesis).
    // Merge consecutive same-role messages so the array is always valid.
    const filtered = msgs
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content ?? '' }));
    const merged: { role: 'user' | 'assistant'; content: string }[] = [];
    for (const msg of filtered) {
      if (merged.length > 0 && merged[merged.length - 1].role === msg.role) {
        merged[merged.length - 1].content += '\n\n' + msg.content;
      } else {
        merged.push({ ...msg });
      }
    }
    // Must start with a user message (drop any leading assistant turns)
    while (merged.length > 0 && merged[0].role !== 'user') merged.shift();
    // Drop any entries whose content is empty or whitespace-only
    return merged.filter(m => m.content.trim());
  };

  const sendTeamResponse = async (text: string, currentMsgs: Message[], plan: KernelPlan) => {
    // ── Security Gateway ────────────────────────────────────────
    const anomaly = checkAnomaly();
    if (anomaly.locked) {
      setSessionLocked(true);
      setMessages(prev => [...prev, { id: uid(), role: 'assistant', content: anomaly.message }]);
      setTimeout(() => setSessionLocked(false), 30_000);
      setIsLoading(false);
      return;
    }
    if (sessionLocked) setSessionLocked(false);

    setIsLoading(true);

    const guests = plan.guests
      .map(id => PERSONAS.find(p => p.id === id))
      .filter((p): p is Persona => p !== undefined);

    let connCtx = '';
    try { connCtx = await buildConnectorContext(text); } catch (e) { console.warn('[UI] build connector context:', e); }
    const memEntries = await loadMemory(activePersona.id);
    const peteKnowledge = await buildKnowledgePrompt(activePersona.id);
    const teamSharedCtx = await buildPersonaSharedContext(activePersona.id);
    const apiBase = toApiMessages(currentMsgs);

    // Medical trust boundary context
    const medCount = medEntries.length;
    const medFullCtx = medCount > 0
      ? `\n\nUser has ${medCount} health entries logged in their private medical memory.`
      : '';

    let thread = [...currentMsgs];

    // ── Kernel banner ─────────────────────────────────────────
    thread = [...thread, {
      id: `kb_${uid()}`, role: 'handoff',
      content: kernelBannerText(plan), personaId: activePersona.id,
    }];
    setMessages([...thread]);

    // ── Atom opens ────────────────────────────────────────────
    setLoadingPersonaId(activePersona.id);
    controlRoomEvents.emit('persona_start', { personaId: activePersona.id });
    controlRoomEvents.emit('step_added', { step: `kernel: ${plan.rationale}` });
    const guestNames = guests.map(g => g.label).join(', ');
    const openingCtx = `\n\nYou are opening a team discussion routed by the kernel: ${plan.rationale}. Give your initial take in 2-3 sentences, then invite ${guestNames || 'the team'} to weigh in. Be brief.`;
    // Atom (pete) receives full medical context; trust boundary enforced per-persona below
    const adamMedCtx = buildMedicalContext(activePersona.id, medCount, medFullCtx);
    const peteRaw = await callClaude(
      CLAUDE_API_KEY,
      activePersona.systemPrompt + teamSharedCtx + openingCtx + buildMemoryPrompt(memEntries) + peteKnowledge + connCtx + adamMedCtx,
      apiBase, 400,
    );
    const peteReply = sanitizeOutput(peteRaw);
    controlRoomEvents.emit('persona_complete', { personaId: activePersona.id });
    thread = [...thread, { id: `pt_${uid()}`, role: 'assistant', content: peteReply, personaId: activePersona.id }];
    setMessages([...thread]);

    // ── Kernel chain: guests respond in order ─────────────────
    const kernelResults: PersonaResult[] = [];

    for (const guest of guests) {
      thread = [...thread, {
        id: `jn_${guest.id}_${uid()}`, role: 'handoff',
        content: `--- ${guest.label} ---`, personaId: guest.id,
      }];
      setMessages([...thread]);
      setLoadingPersonaId(guest.id);
      controlRoomEvents.emit('persona_start', { personaId: guest.id });

      const gMem      = await loadMemory(guest.id);
      const gKnowledge = await buildKnowledgePrompt(guest.id);
      // Each guest sees prior chain results so later personas can build on earlier ones
      const priorWork = kernelResults.length > 0
        ? '\n\nPrior team analysis:\n' + kernelResults
            .map(r => `${r.personaId}: "${r.response.slice(0, 200)}"`)
            .join('\n')
        : '';
      const gCtx = `\n\nYou are ${guest.label} in a kernel-routed team response (${plan.rationale}). Atom opened with: "${peteReply.slice(0, 200)}"${priorWork}\n\nAdd your specialist perspective in 2-4 sentences. Be direct. Add what hasn't been covered yet.`;
      // Persona trust boundary: guests receive summary count only, not medical detail
      const guestMedCtx = buildMedicalContext(guest.id, medCount, medFullCtx);
      const gRaw = await callClaude(
        CLAUDE_API_KEY,
        guest.systemPrompt + gCtx + buildMemoryPrompt(gMem) + gKnowledge + guestMedCtx,
        apiBase, 400,
      );
      const gReply = sanitizeOutput(gRaw);

      // Score confidence — detects hallucination guard triggers
      const confidence = scoreConfidence(gReply);
      kernelResults.push({ personaId: guest.id, response: gReply, confidence });
      controlRoomEvents.emit('persona_complete', { personaId: guest.id });
      controlRoomEvents.emit('step_added', { step: `${guest.label}: ${confidence} confidence`, personaId: guest.id });

      // Append confidence badge to the handoff banner
      const confLabel = confidence === 'high' ? '' : confidence === 'medium' ? ' · verify some details' : ' · ⚠ low confidence';
      // Retroactively update the joining banner with confidence info
      thread = thread.map(m =>
        m.id === `jn_${guest.id}_${thread.find(t => t.id === `jn_${guest.id}_${uid}`)?.id}`
          ? m : m
      );
      thread = [...thread, { id: `g_${guest.id}_${uid()}`, role: 'assistant', content: gReply, personaId: guest.id }];
      // Append confidence to the separator banner below the response
      thread = [...thread, {
        id: `cf_${guest.id}_${uid()}`, role: 'handoff',
        content: `--- ${guest.label} · ${confidence} confidence${confLabel} ---`,
        personaId: guest.id,
      }];
      setMessages([...thread]);
    }

    // ── Kernel synthesis: Atom closes ─────────────────────────
    setLoadingPersonaId(activePersona.id);
    controlRoomEvents.emit('persona_start', { personaId: activePersona.id });
    controlRoomEvents.emit('step_added', { step: 'Atom: kernel synthesis' });
    const synthCtx = buildKernelSynthesisContext(plan, kernelResults);
    // Ensure apiBase always ends with the user's message for synthesis
    const synthBase = apiBase.length > 0 ? apiBase : [{ role: 'user' as const, content: text }];
    const synthRaw = await callClaude(
      CLAUDE_API_KEY,
      activePersona.systemPrompt + (synthCtx.trim() || `\n\nSynthesize the team's responses to: ${text}`) + buildMemoryPrompt(memEntries) + peteKnowledge + adamMedCtx,
      synthBase, 600,
    );
    const synthReply = sanitizeOutput(synthRaw);
    controlRoomEvents.emit('persona_complete', { personaId: activePersona.id });
    controlRoomEvents.emit('step_added', { step: 'synthesis complete' });

    const finalThread: Message[] = [
      ...thread,
      { id: `ps_${uid()}`, role: 'assistant', content: synthReply, personaId: activePersona.id },
      { id: `cl_${uid()}`, role: 'handoff', content: '--- kernel synthesis complete ---', personaId: activePersona.id },
    ];
    setMessages(finalThread);
    saveHistory(finalThread.filter(m => m.role !== 'handoff'), activePersona.id);
    
    // Phase 1: Auto-generate conversation summary (non-blocking)
    const conversationId = `conv_${Date.now()}_kernel`;
    const messagesToSummarize = finalThread
      .filter(m => m.role !== 'handoff')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    
    summarizeConversation(conversationId, messagesToSummarize, CLAUDE_API_KEY)
      .then(summary => storeSummary(summary))
      .catch(e => console.error('[Summarizer] Failed:', e));

    speak(synthReply, activePersona.id);
    setLoadingPersonaId(null);
    setIsLoading(false);
  };

  const sendMessageWithText = async (text: string) => {
    if (!text.trim()) return;

    // ── Security Gateway ──────────────────────────────────────
    // 1. Injection check — block before any state mutation; activate safe mode
    const injCheck = checkInjection(text);
    if (injCheck.blocked) {
      setSafeMode(true); // disable cloud AI + web search for this session
      setMessages(prev => [...prev, { id: uid(), role: 'assistant', content: injCheck.warningMessage + '\n\n⚠ Safe mode activated — cloud AI and web search disabled for this session.' }]);
      return;
    }
    // 2. Anomaly check — rate limiter / session lock
    const anomaly = checkAnomaly();
    if (anomaly.locked) {
      setSessionLocked(true);
      setMessages(prev => [...prev, { id: uid(), role: 'assistant', content: anomaly.message }]);
      setTimeout(() => setSessionLocked(false), 30_000);
      return;
    }
    if (sessionLocked) setSessionLocked(false);

    // 3. Data classification — log routing decision (never logs raw input)
    const dataClass = classifyData(text);
    if (dataClass === 'medical') {
      logSecurityEvent('medical_input_classified', activePersona.id).catch(() => {});
    }

    setInputText('');

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: text };
    const newMessages: Message[] = [...messages, userMsg];

    setMessages(newMessages);
    setIsLoading(true);
    const respondingPersona = activePersona;
    controlRoomEvents.emit('persona_start', { personaId: respondingPersona.id });

    // ── Routing decision ─────────────────────────────────────
    // Medical is a HARD BLOCK — never routes to cloud under any circumstance.
    // offlineMode / safeMode / medical all force local.
    const isMedicalQuery = dataClass === 'medical';
    // Hard gates always win (medical, safe mode).
    // When localMode / offlineMode is ON: force local.
    // When localMode is OFF: always cloud (don't auto-route short messages to Llama).
    // Vera prefers local for medical queries but can use cloud for non-medical (e.g. "who are you?")
    const queryRoute: 'local' | 'cloud' =
      (safeMode || isMedicalQuery) ? 'local' :
      (offlineMode || localMode)   ? 'local' :
      'cloud';
    // IS_REAL_DEVICE removed from gate — returns false in dev builds even on real hardware.
    // localModelStatus === 'ready' is sufficient: initModel() has run and the context is loaded.
    const useLocalAI = queryRoute === 'local' && localModelStatus === 'ready';
    console.log('[ROUTING]', { offlineMode, safeMode, isMedicalQuery, queryRoute, localModelStatus, useLocalAI, IS_REAL_DEVICE });

    // ── Hard medical gate ─────────────────────────────────────
    // If this is a medical query and local AI is not available, refuse entirely.
    // There is no fallback to cloud. Privacy beats capability.
    if (isMedicalQuery && !useLocalAI) {
      setIsLoading(false);
      controlRoomEvents.emit('persona_complete', { personaId: respondingPersona.id });
      logSecurityEvent('medical_cloud_blocked', activePersona.id).catch(() => {});
      networkMonitor.logClassification({
        classification: 'medical',
        route:          'local',
        description:    'medical query BLOCKED — local AI unavailable, cloud refused by policy',
      });
      setMessages(prev => [...prev, {
        id: uid(),
        role: 'assistant',
        content: 'Medical queries are private — local AI required. Enable on a real iPhone to answer health questions on-device. Cloud AI will never receive this data.',
        personaId: respondingPersona.id,
      }]);
      return;
    }

    // ── Classification log — visible proof of routing decision ──
    networkMonitor.logClassification({
      classification: dataClass as 'medical' | 'general',
      route:          queryRoute,
      description:    isMedicalQuery
        ? 'medical keywords detected → routed to on-device Llama, cloud blocked by policy'
        : `general query → ${queryRoute === 'local' ? 'routed to local AI' : `sent to Claude API (${respondingPersona.label})`}`,
    });

    // ── Web search augmentation (cloud-only, disabled in offline/safe mode) ─
    let searchAugmentedText = text;
    let usedWebSearch = false;
    const searchDecision = !offlineMode && !safeMode && queryRoute === 'cloud' && shouldSearch(text);
    console.log('[SEARCH] shouldSearch result:', searchDecision, 'for input:', text.substring(0, 50));
    if (searchDecision && dataClass !== 'medical') {
      setIsSearching(true);
      controlRoomEvents.emit('search_start');
      try {
        networkMonitor.logCall({
          destination:          'tavily',
          url:                  'api.tavily.com/search',
          dataSizeBytes:        text.length,
          description:          'tavily web search — sanitized query (personal identifiers stripped)',
          containsMedicalAlert: false, // medical guard in shouldSearch() prevents reaching here
          safety:               'safe',
        });
        const searchResult = await tavilySearch(text);
        searchAugmentedText = buildSearchContext(text, searchResult);
        usedWebSearch = true;
        console.log('[SEARCH] Tavily search succeeded, answer length:', searchResult.answer?.length);
        controlRoomEvents.emit('search_complete', { success: true });
      } catch (e) {
        console.warn('[SEARCH] Tavily failed, falling back to Claude knowledge:', e);
        controlRoomEvents.emit('search_complete', { success: false });
      }
      setIsSearching(false);
    }

    // Only user + assistant messages sent to the API.
    // The latest user message uses vision format if it carries an image.
    // If web search ran, the last user message gets the augmented text.
    // Ensure augmented text is never empty — fall back to raw input
    const finalUserText = searchAugmentedText.trim() || text;

    const apiMessages = newMessages
      .filter(m => (m.role === 'user' || m.role === 'assistant') && (m.content ?? '').trim())
      .map((m, i, arr) => {
        const isLastUser = m.role === 'user' && i === arr.length - 1;
        if (m.role === 'user' && m.imageBase64) {
          return {
            role: 'user' as const,
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: m.imageBase64 } },
              { type: 'text', text: isLastUser ? finalUserText : m.content },
            ],
          };
        }
        return {
          role: m.role as 'user' | 'assistant',
          content: isLastUser ? finalUserText : m.content,
        };
      });

    // ── Build structured context for isolation layer ─────────────
    let singleConnCtx = '';
    try { singleConnCtx = await buildConnectorContext(text); } catch (e) { console.warn('[UI] build single connector context:', e); }
    const singleMemEntries = await loadMemory(respondingPersona.id);
    const singleKnowledge = await buildKnowledgePrompt(respondingPersona.id);
    const singleMedCount = medEntries.length;
    const singleMedFullCtx = singleMedCount > 0
      ? `\n\nUser has ${singleMedCount} health entries logged in their private medical memory.`
      : '';
    const singleMedCtx = buildMedicalContext(respondingPersona.id, singleMedCount, singleMedFullCtx);
    const singleMemPrompt = buildMemoryPrompt(singleMemEntries);
    const sharedCtx = await buildPersonaSharedContext(respondingPersona.id);
    console.log('[PROMPT] Structured context — persona:', respondingPersona.label, 'memory:', singleMemPrompt.length, 'knowledge:', singleKnowledge.length, 'shared:', sharedCtx.length);

    try {
      const promptMode: PromptMode = !settings.isMuted ? 'voice' : (useLocalAI ? 'local' : 'cloud');
      const result = await routeAI(searchAugmentedText, {
        forceLocal: useLocalAI,
        history: apiMessages.filter((m): m is ConversationMessage => typeof m.content === 'string'),
        systemPrompt: respondingPersona.systemPrompt + sharedCtx,
        mode: promptMode,
        memoryPrompt: singleMemPrompt,
        knowledgeContext: singleKnowledge,
        connectorContext: singleConnCtx,
        medicalContext: singleMedCtx,
      });
      const reply = sanitizeOutput(result.text);

      updateContext(text, reply);
      console.log(`[AI] model=${result.model} route=${result.route} latency=${result.latency}ms tools=${result.toolsUsed.join(',') || 'none'}`);

      controlRoomEvents.emit('persona_complete', { personaId: respondingPersona.id });

      const assistantMsg: Message = {
        id: uid(),
        role: 'assistant',
        content: reply,
        personaId: respondingPersona.id,
        webSearched: usedWebSearch,
        routedVia: result.route,
        model: result.model,
        latency: result.latency,
      };

      const finalMessages = [...newMessages, assistantMsg];
      setMessages(finalMessages);
      saveHistory(finalMessages.filter(m => m.role !== 'handoff'), activePersona.id);
      
      // Auto-generate conversation summary — only for substantive exchanges
      // Skip: short messages, greetings, one-word responses, repeated topics
      const substantiveMessages = finalMessages.filter(m => m.role !== 'handoff' && m.content.trim().length > 30);
      if (substantiveMessages.length >= 4) {
        const conversationId = `conv_${Date.now()}_${activePersona.id}`;
        const messagesToSummarize = finalMessages
          .filter(m => m.role !== 'handoff')
          .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

        summarizeConversation(conversationId, messagesToSummarize, CLAUDE_API_KEY)
          .then(summary => storeSummary(summary))
          .catch(e => console.error('[Summarizer] Failed:', e));
      }

      // Detect and save goals from user message (non-blocking)
      detectAndSaveGoals(text).catch(() => {});

      // AI-powered knowledge extraction (non-blocking, cloud only)
      if (!useLocalAI && shouldExtract(text, reply)) {
        extractKnowledge(text, reply)
          .then(result => { if (result) ingestExtraction(result); })
          .catch(() => {});
      }

      speak(reply, respondingPersona.id);
      // Memory extraction disabled — user triggers via "remember this" button
      // extractPatterns(respondingPersona.id, text, reply, CLAUDE_API_KEY)
      //   .then(() => loadMemory(activePersona.id))
      //   .then(setMemoryEntries)
      //   .catch(() => {});
    } catch (e) {
      console.warn('[UI] send message to AI:', e);
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', content: 'Error connecting to Claude.' }]);
    }
    setIsLoading(false);
  };

  // Keep ref in sync so silence timer always calls the latest version
  sendMessageRef.current = sendMessageWithText;

  const sendMessage = () => {
    const text = inputText.trim() || (attachment ? 'What do you see in this image?' : '');
    if (!text && !attachment) return;
    setInputText('');
    inputRef.current?.clear();
    sendMessageWithText(text);
  };

  const selectedVoiceName = elVoiceId
    ? (elVoices.find(v => v.voice_id === elVoiceId)?.name ?? elVoiceId)
    : 'system default';

  // Group EL voices by category
  const elGrouped: Record<string, ELVoice[]> = {};
  for (const v of elVoices) {
    const cat = v.category || 'other';
    if (!elGrouped[cat]) elGrouped[cat] = [];
    elGrouped[cat].push(v);
  }
  const elCategories = Object.keys(elGrouped).sort();


  return (
    <View style={[styles.root, { backgroundColor: '#080d14' }]}>
      <SacredGeometryBackground isSpeaking={isSpeaking} />


      {/* ── Face ID lock screen ───────────────────────────────── */}
      {authLocked && (
        <View style={styles.authLockOverlay}>
          <Text style={styles.authLockIcon}>⬡</Text>
          <Text style={styles.authLockTitle}>PrivateAI</Text>
          <Text style={styles.authLockSub}>your data is encrypted and locked</Text>
          <TouchableOpacity style={styles.authLockBtn} onPress={authenticate}>
            <Text style={styles.authLockBtnText}>Unlock with Face ID</Text>
          </TouchableOpacity>
        </View>
      )}
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={90}>

        {/* Header — minimal, persona switching moved to input bar */}
        <View style={styles.header}>
          <TouchableOpacity onPress={openSidebar} style={styles.hamburger}>
            <Ionicons name="menu" size={22} color="#6060a0" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>PrivateAI</Text>
          {offlineMode && (
            <View style={styles.offlineBadge}>
              <Text style={styles.offlineBadgeText}>offline</Text>
            </View>
          )}
          {safeMode && (
            <TouchableOpacity style={styles.safeModeBadge} onPress={() => setSafeMode(false)}>
              <Text style={styles.safeModeBadgeText}>⚠ safe mode</Text>
            </TouchableOpacity>
          )}
          {avatarMode === 'mini' && (
            <TouchableOpacity activeOpacity={1} onPress={() => {
              const now = Date.now();
              const taps = avatarTapTimestamps.current;
              taps.push(now);
              const recent = taps.filter(t => now - t < 800);
              avatarTapTimestamps.current = recent;
              if (recent.length >= 3) {
                avatarTapTimestamps.current = [];
                setMessages([]);
                logSecurityEvent('panic_lock', 'user_initiated').catch(() => {});
              }
            }}>
              <PersonaAvatar personaId={activePersona.id} speaking={isSpeaking} size={28} />
            </TouchableOpacity>
          )}
        </View>

        {/* Persona activity dots */}
        <View style={styles.activityDotRow}>
          {[
            { id: 'pete',       color: '#00ff00' },
            { id: 'architect',  color: '#00ffff' },
            { id: 'researcher', color: '#cc99ff' },
            { id: 'critic',     color: '#ff6600' },
            { id: 'builder',    color: '#ffff00' },
          ].map(({ id, color }) => {
            const status = dotStatuses[id] ?? 'idle';
            const isThinking = status === 'thinking';
            const opacity = isThinking
              ? dotPulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.0] })
              : status === 'complete' ? 0.7 : 0.15;
            const scale = isThinking
              ? dotPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.4] })
              : 1;
            return (
              <Animated.View
                key={id}
                style={[
                  styles.activityDot,
                  { backgroundColor: color, opacity, transform: [{ scale }] },
                ]}
              />
            );
          })}
        </View>

        {/* Persona Avatar — full mode only · triple-tap for panic lock */}
        {avatarMode === 'full' && (
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => {
              const now = Date.now();
              const taps = avatarTapTimestamps.current;
              taps.push(now);
              // Keep only taps within last 800 ms
              const recent = taps.filter(t => now - t < 800);
              avatarTapTimestamps.current = recent;
              if (recent.length >= 3) {
                avatarTapTimestamps.current = [];
                // Panic: clear session conversation history
                setMessages([]);
                logSecurityEvent('panic_lock', 'user_initiated').catch(() => {});
              }
            }}>
            <PersonaAvatar personaId={activePersona.id} speaking={isSpeaking} />
          </TouchableOpacity>
        )}

        {/* Messages */}
        <ScrollView
          ref={scrollViewRef}
          style={styles.messages}
          onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}>
          {messages.map((m, mi) => {
            // Inline handoff/return banners — skip divider lines (---.*---), show only kernel routing notes
            if (m.role === 'handoff') {
              if (/^---.*---$/s.test(m.content?.trim() ?? '')) return null;
              const p = PERSONAS.find(p => p.id === m.personaId) ?? activePersona;
              return (
                <View key={`msg-${mi}-${m.id}`} style={styles.handoffBanner}>
                  <Text style={[styles.handoffBannerText, { color: p.color }]}>{m.content}</Text>
                </View>
              );
            }
            // Regular user + assistant messages
            const msgPersona = m.role === 'assistant'
              ? (PERSONAS.find(p => p.id === m.personaId) ?? activePersona)
              : null;
            const personaColor = msgPersona?.color ?? activePersona.color;
            const isUser = m.role === 'user';
            return (
              <View key={`msg-${mi}-${m.id}`} style={[styles.messageRow, isUser ? styles.messageRowUser : styles.messageRowAssistant]}>
                <View style={[
                  styles.bubble,
                  !isUser && styles.bubbleAssistant,
                  isUser
                    ? { backgroundColor: 'rgba(20, 50, 35, 0.6)' }
                    : { backgroundColor: 'rgba(20, 20, 30, 0.6)', borderLeftWidth: 2, borderLeftColor: personaColor },
                ]}>
                  {!isUser && (
                    <Text style={[styles.bubbleLabel, { color: personaColor }]}>
                      {msgPersona?.tag ?? activePersona.tag}
                    </Text>
                  )}
                  {isUser && m.imageBase64 && (
                    <Image
                      source={{ uri: `data:image/jpeg;base64,${m.imageBase64}` }}
                      style={styles.bubbleImage}
                      resizeMode="cover"
                    />
                  )}
                  {m.webSearched && (
                    <View style={styles.webBadge}>
                      <Text style={styles.webBadgeText}>🌐 web</Text>
                    </View>
                  )}
                  {!isUser && m.routedVia && (
                    <View style={[styles.routeBadge, m.routedVia === 'local'
                      ? { backgroundColor: '#001a00', borderColor: '#004400' }
                      : { backgroundColor: '#000d1a', borderColor: '#003366' }]}>
                      <Text style={[styles.routeBadgeText, { color: m.routedVia === 'local' ? '#00aa44' : '#3366cc' }]}>
                        {m.routedVia === 'local' ? 'local' : m.routedVia === 'quick_reply' ? 'instant' : 'cloud'}
                        {m.model ? ` · ${m.model}` : ''}
                        {m.latency != null && m.latency > 0 ? ` · ${m.latency}ms` : ''}
                      </Text>
                    </View>
                  )}
                  <Text selectable style={[styles.bubbleText, { color: isUser ? '#a0ffb0' : '#e0e0f0' }]}>
                    {isUser ? m.content : stripMarkdown(m.content ?? '')}
                  </Text>
                  {/* File source citations */}
                  {!isUser && extractSources(m.content ?? '').length > 0 && (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                      {extractSources(m.content ?? '').map((src, si) => (
                        <View key={si} style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3, backgroundColor: 'rgba(0,150,255,0.12)', borderWidth: 1, borderColor: '#003366' }}>
                          <Text style={{ fontFamily: 'Courier New', fontSize: 9, color: '#4488cc' }}>{src}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                  {/* "Remember this" button — only on the last assistant message */}
                  {!isUser && mi === messages.length - 1 && !isLoading && (
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                      <TouchableOpacity
                        style={{ paddingVertical: 4, paddingHorizontal: 10, borderRadius: 4, backgroundColor: 'rgba(0,255,136,0.1)', borderWidth: 1, borderColor: '#004d22' }}
                        onPress={() => {
                          const lastUser = [...messages].reverse().find(msg => msg.role === 'user');
                          if (!lastUser) return;
                          // Validate before storing — prevent junk from entering the graph
                          const check = prevalidateForKG(lastUser.content);
                          if (check.conceptCount === 0) {
                            console.log('[KG] No meaningful concepts found in:', lastUser.content.slice(0, 80));
                            return;
                          }
                          kgIndex(lastUser.content, { confirmed: true });
                          console.log('[KG] Remembered:', check.labels.join(', '));
                        }}>
                        <Text style={{ fontFamily: 'Courier New', fontSize: 10, color: '#00ff88' }}>remember this</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={{ paddingVertical: 4, paddingHorizontal: 10, borderRadius: 4, backgroundColor: 'rgba(100,100,100,0.1)', borderWidth: 1, borderColor: '#333' }}
                        onPress={() => {}}>
                        <Text style={{ fontFamily: 'Courier New', fontSize: 10, color: '#666' }}>not important</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              </View>
            );
          })}
          {isLoading && (() => {
            const tp = (loadingPersonaId ? PERSONAS.find(p => p.id === loadingPersonaId) : null) ?? activePersona;
            return (
              <View style={[styles.messageRow, styles.messageRowAssistant]}>
                <View style={[styles.bubble, styles.bubbleAssistant, { backgroundColor: 'rgba(20, 20, 30, 0.6)', borderLeftWidth: 2, borderLeftColor: tp.color }]}>
                  <Text style={[styles.bubbleLabel, { color: tp.color }]}>{tp.tag}</Text>
                  <Text style={[styles.bubbleText, { color: '#8888aa' }]}>
                    {localMode ? 'generating locally...' : 'thinking...'}
                  </Text>
                </View>
              </View>
            );
          })()}
        </ScrollView>

        {/* TTS source indicator */}
        {ttsSource === 'system' && (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 4, backgroundColor: '#1a1a00', borderTopWidth: 1, borderTopColor: '#444400' }}>
            <Text style={{ fontFamily: FONT, fontSize: 11, color: '#aaaa00' }}>system voice (expo-speech) — not ElevenLabs</Text>
          </View>
        )}

        {/* ElevenLabs error bar */}
        {elSpeakError !== '' && (
          <TouchableOpacity onPress={() => setElSpeakError('')} style={styles.elErrorBar}>
            <Text style={styles.elErrorBarText}>{elSpeakError}</Text>
            <Text style={styles.elErrorBarText}> [x]</Text>
          </TouchableOpacity>
        )}

        {/* Stop speech bar */}
        {isSpeaking && (
          <TouchableOpacity onPress={stopAudio} style={styles.stopBar}>
            <Text style={styles.stopBarText}>[stop speaking]</Text>
          </TouchableOpacity>
        )}

        {/* Searching web indicator */}
        {isSearching && (
          <View style={styles.searchingBar}>
            <Text style={styles.searchingText}>🌐 searching web...</Text>
          </View>
        )}

        {/* Attach menu — camera / library */}
        {attachMenuVisible && (
          <View style={styles.attachMenu}>
            <TouchableOpacity style={styles.attachMenuRow} onPress={pickFromCamera}>
              <Text style={styles.attachMenuIcon}>📷</Text>
              <Text style={styles.attachMenuLabel}>Camera</Text>
            </TouchableOpacity>
            <View style={styles.attachMenuDivider} />
            <TouchableOpacity style={styles.attachMenuRow} onPress={pickFromLibrary}>
              <Text style={styles.attachMenuIcon}>🖼</Text>
              <Text style={styles.attachMenuLabel}>Photo Library</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Image preview strip */}
        {attachment && (
          <View style={styles.attachPreviewRow}>
            <Image source={{ uri: attachment.uri }} style={styles.attachPreviewThumb} resizeMode="cover" />
            <TouchableOpacity style={styles.attachPreviewRemove} onPress={() => setAttachment(null)}>
              <Text style={styles.attachPreviewRemoveText}>×</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Persona picker popup — floats above input bar */}
        {personaPickerVisible && (
          <View style={styles.personaPickerPopup}>
            {PERSONAS.map(p => {
              const active = activePersona.id === p.id;
              return (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.personaPickerRow, active && styles.personaPickerRowActive]}
                  onPress={() => { switchPersona(p); setPersonaPickerVisible(false); }}>
                  <View style={[styles.personaPickerDot, { backgroundColor: p.color,
                    shadowColor: p.color, shadowOpacity: 0.8, shadowRadius: 4, shadowOffset: { width: 0, height: 0 } }]} />
                  <View style={styles.personaPickerInfo}>
                    <Text style={[styles.personaPickerName, { color: active ? p.color : '#c0c0d0' }]}>
                      {p.label}
                    </Text>
                    <Text style={styles.personaPickerDesc}>{PERSONA_DESCS[p.id]}</Text>
                  </View>
                  {active && <Text style={[styles.personaPickerCheck, { color: p.color }]}>✓</Text>}
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Smart input bar */}
        <View style={styles.inputArea}>
          <View style={styles.inputCard}>
            {/* [+] attach button */}
            <TouchableOpacity
              onPress={() => { setAttachMenuVisible(v => !v); setPersonaPickerVisible(false); }}
              style={{
                width: 32, height: 32, borderRadius: 16,
                backgroundColor: attachMenuVisible ? 'rgba(77,184,164,0.2)' : 'rgba(255,255,255,0.08)',
                borderWidth: 1,
                borderColor: attachMenuVisible ? 'rgba(77,184,164,0.6)' : 'rgba(255,255,255,0.15)',
                alignItems: 'center', justifyContent: 'center', marginRight: 6,
              }}
              activeOpacity={0.6}>
              <Text style={{ color: attachMenuVisible ? '#4db8a4' : 'rgba(255,255,255,0.6)', fontSize: 18, lineHeight: 22 }}>+</Text>
            </TouchableOpacity>

            {/* Left: persona indicator */}
            <TouchableOpacity
              style={styles.personaIndicator}
              onPress={() => setPersonaPickerVisible(v => !v)}>
              <View style={[styles.personaIndicatorDot, {
                backgroundColor: activePersona.color,
                shadowColor: activePersona.color,
              }]} />
              <Text style={[styles.personaIndicatorName, { color: activePersona.color }]}>
                {activePersona.label}
              </Text>
            </TouchableOpacity>

            {/* Center: text input */}
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={inputText}
              onChangeText={setInputText}
              onSubmitEditing={sendMessage}
              onFocus={() => { setPersonaPickerVisible(false); setAttachMenuVisible(false); }}
              autoCorrect
              autoCapitalize="sentences"
              returnKeyType="send"
              placeholderTextColor="#303050"
              placeholder={isRecording ? 'Listening...' : PERSONA_PLACEHOLDER[activePersona.id]}
              multiline
            />

            {/* Right: mode + mic + send */}
            <View style={styles.inputButtons}>
              <Text style={styles.modeLabel}>
                {teamMode ? 'team' : (localMode && IS_REAL_DEVICE && localModelStatus === 'ready' ? 'local' : 'cloud')}
              </Text>
              <TouchableOpacity onPress={toggleVoice} style={styles.inputIconBtn}>
                <Ionicons
                  name={isRecording ? 'stop-circle' : 'mic-outline'}
                  size={20}
                  color={isRecording ? '#ff4444' : '#505060'}
                />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={sendMessage}
                style={[styles.sendBtn, inputText.trim() ? { backgroundColor: activePersona.color } : {}]}>
                <Ionicons
                  name="arrow-up"
                  size={15}
                  color={inputText.trim() ? '#000' : '#252535'}
                />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>

      <Sidebar
        visible={sidebarOpen}
        sidebarX={sidebarX}
        backdropOpacity={backdropOpacity}
        onClose={closeSidebar}
        activePersona={activePersona}
        messages={messages}
        onNewChat={() => {
          if (messages.length > 0) saveHistory([], activePersona.id);
          setMessages([]);
          setInputText('');
          closeSidebar();
        }}
        avatarMode={avatarMode}
        onAvatarModeChange={saveAvatarMode}
        memoryEntries={memoryEntries}
        onClearMemory={clearPersonaMemory}
        medEntries={medEntries}
        medPatterns={medPatterns}
        onMedAdd={() => { setMedRawInput(''); setMedAddVisible(true); }}
        onMedSummary={handleMedSummary}
        localMode={localMode}
        offlineMode={offlineMode}
        isRealDevice={IS_REAL_DEVICE}
        localModelStatus={localModelStatus}
        localModelProgress={localModelProgress}
        localModelError={localModelError}
        onLocalModeToggle={handleLocalModeToggle}
        onOfflineModeToggle={v => { setOfflineMode(v); AsyncStorage.setItem(OFFLINE_MODE_KEY, String(v)); }}
        onDownloadModel={handleDownloadModel}
        onSetLocalModelStatus={setLocalModelStatus}
        sessionLocked={sessionLocked}
        safeMode={safeMode}
        onSetSessionLocked={setSessionLocked}
        onSetSafeMode={setSafeMode}
        connectors={connectors}
        onToggleCalendar={toggleCalendar}
        onToggleNotes={v => updateConnectors({ notes: v })}
        onToggleReminders={toggleReminders}
        kbEntries={kbEntries}
        kbPicking={kbPicking}
        onPickKbFile={pickKbFile}
        onOpenKbPaste={() => { setKbModalError(''); setKbModalVisible(true); }}
        onDeleteKbEntry={deleteKbEntry}
        onIndexFolder={handleIndexFolder}
        indexProgress={indexProgress}
      />

      <MedicalModals
        addVisible={medAddVisible}
        rawInput={medRawInput}
        extracting={medExtracting}
        onRawInputChange={setMedRawInput}
        onSubmit={handleMedSubmit}
        onCloseAdd={() => { setMedAddVisible(false); setMedRawInput(''); }}
        confirmVisible={medConfirmVisible}
        pending={medPending}
        urgent={medUrgent}
        onConfirm={handleMedConfirm}
        onCloseConfirm={() => { setMedConfirmVisible(false); setMedPending(null); }}
        summaryVisible={medSummaryVisible}
        summaryText={medSummaryText}
        summaryLoading={medSummaryLoading}
        onCloseSummary={() => { setMedSummaryVisible(false); setMedSummaryText(''); }}
        onShare={handleMedShare}
      />

      <KnowledgeBaseModal
        visible={kbModalVisible}
        title={kbModalTitle}
        content={kbModalContent}
        error={kbModalError}
        personaLabel={activePersona.label}
        onTitleChange={setKbModalTitle}
        onContentChange={setKbModalContent}
        onSave={saveKbText}
        onClose={() => { setKbModalVisible(false); setKbModalError(''); }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#080d14' },
  container: { flex: 1, paddingTop: 60, backgroundColor: 'transparent' },

  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, paddingVertical: 8, gap: 8 },
  hamburger: { paddingLeft: 14, paddingRight: 8, paddingVertical: 6 },
  headerTitle: { fontFamily: FONT, fontSize: 13, color: '#888', letterSpacing: 2, flex: 1 },
  // ── Auth lock overlay ─────────────────────────────────────
  authLockOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#080d14',
    zIndex: 999,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  authLockIcon: { fontSize: 48, color: '#00ff00', opacity: 0.8 },
  authLockTitle: { fontFamily: FONT, fontSize: 18, color: '#c0c0d0', letterSpacing: 4 },
  authLockSub: { fontFamily: FONT, fontSize: 11, color: '#8888aa', letterSpacing: 1, textAlign: 'center', paddingHorizontal: 40 },
  authLockBtn: { marginTop: 8, borderWidth: 1, borderColor: '#00ff00', borderRadius: 8, paddingHorizontal: 28, paddingVertical: 12 },
  authLockBtnText: { fontFamily: FONT, fontSize: 13, color: '#00ff00', letterSpacing: 1 },

  // ── Safe mode badge ───────────────────────────────────────
  safeModeBadge: { borderWidth: 1, borderColor: '#ff4444', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  safeModeBadgeText: { fontFamily: FONT, fontSize: 9, color: '#ff4444', letterSpacing: 1 },

  offlineBadge: { borderWidth: 1, borderColor: '#ff9500', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  offlineBadgeText: { fontFamily: FONT, fontSize: 9, color: '#ff9500', letterSpacing: 1 },
  routeBadge: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, marginBottom: 4 },
  routeBadgeText: { fontFamily: FONT, fontSize: 9, letterSpacing: 1 },
  activityDotRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingBottom: 4 },
  activityDot: { width: 6, height: 6, borderRadius: 3 },

  messages: { flex: 1, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: 'transparent' },
  messageRow: { marginBottom: 6 },
  messageRowUser: { alignItems: 'flex-end' },
  messageRowAssistant: { alignItems: 'flex-start' },
  bubble: { maxWidth: '82%', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleAssistant: { alignSelf: 'flex-start' },
  bubbleLabel: { fontFamily: FONT, fontSize: 10, fontWeight: '600', letterSpacing: 0.5, marginBottom: 4, textTransform: 'uppercase' },
  bubbleText: { fontFamily: FONT, fontSize: 14, lineHeight: 21 },
  prefix: { fontFamily: FONT, fontSize: 14 },
  messageText: { color: '#fff', fontFamily: FONT, fontSize: 14, flex: 1 },

  elErrorBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 16, backgroundColor: '#1a0000', borderTopWidth: 1, borderTopColor: '#440000' },
  elErrorBarText: { fontFamily: FONT, fontSize: 12, color: '#ff4444' },
  stopBar: { alignItems: 'center', paddingVertical: 8, backgroundColor: '#0a0a0a', borderTopWidth: 1, borderTopColor: '#1a1a1a' },
  stopBarText: { fontFamily: FONT, fontSize: 13, color: '#ff4444' },

  searchingBar: { alignItems: 'center', paddingVertical: 6 },
  searchingText: { fontFamily: FONT, fontSize: 11, color: '#6699bb', letterSpacing: 1 },

  messageContent: { flex: 1 },
  webBadge: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#0a1a2a', borderWidth: 1, borderColor: '#1a3a5a',
    borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, marginBottom: 4,
  },
  webBadgeText: { fontFamily: FONT, fontSize: 9, color: '#6699cc', letterSpacing: 1 },

  // ── Persona picker popup ──────────────────────────────────────
  personaPickerPopup: {
    marginHorizontal: 12, marginBottom: 6,
    backgroundColor: '#1a1a2a',
    borderRadius: 16, borderWidth: 1, borderColor: '#252540',
    overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.4, shadowRadius: 12, elevation: 8,
  },
  personaPickerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: '#1e1e30',
  },
  personaPickerRowActive: { backgroundColor: 'rgba(255,255,255,0.03)' },
  personaPickerDot: { width: 9, height: 9, borderRadius: 5 },
  personaPickerInfo: { flex: 1, gap: 1 },
  personaPickerName: { fontFamily: FONT, fontSize: 13, letterSpacing: 0.3 },
  personaPickerDesc: { fontFamily: FONT, fontSize: 10, color: '#8888aa', letterSpacing: 0.2 },
  personaPickerCheck: { fontFamily: FONT, fontSize: 14 },

  // ── Attach menu ──────────────────────────────────────────────
  attachMenu: {
    marginHorizontal: 12, marginBottom: 6,
    backgroundColor: '#1a1a2a', borderRadius: 14,
    borderWidth: 1, borderColor: '#252540',
    overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.35, shadowRadius: 8, elevation: 6,
  },
  attachMenuRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 18, paddingVertical: 13,
  },
  attachMenuDivider: { height: 1, backgroundColor: '#1e1e30', marginHorizontal: 18 },
  attachMenuIcon: { fontSize: 20 },
  attachMenuLabel: { fontFamily: FONT, fontSize: 13, color: '#c0c0d0' },

  // ── Image preview strip ───────────────────────────────────────
  attachPreviewRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingBottom: 6, gap: 8,
  },
  attachPreviewThumb: { width: 60, height: 60, borderRadius: 10 },
  attachPreviewRemove: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#2a0a0a', borderWidth: 1, borderColor: '#ff4444',
    justifyContent: 'center', alignItems: 'center',
    position: 'absolute', top: -6, left: 52,
  },
  attachPreviewRemoveText: { color: '#ff4444', fontSize: 14, lineHeight: 16, textAlign: 'center' },

  // ── Image in bubble ──────────────────────────────────────────
  bubbleImage: { width: 200, height: 150, borderRadius: 10, marginBottom: 8 },

  // ── Smart input bar ───────────────────────────────────────────
  inputArea: { paddingHorizontal: 12, paddingVertical: 8, paddingBottom: 16 },
  inputCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(20, 20, 35, 0.92)',
    borderRadius: 28, borderWidth: 1, borderColor: '#252540',
    paddingLeft: 12, paddingRight: 8, paddingVertical: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  personaIndicator: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 8, paddingVertical: 6,
    marginRight: 4,
  },
  personaIndicatorDot: {
    width: 8, height: 8, borderRadius: 4,
    shadowOpacity: 0.9, shadowRadius: 5, shadowOffset: { width: 0, height: 0 },
  },
  personaIndicatorName: { fontFamily: FONT, fontSize: 11, letterSpacing: 0.5 },
  modeLabel: { fontFamily: FONT, fontSize: 9, color: '#888', letterSpacing: 1, paddingRight: 4 },
  inputRow: { flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: '#111', borderTopWidth: 1, borderTopColor: '#222' },
  inputPrompt: { color: '#00ff00', fontFamily: FONT, fontSize: 14 },
  input: { flex: 1, fontSize: 15, lineHeight: 20, color: '#d0d0e8', paddingVertical: 6, maxHeight: 100 },
  inputButtons: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  inputIconBtn: { width: 34, height: 34, justifyContent: 'center', alignItems: 'center' },
  sendBtn: { width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1a1a2a' },
  actionBtn: { color: '#00ff00', fontFamily: FONT, fontSize: 14, paddingLeft: 8 },

  // Handoff banners
  handoffBanner: { alignItems: 'center', paddingVertical: 8, marginVertical: 2 },
  handoffBannerText: { fontFamily: FONT, fontSize: 11, letterSpacing: 1, opacity: 0.7 },

  // AI mode header badge
  aiModeBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4 },
  aiModeBadgeText: { fontFamily: FONT, fontSize: 9, letterSpacing: 1 },
});


