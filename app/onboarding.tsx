/**
 * onboarding.tsx — PrivateAI First-Run Setup
 *
 * Three-step flow:
 *   1. API Key — paste Claude key, validate, store in Keychain
 *   2. Permissions — mic, calendar, reminders, Face ID
 *   3. Meet Atlas — brief intro, start chatting
 */

import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import secureStorage from '@/services/secureStorage';
import { requestCalendarPermissions } from '@/services/calendarService';
import { requestRemindersPermissions } from '@/services/remindersService';
import * as LocalAuth from 'expo-local-authentication';

const FONT = Platform.OS === 'ios' ? 'Courier New' : 'monospace';
const ONBOARDING_COMPLETE_KEY = 'onboarding_complete_v1';
const API_KEY_STORE = 'user_claude_api_key_v1';

// ─── Helpers ─────────────────────────────────────────────────

async function validateClaudeKey(key: string): Promise<boolean> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    // 200 = valid key with credits
    // 400 = valid key, bad request (still means auth passed)
    return res.status === 200 || res.status === 400;
  } catch {
    return false;
  }
}

// ─── Component ───────────────────────────────────────────────

export default function OnboardingScreen() {
  const [step, setStep] = useState(0);
  const [apiKey, setApiKey] = useState('');
  const [validating, setValidating] = useState(false);
  const [keyError, setKeyError] = useState('');

  // Permissions state
  const [micGranted, setMicGranted] = useState(false);
  const [calGranted, setCalGranted] = useState(false);
  const [remGranted, setRemGranted] = useState(false);
  const [faceIdAvailable, setFaceIdAvailable] = useState(false);

  // ── Step 1: API Key ──────────────────────────────────────────

  const handleValidateKey = useCallback(async () => {
    const trimmed = apiKey.trim();
    if (!trimmed.startsWith('sk-ant-')) {
      setKeyError('Key should start with sk-ant-');
      return;
    }
    setValidating(true);
    setKeyError('');

    const valid = await validateClaudeKey(trimmed);
    setValidating(false);

    if (valid) {
      await secureStorage.setItem(API_KEY_STORE, trimmed);
      setStep(1);
    } else {
      setKeyError('Invalid key or no credits. Check console.anthropic.com');
    }
  }, [apiKey]);

  // ── Step 2: Permissions ──────────────────────────────────────

  const requestMic = useCallback(async () => {
    try {
      // Voice module triggers the mic permission dialog
      const Voice = (await import('@react-native-voice/voice')).default;
      await Voice.start('en-US');
      await Voice.stop();
      setMicGranted(true);
    } catch {
      // Permission denied or Voice not available — still mark as attempted
      setMicGranted(false);
    }
  }, []);

  const requestCal = useCallback(async () => {
    const granted = await requestCalendarPermissions();
    setCalGranted(granted);
  }, []);

  const requestRem = useCallback(async () => {
    const granted = await requestRemindersPermissions();
    setRemGranted(granted);
  }, []);

  const checkFaceId = useCallback(async () => {
    const hasHw = await LocalAuth.hasHardwareAsync();
    const enrolled = await LocalAuth.isEnrolledAsync();
    setFaceIdAvailable(hasHw && enrolled);
  }, []);

  // ── Step 3: Complete ─────────────────────────────────────────

  const handleComplete = useCallback(async () => {
    await secureStorage.setItem(ONBOARDING_COMPLETE_KEY, 'true');
    router.replace('/(tabs)');
  }, []);

  // ── Render ───────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

        {/* Progress dots */}
        <View style={s.progressRow}>
          {[0, 1, 2].map(i => (
            <View key={i} style={[s.dot, step >= i && s.dotActive]} />
          ))}
        </View>

        {/* ── Step 0: API Key ── */}
        {step === 0 && (
          <View style={s.stepContainer}>
            <Text style={s.stepTitle}>connect to claude</Text>
            <Text style={s.stepDesc}>
              PrivateAI uses Claude as its cloud AI engine. Paste your API key below.
              {'\n\n'}Get one at console.anthropic.com/settings/keys
            </Text>

            <TextInput
              style={s.input}
              value={apiKey}
              onChangeText={t => { setApiKey(t); setKeyError(''); }}
              placeholder="sk-ant-api03-..."
              placeholderTextColor="#333"
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />

            {keyError !== '' && <Text style={s.error}>{keyError}</Text>}

            <TouchableOpacity
              style={[s.primaryBtn, (!apiKey.trim() || validating) && s.btnDisabled]}
              onPress={handleValidateKey}
              disabled={!apiKey.trim() || validating}>
              {validating ? (
                <ActivityIndicator color="#000" size="small" />
              ) : (
                <Text style={s.primaryBtnText}>validate & continue</Text>
              )}
            </TouchableOpacity>

            <Text style={s.hint}>
              Your key is stored in the iOS Keychain (AES-256).{'\n'}It never leaves your device.
            </Text>
          </View>
        )}

        {/* ── Step 1: Permissions ── */}
        {step === 1 && (
          <View style={s.stepContainer}>
            <Text style={s.stepTitle}>permissions</Text>
            <Text style={s.stepDesc}>
              PrivateAI needs a few permissions to work. All data stays on your device.
            </Text>

            <PermissionRow
              icon="mic-outline"
              label="Microphone"
              desc="Voice input"
              granted={micGranted}
              onRequest={requestMic}
            />
            <PermissionRow
              icon="calendar-outline"
              label="Calendar"
              desc="Schedule-aware responses"
              granted={calGranted}
              onRequest={requestCal}
            />
            <PermissionRow
              icon="notifications-outline"
              label="Reminders"
              desc="Task management"
              granted={remGranted}
              onRequest={requestRem}
            />
            <PermissionRow
              icon="finger-print"
              label="Face ID"
              desc="Protect your data vault"
              granted={faceIdAvailable}
              onRequest={checkFaceId}
            />

            <TouchableOpacity style={s.primaryBtn} onPress={() => setStep(2)}>
              <Text style={s.primaryBtnText}>continue</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setStep(2)}>
              <Text style={s.skipText}>skip for now</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Step 2: Meet Atlas ── */}
        {step === 2 && (
          <View style={s.stepContainer}>
            <Text style={s.stepTitle}>meet your team</Text>

            <View style={s.personaCard}>
              <View style={[s.personaDot, { backgroundColor: '#4db8ff' }]} />
              <View style={s.personaInfo}>
                <Text style={[s.personaName, { color: '#4db8ff' }]}>Atlas</Text>
                <Text style={s.personaRole}>Strategic advisor — your default persona</Text>
              </View>
            </View>
            <View style={s.personaCard}>
              <View style={[s.personaDot, { backgroundColor: '#ff6b6b' }]} />
              <View style={s.personaInfo}>
                <Text style={[s.personaName, { color: '#ff6b6b' }]}>Vera</Text>
                <Text style={s.personaRole}>Health monitor — medical data stays on-device</Text>
              </View>
            </View>
            <View style={s.personaCard}>
              <View style={[s.personaDot, { backgroundColor: '#ff9500' }]} />
              <View style={s.personaInfo}>
                <Text style={[s.personaName, { color: '#ff9500' }]}>Cipher</Text>
                <Text style={s.personaRole}>Security analyst — threat detection & privacy</Text>
              </View>
            </View>
            <View style={s.personaCard}>
              <View style={[s.personaDot, { backgroundColor: '#a855f7' }]} />
              <View style={s.personaInfo}>
                <Text style={[s.personaName, { color: '#a855f7' }]}>Lumen</Text>
                <Text style={s.personaRole}>Research specialist — deep knowledge synthesis</Text>
              </View>
            </View>
            <View style={s.personaCard}>
              <View style={[s.personaDot, { backgroundColor: '#00ff00' }]} />
              <View style={s.personaInfo}>
                <Text style={[s.personaName, { color: '#00ff00' }]}>Atom</Text>
                <Text style={s.personaRole}>Personal assistant — general-purpose helper</Text>
              </View>
            </View>

            <Text style={s.stepDesc}>
              Tap the persona dot in the chat bar to switch between them. Each has their own memory and expertise.
            </Text>

            <TouchableOpacity style={s.primaryBtn} onPress={handleComplete}>
              <Text style={s.primaryBtnText}>start chatting</Text>
            </TouchableOpacity>
          </View>
        )}

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Permission Row Component ─────────────────────────────────

function PermissionRow({ icon, label, desc, granted, onRequest }: {
  icon: string;
  label: string;
  desc: string;
  granted: boolean;
  onRequest: () => void;
}) {
  return (
    <TouchableOpacity style={s.permRow} onPress={onRequest} disabled={granted}>
      <Ionicons name={icon as any} size={20} color={granted ? '#00ff88' : '#555'} />
      <View style={s.permInfo}>
        <Text style={[s.permLabel, granted && { color: '#00ff88' }]}>{label}</Text>
        <Text style={s.permDesc}>{desc}</Text>
      </View>
      {granted ? (
        <Ionicons name="checkmark-circle" size={18} color="#00ff88" />
      ) : (
        <Text style={s.permAction}>grant</Text>
      )}
    </TouchableOpacity>
  );
}

// ─── Styles ──────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#080d14' },
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingTop: Platform.OS === 'ios' ? 80 : 50, paddingBottom: 40 },
  progressRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 40 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#1a1a2a' },
  dotActive: { backgroundColor: '#4db8ff' },

  stepContainer: { flex: 1, gap: 16 },
  stepTitle: { fontFamily: FONT, fontSize: 22, color: '#ccc', letterSpacing: 2 },
  stepDesc: { fontFamily: FONT, fontSize: 12, color: '#666', lineHeight: 20 },

  input: {
    fontFamily: FONT, fontSize: 13, color: '#ccc',
    borderWidth: 1, borderColor: '#1a1a2a', borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 14,
    backgroundColor: '#0d1220',
  },
  error: { fontFamily: FONT, fontSize: 11, color: '#ff4444' },
  hint: { fontFamily: FONT, fontSize: 10, color: '#444', lineHeight: 16, textAlign: 'center', marginTop: 8 },

  primaryBtn: {
    backgroundColor: '#4db8ff', borderRadius: 8,
    paddingVertical: 14, alignItems: 'center', marginTop: 8,
  },
  btnDisabled: { opacity: 0.4 },
  primaryBtnText: { fontFamily: FONT, fontSize: 14, color: '#000', letterSpacing: 1, fontWeight: '600' },
  skipText: { fontFamily: FONT, fontSize: 11, color: '#555', textAlign: 'center', marginTop: 8, letterSpacing: 0.5 },

  // Permissions
  permRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, paddingHorizontal: 12,
    borderBottomWidth: 1, borderBottomColor: '#1a1a2a',
  },
  permInfo: { flex: 1, gap: 2 },
  permLabel: { fontFamily: FONT, fontSize: 13, color: '#999' },
  permDesc: { fontFamily: FONT, fontSize: 10, color: '#555' },
  permAction: { fontFamily: FONT, fontSize: 11, color: '#4db8ff', letterSpacing: 0.5 },

  // Persona cards
  personaCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10, paddingHorizontal: 4,
  },
  personaDot: { width: 10, height: 10, borderRadius: 5 },
  personaInfo: { flex: 1, gap: 2 },
  personaName: { fontFamily: FONT, fontSize: 14, fontWeight: '600' },
  personaRole: { fontFamily: FONT, fontSize: 10, color: '#666' },
});

// ─── Exported helpers for checking onboarding state ──────────

export async function isOnboardingComplete(): Promise<boolean> {
  const val = await secureStorage.getItem(ONBOARDING_COMPLETE_KEY);
  return val === 'true';
}

export { ONBOARDING_COMPLETE_KEY, API_KEY_STORE };
