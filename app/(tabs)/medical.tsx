/**
 * medical.tsx — PrivateAI Medical Timeline Screen
 *
 * Living Health Story + month-grouped timeline of all medical entries.
 * Fully on-device. Living Story calls Claude API only on explicit request.
 *
 * Color palette:
 *   Background  #0a0f1a
 *   Teal accent #4db8a4
 *   Amber alert #f5a623
 *   Soft red    #e05555
 */

import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  getEntries,
  addEntry,
  updateEntry,
  deleteEntry,
  extractLocalMedical,
  checkUrgent,
  entryTypeLabel,
  entryTypeColor,
  entryRelativeDate,
  generateAppointmentSummary,
  type MedicalEntry,
  type EntryDraft,
} from '@/services/medicalMemory';

const FONT = Platform.OS === 'ios' ? 'Courier New' : 'monospace';
const CLAUDE_API_KEY = process.env.EXPO_PUBLIC_CLAUDE_API_KEY ?? '';

// ─── Palette ──────────────────────────────────────────────────

const C = {
  bg:        '#0a0f1a',
  surface:   '#111827',
  border:    '#1e2a3a',
  teal:      '#4db8a4',
  amber:     '#f5a623',
  red:       '#e05555',
  muted:     '#4a5568',
  dim:       '#2d3748',
  text:      '#e2e8f0',
  subtext:   '#718096',
  month:     '#4db8a4',
} as const;

// ─── Helpers ──────────────────────────────────────────────────

function monthKey(iso: string): string {
  return iso.slice(0, 7); // 'YYYY-MM'
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function severityColor(sev?: string): string {
  if (sev === 'critical') return C.red;
  if (sev === 'severe')   return C.amber;
  if (sev === 'moderate') return '#d4a017';
  return C.muted;
}

// Group entries newest-month-first, entries within month newest-first
function groupByMonth(entries: MedicalEntry[]): { key: string; entries: MedicalEntry[] }[] {
  const map = new Map<string, MedicalEntry[]>();
  for (const e of entries) {
    const k = monthKey(e.timestamp);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(e);
  }
  return [...map.entries()]
    .sort(([a], [b]) => b.localeCompare(a)) // newest month first
    .map(([key, es]) => ({
      key,
      entries: [...es].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    }));
}

// Strip markdown/emoji for plain-text display
function clean(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/#{1,6}\s+(.+)/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/^\s*-{3,}\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── Living Health Story ──────────────────────────────────────

async function fetchLivingStory(entries: MedicalEntry[]): Promise<string> {
  if (!CLAUDE_API_KEY || entries.length === 0) return '';

  const recent = entries
    .filter(e => Date.now() - new Date(e.timestamp).getTime() <= 30 * 86_400_000)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  if (recent.length === 0) return '';

  const lines = recent.map(e => {
    const d = new Date(e.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const sev = e.structured.severity ? ` (${e.structured.severity})` : '';
    const dur = e.structured.duration ? `, ${e.structured.duration}` : '';
    return `${d}: ${e.type} — ${e.structured.what}${sev}${dur}`;
  }).join('\n');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 180,
      system: 'You are a compassionate medical documentation assistant. Write a 2-3 sentence plain-English narrative describing this patient\'s health over the past month. Be factual, empathetic, and concise. No markdown. No bullet points. No medical advice. Just a clear health story.',
      messages: [{ role: 'user', content: `Health log:\n${lines}` }],
    }),
  });
  const data = await res.json();
  return clean(data?.content?.[0]?.text ?? '');
}

// ─── Component ────────────────────────────────────────────────

export default function MedicalScreen() {
  const [entries, setEntries]               = useState<MedicalEntry[]>([]);
  const [grouped, setGrouped]               = useState<{ key: string; entries: MedicalEntry[] }[]>([]);
  const [expandedId, setExpandedId]         = useState<string | null>(null);

  // Living Story
  const [story, setStory]                   = useState('');
  const [storyLoading, setStoryLoading]     = useState(false);
  const [storyError, setStoryError]         = useState('');

  // Quick-add flow
  const [addVisible, setAddVisible]         = useState(false);
  const [rawInput, setRawInput]             = useState('');
  const [extracting, setExtracting]         = useState(false);
  const [pending, setPending]               = useState<EntryDraft | null>(null);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [pendingUrgent, setPendingUrgent]   = useState(false);

  // Edit flow
  const [editVisible, setEditVisible]       = useState(false);
  const [editEntry, setEditEntry]           = useState<MedicalEntry | null>(null);
  const [editRaw, setEditRaw]               = useState('');

  const scrollRef = useRef<ScrollView>(null);

  // ── Load ──────────────────────────────────────────────────────

  const load = useCallback(async () => {
    const all = await getEntries();
    setEntries(all);
    setGrouped(groupByMonth(all));
  }, []);

  useFocusEffect(useCallback(() => {
    load();
    // Refresh story when screen gains focus (only if we have entries and no story yet)
    getEntries().then(all => {
      if (all.length > 0 && !story) refreshStory(all);
    });
  }, [])); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshStory = async (all?: MedicalEntry[]) => {
    const src = all ?? entries;
    if (src.length === 0) return;
    setStoryLoading(true);
    setStoryError('');
    try {
      const text = await fetchLivingStory(src);
      setStory(text);
    } catch (e: unknown) {
      setStoryError('Could not generate story — check your connection.');
    }
    setStoryLoading(false);
  };

  // ── Quick-add ─────────────────────────────────────────────────

  const handleSubmit = () => {
    if (!rawInput.trim()) return;
    setExtracting(true);
    const draft = extractLocalMedical(rawInput.trim());
    const urgent = checkUrgent(rawInput);
    setPending(draft);
    setPendingUrgent(urgent);
    setAddVisible(false);
    setExtracting(false);
    setConfirmVisible(true);
  };

  const handleConfirm = async () => {
    if (!pending) return;
    await addEntry(pending);
    setConfirmVisible(false);
    setPending(null);
    setRawInput('');
    await load();
    // Regenerate story after new entry
    const all = await getEntries();
    refreshStory(all);
  };

  // ── Edit ──────────────────────────────────────────────────────

  const openEdit = (entry: MedicalEntry) => {
    setEditEntry(entry);
    setEditRaw(entry.rawInput);
    setEditVisible(true);
  };

  const handleSaveEdit = async () => {
    if (!editEntry || !editRaw.trim()) return;
    const draft = extractLocalMedical(editRaw.trim());
    await updateEntry(editEntry.id, {
      rawInput: editRaw.trim(),
      structured: draft.structured,
      tags: draft.tags,
      type: draft.type,
    });
    setEditVisible(false);
    setEditEntry(null);
    setExpandedId(null);
    await load();
  };

  // ── Delete ────────────────────────────────────────────────────

  const handleDelete = (entry: MedicalEntry) => {
    Alert.alert(
      'Delete Entry',
      `Delete "${entry.structured.what.slice(0, 50)}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            await deleteEntry(entry.id);
            setExpandedId(null);
            await load();
          },
        },
      ],
    );
  };

  // ── Share ────────────────────────────────────────────────────

  const handleShare = async () => {
    if (entries.length === 0) return;
    try {
      const summary = await generateAppointmentSummary(entries, CLAUDE_API_KEY);
      await Share.share({ message: clean(summary), title: 'Health Summary — PrivateAI' });
    } catch (e: unknown) {
      Alert.alert('Share failed', e instanceof Error ? e.message : String(e));
    }
  };

  // ── Render ───────────────────────────────────────────────────

  return (
    <View style={s.root}>

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="chevron-back" size={20} color={C.teal} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>// health timeline</Text>
        <TouchableOpacity onPress={handleShare} style={s.shareHeaderBtn}>
          <Ionicons name="share-outline" size={18} color={C.muted} />
        </TouchableOpacity>
      </View>

      <ScrollView
        ref={scrollRef}
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}>

        {/* Privacy badge */}
        <View style={s.privacyBadge}>
          <Ionicons name="lock-closed" size={11} color={C.teal} />
          <Text style={s.privacyText}> on-device · your health data never leaves your phone</Text>
        </View>

        {/* Living Health Story */}
        <View style={s.storyCard}>
          <View style={s.storyHeader}>
            <Text style={s.storyTitle}>Living Health Story</Text>
            <TouchableOpacity onPress={() => refreshStory()} style={s.refreshBtn} disabled={storyLoading}>
              <Ionicons name="refresh" size={13} color={storyLoading ? C.dim : C.teal} />
            </TouchableOpacity>
          </View>
          {storyLoading ? (
            <Text style={s.storyLoading}>composing your story...</Text>
          ) : storyError ? (
            <Text style={s.storyError}>{storyError}</Text>
          ) : story ? (
            <Text style={s.storyText}>{story}</Text>
          ) : (
            <Text style={s.storyEmpty}>
              {entries.length === 0
                ? 'Log your first health entry to generate your living health story.'
                : 'Tap ↻ to generate a narrative summary of the past 30 days.'}
            </Text>
          )}
          {!CLAUDE_API_KEY && (
            <Text style={s.storyApiNote}>claude api key required for story generation</Text>
          )}
        </View>

        {/* Timeline */}
        {grouped.length === 0 ? (
          <View style={s.emptyState}>
            <Ionicons name="pulse-outline" size={32} color={C.dim} />
            <Text style={s.emptyTitle}>No entries yet</Text>
            <Text style={s.emptyBody}>Tap [+ entry] to log a symptom, medication, or doctor visit.</Text>
          </View>
        ) : (
          grouped.map(({ key, entries: monthEntries }) => (
            <View key={key} style={s.monthSection}>

              {/* Month header */}
              <View style={s.monthHeader}>
                <View style={s.monthDot} />
                <Text style={s.monthLabel}>{monthLabel(key)}</Text>
                <Text style={s.monthCount}>{monthEntries.length} {monthEntries.length === 1 ? 'entry' : 'entries'}</Text>
              </View>

              {/* Entries */}
              {monthEntries.map(entry => {
                const expanded = expandedId === entry.id;
                const color    = entryTypeColor(entry.type);
                return (
                  <TouchableOpacity
                    key={entry.id}
                    onPress={() => setExpandedId(expanded ? null : entry.id)}
                    activeOpacity={0.8}
                    style={[s.entryCard, expanded && s.entryCardExpanded]}>

                    {/* Timeline stem */}
                    <View style={s.stemCol}>
                      <View style={[s.stemDot, { backgroundColor: entry.structured.urgent ? C.red : color }]} />
                      <View style={s.stemLine} />
                    </View>

                    {/* Card body */}
                    <View style={s.entryBody}>

                      {/* Top row: badge + date */}
                      <View style={s.entryTopRow}>
                        <View style={[s.typeBadge, { backgroundColor: color + '22', borderColor: color + '55' }]}>
                          <Text style={[s.typeBadgeText, { color }]}>{entryTypeLabel(entry.type)}</Text>
                        </View>
                        {entry.structured.urgent && (
                          <View style={s.urgentBadge}>
                            <Text style={s.urgentBadgeText}>⚠ urgent</Text>
                          </View>
                        )}
                        <Text style={s.entryDate}>{dayLabel(entry.timestamp)}</Text>
                      </View>

                      {/* What */}
                      <Text style={s.entryWhat} numberOfLines={expanded ? undefined : 2}>
                        {entry.structured.what}
                      </Text>

                      {/* Severity + duration inline */}
                      {(entry.structured.severity || entry.structured.duration) && (
                        <View style={s.entryMeta}>
                          {entry.structured.severity && (
                            <Text style={[s.entrySeverity, { color: severityColor(entry.structured.severity) }]}>
                              {entry.structured.severity}
                            </Text>
                          )}
                          {entry.structured.severity && entry.structured.duration && (
                            <Text style={s.entryMetaDot}> · </Text>
                          )}
                          {entry.structured.duration && (
                            <Text style={s.entryDuration}>{entry.structured.duration}</Text>
                          )}
                        </View>
                      )}

                      {/* Expanded: full details + actions */}
                      {expanded && (
                        <View style={s.expandedSection}>
                          {entry.structured.context && (
                            <View style={s.detailRow}>
                              <Text style={s.detailLabel}>context</Text>
                              <Text style={s.detailValue}>{entry.structured.context}</Text>
                            </View>
                          )}
                          <View style={s.detailRow}>
                            <Text style={s.detailLabel}>logged</Text>
                            <Text style={s.detailValue}>{entryRelativeDate(entry.timestamp)}</Text>
                          </View>
                          {entry.tags.length > 0 && (
                            <View style={s.tagRow}>
                              {entry.tags.map(t => (
                                <View key={t} style={s.tag}>
                                  <Text style={s.tagText}>{t}</Text>
                                </View>
                              ))}
                            </View>
                          )}
                          <View style={s.actionRow}>
                            <TouchableOpacity onPress={() => openEdit(entry)} style={s.editBtn}>
                              <Ionicons name="create-outline" size={13} color={C.teal} />
                              <Text style={s.editBtnText}> edit</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => handleDelete(entry)} style={s.deleteBtn}>
                              <Ionicons name="trash-outline" size={13} color={C.red} />
                              <Text style={s.deleteBtnText}> delete</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))
        )}

        {/* Bottom padding for FAB */}
        <View style={{ height: 90 }} />
      </ScrollView>

      {/* Floating add button */}
      <TouchableOpacity
        style={s.fab}
        onPress={() => { setRawInput(''); setAddVisible(true); }}
        activeOpacity={0.85}>
        <Ionicons name="add" size={22} color="#000" />
        <Text style={s.fabText}>entry</Text>
      </TouchableOpacity>

      {/* ── Add Entry Modal ── */}
      <Modal
        visible={addVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => { setAddVisible(false); setRawInput(''); }}>
        <View style={s.modal}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>// log health entry</Text>
            <TouchableOpacity onPress={() => { setAddVisible(false); setRawInput(''); }}>
              <Text style={s.modalClose}>[cancel]</Text>
            </TouchableOpacity>
          </View>
          <Text style={s.modalLabel}>describe what's happening</Text>
          <TextInput
            style={[s.modalInput, s.modalTextArea]}
            value={rawInput}
            onChangeText={setRawInput}
            placeholder="e.g. headache since this morning, mild, worse when I stand up..."
            placeholderTextColor={C.dim}
            multiline
            textAlignVertical="top"
            autoCapitalize="sentences"
            autoFocus
          />
          <Text style={s.modalHint}>symptoms · medications · visits · lab results</Text>
          <TouchableOpacity
            onPress={handleSubmit}
            style={[s.modalSaveBtn, (!rawInput.trim() || extracting) && s.modalSaveBtnDisabled]}
            disabled={!rawInput.trim() || extracting}>
            <Text style={s.modalSaveText}>{extracting ? 'extracting...' : 'extract & review'}</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* ── Confirmation Modal ── */}
      <Modal
        visible={confirmVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => { setConfirmVisible(false); setPending(null); }}>
        <View style={s.modal}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>// review entry</Text>
            <TouchableOpacity onPress={() => { setConfirmVisible(false); setPending(null); }}>
              <Text style={s.modalClose}>[discard]</Text>
            </TouchableOpacity>
          </View>

          {pendingUrgent && (
            <View style={s.urgentBanner}>
              <Ionicons name="warning" size={16} color={C.red} />
              <Text style={s.urgentBannerText}>  URGENT — if this is a medical emergency, call 911 immediately.</Text>
            </View>
          )}

          {pending && (
            <View style={s.confirmCard}>
              <View style={s.confirmRow}>
                <Text style={s.confirmLabel}>type</Text>
                <View style={[s.typeBadge, {
                  backgroundColor: entryTypeColor(pending.type) + '22',
                  borderColor: entryTypeColor(pending.type) + '55',
                }]}>
                  <Text style={[s.typeBadgeText, { color: entryTypeColor(pending.type) }]}>
                    {entryTypeLabel(pending.type)}
                  </Text>
                </View>
              </View>
              <View style={s.confirmRow}>
                <Text style={s.confirmLabel}>what</Text>
                <Text style={s.confirmValue}>{pending.structured.what}</Text>
              </View>
              {pending.structured.severity && (
                <View style={s.confirmRow}>
                  <Text style={s.confirmLabel}>severity</Text>
                  <Text style={[s.confirmValue, { color: severityColor(pending.structured.severity) }]}>
                    {pending.structured.severity}
                  </Text>
                </View>
              )}
              {pending.structured.duration && (
                <View style={s.confirmRow}>
                  <Text style={s.confirmLabel}>duration</Text>
                  <Text style={s.confirmValue}>{pending.structured.duration}</Text>
                </View>
              )}
              {pending.structured.context && (
                <View style={s.confirmRow}>
                  <Text style={s.confirmLabel}>context</Text>
                  <Text style={s.confirmValue}>{pending.structured.context}</Text>
                </View>
              )}
              {pending.tags.length > 0 && (
                <View style={[s.tagRow, { marginTop: 8 }]}>
                  {pending.tags.map(t => (
                    <View key={t} style={s.tag}><Text style={s.tagText}>{t}</Text></View>
                  ))}
                </View>
              )}
            </View>
          )}

          <Text style={s.privacyNote}>saved on-device only · zero data leaves device</Text>
          <TouchableOpacity onPress={handleConfirm} style={s.modalSaveBtn}>
            <Text style={s.modalSaveText}>save entry</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* ── Edit Modal ── */}
      <Modal
        visible={editVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => { setEditVisible(false); setEditEntry(null); }}>
        <View style={s.modal}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>// edit entry</Text>
            <TouchableOpacity onPress={() => { setEditVisible(false); setEditEntry(null); }}>
              <Text style={s.modalClose}>[cancel]</Text>
            </TouchableOpacity>
          </View>
          <Text style={s.modalLabel}>update description</Text>
          <TextInput
            style={[s.modalInput, s.modalTextArea]}
            value={editRaw}
            onChangeText={setEditRaw}
            multiline
            textAlignVertical="top"
            autoCapitalize="sentences"
            autoFocus
          />
          <Text style={s.modalHint}>re-extracted automatically from your description</Text>
          <TouchableOpacity
            onPress={handleSaveEdit}
            style={[s.modalSaveBtn, !editRaw.trim() && s.modalSaveBtnDisabled]}
            disabled={!editRaw.trim()}>
            <Text style={s.modalSaveText}>save changes</Text>
          </TouchableOpacity>
        </View>
      </Modal>

    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: C.bg },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 16 },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: 60, paddingBottom: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: C.border,
    backgroundColor: C.bg,
  },
  backBtn:       { padding: 6, marginRight: 8 },
  headerTitle:   { fontFamily: FONT, fontSize: 14, color: C.teal, flex: 1, letterSpacing: 1 },
  shareHeaderBtn: { padding: 6 },

  // Privacy badge
  privacyBadge: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 16, marginTop: 16, marginBottom: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: C.teal + '33',
    borderRadius: 6, backgroundColor: C.teal + '0d',
    alignSelf: 'flex-start',
  },
  privacyText: { fontFamily: FONT, fontSize: 10, color: C.teal, letterSpacing: 0.5 },

  // Living Health Story card
  storyCard: {
    margin: 16, marginTop: 12,
    padding: 16,
    borderWidth: 1, borderColor: C.border,
    borderRadius: 12, backgroundColor: C.surface,
  },
  storyHeader:  { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  storyTitle:   { fontFamily: FONT, fontSize: 12, color: C.teal, letterSpacing: 1, flex: 1, textTransform: 'uppercase' },
  refreshBtn:   { padding: 4 },
  storyText:    { fontFamily: FONT, fontSize: 14, color: C.text, lineHeight: 22 },
  storyLoading: { fontFamily: FONT, fontSize: 13, color: C.muted, fontStyle: 'italic' },
  storyError:   { fontFamily: FONT, fontSize: 12, color: C.red },
  storyEmpty:   { fontFamily: FONT, fontSize: 13, color: C.muted, lineHeight: 20 },
  storyApiNote: { fontFamily: FONT, fontSize: 10, color: C.dim, marginTop: 8, letterSpacing: 0.5 },

  // Empty state
  emptyState: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyTitle: { fontFamily: FONT, fontSize: 15, color: C.muted },
  emptyBody:  { fontFamily: FONT, fontSize: 12, color: C.dim, textAlign: 'center', paddingHorizontal: 40, lineHeight: 18 },

  // Month section
  monthSection: { paddingHorizontal: 16, marginTop: 8 },
  monthHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, gap: 8,
  },
  monthDot:   { width: 8, height: 8, borderRadius: 4, backgroundColor: C.teal },
  monthLabel: { fontFamily: FONT, fontSize: 13, color: C.month, flex: 1, fontWeight: '600' },
  monthCount: { fontFamily: FONT, fontSize: 10, color: C.muted, letterSpacing: 1 },

  // Entry card
  entryCard: {
    flexDirection: 'row',
    marginBottom: 2,
    borderRadius: 10,
    overflow: 'hidden',
  },
  entryCardExpanded: {
    backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.border,
  },

  // Timeline stem
  stemCol:  { width: 28, alignItems: 'center', paddingTop: 14 },
  stemDot:  { width: 8, height: 8, borderRadius: 4, zIndex: 1 },
  stemLine: { flex: 1, width: 1, backgroundColor: C.border, marginTop: 4 },

  // Card body
  entryBody:    { flex: 1, paddingVertical: 10, paddingRight: 12 },
  entryTopRow:  { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 5 },
  entryDate:    { fontFamily: FONT, fontSize: 10, color: C.muted, marginLeft: 'auto' as any },
  entryWhat:    { fontFamily: FONT, fontSize: 14, color: C.text, lineHeight: 20, marginBottom: 4 },
  entryMeta:    { flexDirection: 'row', alignItems: 'center' },
  entrySeverity:{ fontFamily: FONT, fontSize: 11, letterSpacing: 0.5 },
  entryMetaDot: { fontFamily: FONT, fontSize: 11, color: C.dim },
  entryDuration:{ fontFamily: FONT, fontSize: 11, color: C.muted },

  // Type badge
  typeBadge:     { borderWidth: 1, borderRadius: 4, paddingHorizontal: 7, paddingVertical: 2 },
  typeBadgeText: { fontFamily: FONT, fontSize: 10, fontWeight: '600', letterSpacing: 0.5 },

  // Urgent badge
  urgentBadge:     { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: C.red + '22', borderWidth: 1, borderColor: C.red + '55' },
  urgentBadgeText: { fontFamily: FONT, fontSize: 9, color: C.red, letterSpacing: 0.5 },

  // Expanded details
  expandedSection: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border, gap: 6 },
  detailRow:       { flexDirection: 'row', gap: 10 },
  detailLabel:     { fontFamily: FONT, fontSize: 10, color: C.muted, letterSpacing: 1, textTransform: 'uppercase', width: 56, paddingTop: 1 },
  detailValue:     { fontFamily: FONT, fontSize: 12, color: C.text, flex: 1, lineHeight: 18 },

  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  tag:    { paddingHorizontal: 7, paddingVertical: 2, backgroundColor: C.dim + '55', borderRadius: 4 },
  tagText:{ fontFamily: FONT, fontSize: 9, color: C.muted, letterSpacing: 0.5 },

  actionRow:      { flexDirection: 'row', gap: 12, marginTop: 6 },
  editBtn:        { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 10, borderWidth: 1, borderColor: C.teal + '44', borderRadius: 6 },
  editBtnText:    { fontFamily: FONT, fontSize: 12, color: C.teal },
  deleteBtn:      { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 10, borderWidth: 1, borderColor: C.red + '44', borderRadius: 6 },
  deleteBtnText:  { fontFamily: FONT, fontSize: 12, color: C.red },

  // FAB
  fab: {
    position: 'absolute', right: 20, bottom: 30,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.teal, borderRadius: 28,
    paddingVertical: 14, paddingHorizontal: 20,
    shadowColor: C.teal, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 10, elevation: 8,
  },
  fabText: { fontFamily: FONT, fontSize: 13, color: '#000', fontWeight: '700' },

  // Modals (shared)
  modal: { flex: 1, backgroundColor: '#070d1a', padding: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle:  { fontFamily: FONT, fontSize: 15, color: C.teal },
  modalClose:  { fontFamily: FONT, fontSize: 13, color: C.muted },
  modalLabel:  { fontFamily: FONT, fontSize: 10, color: C.muted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 },
  modalInput:  { fontFamily: FONT, fontSize: 13, color: '#bbb', borderWidth: 1, borderColor: C.border, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 },
  modalTextArea: { minHeight: 140, textAlignVertical: 'top' },
  modalHint:   { fontFamily: FONT, fontSize: 10, color: C.dim, marginBottom: 16, lineHeight: 16 },
  modalSaveBtn: { backgroundColor: C.teal + '22', borderWidth: 1, borderColor: C.teal, borderRadius: 6, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  modalSaveBtnDisabled: { opacity: 0.4 },
  modalSaveText: { fontFamily: FONT, fontSize: 13, color: C.teal },

  // Urgent banner (confirm modal)
  urgentBanner: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: C.red + '1a', borderWidth: 1, borderColor: C.red + '55', borderRadius: 6, padding: 12, marginBottom: 16 },
  urgentBannerText: { fontFamily: FONT, fontSize: 12, color: C.red, flex: 1, lineHeight: 18 },

  // Confirm card
  confirmCard:  { borderWidth: 1, borderColor: C.border, borderRadius: 8, padding: 14, gap: 10, marginBottom: 12 },
  confirmRow:   { flexDirection: 'row', gap: 12 },
  confirmLabel: { fontFamily: FONT, fontSize: 10, color: C.muted, letterSpacing: 1, textTransform: 'uppercase', width: 64, paddingTop: 2 },
  confirmValue: { fontFamily: FONT, fontSize: 12, color: '#aaa', flex: 1, lineHeight: 18 },

  privacyNote:  { fontFamily: FONT, fontSize: 10, color: C.dim, textAlign: 'center', marginBottom: 4, letterSpacing: 0.5 },
});
