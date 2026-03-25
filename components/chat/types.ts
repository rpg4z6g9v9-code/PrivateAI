/**
 * Shared types and constants for the chat UI components.
 * Extracted from app/(tabs)/index.tsx to avoid circular imports.
 */

import { Platform } from 'react-native';
import { CLOUD_PROMPTS } from '@/services/personaPrompts';

// ─── Constants ──────────────────────────────────────────────

export const FONT = Platform.OS === 'ios' ? 'Courier New' : 'monospace';

// ─── Types ──────────────────────────────────────────────────

export interface Message {
  id: string;
  role: string;
  content: string;
  personaId?: string;
  imageBase64?: string;
  webSearched?: boolean;
  routedVia?: 'local' | 'cloud' | 'quick_reply';
  model?: string;
  latency?: number;
}

export interface AttachmentImage {
  uri: string;
  base64: string;
  mimeType: 'image/jpeg';
}

export interface Persona {
  id: string;
  label: string;
  tag: string;
  color: string;
  systemPrompt: string;
}

export interface VoiceSettings {
  rate: number;
  pitch: number;
  isMuted: boolean;
  elStability: number;
  elSimilarity: number;
  elStyle: number;
}

export interface ConnectorSettings {
  calendar: boolean;
  notes: boolean;
  reminders: boolean;
  files: boolean;
}

export type AvatarMode = 'full' | 'mini' | 'hidden';
export type LocalModelStatus = 'idle' | 'downloading' | 'loading' | 'ready' | 'error';

export const DEFAULT_SETTINGS: VoiceSettings = {
  rate: 0.95, pitch: 1.0, isMuted: false,
  elStability: 0.4, elSimilarity: 0.78, elStyle: 0.15,
};

export const DEFAULT_CONNECTORS: ConnectorSettings = {
  calendar: false, notes: false, reminders: false, files: false,
};

export const PERSONAS: Persona[] = [
  {
    id: 'atlas', label: 'Atlas', tag: 'Atlas', color: '#4db8ff',
    systemPrompt: CLOUD_PROMPTS.atlas,
  },
  {
    id: 'vera', label: 'Vera', tag: 'Vera', color: '#ff6b6b',
    systemPrompt: CLOUD_PROMPTS.vera,
  },
  {
    id: 'cipher', label: 'Cipher', tag: 'Cipher', color: '#ff9500',
    systemPrompt: CLOUD_PROMPTS.cipher,
  },
  {
    id: 'lumen', label: 'Lumen', tag: 'Lumen', color: '#a855f7',
    systemPrompt: CLOUD_PROMPTS.lumen,
  },
  {
    id: 'pete', label: 'Atom', tag: 'Atom', color: '#00ff00',
    systemPrompt: CLOUD_PROMPTS.pete,
  },
];

export const PERSONA_DESCS: Record<string, string> = {
  atlas:      'strategy, goals & decision frameworks',
  vera:       'health tracking & medical patterns',
  cipher:     'security analysis & threat detection',
  lumen:      'deep research & knowledge synthesis',
  pete:       'personal AI assistant',
  architect:  'system design & architecture',
  critic:     'critical analysis & risk',
  researcher: 'deep research & synthesis',
  builder:    'implementation & code',
};

export const PERSONA_PLACEHOLDER: Record<string, string> = {
  atlas:      'Ask Atlas...',
  vera:       'Tell Vera...',
  cipher:     'Ask Cipher...',
  lumen:      'Ask Lumen...',
  pete:       'Message Atom...',
  architect:  'Ask Architect...',
  critic:     'Ask Critic...',
  researcher: 'Ask Researcher...',
  builder:    'Ask Builder...',
};

export const PERSONA_VOICES: Record<string, string> = {
  atlas:      'pNInz6obpgDQGcFmaJgB', // Adam    — deep, measured, strategic
  vera:       '21m00Tcm4TlvDq8ikWAM', // Rachel  — calm, warm, clinical
  cipher:     'yoZ06aMxZJJ28mfd3POQ', // Sam     — raspy, direct, alert
  lumen:      'ErXwobaYiN019PkySvjV', // Antoni  — measured, thoughtful, curious
  pete:       '21m00Tcm4TlvDq8ikWAM', // Rachel  — warm, friendly
  architect:  'pNInz6obpgDQGcFmaJgB', // Adam    — deep, analytical
  critic:     'yoZ06aMxZJJ28mfd3POQ', // Sam     — raspy, blunt
  researcher: 'ErXwobaYiN019PkySvjV', // Antoni  — measured, thoughtful
  builder:    'TxGEqnHWrfWFTfGW9XjX', // Josh    — direct, deep
};

// ─── Utility Functions ──────────────────────────────────────

/** Extract [Source: filename] citations from AI response text. */
export function extractSources(text: string): string[] {
  const matches = text.match(/\[Source:\s*([^\]]+)\]/g);
  if (!matches) return [];
  const sources = matches.map(m => m.replace(/\[Source:\s*/, '').replace(/\]$/, '').trim());
  return [...new Set(sources)];
}

/** Strip markdown formatting for display — preserves newlines */
export const stripMarkdown = (text: string): string =>
  text
    .replace(/```[\s\S]*?```/g, m => m.replace(/```\w*\n?/g, '').trim())
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/#{1,6}\s+(.+)/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^>\s*/gm, '')
    .replace(/^\s*---.*---\s*$/gm, '')
    .replace(/^\s*[-=_*]{3,}\s*$/gm, '')
    .replace(/^\s*\|.*\|\s*$/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** Strip emoji (preserve accented chars, punctuation) and collapse whitespace — for TTS */
export const stripEmoji = (text: string) =>
  text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu, '').replace(/\s+/g, ' ').trim();

/** For display: only removes non-ASCII (emoji/symbols), preserves \\n paragraph breaks */
export const stripEmojiDisplay = (text: string): string =>
  text.replace(/[^\x00-\x7F]/g, '');

/** Strip markdown for TTS: additionally collapses newlines to spaces */
export const stripMarkdownForTTS = (text: string): string =>
  stripMarkdown(text).replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();

/** Clean summary for display: strips markdown + emoji */
export const cleanSummary = (raw: string): string => stripEmojiDisplay(stripMarkdown(raw));
