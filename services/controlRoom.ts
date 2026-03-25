/**
 * controlRoom.ts — PrivateAI Control Room Event Bus
 *
 * PrivateAI architecture: lightweight Set-based pub/sub.
 * Zero dependencies. Zero React. Usable from any service or component.
 *
 * Events:
 *   persona_start    — a persona began an API call
 *   persona_complete — a persona received its response
 *   step_added       — a kernel routing step was appended to the timeline
 *   search_start     — Tavily search initiated
 *   search_complete  — Tavily search finished (success or failure)
 *
 * State persistence:
 *   Events are stored in a 100-event ring buffer so the Control Room
 *   screen can hydrate when it mounts, even if it wasn't mounted when
 *   the events fired. getCurrentStatuses() returns live persona states.
 */

// ── Types ─────────────────────────────────────────────────────

export type ControlRoomEventName =
  | 'persona_start'
  | 'persona_complete'
  | 'step_added'
  | 'search_start'
  | 'search_complete';

export type PersonaStatus = 'idle' | 'thinking' | 'complete';

export interface ControlRoomEvent {
  name:       ControlRoomEventName;
  personaId?: string;
  step?:      string;
  success?:   boolean;
  ts:         number;
}

export type ControlRoomListener = (event: ControlRoomEvent) => void;

// ── Module-level state (survives screen unmount/remount) ───────

const EVENT_BUFFER_MAX = 100;
const _eventBuffer: ControlRoomEvent[] = [];
const _personaStatuses: Record<string, PersonaStatus> = {};
let _searchActive = false;

// ── Event bus ─────────────────────────────────────────────────

export class ControlRoomEvents {
  private listeners: Set<ControlRoomListener> = new Set();

  on(listener: ControlRoomListener): void {
    this.listeners.add(listener);
    console.log('[ControlRoom] listener added, total:', this.listeners.size);
  }

  off(listener: ControlRoomListener): void {
    this.listeners.delete(listener);
  }

  emit(name: ControlRoomEventName, payload: Omit<ControlRoomEvent, 'name' | 'ts'> = {}): void {
    const event: ControlRoomEvent = { name, ts: Date.now(), ...payload };
    console.log('[ControlRoom] emit:', name, payload);

    // Update module-level state
    if (name === 'persona_start' && payload.personaId) {
      _personaStatuses[payload.personaId] = 'thinking';
    }
    if (name === 'persona_complete' && payload.personaId) {
      _personaStatuses[payload.personaId] = 'complete';
      // Auto-reset to idle after 3 s
      setTimeout(() => {
        if (_personaStatuses[payload.personaId!] === 'complete') {
          _personaStatuses[payload.personaId!] = 'idle';
        }
      }, 3000);
    }
    if (name === 'search_start') _searchActive = true;
    if (name === 'search_complete') _searchActive = false;

    // Buffer event for late-mounting subscribers
    _eventBuffer.push(event);
    if (_eventBuffer.length > EVENT_BUFFER_MAX) _eventBuffer.shift();

    // Notify live listeners
    this.listeners.forEach(l => {
      try { l(event); } catch { /* never let a listener crash the bus */ }
    });
  }

  /** Snapshot of the current persona statuses (for hydration on mount). */
  getCurrentStatuses(): Record<string, PersonaStatus> {
    return { ..._personaStatuses };
  }

  /** Recent events for timeline hydration on mount. */
  getRecentEvents(limit = 50): ControlRoomEvent[] {
    return _eventBuffer.slice(-limit);
  }

  /** Is a web search currently active? */
  isSearchActive(): boolean {
    return _searchActive;
  }
}

// ── Singleton ─────────────────────────────────────────────────

export const controlRoomEvents = new ControlRoomEvents();
