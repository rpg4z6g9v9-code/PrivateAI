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
  Alert, Animated, Dimensions, KeyboardAvoidingView, Platform,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import * as LocalAuth from 'expo-local-authentication';
import Voice, { SpeechResultsEvent, SpeechErrorEvent } from '@react-native-voice/voice';
import { Ionicons } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';

import CognitiveBackground from '@/components/chat/CognitiveBackground';
import secureStorage from '@/services/secureStorage';
import { networkMonitor } from '@/services/networkMonitor';
import { checkInjection, sanitizeOutput, classifyData, logSecurityEvent } from '@/services/securityGateway';
import { canAccessVault, unlockVault, lockVault } from '@/services/dataVault';
import { routeAI } from '@/services/aiRouter';
import { checkPrivateNode, type PrivateNodeStatus } from '@/services/localAI';
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
const HISTORY_KEY = 'chat_history_v1';
const AUTH_LOCKED_KEY = 'auth_locked_v1';
const SETTINGS_KEY = 'voice_settings_v1';
const BACKGROUND_LOCK_MS = 5 * 60 * 1000; // 5 minutes
const SILENCE_TIMEOUT_MS = 4000; // Auto-stop after 4s silence

// ── Main Component ─────────────────────────────────────────────
export default function ChatScreen() {
  // Core chat state
  const [messages, setMessages] = useState<Message[]>([]);
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

  // ── Load chat history on mount ────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const saved = await secureStorage.getItem(HISTORY_KEY);
        if (saved) setMessages(JSON.parse(saved));
      } catch (e) {
        console.warn('[Chat] Load history failed:', e);
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

      const userMsg: Message = {
        id: `${Date.now()}_user`,
        role: 'user',
        content: text,
        imageBase64: attachment?.base64,
      };

      const newMessages = [...messages, userMsg];
      setMessages(newMessages);
      setAttachment(null);

      // Route to AI (cloud or local, respecting security constraints)
      const result = await routeAI({
        messages: newMessages.map(m => ({
          role: m.role,
          content: m.content,
        })) as ConversationMessage[],
        isSensitive,
        safeMode,
        nodeOnline: nodeStatus?.online,
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

      // Persist to encrypted storage
      await secureStorage.setItem(HISTORY_KEY, JSON.stringify(finalMessages));

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
          <Text style={styles.headerTitle}>Claude</Text>
          <View style={styles.headerRight}>
            {nodeStatus !== null && (
              <Text style={[styles.nodeBadge, { color: nodeStatus.online ? '#44cc88' : '#cc4444' }]}>
                {nodeStatus.online
                  ? `● node · ${nodeStatus.latency}ms`
                  : '● offline · cloud only'}
              </Text>
            )}
            {safeMode && <View style={styles.safeBadge}><Text style={styles.safeBadgeText}>safe mode</Text></View>}
          </View>
        </View>

        {/* Messages */}
        <ScrollView style={styles.messages} contentContainerStyle={{ paddingBottom: 16 }}>
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
});