/**
 * notesService.ts — PrivateAI Notes Connector
 *
 * Stores notes in AsyncStorage. Fully on-device — nothing is synced
 * or uploaded. Notes are stored as a JSON array under a single key.
 *
 * Storage key: notes_v1  (AsyncStorage)
 * Format:      Note[] sorted newest-first
 */

import secureStorage from './secureStorage';
const AsyncStorage = secureStorage;

// ─── Types ────────────────────────────────────────────────────

export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: string;  // ISO date string
  updatedAt: string;  // ISO date string
}

// ─── Storage ──────────────────────────────────────────────────

const NOTES_KEY = 'notes_v1';

async function readAll(): Promise<Note[]> {
  try {
    const raw = await AsyncStorage.getItem(NOTES_KEY);
    return raw ? (JSON.parse(raw) as Note[]) : [];
  } catch (e) {
    console.warn('[Notes] readAll failed:', e);
    return [];
  }
}

async function writeAll(notes: Note[]): Promise<void> {
  try {
    await AsyncStorage.setItem(NOTES_KEY, JSON.stringify(notes));
  } catch (e) { console.warn('[Notes] writeAll failed:', e); }
}

// ─── CRUD ─────────────────────────────────────────────────────

export async function saveNote(title: string, content: string): Promise<Note> {
  const notes = await readAll();
  const note: Note = {
    id: Date.now().toString(),
    title: title.trim() || 'Untitled',
    content: content.trim(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  // Newest first
  await writeAll([note, ...notes]);
  return note;
}

export async function updateNote(id: string, title: string, content: string): Promise<Note | null> {
  const notes = await readAll();
  const idx = notes.findIndex(n => n.id === id);
  if (idx < 0) return null;
  notes[idx] = { ...notes[idx], title: title.trim(), content: content.trim(), updatedAt: new Date().toISOString() };
  await writeAll(notes);
  return notes[idx];
}

export async function listNotes(limit?: number): Promise<Note[]> {
  const notes = await readAll();
  return limit !== undefined ? notes.slice(0, limit) : notes;
}

export async function getNoteById(id: string): Promise<Note | null> {
  const notes = await readAll();
  return notes.find(n => n.id === id) ?? null;
}

export async function searchNotes(keyword: string): Promise<Note[]> {
  if (!keyword.trim()) return listNotes(10);
  const notes = await readAll();
  const lower = keyword.toLowerCase();
  return notes.filter(n =>
    n.title.toLowerCase().includes(lower) ||
    n.content.toLowerCase().includes(lower)
  );
}

export async function deleteNote(id: string): Promise<boolean> {
  const notes = await readAll();
  const filtered = notes.filter(n => n.id !== id);
  if (filtered.length === notes.length) return false;
  await writeAll(filtered);
  return true;
}

export async function noteCount(): Promise<number> {
  return (await readAll()).length;
}

// ─── Format for prompt ────────────────────────────────────────

function relDate(iso: string): string {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 7)  return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
}

export function formatNotesForPrompt(notes: Note[], label = 'saved notes'): string {
  if (notes.length === 0) return `Atom has no ${label}.`;
  const lines = notes.map(n => `  • "${n.title}" (${relDate(n.updatedAt)})`);
  return `Atom's ${label} (${notes.length}):\n${lines.join('\n')}`;
}

export function formatNoteContentForPrompt(note: Note): string {
  return `Note: "${note.title}"\nSaved: ${relDate(note.createdAt)}\n\n${note.content}`;
}

// ─── Title extraction helper ──────────────────────────────────

export function extractTitle(content: string): string {
  const firstLine = content.split('\n').find(l => l.trim()) ?? '';
  return firstLine.trim().slice(0, 60) || 'Untitled';
}
