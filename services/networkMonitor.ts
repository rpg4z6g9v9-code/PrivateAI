/**
 * networkMonitor.ts — PrivateAI Live Network Monitor
 *
 * Logs every outbound network call for security transparency.
 * Pete can see exactly what leaves his phone, when, and to where.
 *
 * Rules:
 *   - Medical data appearing in a cloud call = RED ALERT
 *   - Known safe destinations: claude_api, elevenlabs, tavily
 *   - Unknown destinations = flagged unexpected
 *   - Ring buffer: 100 calls, 100 classifications
 *   - Zero PII stored — descriptions are human-readable labels, never raw content
 */

// ── Types ─────────────────────────────────────────────────────

export type NetworkDest = 'claude_api' | 'elevenlabs' | 'tavily' | 'unknown';
export type NetworkSafety = 'safe' | 'unexpected';

export interface NetworkCallEntry {
  id:                  string;
  ts:                  number;
  destination:         NetworkDest;
  url:                 string;
  dataSizeBytes:       number;
  description:         string;   // human-readable, NEVER raw user content
  containsMedicalAlert: boolean; // true = medical data may have left device
  safety:              NetworkSafety;
}

export interface ClassificationEntry {
  id:             string;
  ts:             number;
  classification: 'medical' | 'general';
  route:          'local' | 'cloud';
  description:    string;
}

type CallListener  = (e: NetworkCallEntry) => void;
type ClassListener = (e: ClassificationEntry) => void;

// ── Module-level ring buffers ──────────────────────────────────

const MAX_ENTRIES = 100;
let _seq = 0;
const _uid = () => `nm_${Date.now()}_${++_seq}`;

const _calls:           NetworkCallEntry[]   = [];
const _classifications: ClassificationEntry[] = [];
const _callListeners  = new Set<CallListener>();
const _classListeners = new Set<ClassListener>();

// ── Destination labels ────────────────────────────────────────

export const DEST_LABEL: Record<NetworkDest, string> = {
  claude_api:  'Claude API',
  elevenlabs:  'ElevenLabs',
  tavily:      'Tavily Search',
  unknown:     'Unknown Host',
};

export const DEST_COLOR: Record<NetworkDest, string> = {
  claude_api:  '#00ff88',
  elevenlabs:  '#a855f7',
  tavily:      '#38bdf8',
  unknown:     '#ef4444',
};

// ── Public API ────────────────────────────────────────────────

export const networkMonitor = {

  /** Log an outbound network call. Call before fetch(). */
  logCall(entry: Omit<NetworkCallEntry, 'id' | 'ts'>): void {
    const full: NetworkCallEntry = { id: _uid(), ts: Date.now(), ...entry };
    _calls.push(full);
    if (_calls.length > MAX_ENTRIES) _calls.shift();
    _callListeners.forEach(l => { try { l(full); } catch (e) { console.warn('[Network] call listener failed:', e); } });
  },

  /** Log a data classification decision. Call after classifyData(). */
  logClassification(entry: Omit<ClassificationEntry, 'id' | 'ts'>): void {
    const full: ClassificationEntry = { id: _uid(), ts: Date.now(), ...entry };
    _classifications.push(full);
    if (_classifications.length > MAX_ENTRIES) _classifications.shift();
    _classListeners.forEach(l => { try { l(full); } catch (e) { console.warn('[Network] classification listener failed:', e); } });
  },

  /** Recent network calls, newest first. */
  getCalls(limit = 50): NetworkCallEntry[] {
    return _calls.slice(-limit).reverse();
  },

  /** Recent classification decisions, newest first. */
  getClassifications(limit = 50): ClassificationEntry[] {
    return _classifications.slice(-limit).reverse();
  },

  /** Subscribe to live network call events. Returns unsubscribe fn. */
  onCall(listener: CallListener): () => void {
    _callListeners.add(listener);
    return () => _callListeners.delete(listener);
  },

  /** Subscribe to live classification events. Returns unsubscribe fn. */
  onClassification(listener: ClassListener): () => void {
    _classListeners.add(listener);
    return () => _classListeners.delete(listener);
  },

  /** True if any logged call has a medical alert flag set. */
  hasMedicalAlert(): boolean {
    return _calls.some(c => c.containsMedicalAlert);
  },

  /** Clear all logs (e.g. on panic lock). */
  clear(): void {
    _calls.length = 0;
    _classifications.length = 0;
  },
};
