/**
 * conversations.tsx — Conversation History
 *
 * Lists all past conversation summaries with:
 *   - Search / filter by subject or content
 *   - Expandable cards with highlights, decisions, action items
 *   - Pin / delete summaries
 *   - Stats bar (total conversations, topics, action items)
 */

import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  getAllSummaries,
  updateSummary,
  deleteSummary,
  type ConversationSummary,
} from '@/services/conversationSummarizer';

const FONT = Platform.OS === 'ios' ? 'Courier New' : 'monospace';

// ── Helpers ──────────────────────────────────────────────────

function relativeDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function statusColor(status: string): string {
  if (status === 'done') return '#00ff88';
  if (status === 'blocked') return '#ff4444';
  return '#ffaa00';
}

// ── Component ────────────────────────────────────────────────

export default function ConversationsScreen() {
  const [summaries, setSummaries] = useState<ConversationSummary[]>([]);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    const all = await getAllSummaries();
    setSummaries(all);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = search.trim() === ''
    ? summaries
    : summaries.filter(s => {
        const q = search.toLowerCase();
        return (
          s.subject.toLowerCase().includes(q) ||
          s.highlights.some(h => h.toLowerCase().includes(q)) ||
          s.hardStickNotes.some(n => n.toLowerCase().includes(q)) ||
          s.actionItems.some(a => a.task.toLowerCase().includes(q))
        );
      });

  // Stats
  const totalTopics = new Set(summaries.map(s => s.subject)).size;
  const totalActions = summaries.reduce((n, s) => n + s.actionItems.length, 0);
  const openActions = summaries.reduce(
    (n, s) => n + s.actionItems.filter(a => a.status !== 'done').length, 0
  );

  const handlePin = async (s: ConversationSummary) => {
    await updateSummary(s.id, { pinnedForReview: !s.pinnedForReview });
    load();
  };

  const handleDelete = (s: ConversationSummary) => {
    Alert.alert(
      'Delete summary?',
      `Remove "${s.subject}" from ${relativeDate(s.date)}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => { await deleteSummary(s.id); load(); },
        },
      ],
    );
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(s => s.id)));
    }
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  const handleBatchDelete = () => {
    if (selected.size === 0) return;
    Alert.alert(
      `Delete ${selected.size} conversation${selected.size !== 1 ? 's' : ''}?`,
      'This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            for (const id of selected) await deleteSummary(id);
            exitSelectMode();
            load();
          },
        },
      ],
    );
  };

  const renderItem = ({ item: s }: { item: ConversationSummary }) => {
    const expanded = expandedId === s.id;
    const isSelected = selected.has(s.id);
    return (
      <TouchableOpacity
        style={[styles.card, s.pinnedForReview && styles.cardPinned, isSelected && styles.cardSelected]}
        activeOpacity={0.7}
        onPress={() => {
          if (selectMode) { toggleSelect(s.id); }
          else { setExpandedId(expanded ? null : s.id); }
        }}
        onLongPress={() => {
          if (!selectMode) {
            setSelectMode(true);
            setSelected(new Set([s.id]));
          }
        }}
      >
        {/* Header */}
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            {selectMode && (
              <View style={[styles.checkbox, isSelected && styles.checkboxChecked]}>
                {isSelected && <Text style={styles.checkmark}>✓</Text>}
              </View>
            )}
            {s.pinnedForReview && <Text style={styles.pinIcon}>pin</Text>}
            <Text style={styles.cardSubject} numberOfLines={1}>{s.subject}</Text>
          </View>
          <Text style={styles.cardDate}>{relativeDate(s.date)}</Text>
        </View>

        {/* Preview — first highlight */}
        {!expanded && s.highlights.length > 0 && (
          <Text style={styles.cardPreview} numberOfLines={1}>
            {s.highlights[0]}
          </Text>
        )}

        {/* Meta row */}
        <View style={styles.cardMeta}>
          <Text style={styles.cardMetaText}>{s.messageCount} msgs</Text>
          <Text style={styles.cardMetaText}>{s.estimatedTimeSpent}m</Text>
          {s.actionItems.length > 0 && (
            <Text style={styles.cardMetaText}>
              {s.actionItems.filter(a => a.status === 'done').length}/{s.actionItems.length} done
            </Text>
          )}
          {s.hardStickNotes.length > 0 && (
            <Text style={[styles.cardMetaText, { color: '#f59e0b' }]}>
              {s.hardStickNotes.length} decision{s.hardStickNotes.length !== 1 ? 's' : ''}
            </Text>
          )}
        </View>

        {/* Expanded details */}
        {expanded && (
          <View style={styles.expandedSection}>
            {/* Highlights */}
            {s.highlights.length > 0 && (
              <View style={styles.detailBlock}>
                <Text style={styles.detailLabel}>highlights</Text>
                {s.highlights.map((h, i) => (
                  <Text key={i} style={styles.detailBullet}>{h}</Text>
                ))}
              </View>
            )}

            {/* Decisions */}
            {s.hardStickNotes.length > 0 && (
              <View style={styles.detailBlock}>
                <Text style={[styles.detailLabel, { color: '#f59e0b' }]}>decisions</Text>
                {s.hardStickNotes.map((n, i) => (
                  <Text key={i} style={[styles.detailBullet, { color: '#ccaa66' }]}>{n}</Text>
                ))}
              </View>
            )}

            {/* Action items */}
            {s.actionItems.length > 0 && (
              <View style={styles.detailBlock}>
                <Text style={styles.detailLabel}>actions</Text>
                {s.actionItems.map((a, i) => (
                  <View key={i} style={styles.actionRow}>
                    <View style={[styles.statusDot, { backgroundColor: statusColor(a.status) }]} />
                    <Text style={styles.actionText} numberOfLines={1}>{a.task}</Text>
                    <Text style={[styles.actionStatus, { color: statusColor(a.status) }]}>
                      {a.status}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {/* KG nodes */}
            {s.knowledgeGraphNodes.length > 0 && (
              <View style={styles.detailBlock}>
                <Text style={styles.detailLabel}>concepts</Text>
                <View style={styles.chipRow}>
                  {s.knowledgeGraphNodes.slice(0, 6).map((n, i) => (
                    <View key={i} style={styles.chip}>
                      <Text style={styles.chipText}>{n}</Text>
                    </View>
                  ))}
                  {s.knowledgeGraphNodes.length > 6 && (
                    <Text style={styles.chipMore}>+{s.knowledgeGraphNodes.length - 6}</Text>
                  )}
                </View>
              </View>
            )}

            {/* Actions: pin + delete */}
            <View style={styles.cardActions}>
              <TouchableOpacity style={styles.cardActionBtn} onPress={() => handlePin(s)}>
                <Text style={styles.cardActionText}>
                  {s.pinnedForReview ? 'unpin' : 'pin'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.cardActionBtnDanger} onPress={() => handleDelete(s)}>
                <Text style={styles.cardActionTextDanger}>delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      {selectMode ? (
        <View style={styles.header}>
          <TouchableOpacity onPress={exitSelectMode} style={styles.backBtn}>
            <Text style={styles.selectCancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {selected.size} selected
          </Text>
          <TouchableOpacity onPress={selectAll} style={styles.selectAllBtn}>
            <Text style={styles.selectAllText}>
              {selected.size === filtered.length ? 'Deselect All' : 'Select All'}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={20} color="#888" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>// conversations</Text>
          <Text style={styles.headerCount}>{summaries.length}</Text>
        </View>
      )}

      {/* Batch delete bar */}
      {selectMode && selected.size > 0 && (
        <TouchableOpacity style={styles.batchDeleteBar} onPress={handleBatchDelete}>
          <Ionicons name="trash-outline" size={14} color="#ff4444" />
          <Text style={styles.batchDeleteText}>
            Delete {selected.size} conversation{selected.size !== 1 ? 's' : ''}
          </Text>
        </TouchableOpacity>
      )}

      {/* Stats bar */}
      <View style={styles.statsBar}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{summaries.length}</Text>
          <Text style={styles.statLabel}>total</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{totalTopics}</Text>
          <Text style={styles.statLabel}>topics</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: '#00ff88' }]}>{totalActions - openActions}</Text>
          <Text style={styles.statLabel}>done</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: '#ffaa00' }]}>{openActions}</Text>
          <Text style={styles.statLabel}>open</Text>
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchRow}>
        <Ionicons name="search" size={14} color="#555" style={{ marginRight: 8 }} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="search conversations..."
          placeholderTextColor="#333"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Text style={styles.searchClear}>x</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* List */}
      {loading ? (
        <Text style={styles.emptyText}>loading...</Text>
      ) : filtered.length === 0 ? (
        <Text style={styles.emptyText}>
          {summaries.length === 0
            ? 'no conversations yet — start chatting.'
            : 'no matches found.'}
        </Text>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={s => s.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#080d14',
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
  },
  backBtn: {
    padding: 4,
  },
  headerTitle: {
    fontFamily: FONT,
    fontSize: 16,
    color: '#4db8ff',
    letterSpacing: 1,
    flex: 1,
  },
  headerCount: {
    fontFamily: FONT,
    fontSize: 12,
    color: '#555',
    letterSpacing: 0.5,
  },
  statsBar: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2a',
    gap: 0,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontFamily: FONT,
    fontSize: 18,
    color: '#ccc',
    fontWeight: '700',
  },
  statLabel: {
    fontFamily: FONT,
    fontSize: 8,
    color: '#555',
    letterSpacing: 1,
    marginTop: 2,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginVertical: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#0d1220',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1a1a2a',
  },
  searchInput: {
    flex: 1,
    fontFamily: FONT,
    fontSize: 12,
    color: '#ccc',
    padding: 0,
  },
  searchClear: {
    fontFamily: FONT,
    fontSize: 14,
    color: '#555',
    paddingLeft: 8,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  emptyText: {
    fontFamily: FONT,
    fontSize: 11,
    color: '#555',
    textAlign: 'center',
    marginTop: 60,
    letterSpacing: 0.5,
  },

  // Card
  card: {
    backgroundColor: '#0d1220',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1a1a2a',
    padding: 14,
    marginBottom: 10,
  },
  cardPinned: {
    borderColor: '#f59e0b33',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 6,
    marginRight: 8,
  },
  pinIcon: {
    fontFamily: FONT,
    fontSize: 8,
    color: '#f59e0b',
    backgroundColor: '#f59e0b18',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 2,
    overflow: 'hidden',
    letterSpacing: 0.5,
  },
  cardSubject: {
    fontFamily: FONT,
    fontSize: 13,
    color: '#ddd',
    fontWeight: '600',
    flex: 1,
    letterSpacing: 0.3,
  },
  cardDate: {
    fontFamily: FONT,
    fontSize: 9,
    color: '#555',
    letterSpacing: 0.5,
  },
  cardPreview: {
    fontFamily: FONT,
    fontSize: 10,
    color: '#777',
    marginBottom: 6,
    lineHeight: 15,
  },
  cardMeta: {
    flexDirection: 'row',
    gap: 12,
  },
  cardMetaText: {
    fontFamily: FONT,
    fontSize: 9,
    color: '#555',
    letterSpacing: 0.3,
  },

  // Expanded
  expandedSection: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#1a1a2a',
    paddingTop: 10,
  },
  detailBlock: {
    marginBottom: 10,
  },
  detailLabel: {
    fontFamily: FONT,
    fontSize: 9,
    color: '#4db8ff',
    letterSpacing: 1,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  detailBullet: {
    fontFamily: FONT,
    fontSize: 10,
    color: '#999',
    lineHeight: 16,
    paddingLeft: 8,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 8,
    marginBottom: 3,
  },
  statusDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  actionText: {
    fontFamily: FONT,
    fontSize: 10,
    color: '#999',
    flex: 1,
  },
  actionStatus: {
    fontFamily: FONT,
    fontSize: 8,
    letterSpacing: 0.5,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    paddingLeft: 8,
  },
  chip: {
    borderWidth: 1,
    borderColor: '#1a2a3a',
    borderRadius: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: '#0a1018',
  },
  chipText: {
    fontFamily: FONT,
    fontSize: 8,
    color: '#7799bb',
    letterSpacing: 0.2,
  },
  chipMore: {
    fontFamily: FONT,
    fontSize: 8,
    color: '#555',
    alignSelf: 'center',
  },
  cardActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1a1a2a',
  },
  cardActionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#1a2a3a',
    borderRadius: 4,
  },
  cardActionText: {
    fontFamily: FONT,
    fontSize: 9,
    color: '#4db8ff',
    letterSpacing: 0.5,
  },
  cardActionBtnDanger: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#331111',
    borderRadius: 4,
    backgroundColor: '#1a0808',
  },
  cardActionTextDanger: {
    fontFamily: FONT,
    fontSize: 9,
    color: '#ff4444',
    letterSpacing: 0.5,
  },

  // Multi-select
  cardSelected: {
    borderColor: '#ff444466',
    backgroundColor: '#1a0a0a',
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    borderColor: '#ff4444',
    backgroundColor: '#ff444422',
  },
  checkmark: {
    fontFamily: FONT,
    fontSize: 11,
    color: '#ff4444',
    lineHeight: 14,
  },
  selectCancelText: {
    fontFamily: FONT,
    fontSize: 13,
    color: '#888',
  },
  selectAllBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  selectAllText: {
    fontFamily: FONT,
    fontSize: 11,
    color: '#4db8ff',
    letterSpacing: 0.5,
  },
  batchDeleteBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingVertical: 10,
    backgroundColor: '#1a0808',
    borderWidth: 1,
    borderColor: '#331111',
    borderRadius: 6,
  },
  batchDeleteText: {
    fontFamily: FONT,
    fontSize: 12,
    color: '#ff4444',
    letterSpacing: 0.5,
  },
});
