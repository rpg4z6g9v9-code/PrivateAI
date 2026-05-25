/**
 * PrivateAI v2 — Simplified Chat Interface
 * 
 * Core: Claude via cloud API (optional local fallback)
 * Privacy: Sensitive data (medical, financial) stays encrypted on-device, never touches cloud
 * 
 * No personas, no team mode, no bloat.
 * Just: clear chat, voice input, encrypted storage, security transparency.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Animated, Dimensions, KeyboardAvoidingView, Modal, Platform,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import * as LocalAuth from 'expo-local-authentication';
import Voice, { SpeechResultsEvent, SpeechErrorEvent } from '@react-native-voice/voice';
import { Ionicons } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';

import CognitiveBackground from '@/components/chat/CognitiveBackground';
import { networkMonitor } from '@/services/networkMonitor';
import { checkInjection, sanitizeOutput, classifyData, logSecurityEvent } from '@/services/securityGateway';
import { canAccessVault, unlockVault, lockVault } from '@/services/dataVault';
import { routeAI } from '@/services/aiRouter';
import { checkPrivateNode, type PrivateNodeStatus } from '@/services/localAI';
import {
  initConversationDB, persistMessage, loadConversation, clearConversation,
  createConversation, getLatestConversationId, getConversations, searchConversations,
  updateConversationTitle, DEFAULT_CONVO_ID, type ConversationSummary,
} from '@/services/conversationDB';
import type { ConversationMessage } from '@/services/claude';
import { AppState, type AppStateStatus } from 'react-native';
import Constants from 'expo-constants';

// ── Types ──────────────────────────────────────────────────────
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  imageBase64?: string;
  routedVia?: 'local' | 'cloud' | 'quick_reply';
  model?: string;
  latency?: number;
}

interface AttachmentImage {
  uri: string;
  base64: string;
  width: number;
  height: number;
}

// ── Constants ──────────────────────────────────────────────────
const FONT = 'Courier New';
const CLAUDE_API_KEY = process.env.EXPO_PUBLIC_CLAUDE_API_KEY ?? '';
// HISTORY_KEY kept for reference; messages now persisted in SQLite via conversationDB.ts
// const HISTORY_KEY = 'chat_history_v1';
const AUTH_LOCKED_KEY = 'auth_locked_v1';
const SETTINGS_KEY = 'voice_settings_v1';
const BACKGROUND_LOCK_MS = 5 * 60 * 1000; // 5 minutes
const SILENCE_TIMEOUT_MS = 4000; // Auto-stop after 4s silence

// ── Main Component ─────────────────────────────────────────────
export default function ChatScreen() {
  // Core chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [isRestoring, setIsRestoring] = useState(true);
  const [activeConversationId, setActiveConversationId] = useState(DEFAULT_CONVO_ID);
  const [inputText, setInputText] = useState('');
  const [attachment, setAttachment] = useState<AttachmentImage | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingDots, setLoadingDots] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);

  // Voice state
  const [isRecording, setIsRecording] = useState(false);
  const voiceDoneRef = useRef(false);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputTextRef = useRef('');
  const sendMessageRef = useRef<(text: string) => void>(() => {});

  // Auth & security
  const [authLocked, setAuthLocked] = useState(true);
  const [sessionLocked, setSessionLocked] = useState(false);
  const [safeMode, setSafeMode] = useState(false);
  const backgroundedAt = useRef<number | null>(null);

  // Node status
  const [nodeStatus, setNodeStatus] = useState<PrivateNodeStatus | null>(null);
  const [isCheckingNode, setIsCheckingNode] = useState(false);

  // History modal
  const [showHistory, setShowHistory] = useState(false);
  const [historyList, setHistoryList] = useState<ConversationSummary[]>([]);
  const [historyQuery, setHistoryQuery] = useState('');

  // Rename modal
  const [showRename, setShowRename] = useState(false);
  const [renameTarget, setRenameTarget] = useState<ConversationSummary | null>(null);
  const [renameText, setRenameText] = useState('');


  // UI state
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebarX = useRef(new Animated.Value(-200)).current;

  // ── Face ID Authentication ────────────────────────────────────
  const authenticate = useCallback(async () => {
    const hasHardware = await LocalAuth.hasHardwareAsync();
    const isEnrolled = await LocalAuth.isEnrolledAsync();

    if (!hasHardware || !isEnrolled) {
      setAuthLocked(false);
      await unlockVault();
      return;
    }

    const result = await LocalAuth.authenticateAsync({
      promptMessage: 'PrivateAI — verify identity',
      fallbackLabel: 'Use Passcode',
      disableDeviceFallback: false,
    });

    if (result.success) {
      setAuthLocked(false);
      await unlockVault();
    }
  }, []);

  // Background lock: if backgrounded > 5 min, re-lock on return
  // Also refresh node status when app comes to foreground
  useEffect(() => {
    authenticate();
    checkPrivateNode().then(setNodeStatus);

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
        // Refresh node status every time the app returns to foreground
        checkPrivateNode().then(setNodeStatus);
      }
    });

    return () => sub.remove();
  }, [authenticate]);

  // ── Init DB and restore conversation on mount ─────────────────
  useEffect(() => {
    (async () => {
      try {
        await initConversationDB();
        const convoId = await getLatestConversationId();
        setActiveConversationId(convoId);
        const rows = await loadConversation(convoId);
        if (rows.length > 0) {
          setMessages(rows.map(r => ({
            id: r.id,
            role: r.role,
            content: r.content,
            routedVia: (r.routedVia as Message['routedVia']) ?? undefined,
            latency: r.latency ?? undefined,
            model: r.model ?? undefined,
          })));
        }
      } catch (e) {
        console.warn('[DB] Load conversation failed:', e);
      } finally {
        setIsRestoring(false);
      }
    })();
  }, []);

  // ── Loading dots animation ─────────────────────────────────────
  useEffect(() => {
    if (!isLoading) {
      setLoadingDots('');
      return;
    }
    const seq = ['.', '..', '...', '..'];
    let i = 0;
    const id = setInterval(() => {
      setLoadingDots(seq[i++ % seq.length]);
    }, 400);
    return () => clearInterval(id);
  }, [isLoading]);

  // ── Voice Input Setup ──────────────────────────────────────────
  const resetSilenceTimer = () => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = setTimeout(() => {
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
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  useEffect(() => {
    Voice.onSpeechStart = () => {
      voiceDoneRef.current = false;
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
      resetSilenceTimer();
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
      Voice.removeAllListeners();
    };
  }, []);

  // ── Handle Voice Record Start ──────────────────────────────────
  const startVoiceInput = async () => {
    try {
      voiceDoneRef.current = false;
      await Voice.start('en-US');
    } catch (e) {
      console.warn('[Voice] Start error:', e);
      Alert.alert('Voice Error', 'Could not start recording');
    }
  };

  // ── Handle Message Send ────────────────────────────────────────
  const sendMessageWithText = async (text: string) => {
    if (!text.trim()) return;

    // Security check: detect injection
    const injectCheck = checkInjection(text);
    if (injectCheck.detected) {
      setSafeMode(true);
      logSecurityEvent('injection_detected', 'user').catch(() => {});
      Alert.alert(
        'Security Warning',
        'Potential prompt injection detected. Cloud features disabled.',
        [{ text: 'OK' }]
      );
      return;
    }

    // Classify data (medical, financial, PII)
    const dataClass = classifyData(text);
    const isSensitive = dataClass.hasMedical || dataClass.hasFinancial || dataClass.hasPII;

    try {
      setIsLoading(true);

      // Fresh node check before every send.
      // Routing uses freshStatus directly — never React state, which is async and stale.
      setNodeStatus(null);
      setIsCheckingNode(true);
      let freshStatus: PrivateNodeStatus;
      try {
        freshStatus = await checkPrivateNode();
      } catch {
        freshStatus = { online: false, host: '', latency: null, models: [] };
      } finally {
        setIsCheckingNode(false);
      }
      if (!freshStatus.online) {
        console.log('[PrivateNode] online=false source=fresh-check');
      }
      setNodeStatus(freshStatus);

      const userMsg: Message = {
        id: `${Date.now()}_user`,
        role: 'user',
        content: text,
        imageBase64: attachment?.base64,
      };

      const newMessages = [...messages, userMsg];
      setMessages(newMessages);
      setAttachment(null);
      persistMessage(userMsg, activeConversationId).catch(e => console.warn('[DB] persist user msg failed:', e));

      // Route to AI (cloud or local, respecting security constraints)
      const result = await routeAI({
        messages: newMessages.map(m => ({
          role: m.role,
          content: m.content,
        })) as ConversationMessage[],
        isSensitive,
        safeMode,
        nodeOnline: freshStatus.online,
      });

      const reply = sanitizeOutput(result.text);

      networkMonitor.logCall({
        destination: result.route === 'local' ? 'local_llama' : 'claude_api',
        url: result.route === 'local' ? 'localhost:11434' : 'api.anthropic.com',
        dataSizeBytes: JSON.stringify(newMessages).length,
        description: `Chat message (${isSensitive ? 'sensitive' : 'regular'})`,
        containsMedicalAlert: dataClass.hasMedical,
        safety: injectCheck.detected ? 'blocked' : 'safe',
      });

      const assistantMsg: Message = {
        id: `${Date.now()}_assistant`,
        role: 'assistant',
        content: reply,
        routedVia: result.route,
        model: result.model,
        latency: result.latency,
      };

      const finalMessages = [...newMessages, assistantMsg];
      setMessages(finalMessages);
      persistMessage(assistantMsg, activeConversationId).catch(e => console.warn('[DB] persist assistant msg failed:', e));

      // Speak response
      if (reply) {
        setIsSpeaking(true);
        await Speech.speak(reply, {
          rate: 1.0,
          onDone: () => setIsSpeaking(false),
          onError: () => setIsSpeaking(false),
        });
      }
    } catch (e) {
      console.warn('[Chat] Send message error:', e);
      Alert.alert('Error', 'Could not send message');
    } finally {
      setIsLoading(false);
    }
  };

  sendMessageRef.current = sendMessageWithText;

  // ── Handle Send Button Press ───────────────────────────────────
  const handleSend = () => {
    const text = inputText.trim() || (attachment ? 'What do you see in this image?' : '');
    if (!text && !attachment) return;
    setInputText('');
    sendMessageWithText(text);
  };

  // ── New Chat ───────────────────────────────────────────────────
  const handleNewChat = () => {
    Alert.alert('New Chat', 'Start a new conversation? Current session is preserved.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'New Chat',
        onPress: async () => {
          try {
            const newId = await createConversation();
            setActiveConversationId(newId);
            setMessages([]);
          } catch (e) {
            console.warn('[DB] createConversation failed:', e);
          }
        },
      },
    ]);
  };

  // ── History Modal ──────────────────────────────────────────────
  const openHistory = async () => {
    try {
      setHistoryQuery('');
      const list = await getConversations();
      setHistoryList(list);
      setShowHistory(true);
    } catch (e) {
      console.warn('[DB] getConversations failed:', e);
    }
  };

  const handleHistorySearch = async (q: string) => {
    setHistoryQuery(q);
    try {
      const list = await searchConversations(q);
      setHistoryList(list);
    } catch (e) {
      console.warn('[DB] searchConversations failed:', e);
    }
  };

  const switchToConversation = async (id: string) => {
    try {
      const rows = await loadConversation(id);
      setActiveConversationId(id);
      setMessages(rows.map(r => ({
        id: r.id,
        role: r.role,
        content: r.content,
        routedVia: (r.routedVia as Message['routedVia']) ?? undefined,
        latency: r.latency ?? undefined,
        model: r.model ?? undefined,
      })));
      setShowHistory(false);
    } catch (e) {
      console.warn('[DB] switchToConversation failed:', e);
    }
  };

  // ── Rename ────────────────────────────────────────────────────
  const startRename = (conv: ConversationSummary) => {
    console.log('[Rename] target id:', conv.id, 'current title:', conv.title);
    setRenameTarget(conv);
    setRenameText(conv.title ?? conv.snippet?.slice(0, 40) ?? '');
    setShowRename(true);
  };

  const confirmRename = async () => {
    const title = renameText.trim();
    console.log('[Rename] new title:', JSON.stringify(title), '| target:', renameTarget?.id);
    if (!renameTarget || !title) {
      console.log('[Rename] aborted — no target or empty title');
      setShowRename(false);
      return;
    }
    try {
      await updateConversationTitle(renameTarget.id, title);
      console.log('[Rename] update complete');
      const list = await searchConversations(historyQuery);
      console.log('[Rename] refreshed list titles:', list.map(c => `${c.id.slice(-6)}="${c.title}"`).join(', '));
      setHistoryList(list);
    } catch (e) {
      console.warn('[Rename] failed:', e);
    } finally {
      setShowRename(false);
      setRenameTarget(null);
    }
  };

  // ── Handle Image Attachment ────────────────────────────────────
  const pickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        aspect: [4, 3],
        quality: 0.8,
        base64: true,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        setAttachment({
          uri: asset.uri,
          base64: asset.base64 ?? '',
          width: asset.width,
          height: asset.height,
        });
      }
    } catch (e) {
      console.warn('[Image] Pick error:', e);
    }
  };

  // ── Conversation grouping helper ──────────────────────────────
  const groupConversations = (list: ConversationSummary[]) => {
    const now = Date.now();
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const startOfYesterday = new Date(startOfToday); startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    const startOf7Days = new Date(startOfToday); startOf7Days.setDate(startOf7Days.getDate() - 7);

    const groups: { label: string; items: ConversationSummary[] }[] = [
      { label: 'Today', items: [] },
      { label: 'Yesterday', items: [] },
      { label: 'Last 7 days', items: [] },
      { label: 'Older', items: [] },
    ];

    for (const conv of list) {
      const ts = conv.lastActive ?? conv.createdAt;
      if (ts >= startOfToday.getTime())       groups[0].items.push(conv);
      else if (ts >= startOfYesterday.getTime()) groups[1].items.push(conv);
      else if (ts >= startOf7Days.getTime())  groups[2].items.push(conv);
      else                                     groups[3].items.push(conv);
    }

    return groups.filter(g => g.items.length > 0);
  };

  // ── Render ─────────────────────────────────────────────────────
  if (authLocked) {
    return (
      <View style={styles.authOverlay}>
        <Text style={styles.authIcon}>⬡</Text>
        <Text style={styles.authTitle}>PrivateAI</Text>
        <Text style={styles.authSub}>your data is encrypted and locked</Text>
        <TouchableOpacity style={styles.authBtn} onPress={authenticate}>
          <Text style={styles.authBtnText}>Unlock with Face ID</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: '#080d14' }]}>
      <CognitiveBackground isSpeaking={isSpeaking} />

      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={90}>

        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={handleNewChat} style={styles.newChatBtn}>
            <Text style={styles.newChatText}>+ new</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Claude</Text>
          <View style={styles.headerRight}>
            {isCheckingNode ? (
              <Text style={[styles.nodeBadge, { color: '#888888' }]}>checking node...</Text>
            ) : nodeStatus !== null && (
              <Text style={[styles.nodeBadge, { color: nodeStatus.online ? '#44cc88' : '#cc4444' }]}>
                {nodeStatus.online
                  ? `● node · ${nodeStatus.latency}ms`
                  : '● offline · cloud only'}
              </Text>
            )}
            {safeMode && <View style={styles.safeBadge}><Text style={styles.safeBadgeText}>safe mode</Text></View>}
            <TouchableOpacity onPress={openHistory} style={styles.historyBtn}>
              <Text style={styles.historyBtnText}>≡</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Messages */}
        <ScrollView style={styles.messages} contentContainerStyle={{ paddingBottom: 16 }}>
          {isRestoring && (
            <Text style={styles.restoringText}>Restoring conversation...</Text>
          )}
          {messages.map((msg, i) => (
            <View key={msg.id} style={[styles.msgRow, msg.role === 'user' ? styles.msgUser : styles.msgAssistant]}>
              <View style={[
                styles.bubble,
                msg.role === 'user'
                  ? { backgroundColor: 'rgba(20, 50, 35, 0.6)' }
                  : { backgroundColor: 'rgba(20, 20, 30, 0.6)', borderLeftWidth: 2, borderLeftColor: '#4a9eff' },
              ]}>
                {msg.imageBase64 && (
                  <View style={styles.imgPreview}>
                    {/* Base64 image preview would go here */}
                  </View>
                )}
                <Text selectable style={[
                  styles.msgText,
                  { color: msg.role === 'user' ? '#a0ffb0' : '#e0e0f0' },
                ]}>
                  {msg.content}
                </Text>
                {msg.routedVia && (
                  <Text style={styles.routeBadge}>
                    {msg.routedVia === 'local' ? '🖥️ private node' : '☁️  cloud'} · {msg.latency}ms
                  </Text>
                )}
              </View>
            </View>
          ))}

          {isLoading && (
            <View style={[styles.msgRow, styles.msgAssistant]}>
              <View style={[styles.bubble, { backgroundColor: 'rgba(20, 20, 30, 0.6)', borderLeftWidth: 2, borderLeftColor: '#4a9eff' }]}>
                <Text style={styles.msgText}>{loadingDots}</Text>
              </View>
            </View>
          )}
        </ScrollView>

        {/* Image preview */}
        {attachment && (
          <View style={styles.attachPreview}>
            <Text style={styles.attachLabel}>📎 image attached</Text>
            <TouchableOpacity onPress={() => setAttachment(null)}>
              <Text style={styles.attachRemove}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Input area */}
        <View style={styles.inputArea}>
          <View style={styles.inputCard}>
            <TextInput
              ref={() => {}}
              style={styles.input}
              placeholder="Ask Claude..."
              placeholderTextColor="#666"
              value={inputText}
              onChangeText={setInputText}
              editable={!isLoading}
              multiline
            />
            <TouchableOpacity onPress={pickImage} style={styles.iconBtn}>
              <Ionicons name="image" size={20} color="#4a9eff" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={isRecording ? () => Voice.stop() : startVoiceInput}
              style={[styles.iconBtn, isRecording && styles.recordingActive]}>
              <Ionicons name={isRecording ? 'mic' : 'mic-outline'} size={20} color={isRecording ? '#ff4444' : '#4a9eff'} />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleSend} style={[styles.sendBtn, isLoading && { opacity: 0.5 }]} disabled={isLoading}>
              <Ionicons name="send" size={18} color="#00ff88" />
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* History Modal */}
      <Modal
        visible={showHistory}
        animationType="slide"
        transparent
        onRequestClose={() => setShowHistory(false)}>
        <View style={styles.historyOverlay}>
          <View style={styles.historySheet}>
            <View style={styles.historyHeader}>
              <Text style={styles.historyTitle}>Conversations</Text>
              <TouchableOpacity onPress={() => setShowHistory(false)}>
                <Text style={styles.historyClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.historySearchRow}>
              <TextInput
                style={styles.historySearch}
                placeholder="Search conversations..."
                placeholderTextColor="#444"
                value={historyQuery}
                onChangeText={handleHistorySearch}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <ScrollView style={styles.historyList}>
              {historyList.length === 0 ? (
                <Text style={styles.historyEmpty}>
                  {historyQuery ? 'No matches' : 'No previous conversations'}
                </Text>
              ) : (() => {
                const renderItem = (conv: ConversationSummary) => {
                  const isActive = conv.id === activeConversationId;
                  const label = conv.title
                    ?? (conv.snippet ? conv.snippet.slice(0, 60) + (conv.snippet.length > 60 ? '…' : '') : '(empty)');
                  return (
                    <TouchableOpacity
                      key={conv.id}
                      style={[styles.historyItem, isActive && styles.historyItemActive]}
                      onPress={() => switchToConversation(conv.id)}
                      onLongPress={() => startRename(conv)}
                      delayLongPress={400}>
                      <Text style={styles.historySnippet} numberOfLines={2}>{label}</Text>
                      {isActive && <Text style={styles.historyActiveIndicator}>current</Text>}
                    </TouchableOpacity>
                  );
                };

                if (historyQuery) {
                  // Search results: flat list, no grouping
                  return historyList.map(renderItem);
                }

                // Browsing: grouped by recency
                return groupConversations(historyList).map(group => (
                  <View key={group.label}>
                    <Text style={styles.historyGroupLabel}>{group.label}</Text>
                    {group.items.map(renderItem)}
                  </View>
                ));
              })()}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Rename Modal */}
      <Modal
        visible={showRename}
        animationType="fade"
        transparent
        onRequestClose={() => setShowRename(false)}>
        <View style={styles.renameOverlay}>
          <View style={styles.renameSheet}>
            <Text style={styles.renameTitle}>Rename conversation</Text>
            <TextInput
              style={styles.renameInput}
              value={renameText}
              onChangeText={setRenameText}
              autoFocus
              autoCapitalize="sentences"
              autoCorrect={false}
              maxLength={80}
              onSubmitEditing={confirmRename}
              returnKeyType="done"
            />
            <View style={styles.renameActions}>
              <TouchableOpacity onPress={() => setShowRename(false)} style={styles.renameCancelBtn}>
                <Text style={styles.renameCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={confirmRename} style={styles.renameConfirmBtn}>
                <Text style={styles.renameConfirmText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#080d14' },
  container: { flex: 1, paddingTop: 40 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1a1a2a' },
  headerTitle: { fontFamily: FONT, fontSize: 16, fontWeight: '600', color: '#c0c0d0', letterSpacing: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  newChatBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  newChatText: { fontFamily: FONT, fontSize: 11, color: '#4a9eff', letterSpacing: 0.5 },
  nodeBadge: { fontFamily: FONT, fontSize: 9, letterSpacing: 0.5 },
  safeBadge: { borderWidth: 1, borderColor: '#ff9500', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3 },
  safeBadgeText: { fontFamily: FONT, fontSize: 9, color: '#ff9500', letterSpacing: 0.5 },

  authOverlay: { flex: 1, backgroundColor: '#080d14', alignItems: 'center', justifyContent: 'center', gap: 16 },
  authIcon: { fontSize: 48, color: '#00ff00', opacity: 0.8 },
  authTitle: { fontFamily: FONT, fontSize: 20, fontWeight: '600', color: '#c0c0d0', letterSpacing: 2 },
  authSub: { fontFamily: FONT, fontSize: 12, color: '#888', letterSpacing: 0.5, textAlign: 'center', paddingHorizontal: 40 },
  authBtn: { marginTop: 8, borderWidth: 1, borderColor: '#00ff00', borderRadius: 8, paddingHorizontal: 32, paddingVertical: 12 },
  authBtnText: { fontFamily: FONT, fontSize: 13, color: '#00ff00', letterSpacing: 1 },

  messages: { flex: 1, paddingHorizontal: 12, paddingVertical: 8 },
  msgRow: { marginBottom: 8 },
  msgUser: { alignItems: 'flex-end' },
  msgAssistant: { alignItems: 'flex-start' },
  bubble: { maxWidth: '85%', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10 },
  msgText: { fontFamily: FONT, fontSize: 14, lineHeight: 20 },
  routeBadge: { fontFamily: FONT, fontSize: 9, color: '#6699cc', marginTop: 6, opacity: 0.7 },
  restoringText: { fontFamily: FONT, fontSize: 11, color: '#555566', textAlign: 'center', paddingVertical: 24, letterSpacing: 0.5 },

  imgPreview: { width: 160, height: 120, borderRadius: 8, backgroundColor: '#1a1a2a', marginBottom: 8 },

  attachPreview: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#1a1a2a', borderTopWidth: 1, borderTopColor: '#252540' },
  attachLabel: { fontFamily: FONT, fontSize: 12, color: '#4a9eff', flex: 1 },
  attachRemove: { fontFamily: FONT, fontSize: 16, color: '#888', paddingHorizontal: 8 },

  inputArea: { paddingHorizontal: 12, paddingVertical: 8, paddingBottom: 20 },
  inputCard: { flexDirection: 'row', alignItems: 'flex-end', backgroundColor: 'rgba(20, 20, 35, 0.92)', borderRadius: 24, borderWidth: 1, borderColor: '#252540', paddingHorizontal: 12, paddingVertical: 6, gap: 8 },
  input: { flex: 1, fontFamily: FONT, fontSize: 14, color: '#d0d0e8', paddingVertical: 8, maxHeight: 80 },
  iconBtn: { padding: 8 },
  recordingActive: { backgroundColor: 'rgba(255, 68, 68, 0.1)', borderRadius: 20 },
  sendBtn: { padding: 8 },

  historyBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  historyBtnText: { fontFamily: FONT, fontSize: 16, color: '#4a9eff' },

  historyOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  historySheet: { backgroundColor: '#0e1420', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '70%', paddingBottom: 32 },
  historyHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#1a1a2a' },
  historyTitle: { fontFamily: FONT, fontSize: 14, fontWeight: '600', color: '#c0c0d0', letterSpacing: 1 },
  historyClose: { fontFamily: FONT, fontSize: 16, color: '#888', paddingHorizontal: 4 },
  historySearchRow: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1a1a2a' },
  historySearch: { fontFamily: FONT, fontSize: 13, color: '#c0c0d0', backgroundColor: '#141a26', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  historyList: { paddingHorizontal: 16, paddingTop: 8 },
  historyEmpty: { fontFamily: FONT, fontSize: 12, color: '#555', textAlign: 'center', paddingVertical: 32 },
  historyGroupLabel: { fontFamily: FONT, fontSize: 10, color: '#556677', letterSpacing: 0.8, textTransform: 'uppercase', paddingTop: 14, paddingBottom: 4, paddingHorizontal: 2 },
  historyItem: { paddingVertical: 12, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#1a1a2a' },
  historyItemActive: { backgroundColor: 'rgba(74, 158, 255, 0.08)', borderRadius: 8 },
  historySnippet: { fontFamily: FONT, fontSize: 13, color: '#c0c0d0', lineHeight: 18 },
  historyActiveIndicator: { fontFamily: FONT, fontSize: 9, color: '#4a9eff', marginTop: 3, letterSpacing: 0.3 },

  renameOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', paddingHorizontal: 32 },
  renameSheet: { backgroundColor: '#0e1420', borderRadius: 14, padding: 20, gap: 16, borderWidth: 1, borderColor: '#1a2030' },
  renameTitle: { fontFamily: FONT, fontSize: 13, color: '#888', letterSpacing: 0.5 },
  renameInput: { fontFamily: FONT, fontSize: 15, color: '#e0e0f0', backgroundColor: '#141a26', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: '#252540' },
  renameActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
  renameCancelBtn: { paddingHorizontal: 16, paddingVertical: 8 },
  renameCancelText: { fontFamily: FONT, fontSize: 13, color: '#666' },
  renameConfirmBtn: { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: 'rgba(74,158,255,0.12)', borderRadius: 8 },
  renameConfirmText: { fontFamily: FONT, fontSize: 13, color: '#4a9eff' },
});