/**
 * filesService.ts — PrivateAI Files Connector
 *
 * Lets Atom pick files from his device, reads their text content,
 * and stores references + content in AsyncStorage for search.
 * Uses expo-document-picker for the picker and React Native's
 * fetch() for reading local file URIs. Fully on-device.
 *
 * Storage key: files_v1  (AsyncStorage)
 */

import secureStorage from './secureStorage';
const AsyncStorage = secureStorage;
import * as DocumentPicker from 'expo-document-picker';
import { File as ExpoFile } from 'expo-file-system';
import { extractPdfText } from './pdfExtractor';

// ─── Types ────────────────────────────────────────────────────

export interface StoredFile {
  id: string;
  name: string;
  uri: string;
  mimeType: string;
  size: number;
  content: string;    // text content; empty string for binary files
  addedAt: string;    // ISO date string
}

// ─── Constants ────────────────────────────────────────────────

const FILES_KEY       = 'files_v1';
const MAX_CONTENT_LEN = 40_000; // ~40KB of text per file in storage

/** Explicit MIME whitelist for the document picker. */
export const ALLOWED_MIME_TYPES = [
  'text/plain',
  'text/markdown',
  'text/x-typescript',
  'text/typescript',
  'text/javascript',
  'application/javascript',
  'text/x-python',
  'text/x-swift',
  'application/json',
  'text/csv',
  'application/x-yaml',
  'text/x-yaml',
  'text/yaml',
  'text/html',
  'text/css',
  'text/xml',
  'application/xml',
  'application/pdf',
] as const;

/** Allowed file extensions (validated after picker returns). */
const ALLOWED_EXTENSIONS = new Set([
  '.txt', '.md', '.ts', '.tsx', '.js', '.jsx',
  '.py', '.swift', '.json', '.csv', '.yml', '.yaml',
  '.xml', '.html', '.css', '.java', '.go', '.rs',
  '.kt', '.rb', '.sh', '.toml', '.conf', '.ini',
  '.env', '.markdown', '.pdf',
]);

// ─── Storage ──────────────────────────────────────────────────

async function readAll(): Promise<StoredFile[]> {
  try {
    const raw = await AsyncStorage.getItem(FILES_KEY);
    return raw ? (JSON.parse(raw) as StoredFile[]) : [];
  } catch (e) {
    console.warn('[Files] readAll failed:', e);
    return [];
  }
}

async function writeAll(files: StoredFile[]): Promise<void> {
  try {
    await AsyncStorage.setItem(FILES_KEY, JSON.stringify(files));
  } catch (e) { console.warn('[Files] writeAll failed:', e); }
}

// ─── Readable MIME types ──────────────────────────────────────

function isReadable(mimeType: string, name: string): boolean {
  if (mimeType.startsWith('text/')) return true;
  const readableMimes = [
    'application/json',
    'application/xml',
    'application/javascript',
    'application/typescript',
    'application/markdown',
  ];
  if (readableMimes.includes(mimeType)) return true;
  const readableExts = ['.txt', '.md', '.json', '.js', '.ts', '.py', '.swift',
                        '.kt', '.java', '.go', '.rs', '.sh', '.yaml', '.yml',
                        '.toml', '.csv', '.xml', '.html', '.css'];
  return readableExts.some(ext => name.toLowerCase().endsWith(ext));
}

// ─── Pick & Store ─────────────────────────────────────────────

// ─── PDF detection ───────────────────────────────────────────

function isPdf(mimeType: string, name: string): boolean {
  return mimeType === 'application/pdf' || name.toLowerCase().endsWith('.pdf');
}

// ─── Pick & Store (supports multiple) ────────────────────────

let _pickerActive = false;

export interface PickResult {
  stored: StoredFile[];
  skippedPdfs: string[];
  errors: string[];
}

/**
 * Open native file picker (multi-select), read text content, store.
 * PDFs are skipped gracefully with a message.
 */
export async function pickAndStoreFiles(): Promise<PickResult> {
  if (_pickerActive) {
    console.warn('[Files] pickAndStoreFiles called while picker already active — ignoring');
    return { stored: [], skippedPdfs: [], errors: [] };
  }
  _pickerActive = true;
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: [...ALLOWED_MIME_TYPES],
      copyToCacheDirectory: true,
      multiple: true,
    });

    if (result.canceled || !result.assets?.length) {
      return { stored: [], skippedPdfs: [], errors: [] };
    }

    const stored: StoredFile[] = [];
    const skippedPdfs: string[] = [];
    const errors: string[] = [];
    const existing = await readAll();

    for (const asset of result.assets) {
      const name     = asset.name     ?? 'Unnamed file';
      const mimeType = asset.mimeType ?? 'application/octet-stream';
      const size     = asset.size     ?? 0;
      const uri      = asset.uri      ?? '';

      // Block ALL image types (MIME or extension)
      const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.heic', '.heif', '.tiff', '.ico']);
      const extLower = name.lastIndexOf('.') >= 0
        ? name.slice(name.lastIndexOf('.')).toLowerCase()
        : '';
      if (mimeType.startsWith('image/') || IMAGE_EXTS.has(extLower)) {
        console.log(`[Files] REJECTED image: ${name} (${mimeType})`);
        errors.push(`Image not supported: ${name}`);
        continue;
      }

      // Extension validation (defense-in-depth after MIME filter)
      if (extLower && !ALLOWED_EXTENSIONS.has(extLower)) {
        console.log('[Files] Unsupported extension:', extLower, name);
        errors.push(`Unsupported file type: ${name}`);
        continue;
      }

      let content = '';

      // PDF extraction
      if (isPdf(mimeType, name)) {
        try {
          console.log('[Files] Extracting PDF text:', name);
          const pdfFile = new ExpoFile(uri);
          const rawBytes = await pdfFile.bytes();
          const result = await extractPdfText(new Uint8Array(rawBytes));
          content = result.text.length > MAX_CONTENT_LEN
            ? result.text.slice(0, MAX_CONTENT_LEN) + `\n[... PDF truncated at 40KB, ${result.numPages} pages ...]`
            : result.text;
          console.log(`[Files] PDF extracted: ${result.numPages} pages, ${content.length} chars`);
        } catch (e: any) {
          console.error('[Files] PDF extraction failed:', e?.message ?? e);
          errors.push(`Could not read PDF: ${name}`);
          continue;
        }
      } else if (uri && isReadable(mimeType, name)) {
        try {
          const res = await fetch(uri);
          if (res.ok) {
            const text = await res.text();
            content = text.length > MAX_CONTENT_LEN
              ? text.slice(0, MAX_CONTENT_LEN) + '\n[... content truncated at 40KB ...]'
              : text;
          }
        } catch (e) {
          console.warn('[Files] file read failed:', e);
          content = '[Could not read file content]';
          errors.push(`Could not read: ${name}`);
        }
      }

      // Final safety: reject binary content (null bytes = not text), skip for PDFs
      if (content && !isPdf(mimeType, name) && content.includes('\x00')) {
        console.log(`[Files] REJECTED binary content: ${name}`);
        errors.push(`Binary file rejected: ${name}`);
        continue;
      }

      const file: StoredFile = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name,
        uri,
        mimeType,
        size,
        content,
        addedAt: new Date().toISOString(),
      };

      stored.push(file);
    }

    if (stored.length > 0) {
      await writeAll([...stored, ...existing]);
    }

    console.log(`[Files] Stored ${stored.length}, skipped ${skippedPdfs.length} PDFs, ${errors.length} errors`);
    return { stored, skippedPdfs, errors };
  } catch (e) {
    console.error('[Files] pickAndStoreFiles error:', e);
    return { stored: [], skippedPdfs: [], errors: ['File picker failed unexpectedly.'] };
  } finally {
    _pickerActive = false;
  }
}

/** @deprecated Use pickAndStoreFiles() for multi-select support. */
export async function pickAndStoreFile(): Promise<StoredFile | null> {
  const result = await pickAndStoreFiles();
  return result.stored[0] ?? null;
}

// ─── Image purge (cleans up files indexed before validation existed) ──

const IMAGE_FILE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.heic', '.heif', '.tiff', '.ico']);

function isImageFile(name: string, mimeType: string): boolean {
  const ext = name.lastIndexOf('.') >= 0 ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
  return mimeType.startsWith('image/') || IMAGE_FILE_EXTS.has(ext);
}

let _purged = false;

async function purgeImageFiles(): Promise<void> {
  if (_purged) return;
  _purged = true;
  try {
    const files = await readAll();
    const clean = files.filter(f => !isImageFile(f.name, f.mimeType));
    if (clean.length < files.length) {
      const removed = files.length - clean.length;
      await writeAll(clean);
      console.log(`[Files] Purged ${removed} image file(s) from storage`);
    }
  } catch (e) { console.warn('[Files] purgeImageFiles failed:', e); }
}

// ─── CRUD ─────────────────────────────────────────────────────

export async function listFiles(): Promise<StoredFile[]> {
  await purgeImageFiles();
  return readAll();
}

export async function getFileById(id: string): Promise<StoredFile | null> {
  const files = await readAll();
  return files.find(f => f.id === id) ?? null;
}

export async function searchFiles(keyword: string): Promise<StoredFile[]> {
  if (!keyword.trim()) return listFiles();
  const files = await readAll();
  const lower = keyword.toLowerCase();
  return files.filter(f =>
    f.name.toLowerCase().includes(lower) ||
    f.content.toLowerCase().includes(lower)
  );
}

export async function deleteFile(id: string): Promise<boolean> {
  const files = await readAll();
  const filtered = files.filter(f => f.id !== id);
  if (filtered.length === files.length) return false;
  await writeAll(filtered);
  return true;
}

// ─── Format for prompt ────────────────────────────────────────

function relDate(iso: string): string {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 7)  return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
}

function fmtSize(bytes: number): string {
  if (bytes === 0)     return '';
  if (bytes < 1024)    return ` ${bytes}B`;
  if (bytes < 1048576) return ` ${Math.round(bytes / 1024)}KB`;
  return ` ${(bytes / 1048576).toFixed(1)}MB`;
}

export function formatFilesForPrompt(files: StoredFile[]): string {
  if (files.length === 0) return "Atom has no stored files.";
  const lines = files.map(f => `  • "${f.name}"${fmtSize(f.size)} — added ${relDate(f.addedAt)}`);
  return `Atom's stored files (${files.length}):\n${lines.join('\n')}`;
}

export function formatFileContentForPrompt(file: StoredFile): string {
  if (!file.content) return `File: "${file.name}" — binary or unreadable format.`;
  return `File: "${file.name}" (added ${relDate(file.addedAt)})\n\n${file.content}`;
}
