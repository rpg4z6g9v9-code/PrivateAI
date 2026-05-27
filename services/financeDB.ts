/**
 * financeDB.ts — SQLite-backed financial transaction persistence
 *
 * Schema-first. No AI categorization. No bank connections. No alerts.
 * Proves the data model works before adding any intelligence layer.
 *
 * Usage:
 *   await initFinanceDB()                           — call once on screen mount
 *   await addTransaction(tx)                        — insert a transaction
 *   const totals = await getMonthlyTotals(2026, 5)  — category totals for May 2026
 *   const txns   = await getTransactions({ year, month }) — full list, newest first
 */

import * as SQLite from 'expo-sqlite';

const DB_NAME = 'privateai_finance_v1.db';

let db: SQLite.SQLiteDatabase | null = null;

// ── Categories ────────────────────────────────────────────────

export const CATEGORIES = [
  'Income',
  'Housing',
  'Utilities',
  'Groceries',
  'Dining',
  'Transportation',
  'Gas',
  'Insurance',
  'Medical',
  'Debt',
  'Subscriptions',
  'Shopping',
  'Entertainment',
  'Savings',
  'Transfers',
  'Fees',
  'Other',
] as const;

export type Category = typeof CATEGORIES[number];

// ── Types ─────────────────────────────────────────────────────

export type TransactionType = 'income' | 'expense' | 'transfer';

export interface Transaction {
  id: string;
  createdAt: number;
  date: number;           // user-set date as timestamp (start of day)
  amount: number;         // always positive; direction implied by type
  type: TransactionType;
  category: Category;
  merchant: string | null;
  note: string | null;
  recurring: number;      // 0 = one-time, 1 = recurring
  paymentMethod: string | null;
}

export interface NewTransaction {
  date: number;
  amount: number;
  type: TransactionType;
  category: Category;
  merchant?: string | null;
  note?: string | null;
  recurring?: number;
  paymentMethod?: string | null;
}

export interface CategoryTotal {
  category: Category;
  type: TransactionType;
  total: number;
}

// ── Init ──────────────────────────────────────────────────────

export async function initFinanceDB(): Promise<void> {
  if (db) return;
  db = await SQLite.openDatabaseAsync(DB_NAME);
  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS transactions (
      id             TEXT    PRIMARY KEY,
      created_at     INTEGER NOT NULL,
      date           INTEGER NOT NULL,
      amount         REAL    NOT NULL,
      type           TEXT    NOT NULL CHECK(type IN ('income','expense','transfer')),
      category       TEXT    NOT NULL,
      merchant       TEXT,
      note           TEXT,
      recurring      INTEGER NOT NULL DEFAULT 0,
      payment_method TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_txn_date     ON transactions(date);
    CREATE INDEX IF NOT EXISTS idx_txn_category ON transactions(category);
  `);
}

// ── Write ─────────────────────────────────────────────────────

export async function addTransaction(tx: NewTransaction): Promise<string> {
  if (!db) throw new Error('[FinanceDB] addTransaction called before initFinanceDB');
  const id = `txn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  await db.runAsync(
    `INSERT INTO transactions
       (id, created_at, date, amount, type, category, merchant, note, recurring, payment_method)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      Date.now(),
      tx.date,
      tx.amount,
      tx.type,
      tx.category,
      tx.merchant ?? null,
      tx.note ?? null,
      tx.recurring ?? 0,
      tx.paymentMethod ?? null,
    ]
  );
  return id;
}

export async function deleteTransaction(id: string): Promise<void> {
  if (!db) return;
  await db.runAsync('DELETE FROM transactions WHERE id = ?', [id]);
}

// ── Read ──────────────────────────────────────────────────────

/**
 * Returns SUM(amount) grouped by category + type for a given calendar month.
 * year: 4-digit (e.g. 2026), month: 1–12
 */
export async function getMonthlyTotals(year: number, month: number): Promise<CategoryTotal[]> {
  if (!db) return [];
  const start = new Date(year, month - 1, 1).getTime();
  const end   = new Date(year, month,     1).getTime();
  const rows  = await db.getAllAsync<{ category: string; type: string; total: number }>(
    `SELECT category, type, SUM(amount) AS total
     FROM transactions
     WHERE date >= ? AND date < ?
     GROUP BY category, type
     ORDER BY total DESC`,
    [start, end]
  );
  return rows as CategoryTotal[];
}

/**
 * Returns individual transactions, newest first.
 * Optionally filtered to a specific calendar month.
 * Hard limit: 200 rows (more than enough for monthly view).
 */
export async function getTransactions(opts?: { year?: number; month?: number }): Promise<Transaction[]> {
  if (!db) return [];
  if (opts?.year && opts?.month) {
    const start = new Date(opts.year, opts.month - 1, 1).getTime();
    const end   = new Date(opts.year, opts.month,     1).getTime();
    return db.getAllAsync<Transaction>(
      `SELECT id, created_at AS createdAt, date, amount, type, category,
              merchant, note, recurring, payment_method AS paymentMethod
       FROM transactions
       WHERE date >= ? AND date < ?
       ORDER BY date DESC`,
      [start, end]
    );
  }
  return db.getAllAsync<Transaction>(
    `SELECT id, created_at AS createdAt, date, amount, type, category,
            merchant, note, recurring, payment_method AS paymentMethod
     FROM transactions
     ORDER BY date DESC
     LIMIT 200`
  );
}
