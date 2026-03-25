/**
 * knowledgeBase.ts — PrivateAI Per-Persona Knowledge Base
 *
 * Lets Atom feed books, documents, and text to each persona.
 * Stored in encrypted storage per persona. Injected into system
 * prompts so each persona "knows" what Atom has taught it.
 *
 * Storage key: knowledge_v1_{personaId}
 * Cap: 10 entries per persona, 50,000 characters per entry
 */

import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { extractPdfText } from './pdfExtractor';
import secureStorage from './secureStorage';
import { canAccessVault } from './dataVault';
import { ALLOWED_MIME_TYPES } from './filesService';

// ─── Types ────────────────────────────────────────────────────

export interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
  source: 'file' | 'paste';
  dateAdded: string;
  personaId: string;
}

/** Unified file metadata — used by Control Room and file indexing. */
export interface FileMetadata {
  id: string;
  name: string;
  size: number;
  mimeType?: string;
  uri: string;
  content: string;
  dateAdded: string;
}

// ─── Constants ────────────────────────────────────────────────

const KNOWLEDGE_KEY = (personaId: string) => `knowledge_v1_${personaId}`;
export const MAX_KB_ENTRIES = 10;
export const MAX_KB_CONTENT = 50_000;
const PROMPT_CHARS_PER_ENTRY = 2_000; // chars injected per entry into system prompt

/** Allowed file extensions for KB ingestion. */
const KB_ALLOWED_EXTENSIONS = new Set([
  '.txt', '.md', '.ts', '.tsx', '.js', '.jsx',
  '.py', '.swift', '.json', '.csv', '.yml', '.yaml',
  '.xml', '.html', '.css', '.java', '.go', '.rs',
  '.kt', '.rb', '.sh', '.toml', '.markdown', '.pdf',
]);

// ─── Storage ──────────────────────────────────────────────────

async function readAll(personaId: string): Promise<KnowledgeEntry[]> {
  try {
    const raw = await secureStorage.getItem(KNOWLEDGE_KEY(personaId));
    return raw ? (JSON.parse(raw) as KnowledgeEntry[]) : [];
  } catch (e) { console.warn('[KB] readAll failed:', e); return []; }
}

async function writeAll(personaId: string, entries: KnowledgeEntry[]): Promise<void> {
  try {
    await secureStorage.setItem(KNOWLEDGE_KEY(personaId), JSON.stringify(entries));
  } catch (e) { console.warn('[KB] writeAll failed:', e); }
}

// ─── CRUD ─────────────────────────────────────────────────────

export async function listEntries(personaId: string): Promise<KnowledgeEntry[]> {
  if (!canAccessVault()) return [];
  return readAll(personaId);
}

export async function addEntry(
  personaId: string,
  title: string,
  content: string,
  source: 'file' | 'paste',
): Promise<{ entry: KnowledgeEntry | null; error?: string }> {
  const entries = await readAll(personaId);
  if (entries.length >= MAX_KB_ENTRIES) {
    return { entry: null, error: `Knowledge base is full (max ${MAX_KB_ENTRIES} entries). Delete one first.` };
  }
  if (!content.trim()) {
    return { entry: null, error: 'Content is empty.' };
  }
  const trimmed = content.length > MAX_KB_CONTENT
    ? content.slice(0, MAX_KB_CONTENT) + '\n[... truncated at 50KB]'
    : content;

  const entry: KnowledgeEntry = {
    id: Date.now().toString(),
    title: title.trim() || 'Untitled',
    content: trimmed,
    source,
    dateAdded: new Date().toISOString(),
    personaId,
  };
  await writeAll(personaId, [entry, ...entries]);
  return { entry };
}

export async function deleteEntry(personaId: string, id: string): Promise<boolean> {
  const entries = await readAll(personaId);
  const filtered = entries.filter(e => e.id !== id);
  if (filtered.length === entries.length) return false;
  await writeAll(personaId, filtered);
  return true;
}

// ─── File ingestion ───────────────────────────────────────────

let _kbPickerActive = false;

export async function pickAndAddEntry(
  personaId: string,
): Promise<{ entry: KnowledgeEntry | null; error?: string }> {
  if (_kbPickerActive) {
    console.warn('[KB] pickAndAddEntry called while picker already active — ignoring');
    return { entry: null };
  }
  _kbPickerActive = true;
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: [...ALLOWED_MIME_TYPES],
      copyToCacheDirectory: true,
      multiple: true,
    });

    console.log('[KB] picker result: assets:', result.assets?.length ?? 0);

    if (result.canceled || !result.assets?.length) {
      console.log('[KB] picker cancelled or no assets');
      return { entry: null };
    }

    // Process all selected files, return first successful entry
    let firstEntry: KnowledgeEntry | null = null;
    let lastError = '';

    for (const asset of result.assets) {
      const title = asset.name ?? 'Untitled';
      const uri = asset.uri;

      console.log('[KB] processing:', title, 'uri:', uri, 'size:', asset.size, 'mime:', asset.mimeType);

      if (!uri) {
        lastError = 'No file URI returned from picker.';
        continue;
      }

      const isPdf = asset.mimeType === 'application/pdf' || title.toLowerCase().endsWith('.pdf');

      // Extension validation (defense-in-depth)
      const dotIdx = title.lastIndexOf('.');
      const ext = dotIdx >= 0 ? title.slice(dotIdx).toLowerCase() : '';
      if (ext && !KB_ALLOWED_EXTENSIONS.has(ext)) {
        console.log('[KB] Unsupported extension:', ext, title);
        lastError = `Unsupported file type: ${title}`;
        continue;
      }

      // Read content — PDF extraction or plain text
      let content = '';
      if (isPdf) {
        try {
          console.log('[KB] Extracting PDF text:', title);
          const file = new File(uri);
          const rawBytes = await file.bytes();
          const result = await extractPdfText(new Uint8Array(rawBytes));
          content = result.text.length > MAX_KB_CONTENT
            ? result.text.slice(0, MAX_KB_CONTENT) + `\n[... PDF truncated, ${result.numPages} pages ...]`
            : result.text;
          console.log(`[KB] PDF extracted: ${result.numPages} pages, ${content.length} chars`);
        } catch (e: any) {
          console.error('[KB] PDF extraction failed:', e?.message ?? e);
          lastError = `Could not read PDF: ${title}`;
          continue;
        }
      } else {
        try {
          const file = new File(uri);
          content = await file.text();
          console.log('[KB] read', content.length, 'chars from', title);
        } catch (e: any) {
          console.error('[KB] File read FAILED:', e?.message ?? e);
          try {
            const res = await fetch(uri);
            if (res.ok) content = await res.text();
          } catch (e) {
            console.warn('[KB] fallback fetch failed:', e);
            lastError = `Could not read: ${title}`;
            continue;
          }
        }
      }

      if (!content.trim()) {
        lastError = `${title} appears empty or binary.`;
        continue;
      }

      const { entry, error } = await addEntry(personaId, title, content, 'file');
      if (entry) {
        if (!firstEntry) firstEntry = entry;
        console.log('[KB] Added:', title);
      } else if (error) {
        lastError = error;
      }
    }

    if (firstEntry) {
      return { entry: firstEntry };
    }
    return { entry: null, error: lastError || undefined };
  } catch (e) {
    console.error('[KB] pickAndAddEntry error:', e);
    return { entry: null, error: `File picker failed: ${e instanceof Error ? e.message : String(e)}` };
  } finally {
    _kbPickerActive = false;
  }
}

// ─── Format for prompt ────────────────────────────────────────

export function relKbDate(iso: string): string {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
}

export function fmtKbSize(content: string): string {
  const kb = Math.round(content.length / 1024);
  return kb < 1 ? `${content.length}B` : `${kb}KB`;
}

export async function buildKnowledgePrompt(personaId: string): Promise<string> {
  if (!canAccessVault()) return '';
  const entries = await readAll(personaId);
  if (entries.length === 0) return '';
  const sections = entries.map(e => {
    const preview = e.content.slice(0, PROMPT_CHARS_PER_ENTRY);
    const suffix = e.content.length > PROMPT_CHARS_PER_ENTRY ? '\n[... more content]' : '';
    return `[${e.title}]:\n${preview}${suffix}`;
  });
  return `\n\nKnowledge Atom has given me:\n\n${sections.join('\n\n---\n\n')}`;
}

// ─── File management (cross-persona) ─────────────────────────

const FILES_KB_KEY = 'kb_files_v1';

async function readFiles(): Promise<FileMetadata[]> {
  try {
    const raw = await secureStorage.getItem(FILES_KB_KEY);
    return raw ? (JSON.parse(raw) as FileMetadata[]) : [];
  } catch (e) { console.warn('[KB] readFiles failed:', e); return []; }
}

async function writeFiles(files: FileMetadata[]): Promise<void> {
  try {
    await secureStorage.setItem(FILES_KB_KEY, JSON.stringify(files));
  } catch (e) { console.warn('[KB] writeFiles failed:', e); }
}

/**
 * Store a file in the KB file store.
 * Validates content is non-empty.
 */
export async function storeFile(file: Omit<FileMetadata, 'id'>): Promise<FileMetadata> {
  if (!file.content?.trim()) {
    throw new Error('File is empty.');
  }

  const stored: FileMetadata = {
    ...file,
    id: `file_${Date.now()}`,
  };

  const existing = await readFiles();
  await writeFiles([stored, ...existing]);
  console.log('[KB] Stored file:', stored.name);
  return stored;
}

/**
 * Remove a file by name from the KB file store.
 */
export async function removeFile(fileName: string): Promise<boolean> {
  const files = await readFiles();
  const filtered = files.filter(f => f.name !== fileName);
  if (filtered.length === files.length) return false;
  await writeFiles(filtered);
  console.log('[KB] Removed file:', fileName);
  return true;
}

const KB_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.heic', '.heif', '.tiff', '.ico']);
let _kbPurged = false;

async function purgeKbImageFiles(): Promise<void> {
  if (_kbPurged) return;
  _kbPurged = true;
  try {
    const files = await readFiles();
    const clean = files.filter(f => {
      const ext = f.name.lastIndexOf('.') >= 0 ? f.name.slice(f.name.lastIndexOf('.')).toLowerCase() : '';
      const mime = (f.mimeType ?? '').toLowerCase();
      return !mime.startsWith('image/') && !KB_IMAGE_EXTS.has(ext);
    });
    if (clean.length < files.length) {
      const removed = files.length - clean.length;
      await writeFiles(clean);
      console.log(`[KB] Purged ${files.length - clean.length} image file(s) from KB store`);
    }
  } catch (e) { console.warn('[KB] purgeKbImageFiles failed:', e); }
}

/**
 * Get all files in the KB file store.
 */
export async function getFiles(): Promise<FileMetadata[]> {
  await purgeKbImageFiles();
  return readFiles();
}

/**
 * Get content of a file by name. Returns null if not found.
 */
export async function getFileContent(fileName: string): Promise<string | null> {
  const files = await readFiles();
  const file = files.find(f => f.name === fileName);
  return file?.content ?? null;
}
