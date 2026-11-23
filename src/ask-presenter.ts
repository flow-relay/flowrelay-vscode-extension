/**
 * @license
 * Flow Relay Ask panel presenter
 * Copyright (c) 2026 Adriano Sorbello (atrisorb) <https://github.com/atrisorb>
 * Licensed under GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)
 */

import { RefIndex, collectSources, renderMarkdown, type SourceView } from './ask-markdown';
import type { AskEvent } from './ask-stream';
import type { AskTurnResult } from './ask-turn';

export type PanelMessage =
  | { type: 'status'; text: string }
  | { type: 'tier'; tier: string }
  | { type: 'tool'; id: string; label: string; state: 'running' | 'ok' | 'error' | 'denied'; summary: string }
  | { type: 'answer'; html: string }
  | { type: 'notice'; kind: 'connect' | 'approval'; title: string; text: string }
  | { type: 'turnEnd'; html: string; sources: SourceView[]; status: AskTurnResult['status']; error: string | null };

const THROTTLE_MS = 60;

const CONNECT_TEXT = {
  connect: (name: string) => `${name} is not connected yet. Connect it from the project page, then ask again.`,
  reauth: (name: string) => `${name} needs to be reconnected. Reconnect it from the project page, then ask again.`,
  eu_attestation: (name: string) =>
    `${name} needs an EU attestation before it can be used in this project. Confirm it from the project page, then ask again.`,
} as const;

export function argsPreview(args: Record<string, unknown>): string {
  const text = JSON.stringify(args);
  return text.length > 300 ? `${text.slice(0, 297)}...` : text;
}

export class TurnPresenter {
  readonly index = new RefIndex();
  private text = '';
  private lastRender = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly tools = new Map<string, string>();

  constructor(private readonly post: (message: PanelMessage) => void) {}

  handle(event: AskEvent): void {
    switch (event.type) {
      case 'turn.start':
        this.post({ type: 'tier', tier: event.tier });
        break;
      case 'status':
        this.post({ type: 'status', text: event.label });
        break;
      case 'tool.start':
        this.tools.set(event.callId, event.label);
        this.post({ type: 'status', text: event.label });
        this.post({ type: 'tool', id: event.callId, label: event.label, state: 'running', summary: '' });
        break;
      case 'tool.end':
        this.post({
          type: 'tool',
          id: event.callId,
          label: this.tools.get(event.callId) ?? 'Tool',
          state: event.status,
          summary: event.summary,
        });
        break;
      case 'text.delta':
        this.text += event.text;
        this.scheduleRender();
        break;
      case 'citation':
        this.index.set(event);
        break;
      case 'connect.required':
        this.post({
          type: 'notice',
          kind: 'connect',
          title: event.name,
          text: CONNECT_TEXT[event.reason](event.name),
        });
        break;
      case 'approval.required':
        this.post({
          type: 'notice',
          kind: 'approval',
          title: `Approval needed: ${event.tool}`,
          text: `Flow Relay wants to run ${event.tool} on ${event.server} with ${argsPreview(event.args)}. Approving a tool call needs the Flow Relay web or mobile app, because this editor connection cannot answer it. Approve it there, then ask again.`,
        });
        break;
      default:
        break;
    }
  }

  private scheduleRender(): void {
    const wait = THROTTLE_MS - (Date.now() - this.lastRender);
    if (wait <= 0) {
      this.renderNow();
    } else if (!this.timer) {
      this.timer = setTimeout(() => this.renderNow(), wait);
    }
  }

  private renderNow(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.lastRender = Date.now();
    this.index.scan(this.text);
    this.post({ type: 'answer', html: renderMarkdown(this.text, this.index) });
  }

  finish(result: AskTurnResult): { html: string; sources: SourceView[]; text: string } {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const text = result.content || this.text;
    this.index.scan(text);
    const sources = collectSources(this.index, result.citations);
    const html = renderMarkdown(text, this.index);
    this.post({
      type: 'turnEnd',
      html,
      sources,
      status: result.status,
      error: result.error?.message ?? null,
    });
    return { html, sources, text };
  }
}
