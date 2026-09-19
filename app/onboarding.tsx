/**
 * onboarding.tsx — PrivateAI First-Run Setup
 *
 * Three-step flow:
 *   1. Gateway — verify optional cloud fallback
 *   2. Permissions — mic, calendar, reminders, Face ID
 *   3. Meet Atlas — brief intro, start chatting
 */

import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import secureStorage from '@/services/secureStorage';
import { getProviderGatewayHealth } from '@/services/providerGateway';
import * as LocalAuth from 'expo-local-authentication';

async function requestCalendarPermissions(): Promise<boolean> { return false; }
async function requestRemindersPermissions(): Promise<boolean> { return false; }

const FONT = Platform.OS === 'ios' ? 'Courier New' : 'monospace';
const ONBOARDING_COMPLETE_KEY = 'onboarding_complete_v1';
// ─── Component ───────────────────────────────────────────────

export default function OnboardingScreen() {
  const [step, setStep] = useState(0);
  const [gatewayChecking, setGatewayChecking] = useState(false);
  const [gatewayError, setGatewayError] = useState('');

  // Permissions state
  const [micGranted, setMicGranted] = useState(false);
  const [calGranted, setCalGranted] = useState(false);
  const [remGranted, setRemGranted] = useState(false);
  const [faceIdAvailable, setFaceIdAvailable] = useState(false);

  // ── Step 1: Provider gateway ──────────────────────────────────
  const handleCheckGateway = useCallback(async () => {
    setGatewayChecking(true);
    setGatewayError('');

    const health = await getProviderGatewayHealth();
    setGatewayChecking(false);

    if (!health?.ok) {
      setGatewayError('Provider gateway is not reachable. Start it on your Mac or continue local-only.');
      return;
    }

    if (!health.providers?.claude) {
      setGatewayError('Gateway is running, but Claude is not configured on the Mac.');
      return;
    }

    setStep(1);
  }, []);

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

        {/* ── Step 0: Provider gateway ── */}
        {step === 0 && (
          <View style={s.stepContainer}>
            <Text style={s.stepTitle}>cloud gateway (optional)</Text>

            <Text style={s.stepDesc}>
              PrivateAI runs locally on your private Mac node — no cloud required.{'\n\n'}
              Claude fallback uses the provider gateway on your Mac. No Claude API key is stored inside the app.
            </Text>

            {gatewayError !== '' && <Text style={s.error}>{gatewayError}</Text>}

            <TouchableOpacity
              style={[s.primaryBtn, gatewayChecking && s.btnDisabled]}
              onPress={handleCheckGateway}
              disabled={gatewayChecking}>
              <Text style={s.primaryBtnText}>
                {gatewayChecking ? 'checking...' : 'check gateway & continue'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setStep(1)}>
              <Text style={s.skipText}>skip — run local only</Text>
            </TouchableOpacity>

            <Text style={s.hint}>
              Provider credentials stay on the Mac and are never bundled into the iPhone app.
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

        {/* ── Step 2: How it works ── */}
        {step === 2 && (
          <View style={s.stepContainer}>
            <Text style={s.stepTitle}>how it works</Text>

            <View style={s.infoCard}>
              <Text style={[s.infoTitle, { color: '#00ff88' }]}>Private node (Mac Mini)</Text>
              <Text style={s.infoDesc}>
                AI runs locally on your Mac Mini at home. Messages stay on your network — nothing goes to the internet. The node indicator shows connection status and latency in ms.
              </Text>
            </View>

            <View style={s.infoCard}>
              <Text style={[s.infoTitle, { color: '#4db8ff' }]}>Cloud fallback (Claude)</Text>
              <Text style={s.infoDesc}>
                When the private node is offline, general queries can route to Claude through your Mac provider gateway. Provider credentials remain on the Mac. Medical or sensitive data is never sent to cloud — it waits for the local node.
              </Text>
            </View>

            <View style={s.infoCard}>
              <Text style={[s.infoTitle, { color: '#ccc' }]}>Local is slower</Text>
              <Text style={s.infoDesc}>
                The local model (phi4-mini) is smaller and may take a few extra seconds to respond. Cloud responses can be faster. Both routes show route and latency in the chat.
              </Text>
            </View>

            <View style={s.infoCard}>
              <Text style={[s.infoTitle, { color: '#ccc' }]}>Conversation history</Text>
              <Text style={s.infoDesc}>
                Tap the clock icon to browse past chats. Long-press a conversation to rename it. Swipe left to archive. Search by typing in the history panel.
              </Text>
            </View>

            <View style={s.infoCard}>
              <Text style={[s.infoTitle, { color: '#f59e0b' }]}>Knowledge cutoff</Text>
              <Text style={s.infoDesc}>
                AI models have a training cutoff. Web search can provide current information when it is configured in System settings.
              </Text>
            </View>

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

  // Info cards (step 2)
  infoCard: {
    paddingVertical: 12, paddingHorizontal: 14,
    borderLeftWidth: 2, borderLeftColor: '#1a2a3a',
    gap: 4,
  },
  infoTitle: { fontFamily: FONT, fontSize: 12, fontWeight: '600', letterSpacing: 0.5 },
  infoDesc: { fontFamily: FONT, fontSize: 11, color: '#555', lineHeight: 18 },
});

// ─── Exported helpers for checking onboarding state ──────────

export async function isOnboardingComplete(): Promise<boolean> {
  const val = await secureStorage.getItem(ONBOARDING_COMPLETE_KEY);
  return val === 'true';
}

export { ONBOARDING_COMPLETE_KEY };
