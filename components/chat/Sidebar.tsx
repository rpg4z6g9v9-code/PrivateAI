/**
 * Sidebar — Main navigation and settings drawer.
 * Extracted from app/(tabs)/index.tsx.
 */

import React from 'react';
import {
  Animated, Dimensions, ScrollView, StyleSheet, Switch,
  Text, TouchableOpacity, TouchableWithoutFeedback, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import {
  AvatarMode, ConnectorSettings, FONT, LocalModelStatus, Message, Persona,
  PERSONA_DESCS,
} from '@/components/chat/types';
import { MemoryEntry, relativeDate } from '@/services/memory';
import {
  entryTypeLabel, entryTypeColor, entryRelativeDate,
  patternTypeLabel, patternTypeColor, confidenceBar,
  type MedicalEntry, type PatternSummary,
} from '@/services/medicalMemory';
import { KnowledgeEntry, relKbDate, fmtKbSize } from '@/services/knowledgeBase';
import { releaseModel, deleteModelFile } from '@/services/localAI';
import { resetSessionLock } from '@/services/securityGateway';
import type { IndexProgress } from '@/services/fileIndexer';

const SIDEBAR_WIDTH = Math.round(Dimensions.get('window').width * 0.78);

export interface SidebarProps {
  visible: boolean;
  sidebarX: Animated.Value;
  backdropOpacity: Animated.Value;
  onClose: () => void;
  // Profile / persona
  activePersona: Persona;
  // Messages (for new chat)
  messages: Message[];
  onNewChat: () => void;
  // Display settings
  avatarMode: AvatarMode;
  onAvatarModeChange: (mode: AvatarMode) => void;
  // Memory
  memoryEntries: MemoryEntry[];
  onClearMemory: () => void;
  // Medical
  medEntries: MedicalEntry[];
  medPatterns: PatternSummary[];
  onMedAdd: () => void;
  onMedSummary: () => void;
  // AI mode
  localMode: boolean;
  offlineMode: boolean;
  isRealDevice: boolean;
  localModelStatus: LocalModelStatus;
  localModelProgress: number;
  localModelError: string;
  onLocalModeToggle: (v: boolean) => void;
  onOfflineModeToggle: (v: boolean) => void;
  onDownloadModel: () => void;
  onSetLocalModelStatus: (s: LocalModelStatus) => void;
  // Security
  sessionLocked: boolean;
  safeMode: boolean;
  onSetSessionLocked: (v: boolean) => void;
  onSetSafeMode: (v: boolean) => void;
  // Connectors
  connectors: ConnectorSettings;
  onToggleCalendar: (v: boolean) => void;
  onToggleNotes: (v: boolean) => void;
  onToggleReminders: (v: boolean) => void;
  // Knowledge base
  kbEntries: KnowledgeEntry[];
  kbPicking: boolean;
  onPickKbFile: () => void;
  onOpenKbPaste: () => void;
  onDeleteKbEntry: (id: string) => void;
  onIndexFolder: () => void;
  indexProgress: IndexProgress | null;
}

export default function Sidebar(props: SidebarProps) {
  const {
    visible, sidebarX, backdropOpacity, onClose,
    activePersona, messages, onNewChat,
    avatarMode, onAvatarModeChange,
    memoryEntries, onClearMemory,
    medEntries, medPatterns, onMedAdd, onMedSummary,
    localMode, offlineMode, isRealDevice,
    localModelStatus, localModelProgress, localModelError,
    onLocalModeToggle, onOfflineModeToggle, onDownloadModel, onSetLocalModelStatus,
    sessionLocked, safeMode, onSetSessionLocked, onSetSafeMode,
    connectors, onToggleCalendar, onToggleNotes, onToggleReminders,
    kbEntries, kbPicking, onPickKbFile, onOpenKbPaste, onDeleteKbEntry, onIndexFolder, indexProgress,
  } = props;

  if (!visible) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <TouchableWithoutFeedback onPress={onClose}>
        <Animated.View style={[s.backdrop, { opacity: backdropOpacity }]} />
      </TouchableWithoutFeedback>

      <Animated.View style={[s.sidebar, { transform: [{ translateX: sidebarX }] }]}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.sidebarContent}>

          {/* Header */}
          <View style={s.sidebarHeader}>
            <Text style={s.sidebarTitle}>PrivateAI</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={s.closeBtn}>[x]</Text>
            </TouchableOpacity>
          </View>

          {/* Profile */}
          <Text style={s.sectionLabel}>// profile</Text>
          <View style={s.profileCard}>
            <Text style={s.profileName}>Pete</Text>
            <Text style={s.profileSub}>privacy-first AI product builder</Text>
            <Text style={s.profileSub}>active: <Text style={{ color: activePersona.color }}>{activePersona.label}</Text></Text>
            <View style={s.encryptedBadge}>
              <Ionicons name="lock-closed" size={10} color="#00ff00" />
              <Text style={s.encryptedBadgeText}> storage: encrypted</Text>
            </View>
          </View>

          {/* Navigate */}
          <Text style={s.sectionLabel}>// navigate</Text>
          <TouchableOpacity onPress={() => { onClose(); router.push('/(tabs)/dashboard'); }} style={s.navBtn}>
            <Text style={[s.navIcon, { color: '#4db8a4' }]}>◎</Text>
            <Text style={[s.navText, { color: '#4db8a4' }]}>// dashboard</Text>
            <Text style={s.navArrow}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { onClose(); router.push('/(tabs)/conversations'); }} style={s.navBtn}>
            <Text style={[s.navIcon, { color: '#4db8ff' }]}>☰</Text>
            <Text style={[s.navText, { color: '#4db8ff' }]}>// conversations</Text>
            <Text style={s.navArrow}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { onClose(); router.push('/(tabs)/controlroom'); }} style={s.navBtn}>
            <Text style={[s.navIcon, { color: '#a855f7' }]}>⬡</Text>
            <Text style={[s.navText, { color: '#a855f7' }]}>// control room</Text>
            <Text style={s.navArrow}>›</Text>
          </TouchableOpacity>

          {/* New Chat */}
          <TouchableOpacity style={s.newChatBtn} onPress={onNewChat}>
            <Text style={s.newChatBtnText}>+ new chat</Text>
          </TouchableOpacity>

          {/* Display Settings */}
          <Text style={s.sectionLabel}>// display settings</Text>
          <Text style={s.settingKey}>avatar</Text>
          <View style={s.chipRow}>
            {(['full', 'mini', 'hidden'] as const).map(mode => (
              <TouchableOpacity key={mode} onPress={() => onAvatarModeChange(mode)}
                style={[s.chip, avatarMode === mode && s.chipActive]}>
                <Text style={[s.chipText, avatarMode === mode && s.chipTextActive]}>{mode}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* What I've Noticed */}
          <View style={s.memoryHeader}>
            <Text style={s.sectionLabel}>// what i've noticed</Text>
            {memoryEntries.length > 0 && (
              <TouchableOpacity onPress={onClearMemory} style={s.clearMemoryBtn}>
                <Text style={s.clearMemoryText}>[clear]</Text>
              </TouchableOpacity>
            )}
          </View>
          {memoryEntries.length === 0 ? (
            <Text style={s.memoryEmpty}>no patterns detected yet — start chatting.</Text>
          ) : (
            memoryEntries.map((entry, i) => (
              <View key={`${entry.topic}-${i}`} style={s.memoryEntry}>
                <View style={s.memoryEntryHeader}>
                  <Text style={[s.memoryTopic, { color: activePersona.color }]} numberOfLines={1}>
                    {entry.topic}
                  </Text>
                  <Text style={s.memoryFreq}>×{entry.frequency}</Text>
                </View>
                <Text style={s.memorySummary} numberOfLines={2}>{entry.summary}</Text>
                {entry.exampleQuotes.length > 0 && (
                  <Text style={s.memoryQuote} numberOfLines={2}>
                    "{entry.exampleQuotes[entry.exampleQuotes.length - 1]}"
                  </Text>
                )}
                <Text style={s.memoryDate}>{relativeDate(entry.lastSeen)}</Text>
              </View>
            ))
          )}

          {/* Medical Memory */}
          <View style={s.memoryHeader}>
            <Text style={s.sectionLabel}>// medical memory</Text>
            {medEntries.length > 0 && (
              <TouchableOpacity onPress={onMedSummary} style={s.clearMemoryBtn}>
                <Text style={[s.clearMemoryText, { color: '#ff6b6b' }]}>[summary]</Text>
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity onPress={onMedAdd} style={s.medAddBtn}>
            <Ionicons name="add-circle-outline" size={13} color="#ff6b6b" />
            <Text style={s.medAddBtnText}> log health entry</Text>
          </TouchableOpacity>
          {medEntries.length === 0 ? (
            <Text style={s.memoryEmpty}>no health entries yet — log symptoms, medications, visits.</Text>
          ) : (
            medEntries.slice(0, 5).map(entry => (
              <View key={entry.id} style={s.medEntry}>
                <View style={s.medEntryHeader}>
                  <View style={[s.medTypeDot, { backgroundColor: entryTypeColor(entry.type) }]} />
                  <Text style={[s.medEntryType, { color: entryTypeColor(entry.type) }]}>
                    {entryTypeLabel(entry.type)}
                  </Text>
                  {entry.structured.urgent && <Text style={s.medEntryUrgent}> ⚠</Text>}
                  <Text style={s.medEntryDate}>{entryRelativeDate(entry.timestamp)}</Text>
                </View>
                <Text style={s.medEntryWhat} numberOfLines={2}>{entry.structured.what}</Text>
              </View>
            ))
          )}

          {/* Detected Patterns */}
          {medPatterns.length > 0 && (
            <>
              <Text style={s.sectionLabel}>// detected patterns</Text>
              {medPatterns
                .sort((a, b) => b.confidence - a.confidence)
                .slice(0, 5)
                .map(p => (
                  <View key={p.id} style={s.medPatternCard}>
                    <View style={s.medPatternHeader}>
                      <View style={[s.medTypeDot, { backgroundColor: patternTypeColor(p.patternType) }]} />
                      <Text style={[s.medPatternType, { color: patternTypeColor(p.patternType) }]}>
                        {patternTypeLabel(p.patternType)}
                      </Text>
                      <Text style={s.medPatternConf}>{Math.round(p.confidence * 100)}%</Text>
                    </View>
                    <Text style={s.medPatternDesc} numberOfLines={3}>{p.description}</Text>
                    <Text style={s.medPatternBar}>{confidenceBar(p.confidence)}</Text>
                    <Text style={s.medPatternTimeframe}>{p.timeframe}</Text>
                  </View>
                ))}
            </>
          )}

          {/* Offline Mode */}
          <View style={s.settingRow}>
            <View style={s.connectorLeft}>
              <Ionicons name="cloud-offline-outline" size={16} color={offlineMode ? '#ff9500' : '#555'} />
              <View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={[s.connectorLabel, { color: offlineMode ? '#ff9500' : '#555' }]}>
                    // offline mode
                  </Text>
                  <View style={[s.routeBadge, { backgroundColor: offlineMode ? '#2a1500' : '#111', borderColor: offlineMode ? '#ff9500' : '#333' }]}>
                    <Text style={[s.routeBadgeText, { color: offlineMode ? '#ff9500' : '#555' }]}>$0</Text>
                  </View>
                </View>
                <Text style={s.connectorSub}>
                  {offlineMode ? 'all queries routed on-device · no API cost' : 'auto-route: local or cloud per query'}
                </Text>
              </View>
            </View>
            <Switch
              value={offlineMode}
              onValueChange={onOfflineModeToggle}
              trackColor={{ false: '#111', true: '#2a1500' }}
              thumbColor={offlineMode ? '#ff9500' : '#444'}
            />
          </View>

          {/* AI Mode */}
          <Text style={s.sectionLabel}>// ai mode</Text>
          <View style={s.settingRow}>
            <View style={s.connectorLeft}>
              <Ionicons
                name={localMode ? 'hardware-chip-outline' : 'cloud-outline'}
                size={16}
                color={localMode ? '#00ff00' : '#4499ff'}
              />
              <View>
                <Text style={[s.connectorLabel, { color: localMode ? '#00ff00' : '#4499ff' }]}>
                  {localMode ? 'Local (on-device)' : 'Cloud (Claude API)'}
                </Text>
                <Text style={s.connectorSub}>
                  {localMode ? 'llama 3.2 3b · zero data leaves device' : 'claude sonnet · internet required'}
                </Text>
              </View>
            </View>
            <Switch
              value={localMode}
              onValueChange={onLocalModeToggle}
              trackColor={{ false: '#001133', true: '#004400' }}
              thumbColor={localMode ? '#00ff00' : '#4499ff'}
            />
          </View>

          {/* Simulator notice */}
          {!isRealDevice && (
            <View style={s.aiModeSimulatorNote}>
              <Text style={s.aiModeSimulatorTitle}>// local AI unavailable on simulator</Text>
              <Text style={s.aiModeSimulatorBody}>
                test on a real iPhone for on-device inference{'\n'}
                zero data leaves device when enabled
              </Text>
            </View>
          )}

          {/* Model download / status — real device only */}
          {isRealDevice && localMode && localModelStatus === 'idle' && (
            <TouchableOpacity style={s.aiModeDownloadBtn} onPress={onDownloadModel}>
              <Ionicons name="download-outline" size={13} color="#00ff00" />
              <Text style={s.aiModeDownloadText}> download model (~1.8 GB)</Text>
            </TouchableOpacity>
          )}
          {isRealDevice && localMode && localModelStatus === 'downloading' && (
            <View style={s.aiModeProgress}>
              <Text style={s.aiModeProgressText}>
                {localModelProgress > 0 ? `downloading... ${localModelProgress}%` : 'connecting to server...'}
              </Text>
              <View style={s.aiModeProgressBar}>
                <View style={s.aiModeProgressTrack}>
                  <View style={[s.aiModeProgressFill, { flex: localModelProgress > 0 ? localModelProgress : 0 }]} />
                  <View style={{ flex: 100 - (localModelProgress > 0 ? localModelProgress : 0) }} />
                </View>
              </View>
            </View>
          )}
          {isRealDevice && localMode && localModelStatus === 'loading' && (
            <Text style={s.dimText}>  loading model into memory...</Text>
          )}
          {isRealDevice && localMode && localModelStatus === 'ready' && (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={s.dimText}>  model ready · llama 3.2 3b q4_k_m</Text>
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4 }}
                onPress={async () => {
                  await releaseModel();
                  deleteModelFile();
                  onSetLocalModelStatus('idle');
                }}>
                <Ionicons name="trash-outline" size={11} color="#555" />
                <Text style={{ color: '#888', fontSize: 11, marginLeft: 3 }}>delete</Text>
              </TouchableOpacity>
            </View>
          )}
          {isRealDevice && localMode && localModelStatus === 'error' && (
            <View style={s.aiModeErrorBox}>
              <Text style={s.aiModeErrorText} numberOfLines={3}>{localModelError || 'Failed to load model'}</Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity style={s.aiModeRetryBtn} onPress={() => { deleteModelFile(); onSetLocalModelStatus('idle'); }}>
                  <Ionicons name="trash-outline" size={12} color="#ff4444" />
                  <Text style={s.aiModeRetryText}> delete & retry</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.aiModeRetryBtn} onPress={onDownloadModel}>
                  <Ionicons name="refresh-outline" size={12} color="#ff4444" />
                  <Text style={s.aiModeRetryText}> retry</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Local AI Section */}
          <Text style={s.sectionLabel}>// local AI</Text>
          {localModelStatus === 'idle' && (
            <>
              <TouchableOpacity style={s.aiModeDownloadBtn} onPress={onDownloadModel}>
                <Ionicons name="download-outline" size={13} color="#00ff00" />
                <Text style={s.aiModeDownloadText}> download llama 3b</Text>
              </TouchableOpacity>
              <Text style={[s.dimText, { marginTop: 4, color: '#ff9500' }]}>
                {'  ~1.8 GB download — use WiFi'}
              </Text>
            </>
          )}
          {localModelStatus === 'downloading' && (
            <View style={s.aiModeProgress}>
              <Text style={s.aiModeProgressText}>
                {localModelProgress > 0 ? `downloading... ${localModelProgress}%` : 'connecting to server...'}
              </Text>
              <View style={s.aiModeProgressBar}>
                <View style={s.aiModeProgressTrack}>
                  <View style={[s.aiModeProgressFill, { flex: localModelProgress > 0 ? localModelProgress : 0 }]} />
                  <View style={{ flex: 100 - (localModelProgress > 0 ? localModelProgress : 0) }} />
                </View>
              </View>
            </View>
          )}
          {localModelStatus === 'loading' && (
            <Text style={s.dimText}>  loading model...</Text>
          )}
          {localModelStatus === 'ready' && (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={[s.dimText, { color: '#00ff88' }]}>{'  llama 3b ready — $0 mode available'}</Text>
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4 }}
                onPress={async () => { await releaseModel(); deleteModelFile(); onSetLocalModelStatus('idle'); }}>
                <Ionicons name="trash-outline" size={11} color="#555" />
                <Text style={{ color: '#888', fontSize: 11, marginLeft: 3 }}>delete</Text>
              </TouchableOpacity>
            </View>
          )}
          {localModelStatus === 'error' && (
            <View style={s.aiModeErrorBox}>
              <Text style={s.aiModeErrorText} numberOfLines={3}>{localModelError || 'Download failed'}</Text>
              <TouchableOpacity style={s.aiModeRetryBtn} onPress={() => { deleteModelFile(); onSetLocalModelStatus('idle'); }}>
                <Ionicons name="trash-outline" size={12} color="#ff4444" />
                <Text style={s.aiModeRetryText}> delete & retry</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Security */}
          <Text style={s.sectionLabel}>// security</Text>
          <View style={s.securityPanel}>
            <View style={s.securityRow}>
              <View style={s.securityDot} />
              <Text style={s.securityLabel}>Injection Shield</Text>
              <Text style={s.securityValue}>Active</Text>
            </View>
            <View style={s.securityRow}>
              <View style={s.securityDot} />
              <Text style={s.securityLabel}>Output Filter</Text>
              <Text style={s.securityValue}>Active</Text>
            </View>
            <View style={s.securityRow}>
              <View style={s.securityDot} />
              <Text style={s.securityLabel}>Medical Data</Text>
              <Text style={s.securityValue}>Local Only</Text>
            </View>
            <View style={s.securityRow}>
              <View style={[s.securityDot, sessionLocked && s.securityDotWarn]} />
              <Text style={s.securityLabel}>Session</Text>
              <Text style={[s.securityValue, sessionLocked && s.securityValueWarn]}>
                {sessionLocked ? 'Locked' : 'Normal'}
              </Text>
            </View>
            {sessionLocked && (
              <TouchableOpacity style={s.securityUnlockBtn} onPress={() => { resetSessionLock(); onSetSessionLocked(false); }}>
                <Text style={s.securityUnlockText}>Unlock Session</Text>
              </TouchableOpacity>
            )}
            <View style={s.securityRow}>
              <View style={[s.securityDot, safeMode && s.securityDotWarn]} />
              <Text style={s.securityLabel}>Safe Mode</Text>
              <Text style={[s.securityValue, safeMode && s.securityValueWarn]}>
                {safeMode ? 'Active — cloud + web off' : 'Off'}
              </Text>
            </View>
            {safeMode && (
              <TouchableOpacity style={s.securityUnlockBtn} onPress={() => onSetSafeMode(false)}>
                <Text style={s.securityUnlockText}>Disable Safe Mode</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Connectors */}
          <Text style={s.sectionLabel}>// connectors</Text>
          <View style={s.settingRow}>
            <View style={s.connectorLeft}>
              <Ionicons name="calendar-outline" size={16} color={connectors.calendar ? '#00ff00' : '#333'} />
              <View>
                <Text style={[s.connectorLabel, connectors.calendar && { color: '#00ff00' }]}>Calendar</Text>
                <Text style={s.connectorSub}>{connectors.calendar ? 'schedule injected into context' : 'ask "what do I have today?"'}</Text>
              </View>
            </View>
            <Switch value={connectors.calendar} onValueChange={onToggleCalendar} trackColor={{ false: '#222', true: '#004400' }} thumbColor={connectors.calendar ? '#00ff00' : '#444'} />
          </View>
          <View style={s.settingRow}>
            <View style={s.connectorLeft}>
              <Ionicons name="document-text-outline" size={16} color={connectors.notes ? '#00ff00' : '#333'} />
              <View>
                <Text style={[s.connectorLabel, connectors.notes && { color: '#00ff00' }]}>Notes</Text>
                <Text style={s.connectorSub}>{connectors.notes ? 'save and search on-device notes' : 'say "save a note: ..."'}</Text>
              </View>
            </View>
            <Switch value={connectors.notes} onValueChange={onToggleNotes} trackColor={{ false: '#222', true: '#004400' }} thumbColor={connectors.notes ? '#00ff00' : '#444'} />
          </View>
          <View style={s.settingRow}>
            <View style={s.connectorLeft}>
              <Ionicons name="notifications-outline" size={16} color={connectors.reminders ? '#00ff00' : '#333'} />
              <View>
                <Text style={[s.connectorLabel, connectors.reminders && { color: '#00ff00' }]}>Reminders</Text>
                <Text style={s.connectorSub}>{connectors.reminders ? 'say "remind me to..."' : 'create & view reminders'}</Text>
              </View>
            </View>
            <Switch value={connectors.reminders} onValueChange={onToggleReminders} trackColor={{ false: '#222', true: '#004400' }} thumbColor={connectors.reminders ? '#00ff00' : '#444'} />
          </View>

          {/* Knowledge Base */}
          <Text style={s.sectionLabel}>{'// knowledge base'}</Text>
          <View style={s.kbActions}>
            <TouchableOpacity onPress={onPickKbFile} style={[s.kbActionBtn, kbPicking && { opacity: 0.4 }]} disabled={kbPicking}>
              <Ionicons name={kbPicking ? 'hourglass-outline' : 'document-attach-outline'} size={12} color="#00ff00" />
              <Text style={s.kbActionText}>{kbPicking ? ' picking...' : ' add file'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onOpenKbPaste} style={s.kbActionBtn}>
              <Ionicons name="create-outline" size={12} color="#00ff00" />
              <Text style={s.kbActionText}> paste text</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onIndexFolder} style={s.kbActionBtn}>
              <Ionicons name="folder-open-outline" size={12} color="#4db8ff" />
              <Text style={[s.kbActionText, { color: '#4db8ff' }]}> index folder</Text>
            </TouchableOpacity>
          </View>
          {indexProgress && indexProgress.phase !== 'done' && (
            <View style={s.indexProgress}>
              <Text style={s.indexProgressText}>
                {indexProgress.phase === 'scanning' && 'Scanning folder...'}
                {indexProgress.phase === 'reading' && `Found ${indexProgress.filesFound} files`}
                {indexProgress.phase === 'indexing' && `${indexProgress.filesProcessed}/${indexProgress.filesFound} files · ${indexProgress.conceptsExtracted} concepts`}
                {indexProgress.phase === 'error' && indexProgress.error}
              </Text>
              {indexProgress.currentFile && (
                <Text style={s.indexProgressFile} numberOfLines={1}>{indexProgress.currentFile}</Text>
              )}
            </View>
          )}
          {indexProgress?.phase === 'done' && indexProgress.conceptsExtracted > 0 && (
            <Text style={s.indexDoneText}>
              Indexed {indexProgress.filesProcessed} files · {indexProgress.conceptsExtracted} concepts added to graph
            </Text>
          )}
          {kbEntries.length === 0 ? (
            <Text style={s.memoryEmpty}>no knowledge added yet — pick a file or paste text.</Text>
          ) : (
            kbEntries.map(entry => (
              <View key={entry.id} style={s.kbEntry}>
                <View style={s.kbEntryHeader}>
                  <Text style={[s.kbEntryTitle, { color: activePersona.color }]} numberOfLines={1}>{entry.title}</Text>
                  <TouchableOpacity onPress={() => onDeleteKbEntry(entry.id)}>
                    <Text style={s.kbEntryDelete}>[x]</Text>
                  </TouchableOpacity>
                </View>
                <Text style={s.kbEntryMeta}>
                  {entry.source === 'file' ? 'file' : 'pasted'} · {fmtKbSize(entry.content)} · {relKbDate(entry.dateAdded)}
                </Text>
              </View>
            ))
          )}

          {/* About */}
          <Text style={s.sectionLabel}>// about</Text>
          <View style={s.aboutCard}>
            <Text style={s.aboutLine}>PrivateAI v1.0</Text>
            <Text style={s.aboutLine}>privacy-first AI assistant</Text>
            <Text style={s.aboutLine}>voice powered by ElevenLabs</Text>
            <Text style={s.aboutLine}>LLM powered by Claude</Text>
            <Text style={[s.aboutLine, { color: '#888', marginTop: 8 }]}>built with Expo + React Native</Text>
          </View>

          {/* Support */}
          <Text style={s.sectionLabel}>// support</Text>
          <TouchableOpacity
            style={s.donateBtn}
            onPress={() => {
              import('react-native').then(({ Linking }) => {
                Linking.openURL('https://buymeacoffee.com/privateai');
              });
            }}>
            <Text style={s.donateBtnText}>support PrivateAI</Text>
            <Text style={s.donateSub}>free & open source — donations keep it alive</Text>
          </TouchableOpacity>

        </ScrollView>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  sidebar: { position: 'absolute', top: 0, left: 0, bottom: 0, width: SIDEBAR_WIDTH, backgroundColor: '#080808', borderRightWidth: 1, borderRightColor: '#1a1a1a' },
  sidebarContent: { paddingBottom: 60 },
  sidebarHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 64, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  sidebarTitle: { fontFamily: FONT, fontSize: 16, color: '#00ff00' },
  closeBtn: { fontFamily: FONT, fontSize: 14, color: '#999' },
  sectionLabel: { fontFamily: FONT, fontSize: 10, color: '#888', letterSpacing: 2, paddingHorizontal: 20, paddingTop: 24, paddingBottom: 10 },
  profileCard: { paddingHorizontal: 20, paddingBottom: 4, gap: 4 },
  profileName: { fontFamily: FONT, fontSize: 18, color: '#00ff00' },
  profileSub: { fontFamily: FONT, fontSize: 12, color: '#555' },
  encryptedBadge: { flexDirection: 'row', alignItems: 'center', marginTop: 6, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, borderColor: '#003300', borderRadius: 4, alignSelf: 'flex-start' },
  encryptedBadgeText: { fontFamily: FONT, fontSize: 10, color: '#00ff00', letterSpacing: 1 },
  navBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingVertical: 14, borderTopWidth: 1, borderTopColor: '#1a1a2a' },
  navIcon: { fontFamily: FONT, fontSize: 14, width: 18, textAlign: 'center' },
  navText: { fontFamily: FONT, fontSize: 12, letterSpacing: 1, flex: 1 },
  navArrow: { fontFamily: FONT, fontSize: 16, color: '#8888aa' },
  newChatBtn: { marginHorizontal: 20, marginTop: 10, borderWidth: 1, borderColor: '#1a3a2a', borderRadius: 4, paddingVertical: 10, alignItems: 'center', backgroundColor: '#0a1a10' },
  newChatBtnText: { fontFamily: FONT, fontSize: 11, color: '#00ff88', letterSpacing: 1 },
  settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 10 },
  settingKey: { fontFamily: FONT, fontSize: 12, color: '#555', paddingHorizontal: 20, paddingBottom: 6, paddingTop: 10 },
  chipRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingBottom: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 5, borderWidth: 1, borderColor: '#222', borderRadius: 4 },
  chipActive: { borderColor: '#00ff00', backgroundColor: '#001a00' },
  chipText: { fontFamily: FONT, fontSize: 12, color: '#999' },
  chipTextActive: { color: '#00ff00' },
  memoryHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 20 },
  clearMemoryBtn: { paddingTop: 24, paddingBottom: 10 },
  clearMemoryText: { fontFamily: FONT, fontSize: 10, color: '#888', letterSpacing: 1 },
  memoryEmpty: { fontFamily: FONT, fontSize: 12, color: '#888', paddingHorizontal: 20, paddingBottom: 8 },
  memoryEntry: { paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#0f0f0f' },
  memoryEntryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 },
  memoryTopic: { fontFamily: FONT, fontSize: 13, fontWeight: '600', flex: 1, marginRight: 8 },
  memoryFreq: { fontFamily: FONT, fontSize: 11, color: '#333' },
  memorySummary: { fontFamily: FONT, fontSize: 11, color: '#444', lineHeight: 16 },
  memoryQuote: { fontFamily: FONT, fontSize: 10, color: '#888', lineHeight: 15, marginTop: 4, fontStyle: 'italic' },
  memoryDate: { fontFamily: FONT, fontSize: 9, color: '#222', marginTop: 4, letterSpacing: 1 },
  medAddBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 8 },
  medAddBtnText: { fontFamily: FONT, fontSize: 12, color: '#ff6b6b' },
  medEntry: { paddingHorizontal: 20, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#0f0f0f' },
  medEntryHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  medTypeDot: { width: 6, height: 6, borderRadius: 3 },
  medEntryType: { fontFamily: FONT, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' },
  medEntryUrgent: { fontFamily: FONT, fontSize: 11, color: '#ff4444' },
  medEntryDate: { fontFamily: FONT, fontSize: 9, color: '#888', marginLeft: 'auto' as any },
  medEntryWhat: { fontFamily: FONT, fontSize: 11, color: '#444', lineHeight: 16 },
  medPatternCard: { paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#0f0f0f' },
  medPatternHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  medPatternType: { fontFamily: FONT, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', flex: 1 },
  medPatternConf: { fontFamily: FONT, fontSize: 10, color: '#444' },
  medPatternDesc: { fontFamily: FONT, fontSize: 11, color: '#555', lineHeight: 16, marginBottom: 4 },
  medPatternBar: { fontFamily: FONT, fontSize: 8, color: '#888', letterSpacing: -1, marginBottom: 2 },
  medPatternTimeframe: { fontFamily: FONT, fontSize: 9, color: '#888', letterSpacing: 1 },
  routeBadge: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  routeBadgeText: { fontFamily: FONT, fontSize: 9, letterSpacing: 1 },
  connectorLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, marginRight: 12 },
  connectorLabel: { fontFamily: FONT, fontSize: 13, color: '#999' },
  connectorSub: { fontFamily: FONT, fontSize: 9, color: '#777', marginTop: 2 },
  dimText: { fontFamily: FONT, fontSize: 12, color: '#888', paddingHorizontal: 20, paddingTop: 4 },
  aiModeSimulatorNote: { marginHorizontal: 20, marginVertical: 6, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: '#111', borderRadius: 4 },
  aiModeSimulatorTitle: { fontFamily: FONT, fontSize: 10, color: '#77aa77', letterSpacing: 1, marginBottom: 6 },
  aiModeSimulatorBody: { fontFamily: FONT, fontSize: 10, color: '#1e2e1e', lineHeight: 16 },
  aiModeDownloadBtn: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, marginVertical: 6, paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: '#1a1a1a', borderRadius: 4 },
  aiModeDownloadText: { fontFamily: FONT, fontSize: 11, color: '#00ff00' },
  aiModeProgress: { marginHorizontal: 20, marginVertical: 6 },
  aiModeProgressText: { fontFamily: FONT, fontSize: 10, color: '#444', marginBottom: 6 },
  aiModeProgressBar: { height: 3, borderRadius: 2, overflow: 'hidden' },
  aiModeProgressTrack: { flexDirection: 'row', height: 3, backgroundColor: '#1a1a1a', borderRadius: 2 },
  aiModeProgressFill: { height: 3, backgroundColor: '#00ff00', borderRadius: 2 },
  aiModeErrorBox: { marginHorizontal: 20, marginVertical: 6, padding: 10, borderWidth: 1, borderColor: '#330000', borderRadius: 4, gap: 8 },
  aiModeErrorText: { fontFamily: FONT, fontSize: 10, color: '#ff4444', lineHeight: 15 },
  aiModeRetryBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start' },
  aiModeRetryText: { fontFamily: FONT, fontSize: 11, color: '#ff4444' },
  securityPanel: { marginHorizontal: 20, marginBottom: 12, borderWidth: 1, borderColor: '#0d1f0d', borderRadius: 6, backgroundColor: '#050e05', overflow: 'hidden' },
  securityRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#0d1a0d' },
  securityDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#00cc44' },
  securityDotWarn: { backgroundColor: '#ff4444' },
  securityLabel: { fontFamily: FONT, fontSize: 10, color: '#77aa77', flex: 1, letterSpacing: 0.5 },
  securityValue: { fontFamily: FONT, fontSize: 10, color: '#00cc44', letterSpacing: 0.5 },
  securityValueWarn: { color: '#ff4444' },
  securityUnlockBtn: { marginHorizontal: 12, marginVertical: 8, paddingVertical: 6, paddingHorizontal: 12, borderWidth: 1, borderColor: '#ff4444', borderRadius: 4, alignItems: 'center' },
  securityUnlockText: { fontFamily: FONT, fontSize: 10, color: '#ff4444', letterSpacing: 1 },
  kbActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 20, paddingVertical: 8 },
  kbActionBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: '#1a1a1a', borderRadius: 4, gap: 6 },
  kbActionText: { fontFamily: FONT, fontSize: 11, color: '#555' },
  indexProgress: { paddingHorizontal: 20, paddingVertical: 8, backgroundColor: '#0a1520', borderRadius: 4, marginHorizontal: 20, marginBottom: 6 },
  indexProgressText: { fontFamily: FONT, fontSize: 11, color: '#4db8ff', letterSpacing: 0.5 },
  indexProgressFile: { fontFamily: FONT, fontSize: 9, color: '#6699bb', marginTop: 2 },
  indexDoneText: { fontFamily: FONT, fontSize: 10, color: '#00ff88', letterSpacing: 0.5, paddingHorizontal: 20, paddingVertical: 6 },
  kbEntry: { paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#0f0f0f' },
  kbEntryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 },
  kbEntryTitle: { fontFamily: FONT, fontSize: 13, color: '#555', flex: 1, marginRight: 8 },
  kbEntryDelete: { fontFamily: FONT, fontSize: 10, color: '#888' },
  kbEntryMeta: { fontFamily: FONT, fontSize: 9, color: '#888', letterSpacing: 1 },
  aboutCard: { paddingHorizontal: 20, gap: 6 },
  aboutLine: { fontFamily: FONT, fontSize: 12, color: '#999' },
  donateBtn: {
    marginHorizontal: 20, marginTop: 4, marginBottom: 20,
    paddingVertical: 14, paddingHorizontal: 16,
    borderWidth: 1, borderColor: '#c9a84c44', borderRadius: 8,
    backgroundColor: '#0d0a04', alignItems: 'center', gap: 4,
  },
  donateBtnText: { fontFamily: FONT, fontSize: 13, color: '#c9a84c', letterSpacing: 1 },
  donateSub: { fontFamily: FONT, fontSize: 9, color: '#665520', letterSpacing: 0.5 },
});
