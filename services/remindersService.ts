/**
 * remindersService.ts — PrivateAI Reminders Connector
 *
 * iOS Reminders are accessed through the same EventKit framework as Calendar,
 * using expo-calendar with EntityTypes.REMINDER. Fully on-device.
 */

import * as Calendar from 'expo-calendar';

// ─── Types ────────────────────────────────────────────────────

export interface Reminder {
  id: string;
  title: string;
  dueDate?: Date;
  completed: boolean;
  calendarId: string;
  notes?: string;
}

// ─── Permissions ──────────────────────────────────────────────

export async function requestRemindersPermissions(): Promise<boolean> {
  try {
    const { status } = await Calendar.requestRemindersPermissionsAsync();
    return status === 'granted';
  } catch (e) {
    console.warn('[Reminders] requestPermissions failed:', e);
    return false;
  }
}

export async function hasRemindersPermission(): Promise<boolean> {
  try {
    const { status } = await Calendar.getRemindersPermissionsAsync();
    return status === 'granted';
  } catch (e) {
    console.warn('[Reminders] hasPermission check failed:', e);
    return false;
  }
}

// ─── Fetch ────────────────────────────────────────────────────

export async function fetchUpcomingReminders(): Promise<Reminder[]> {
  try {
    const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.REMINDER);
    if (cals.length === 0) return [];
    const calIds = cals.map(c => c.id);

    const raw = await Calendar.getRemindersAsync(
      calIds,
      Calendar.ReminderStatus.INCOMPLETE,
      null,
      null,
    );

    return (raw ?? [])
      .filter((r: any) => r.title?.trim())
      .map((r: any) => ({
        id: r.id,
        title: r.title,
        dueDate: r.dueDate ? new Date(r.dueDate) : undefined,
        completed: r.completed ?? false,
        calendarId: r.calendarId ?? '',
        notes: r.notes || undefined,
      }))
      .sort((a: Reminder, b: Reminder) => {
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate.getTime() - b.dueDate.getTime();
      });
  } catch (e) {
    console.warn('[Reminders] fetchUpcomingReminders failed:', e);
    return [];
  }
}

// ─── Create ───────────────────────────────────────────────────

export async function createReminder(
  title: string,
  dueDate?: Date,
  notes?: string,
): Promise<string | null> {
  try {
    const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.REMINDER);
    const target = cals.find(c => c.allowsModifications && c.isPrimary)
                ?? cals.find(c => c.allowsModifications)
                ?? null;
    if (!target) return null;

    const id = await Calendar.createReminderAsync(target.id, {
      title,
      dueDate: dueDate ?? undefined,
      completed: false,
      notes,
    } as any);
    return id;
  } catch (e) {
    console.warn('[Reminders] createReminder failed:', e);
    return null;
  }
}

// ─── Complete ─────────────────────────────────────────────────

export async function completeReminder(id: string): Promise<boolean> {
  try {
    await Calendar.updateReminderAsync(id, { completed: true } as any);
    return true;
  } catch (e) {
    console.warn('[Reminders] completeReminder failed:', e);
    return false;
  }
}

// ─── Natural language due-date parser ─────────────────────────
// Handles: "tomorrow", "today", "at 3pm", "on Friday", "next Monday"

export function parseDueDate(text: string): Date | undefined {
  const lower = text.toLowerCase();
  const now = new Date();

  if (/\btomorrow\b/.test(lower)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d;
  }
  if (/\btoday\b/.test(lower)) {
    const d = new Date(now);
    d.setHours(17, 0, 0, 0);
    return d;
  }

  // "at Xam/pm"
  const timeMatch = lower.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (timeMatch) {
    let h = parseInt(timeMatch[1], 10);
    const m = parseInt(timeMatch[2] ?? '0', 10);
    const meridiem = timeMatch[3];
    if (meridiem === 'pm' && h < 12) h += 12;
    if (meridiem === 'am' && h === 12) h = 0;
    const d = new Date(now);
    d.setHours(h, m, 0, 0);
    if (d <= now) d.setDate(d.getDate() + 1); // push to tomorrow if time already passed
    return d;
  }

  // "next Monday" / "on Friday"
  const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const dayMatch = lower.match(/(?:next|on)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/);
  if (dayMatch) {
    const targetDay = days.indexOf(dayMatch[1]);
    const d = new Date(now);
    const currentDay = d.getDay();
    let diff = targetDay - currentDay;
    if (diff <= 0) diff += 7;
    d.setDate(d.getDate() + diff);
    d.setHours(9, 0, 0, 0);
    return d;
  }

  return undefined;
}

// ─── Format for prompt ────────────────────────────────────────

function fmtDue(d: Date): string {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (d.toDateString() === today.toDateString())    return 'today';
  if (d.toDateString() === tomorrow.toDateString()) return 'tomorrow';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatRemindersForPrompt(reminders: Reminder[]): string {
  if (reminders.length === 0) return "Atom has no upcoming reminders.";
  const lines = reminders.map(r => {
    const due = r.dueDate ? ` — due ${fmtDue(r.dueDate)}` : '';
    return `  • ${r.title}${due}`;
  });
  return `Atom's reminders (${reminders.length} incomplete):\n${lines.join('\n')}`;
}
