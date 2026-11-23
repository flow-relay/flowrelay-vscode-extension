/**
 * @license
 * Flow Relay Ask stream client
 * Copyright (c) 2026 Adriano Sorbello (atrisorb) <https://github.com/atrisorb>
 * Licensed under GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)
 */

export type AskTier = 'quick' | 'standard' | 'deep';
export type AskTierChoice = 'auto' | AskTier;

export interface AskCitationRef {
  ref: string;
  eventId: string | null;
  source?: string;
  title?: string;
  url?: string | null;
  createdAt?: string;
}

export type AskEvent =
  | { type: 'turn.start'; threadId: string; userMessageId: string; messageId: string; tier: AskTier; routedBy: string; credits: number }
  | { type: 'status'; phase: string; label: string }
  | { type: 'tool.start'; callId: string; name: string; label: string; argsPreview: string; server?: string }
  | { type: 'tool.end'; callId: string; status: 'ok' | 'error' | 'denied'; summary: string; latencyMs: number }
  | { type: 'text.delta'; text: string }
  | { type: 'citation'; ref: string; eventId: string | null; source?: string; title?: string; url?: string | null; createdAt?: string }
  | { type: 'connect.required'; serverId: string; name: string; reason: 'connect' | 'reauth' | 'eu_attestation' }
  | { type: 'approval.required'; callId: string; server: string; tool: string; args: Record<string, unknown> }
  | { type: 'turn.end'; status: 'completed' | 'failed' | 'cancelled'; messageId: string; content: string; citations: AskCitationRef[]; charged: number }
  | { type: 'error'; errorCode: string; error: string; retryable: boolean };

export interface SseFrame {
  id: string | null;
  event: string;
  data: string;
}

export class SseParser {
  private buffer = '';

  push(chunk: string): SseFrame[] {
    this.buffer += chunk;
    const frames: SseFrame[] = [];
    for (;;) {
      const match = /\r\n\r\n|\n\n|\r\r/.exec(this.buffer);
      if (!match) break;
      const raw = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      const frame = parseFrame(raw);
      if (frame) frames.push(frame);
    }
    return frames;
  }

  flush(): SseFrame[] {
    const raw = this.buffer;
    this.buffer = '';
    const frame = raw.trim() ? parseFrame(raw) : null;
    return frame ? [frame] : [];
  }
}

function parseFrame(raw: string): SseFrame | null {
  let id: string | null = null;
  let event = 'message';
  const data: string[] = [];
  for (const line of raw.split(/\r\n|\n|\r/)) {
    if (line === '' || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'id') id = value;
    else if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  if (data.length === 0) return null;
  return { id, event, data: data.join('\n') };
}

const EVENT_TYPES = new Set([
  'turn.start',
  'status',
  'tool.start',
  'tool.end',
  'text.delta',
  'citation',
  'connect.required',
  'approval.required',
  'turn.end',
  'error',
]);

export function parseAskEvent(frame: SseFrame): AskEvent | null {
  try {
    const value = JSON.parse(frame.data) as unknown;
    if (typeof value !== 'object' || value === null) return null;
    const type = (value as { type?: unknown }).type;
    if (typeof type !== 'string' || !EVENT_TYPES.has(type)) return null;
    return value as AskEvent;
  } catch {
    return null;
  }
}
