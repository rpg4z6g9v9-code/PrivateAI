/**
 * VoiceSettingsPanel.tsx — Voice input/output settings
 * 
 * Configurable:
 * - Speech rate (TTS output speed)
 * - Pitch (TTS output pitch)
 * - Auto-stop delay (voice input timeout)
 */

import React, { useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface VoiceSettings {
  speechRate: number; // 0.8 to 1.3, default 1.0
  pitch: number; // 0.8 to 1.2, default 1.0
  autoStopDelayMs: number; // 2000 to 6000, default 4000
}

const DEFAULTS: VoiceSettings = {
  speechRate: 1.0,
  pitch: 1.0,
  autoStopDelayMs: 4000,
};

const STORAGE_KEY = 'voice_settings_v1';

export async function loadVoiceSettings(): Promise<VoiceSettings> {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    if (saved) return { ...DEFAULTS, ...JSON.parse(saved) };
  } catch (e) {
    console.warn('[Voice] Load settings failed:', e);
  }
  return DEFAULTS;
}

export async function saveVoiceSettings(settings: VoiceSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn('[Voice] Save settings failed:', e);
  }
}

interface Props {
  onClose: () => void;
  onSettingsChange: (settings: VoiceSettings) => void;
}

export default function VoiceSettingsPanel({ onClose, onSettingsChange }: Props) {
  const [settings, setSettings] = useState<VoiceSettings>(DEFAULTS);

  const handleRateChange = (rate: number) => {
    const updated = { ...settings, speechRate: parseFloat(rate.toFixed(1)) };
    setSettings(updated);
    onSettingsChange(updated);
    saveVoiceSettings(updated).catch(() => {});
  };

  const handlePitchChange = (pitch: number) => {
    const updated = { ...settings, pitch: parseFloat(pitch.toFixed(1)) };
    setSettings(updated);
    onSettingsChange(updated);
    saveVoiceSettings(updated).catch(() => {});
  };

  const handleDelayChange = (delayMs: number) => {
    const updated = { ...settings, autoStopDelayMs: Math.round(delayMs / 100) * 100 };
    setSettings(updated);
    onSettingsChange(updated);
    saveVoiceSettings(updated).catch(() => {});
  };

  return (
    <View style={styles.panel}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Voice Settings</Text>
        <TouchableOpacity onPress={onClose}>
          <Ionicons name="close" size={24} color="#c0c0d0" />
        </TouchableOpacity>
      </View>

      {/* Speech Rate */}
      <View style={styles.section}>
        <Text style={styles.label}>Speech Rate</Text>
        <View style={styles.sliderRow}>
          <TouchableOpacity onPress={() => handleRateChange(Math.max(0.8, settings.speechRate - 0.1))} style={styles.stepBtn}><Text style={styles.stepBtnText}>−</Text></TouchableOpacity>
          <Text style={[styles.value, { flex: 1, textAlign: 'center' }]}>{settings.speechRate.toFixed(1)}x</Text>
          <TouchableOpacity onPress={() => handleRateChange(Math.min(1.3, settings.speechRate + 0.1))} style={styles.stepBtn}><Text style={styles.stepBtnText}>+</Text></TouchableOpacity>
        </View>
        <Text style={styles.hint}>Slower to faster speech output</Text>
      </View>

      {/* Pitch */}
      <View style={styles.section}>
        <Text style={styles.label}>Pitch</Text>
        <View style={styles.sliderRow}>
          <TouchableOpacity onPress={() => handlePitchChange(Math.max(0.8, settings.pitch - 0.1))} style={styles.stepBtn}><Text style={styles.stepBtnText}>−</Text></TouchableOpacity>
          <Text style={[styles.value, { flex: 1, textAlign: 'center' }]}>{settings.pitch.toFixed(1)}</Text>
          <TouchableOpacity onPress={() => handlePitchChange(Math.min(1.2, settings.pitch + 0.1))} style={styles.stepBtn}><Text style={styles.stepBtnText}>+</Text></TouchableOpacity>
        </View>
        <Text style={styles.hint}>Lower to higher pitch</Text>
      </View>

      {/* Auto-Stop Delay */}
      <View style={styles.section}>
        <Text style={styles.label}>Auto-Stop Delay</Text>
        <View style={styles.sliderRow}>
          <TouchableOpacity onPress={() => handleDelayChange(Math.max(2000, settings.autoStopDelayMs - 500))} style={styles.stepBtn}><Text style={styles.stepBtnText}>−</Text></TouchableOpacity>
          <Text style={[styles.value, { flex: 1, textAlign: 'center' }]}>{(settings.autoStopDelayMs / 1000).toFixed(1)}s</Text>
          <TouchableOpacity onPress={() => handleDelayChange(Math.min(6000, settings.autoStopDelayMs + 500))} style={styles.stepBtn}><Text style={styles.stepBtnText}>+</Text></TouchableOpacity>
        </View>
        <Text style={styles.hint}>Silence timeout before auto-sending</Text>
      </View>

      {/* Close Button */}
      <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
        <Text style={styles.closeBtnText}>Done</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: 'rgba(8, 13, 20, 0.98)',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#252540',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontFamily: 'Courier New',
    fontSize: 18,
    fontWeight: '600',
    color: '#c0c0d0',
    letterSpacing: 1,
  },
  section: {
    marginBottom: 24,
  },
  label: {
    fontFamily: 'Courier New',
    fontSize: 13,
    fontWeight: '500',
    color: '#a0a0c0',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  value: {
    fontFamily: 'Courier New',
    fontSize: 14,
    fontWeight: '600',
    color: '#4a9eff',
    minWidth: 40,
  },
  slider: {
    flex: 1,
    height: 24,
  },
  stepBtn: {
    width: 32, height: 32, borderRadius: 4,
    borderWidth: 1, borderColor: '#3a3a4a',
    alignItems: 'center', justifyContent: 'center',
  },
  stepBtnText: {
    fontFamily: 'Courier New', fontSize: 18, color: '#4a9eff', lineHeight: 22,
  },
  hint: {
    fontFamily: 'Courier New',
    fontSize: 11,
    color: '#666',
    marginTop: 4,
  },
  closeBtn: {
    backgroundColor: 'rgba(74, 158, 255, 0.15)',
    borderWidth: 1,
    borderColor: '#4a9eff',
    borderRadius: 8,
    paddingVertical: 12,
    marginTop: 20,
  },
  closeBtnText: {
    fontFamily: 'Courier New',
    fontSize: 13,
    fontWeight: '600',
    color: '#4a9eff',
    textAlign: 'center',
    letterSpacing: 1,
  },
});
