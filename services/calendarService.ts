/**
 * calendarService.ts — PrivateAI Calendar Connector
 *
 * Reads the device calendar via expo-calendar. On-device only —
 * event data is never sent anywhere except into the local system
 * prompt for that conversation turn.
 */

import * as Calendar from 'expo-calendar';

// ─── Types ────────────────────────────────────────────────────

export interface CalendarEvent {
  id: string;
  title: string;
  startDate: Date;
  endDate: Date;
  location?: string;
  notes?: string;
  allDay: boolean;
  calendarTitle?: string;
}

// ─── Permissions ──────────────────────────────────────────────

export async function requestCalendarPermissions(): Promise<boolean> {
  try {
    const { status } = await Calendar.requestCalendarPermissionsAsync();
    return status === 'granted';
  } catch (e) {
    console.warn('[Calendar] requestPermissions failed:', e);
    return false;
  }
}

export async function hasCalendarPermission(): Promise<boolean> {
  try {
    const { status } = await Calendar.getCalendarPermissionsAsync();
    return status === 'granted';
  } catch (e) {
    console.warn('[Calendar] hasPermission check failed:', e);
    return false;
  }
}

// ─── Date helpers ─────────────────────────────────────────────

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

// ─── Fetch ────────────────────────────────────────────────────

export async function fetchEventsInRange(start: Date, end: Date): Promise<CalendarEvent[]> {
  try {
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    if (calendars.length === 0) return [];

    const calendarIds = calendars.map(c => c.id);
    const titleMap: Record<string, string> = Object.fromEntries(
      calendars.map(c => [c.id, c.title])
    );

    const raw = await Calendar.getEventsAsync(calendarIds, start, end);

    return raw
      .filter(e => e.title?.trim())
      .map(e => ({
        id: e.id,
        title: e.title,
        startDate: new Date(e.startDate),
        endDate: new Date(e.endDate),
        location: e.location || undefined,
        notes: e.notes || undefined,
        allDay: e.allDay ?? false,
        calendarTitle: titleMap[e.calendarId ?? ''] ?? undefined,
      }))
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  } catch (e) {
    console.warn('[Calendar] fetchEventsInRange failed:', e);
    return [];
  }
}

export async function fetchTodayEvents(): Promise<CalendarEvent[]> {
  const today = new Date();
  return fetchEventsInRange(startOfDay(today), endOfDay(today));
}

export async function fetchTomorrowEvents(): Promise<CalendarEvent[]> {
  const tomorrow = addDays(new Date(), 1);
  return fetchEventsInRange(startOfDay(tomorrow), endOfDay(tomorrow));
}

export async function fetchWeekEvents(): Promise<CalendarEvent[]> {
  const today = new Date();
  return fetchEventsInRange(startOfDay(today), endOfDay(addDays(today, 6)));
}

// ─── Create ───────────────────────────────────────────────────

export async function createEvent(
  title: string,
  startDate: Date,
  endDate: Date,
  notes?: string,
  location?: string,
): Promise<string | null> {
  try {
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const writable = calendars.find(c => c.allowsModifications && c.isPrimary)
                  ?? calendars.find(c => c.allowsModifications)
                  ?? null;
    if (!writable) return null;

    const id = await Calendar.createEventAsync(writable.id, {
      title,
      startDate,
      endDate,
      notes,
      location,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    return id;
  } catch (e) {
    console.warn('[Calendar] createEvent failed:', e);
    return null;
  }
}

// ─── Format for prompt ────────────────────────────────────────

function fmtTime(d: Date, allDay: boolean): string {
  if (allDay) return 'all day';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function fmtDate(d: Date): string {
  const today = new Date();
  const tomorrow = addDays(today, 1);
  if (d.toDateString() === today.toDateString())    return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatEventsForPrompt(events: CalendarEvent[], label: string): string {
  if (events.length === 0) {
    return `Atom's calendar (${label}): no events scheduled.`;
  }
  const lines = events.map(e => {
    const date  = fmtDate(e.startDate);
    const start = fmtTime(e.startDate, e.allDay);
    const end   = e.allDay ? '' : ` – ${fmtTime(e.endDate, false)}`;
    const loc   = e.location ? ` @ ${e.location}` : '';
    return `  • ${date} ${start}${end}: ${e.title}${loc}`;
  });
  return `Atom's calendar (${label}):\n${lines.join('\n')}`;
}
