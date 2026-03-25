/**
 * fileIndexer.ts — PrivateAI File Indexer
 *
 * User selects a folder → app walks all text-readable files →
 * extracts concepts → indexes into the knowledge graph.
 *
 * Vault-gated: requires biometric unlock before reading any files.
 * All processing stays on-device.
 */

import { Directory, File } from 'expo-file-system';
import { extractPdfText } from './pdfExtractor';
import { canAccessVault, unlockVault } from './dataVault';
import { extractAndIndexConcepts } from './knowledgeGraph';

// ── Config ───────────────────────────────────────────────────────

/** Supported text extensions for single-file indexing. */
const SUPPORTED_TYPES = [
  '.txt', '.md', '.ts', '.tsx', '.js',
  '.py', '.swift', '.json', '.csv', '.yml', '.yaml',
  '.xml', '.html', '.css', '.java', '.go', '.rs',
] as const;

/** File extensions we can extract text from (superset for folder walks). */
const TEXT_EXTENSIONS = new Set<string>([
  ...SUPPORTED_TYPES,
  '.markdown', '.jsx',
  '.kt', '.rb',
  '.sh', '.zsh', '.bash',
  '.env', '.conf', '.ini', '.toml',
  '.pdf',
]);

/** Directories to skip when walking. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.expo', 'build', 'dist',
  'Pods', 'DerivedData', '__pycache__', '.next',
]);

/** Max file size to read (10 MB). */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// ── Types ────────────────────────────────────────────────────────

export interface IndexProgress {
  phase: 'scanning' | 'reading' | 'indexing' | 'done' | 'error';
  filesFound: number;
  filesProcessed: number;
  conceptsExtracted: number;
  currentFile?: string;
  error?: string;
}

export type ProgressCallback = (progress: IndexProgress) => void;

// ── Helpers ──────────────────────────────────────────────────────

function getExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

function getFileName(uri: string): string {
  const decoded = decodeURIComponent(uri);
  const slash = decoded.lastIndexOf('/');
  return slash >= 0 ? decoded.slice(slash + 1) : decoded;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')       // headings
    .replace(/\*\*([^*]+)\*\*/g, '$1')  // bold
    .replace(/\*([^*]+)\*/g, '$1')      // italic
    .replace(/`{1,3}[^`]*`{1,3}/g, '')  // inline/block code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
    .replace(/^[-*+]\s+/gm, '')         // list markers
    .replace(/^>\s+/gm, '');            // blockquotes
}

// ── Core: walk directory recursively ─────────────────────────────

function walkDirectory(dir: Directory): File[] {
  const files: File[] = [];

  try {
    const entries = dir.list();

    for (const entry of entries) {
      const name = getFileName(entry.uri);

      if (entry instanceof Directory) {
        if (SKIP_DIRS.has(name)) continue;
        files.push(...walkDirectory(entry));
      } else if (entry instanceof File) {
        const ext = getExtension(name);
        if (!TEXT_EXTENSIONS.has(ext)) continue;
        if (entry.size > MAX_FILE_SIZE) continue;
        files.push(entry);
      }
    }
  } catch (e) {
    console.warn('[FileIndexer] Error walking directory:', e);
  }

  return files;
}

// ── Core: read and extract text ──────────────────────────────────

async function readFileText(file: File): Promise<string> {
  try {
    const name = getFileName(file.uri);
    const ext = getExtension(name);

    // PDF: extract text via pure-JS extractor — skip gracefully on failure
    if (ext === '.pdf') {
      try {
        console.log('[FileIndexer] Reading PDF bytes for:', name);
        const bytes = await file.bytes();
        if (!bytes || bytes.byteLength === 0) {
          console.warn('[FileIndexer] PDF empty, skipping:', name);
          return '';
        }
        console.log('[FileIndexer] Got', bytes.byteLength, 'bytes, calling extractPdfText...');
        const result = await extractPdfText(new Uint8Array(bytes));
        if (!result?.text) {
          console.warn('[FileIndexer] PDF returned no text, skipping:', name);
          return '';
        }
        console.log('[FileIndexer] PDF extracted:', result.numPages, 'pages,', result.text.length, 'chars');
        return result.text;
      } catch (e: any) {
        console.warn('[FileIndexer] PDF skipped (parse failed):', name, e?.message ?? e);
        return '';
      }
    }

    let text = await file.text();

    // Strip markdown formatting for better concept extraction
    if (ext === '.md' || ext === '.markdown') {
      text = stripMarkdown(text);
    }

    return text;
  } catch (e) {
    console.warn('[FileIndexer] Failed to read file:', file.uri, e);
    return '';
  }
}

// ── Main: pick folder and index ──────────────────────────────────

/**
 * Opens the native folder picker, walks all readable files,
 * extracts concepts, and indexes them into the knowledge graph.
 *
 * @param onProgress Called with progress updates throughout the operation.
 * @returns Final progress object with totals.
 */
export async function pickAndIndexFolder(
  onProgress?: ProgressCallback,
): Promise<IndexProgress> {
  const progress: IndexProgress = {
    phase: 'scanning',
    filesFound: 0,
    filesProcessed: 0,
    conceptsExtracted: 0,
  };

  const report = () => onProgress?.(({ ...progress }));

  // ── Vault gate ─────────────────────────────────────────────────
  if (!canAccessVault()) {
    const unlocked = await unlockVault();
    if (!unlocked) {
      progress.phase = 'error';
      progress.error = 'Vault unlock required to index files.';
      report();
      return progress;
    }
  }

  // ── Pick folder ────────────────────────────────────────────────
  let dir: Directory;
  try {
    dir = await Directory.pickDirectoryAsync() as Directory;
  } catch (e) {
    console.warn('[FileIndexer] pickDirectory failed:', e);
    // User cancelled or picker failed
    progress.phase = 'error';
    progress.error = 'No folder selected.';
    report();
    return progress;
  }

  // ── Scan for files ─────────────────────────────────────────────
  report();
  const files = walkDirectory(dir);
  progress.filesFound = files.length;
  progress.phase = 'reading';
  report();

  if (files.length === 0) {
    progress.phase = 'done';
    report();
    return progress;
  }

  // ── Read + index each file ─────────────────────────────────────
  progress.phase = 'indexing';
  report();

  for (const file of files) {
    const name = getFileName(file.uri);
    progress.currentFile = name;
    report();

    const text = await readFileText(file);
    if (text.length > 0) {
      const count = await extractAndIndexConcepts(text, { source: name });
      progress.conceptsExtracted += count;
    }

    progress.filesProcessed++;
    report();
  }

  // ── Done ───────────────────────────────────────────────────────
  progress.phase = 'done';
  progress.currentFile = undefined;
  report();

  console.log(
    `[FileIndexer] Done: ${progress.filesProcessed} files, ${progress.conceptsExtracted} concepts`,
  );

  return progress;
}

// ── Single file indexing ───────────────────────────────────────

/**
 * Index a single file by URI into the knowledge graph.
 * Rejects PDFs and unsupported types with a thrown error.
 *
 * @param fileUri  Local file URI (from document picker cache)
 * @param fileName Original file name with extension
 * @returns Number of concepts extracted
 */
export async function indexFile(fileUri: string, fileName: string): Promise<number> {
  // Reject PDFs explicitly
  if (fileName.toLowerCase().endsWith('.pdf')) {
    console.log('[FileIndexer] Skipping PDF:', fileName);
    throw new Error('PDF not supported. Convert to .txt and try again.');
  }

  // Validate extension
  const ext = getExtension(fileName);
  if (!ext || !SUPPORTED_TYPES.includes(ext as typeof SUPPORTED_TYPES[number])) {
    console.warn('[FileIndexer] Unsupported file type:', ext || '(none)');
    throw new Error(`File type ${ext || '(unknown)'} not supported.`);
  }

  // Read content
  let content: string;
  try {
    const file = new File(fileUri);
    if (!file.exists) {
      throw new Error('File not found.');
    }
    content = await file.text();
  } catch (e: any) {
    // Fallback to fetch for cache URIs
    try {
      const res = await fetch(fileUri);
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      content = await res.text();
    } catch (e2) {
      console.warn('[FileIndexer] fallback fetch failed:', e2);
      throw new Error(`Could not read file: ${e?.message ?? 'unknown error'}`);
    }
  }

  if (!content || !content.trim()) {
    throw new Error('File is empty.');
  }

  // Strip markdown if applicable
  if (ext === '.md' || ext === '.markdown') {
    content = stripMarkdown(content);
  }

  // Index into knowledge graph
  const count = await extractAndIndexConcepts(content, { source: fileName });
  console.log('[FileIndexer] Indexed:', fileName, '→', count, 'concepts');
  return count;
}

/**
 * Safe wrapper around indexFile — returns boolean, never throws.
 * Use this from UI handlers where you don't want to catch.
 */
export async function safeIndexFile(fileUri: string, fileName: string): Promise<boolean> {
  if (!fileUri || !fileName) {
    console.error('[FileIndexer] safeIndexFile: missing file path or name');
    return false;
  }

  try {
    await indexFile(fileUri, fileName);
    return true;
  } catch (e) {
    console.error('[FileIndexer] safeIndexFile failed:', e);
    return false;
  }
}
