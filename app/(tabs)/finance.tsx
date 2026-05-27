/**
 * finance.tsx — PrivateAI Finance Domain
 *
 * V1 proof loop:
 *   1. Add transaction (amount, type, category, merchant, note)
 *   2. Save to SQLite via financeDB.ts
 *   3. Show this month totals by category
 *
 * No AI categorization. No bank connections. No alerts. No rewards.
 * Schema-first: prove the data model works before adding intelligence.
 */

import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  initFinanceDB,
  addTransaction,
  deleteTransaction,
  getMonthlyTotals,
  getTransactions,
  CATEGORIES,
  type Category,
  type CategoryTotal,
  type Transaction,
  type TransactionType,
} from '@/services/financeDB';

const FONT = Platform.OS === 'ios' ? 'Courier New' : 'monospace';

const TYPE_COLOR: Record<TransactionType, string> = {
  income:   '#00ff88',
  expense:  '#ef4444',
  transfer: '#4db8ff',
};

function fmtAmount(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function monthLabel(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// ── Category row ─────────────────────────────────────────────

function CategoryRow({ item }: { item: CategoryTotal }) {
  const color = TYPE_COLOR[item.type] ?? '#888';
  return (
    <View style={styles.catRow}>
      <Text style={styles.catName}>{item.category}</Text>
      <Text style={[styles.catAmount, { color }]}>${fmtAmount(item.total)}</Text>
    </View>
  );
}

// ── Transaction row ──────────────────────────────────────────

function TransactionRow({ tx, onDelete }: { tx: Transaction; onDelete: (id: string) => void }) {
  const color = TYPE_COLOR[tx.type] ?? '#888';
  const date = new Date(tx.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return (
    <View style={styles.txRow}>
      <View style={styles.txLeft}>
        <Text style={styles.txDate}>{date}</Text>
        <View style={styles.txMid}>
          <Text style={styles.txCategory}>{tx.category}</Text>
          {tx.merchant ? <Text style={styles.txMerchant}>{tx.merchant}</Text> : null}
        </View>
      </View>
      <View style={styles.txRight}>
        <Text style={[styles.txAmount, { color }]}>
          {tx.type === 'income' ? '+' : tx.type === 'expense' ? '-' : ''}${fmtAmount(tx.amount)}
        </Text>
        <Pressable onPress={() => onDelete(tx.id)} hitSlop={8}>
          <Text style={styles.txDelete}>✕</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ── Main screen ──────────────────────────────────────────────

type View_ = 'summary' | 'transactions';

export default function FinanceScreen() {
  const now = new Date();
  const [year,  setYear]  = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [view,  setView]  = useState<View_>('summary');
  const [totals, setTotals] = useState<CategoryTotal[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [showAdd, setShowAdd] = useState(false);

  // Add form
  const [amountText,   setAmountText]   = useState('');
  const [txType,       setTxType]       = useState<TransactionType>('expense');
  const [category,     setCategory]     = useState<Category>('Groceries');
  const [merchant,     setMerchant]     = useState('');
  const [note,         setNote]         = useState('');
  const [saving,       setSaving]       = useState(false);
  const [amountError,  setAmountError]  = useState('');

  const loadData = useCallback(async () => {
    const [t, txns] = await Promise.all([
      getMonthlyTotals(year, month),
      getTransactions({ year, month }),
    ]);
    setTotals(t);
    setTransactions(txns);
  }, [year, month]);

  useEffect(() => {
    initFinanceDB().then(loadData);
  }, [loadData]);

  const prevMonth = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  };

  const handleSave = async () => {
    const raw = amountText.replace(/[^0-9.]/g, '');
    const amount = parseFloat(raw);
    if (isNaN(amount) || amount <= 0) {
      setAmountError('enter a valid amount');
      return;
    }
    setSaving(true);
    setAmountError('');
    try {
      await addTransaction({
        date: Date.now(),
        amount,
        type: txType,
        category,
        merchant: merchant.trim() || null,
        note: note.trim() || null,
        recurring: 0,
        paymentMethod: null,
      });
      setAmountText('');
      setMerchant('');
      setNote('');
      setTxType('expense');
      setCategory('Groceries');
      setShowAdd(false);
      await loadData();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteTransaction(id);
    await loadData();
  };

  const resetAddForm = () => {
    setAmountText('');
    setMerchant('');
    setNote('');
    setAmountError('');
    setTxType('expense');
    setCategory('Groceries');
    setShowAdd(false);
  };

  // Computed totals
  const totalIncome   = totals.filter(t => t.type === 'income').reduce((s, t) => s + t.total, 0);
  const totalExpenses = totals.filter(t => t.type === 'expense').reduce((s, t) => s + t.total, 0);
  const net = totalIncome - totalExpenses;

  const expenses  = totals.filter(t => t.type === 'expense').sort((a, b) => b.total - a.total);
  const incomes   = totals.filter(t => t.type === 'income');
  const transfers = totals.filter(t => t.type === 'transfer');

  return (
    <View style={styles.root}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={20} color="#4db8ff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>// finance</Text>
        <TouchableOpacity onPress={() => setShowAdd(true)} style={styles.addHeaderBtn}>
          <Text style={styles.addHeaderBtnText}>+ add</Text>
        </TouchableOpacity>
      </View>

      {/* Month navigation */}
      <View style={styles.monthNav}>
        <TouchableOpacity onPress={prevMonth} style={styles.monthArrow}>
          <Text style={styles.monthArrowText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.monthLabel}>{monthLabel(year, month)}</Text>
        <TouchableOpacity onPress={nextMonth} style={styles.monthArrow}>
          <Text style={styles.monthArrowText}>›</Text>
        </TouchableOpacity>
      </View>

      {/* Net summary strip */}
      <View style={styles.netStrip}>
        <View style={styles.netItem}>
          <Text style={styles.netLabel}>in</Text>
          <Text style={[styles.netAmount, { color: '#00ff88' }]}>${fmtAmount(totalIncome)}</Text>
        </View>
        <View style={styles.netDivider} />
        <View style={styles.netItem}>
          <Text style={styles.netLabel}>out</Text>
          <Text style={[styles.netAmount, { color: '#ef4444' }]}>${fmtAmount(totalExpenses)}</Text>
        </View>
        <View style={styles.netDivider} />
        <View style={styles.netItem}>
          <Text style={styles.netLabel}>net</Text>
          <Text style={[styles.netAmount, { color: net >= 0 ? '#00ff88' : '#ef4444' }]}>
            {net >= 0 ? '+' : ''}${fmtAmount(Math.abs(net))}
          </Text>
        </View>
      </View>

      {/* View toggle */}
      <View style={styles.viewToggle}>
        {(['summary', 'transactions'] as View_[]).map(v => (
          <TouchableOpacity key={v} onPress={() => setView(v)}
            style={[styles.toggleBtn, view === v && styles.toggleBtnActive]}>
            <Text style={[styles.toggleText, view === v && styles.toggleTextActive]}>{v}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      {view === 'summary' ? (
        <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 40 }}>
          {totals.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>no transactions this month</Text>
              <Text style={styles.emptySub}>tap + add to log your first transaction</Text>
            </View>
          ) : (
            <>
              {expenses.length > 0 && (
                <>
                  <Text style={styles.groupLabel}>// expenses</Text>
                  {expenses.map((t, i) => <CategoryRow key={`exp-${i}`} item={t} />)}
                </>
              )}
              {incomes.length > 0 && (
                <>
                  <Text style={[styles.groupLabel, { marginTop: 20 }]}>// income</Text>
                  {incomes.map((t, i) => <CategoryRow key={`inc-${i}`} item={t} />)}
                </>
              )}
              {transfers.length > 0 && (
                <>
                  <Text style={[styles.groupLabel, { marginTop: 20 }]}>// transfers</Text>
                  {transfers.map((t, i) => <CategoryRow key={`txf-${i}`} item={t} />)}
                </>
              )}
            </>
          )}
        </ScrollView>
      ) : (
        <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 40 }}>
          {transactions.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>no transactions this month</Text>
            </View>
          ) : (
            transactions.map(tx => (
              <TransactionRow key={tx.id} tx={tx} onDelete={handleDelete} />
            ))
          )}
        </ScrollView>
      )}

      {/* Add Transaction Modal */}
      <Modal
        visible={showAdd}
        animationType="slide"
        transparent
        presentationStyle="overFullScreen"
        onRequestClose={resetAddForm}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalSheet}>

            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>// add transaction</Text>
              <Pressable onPress={resetAddForm} hitSlop={8}>
                <Text style={styles.modalClose}>[x]</Text>
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

              {/* Amount */}
              <Text style={styles.fieldLabel}>amount ($)</Text>
              <TextInput
                style={[styles.amountInput, amountError ? { borderColor: '#ef4444' } : null]}
                value={amountText}
                onChangeText={t => { setAmountText(t); setAmountError(''); }}
                placeholder="0.00"
                placeholderTextColor="#2a2a3a"
                keyboardType="decimal-pad"
                autoFocus
              />
              {amountError ? <Text style={styles.fieldError}>{amountError}</Text> : null}

              {/* Type */}
              <Text style={styles.fieldLabel}>type</Text>
              <View style={styles.chipRow}>
                {(['expense', 'income', 'transfer'] as TransactionType[]).map(t => (
                  <TouchableOpacity key={t} onPress={() => setTxType(t)}
                    style={[styles.chip, txType === t && { borderColor: TYPE_COLOR[t], backgroundColor: TYPE_COLOR[t] + '18' }]}>
                    <Text style={[styles.chipText, txType === t && { color: TYPE_COLOR[t] }]}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Category */}
              <Text style={styles.fieldLabel}>category</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catScroll}
                contentContainerStyle={styles.catScrollContent}>
                {CATEGORIES.map(cat => (
                  <TouchableOpacity key={cat} onPress={() => setCategory(cat)}
                    style={[styles.chip, category === cat && styles.chipActive]}>
                    <Text style={[styles.chipText, category === cat && styles.chipTextActive]}>{cat}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Merchant */}
              <Text style={styles.fieldLabel}>merchant (optional)</Text>
              <TextInput
                style={styles.textInput}
                value={merchant}
                onChangeText={setMerchant}
                placeholder="e.g. Whole Foods"
                placeholderTextColor="#2a2a3a"
                autoCapitalize="words"
              />

              {/* Note */}
              <Text style={styles.fieldLabel}>note (optional)</Text>
              <TextInput
                style={styles.textInput}
                value={note}
                onChangeText={setNote}
                placeholder="optional note"
                placeholderTextColor="#2a2a3a"
              />

              {/* Save */}
              <Pressable
                style={[styles.saveBtn, (saving || !amountText.trim()) && { opacity: 0.4 }]}
                onPress={handleSave}
                disabled={saving || !amountText.trim()}>
                <Text style={styles.saveBtnText}>{saving ? 'saving...' : 'save transaction'}</Text>
              </Pressable>

              <View style={{ height: 24 }} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#080d14' },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 56, paddingHorizontal: 16, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: '#0d1a10',
  },
  backBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontFamily: FONT, fontSize: 14, color: '#4db8ff', letterSpacing: 2 },
  addHeaderBtn: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: '#1a2a3a', borderRadius: 4,
    backgroundColor: 'rgba(77,184,255,0.06)',
  },
  addHeaderBtnText: { fontFamily: FONT, fontSize: 11, color: '#4db8ff', letterSpacing: 1 },

  // Month nav
  monthNav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 10, gap: 20,
  },
  monthArrow: { padding: 6 },
  monthArrowText: { fontFamily: FONT, fontSize: 20, color: '#4db8ff' },
  monthLabel: { fontFamily: FONT, fontSize: 13, color: '#ccc', letterSpacing: 1, minWidth: 160, textAlign: 'center' },

  // Net strip
  netStrip: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 16, marginBottom: 12,
    borderWidth: 1, borderColor: '#0d1a20', borderRadius: 6,
    backgroundColor: '#0a0f18',
  },
  netItem: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  netLabel: { fontFamily: FONT, fontSize: 9, color: '#3a4a5a', letterSpacing: 1, marginBottom: 4 },
  netAmount: { fontFamily: FONT, fontSize: 14, fontWeight: '700' },
  netDivider: { width: 1, height: 32, backgroundColor: '#0d1a20' },

  // View toggle
  viewToggle: {
    flexDirection: 'row', marginHorizontal: 16, marginBottom: 8,
    borderWidth: 1, borderColor: '#0d1a20', borderRadius: 4, overflow: 'hidden',
  },
  toggleBtn: { flex: 1, paddingVertical: 8, alignItems: 'center' },
  toggleBtnActive: { backgroundColor: 'rgba(77,184,255,0.08)' },
  toggleText: { fontFamily: FONT, fontSize: 9, color: '#2a3a4a', letterSpacing: 1 },
  toggleTextActive: { color: '#4db8ff' },

  // Content
  content: { flex: 1, paddingHorizontal: 16 },

  // Category summary
  groupLabel: {
    fontFamily: FONT, fontSize: 10, color: '#2a3a4a',
    letterSpacing: 2, marginTop: 12, marginBottom: 6,
  },
  catRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#0a0f14',
  },
  catName: { fontFamily: FONT, fontSize: 12, color: '#6a7a8a' },
  catAmount: { fontFamily: FONT, fontSize: 13, fontWeight: '600' },

  // Transaction list
  txRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#0a0f14',
  },
  txLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  txDate: { fontFamily: FONT, fontSize: 10, color: '#2a3a4a', width: 46 },
  txMid: { flex: 1, gap: 2 },
  txCategory: { fontFamily: FONT, fontSize: 11, color: '#6a7a8a' },
  txMerchant: { fontFamily: FONT, fontSize: 9, color: '#3a4a5a' },
  txRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  txAmount: { fontFamily: FONT, fontSize: 12, fontWeight: '600' },
  txDelete: { fontFamily: FONT, fontSize: 10, color: '#2a2a3a' },

  // Empty state
  empty: { flex: 1, alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyText: { fontFamily: FONT, fontSize: 13, color: '#1a2a3a', letterSpacing: 1 },
  emptySub: { fontFamily: FONT, fontSize: 11, color: '#111828', textAlign: 'center' },

  // Add modal
  modalOverlay: {
    flex: 1, justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  modalSheet: {
    backgroundColor: '#080d14',
    borderTopWidth: 1, borderTopColor: '#0d1a20',
    borderTopLeftRadius: 16, borderTopRightRadius: 16,
    paddingHorizontal: 20, paddingTop: 16,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: { fontFamily: FONT, fontSize: 13, color: '#4db8ff', letterSpacing: 2 },
  modalClose: { fontFamily: FONT, fontSize: 13, color: '#3a4a5a' },

  // Form fields
  fieldLabel: {
    fontFamily: FONT, fontSize: 10, color: '#3a4a5a',
    letterSpacing: 1, marginBottom: 6, marginTop: 14,
  },
  fieldError: { fontFamily: FONT, fontSize: 10, color: '#ef4444', marginTop: 4 },
  amountInput: {
    fontFamily: FONT, fontSize: 22, color: '#ccc',
    borderWidth: 1, borderColor: '#0d1a20', borderRadius: 6,
    paddingHorizontal: 14, paddingVertical: 12,
    backgroundColor: '#0a0f18',
  },
  textInput: {
    fontFamily: FONT, fontSize: 13, color: '#ccc',
    borderWidth: 1, borderColor: '#0d1a20', borderRadius: 6,
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: '#0a0f18',
  },
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  catScroll: { marginBottom: 4 },
  catScrollContent: { flexDirection: 'row', gap: 8, paddingBottom: 4 },
  chip: {
    paddingVertical: 6, paddingHorizontal: 10,
    borderWidth: 1, borderColor: '#0d1a20', borderRadius: 4,
    backgroundColor: '#0a0f18',
  },
  chipActive: { borderColor: '#4db8ff', backgroundColor: 'rgba(77,184,255,0.08)' },
  chipText: { fontFamily: FONT, fontSize: 10, color: '#2a3a4a' },
  chipTextActive: { color: '#4db8ff' },
  saveBtn: {
    marginTop: 20,
    borderWidth: 1, borderColor: '#4db8ff', borderRadius: 6,
    paddingVertical: 14, alignItems: 'center',
    backgroundColor: 'rgba(77,184,255,0.06)',
  },
  saveBtnText: { fontFamily: FONT, fontSize: 13, color: '#4db8ff', letterSpacing: 1 },
});
