/**
 * @license
 * Flow Relay Ask panel
 * Copyright (c) 2026 Adriano Sorbello (atrisorb) <https://github.com/atrisorb>
 * Licensed under GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { RefIndex, collectSources, escapeHtml, renderMarkdown, safeHttpUrl, type SourceView } from './ask-markdown';
import { TurnPresenter } from './ask-presenter';
import type { AskStore, StoredThread } from './ask-store';
import type { AskTierChoice } from './ask-stream';
import { runAskTurn, type AskStreamApi } from './ask-turn';

export interface PanelProject {
  id: string;
  name: string;
  webUrl: string;
}

export interface AskPanelDeps {
  extensionUri: vscode.Uri;
  store: AskStore;
  getApi(): AskStreamApi | null;
  getProject(): Promise<PanelProject | null>;
}

interface RenderedTurn {
  question: string;
  html: string;
  sources: SourceView[];
  tier: string | null;
}

type Incoming =
  | { type: 'ready' }
  | { type: 'send'; question: string; tier: AskTierChoice }
  | { type: 'cancel' }
  | { type: 'newThread' }
  | { type: 'openThread'; id: string }
  | { type: 'deleteThread'; id: string }
  | { type: 'open'; url: string }
  | { type: 'openProject' }
  | { type: 'chooseProject' }
  | { type: 'setApiKey' };

const TIERS: AskTierChoice[] = ['auto', 'quick', 'standard', 'deep'];

function nonce(): string {
  return crypto.randomBytes(18).toString('base64').replace(/[^A-Za-z0-9]/g, 'a');
}

function renderStored(thread: StoredThread): RenderedTurn[] {
  return thread.turns.map((turn) => {
    const index = new RefIndex();
    index.scan(turn.answer);
    const sources = collectSources(index, turn.citations);
    return { question: turn.question, html: renderMarkdown(turn.answer, index), sources, tier: turn.tier };
  });
}

export class AskPanel {
  private static current: AskPanel | null = null;

  private activeThreadId: string | null = null;
  private activeProjectId: string | null = null;
  private lastTurn: (RenderedTurn & { error: string | null; stopped: boolean }) | null = null;
  private controller: AbortController | null = null;
  private project: PanelProject | null = null;

  static show(deps: AskPanelDeps): void {
    if (AskPanel.current) {
      AskPanel.current.panel.reveal(vscode.ViewColumn.Active);
      void AskPanel.current.sendState();
      return;
    }
    AskPanel.current = new AskPanel(deps);
  }

  static refresh(): void {
    void AskPanel.current?.sendState();
  }

  private readonly panel: vscode.WebviewPanel;

  private constructor(private readonly deps: AskPanelDeps) {
    const media = vscode.Uri.joinPath(deps.extensionUri, 'media');
    this.panel = vscode.window.createWebviewPanel('flowrelayAsk', 'Ask Flow Relay', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [media],
    });
    this.panel.iconPath = {
      light: vscode.Uri.joinPath(media, 'icon.svg'),
      dark: vscode.Uri.joinPath(media, 'icon-dark-theme.svg'),
    };
    const asset = (...p: string[]) => this.panel.webview.asWebviewUri(vscode.Uri.joinPath(media, ...p)).toString();
    const n = nonce();
    const csp = [
      `default-src 'none'`,
      `img-src ${this.panel.webview.cspSource}`,
      `style-src ${this.panel.webview.cspSource}`,
      `script-src 'nonce-${n}'`,
      `font-src ${this.panel.webview.cspSource}`,
    ].join('; ');
    this.panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Ask Flow Relay</title>
  <link rel="stylesheet" href="${escapeHtml(asset('ask-panel.css'))}" />
</head>
<body>
  <div id="app" class="app"></div>
  <script nonce="${n}" src="${escapeHtml(asset('ask-panel.js'))}" data-mark-light="${escapeHtml(asset('icon.svg'))}" data-mark-dark="${escapeHtml(asset('icon-dark-theme.svg'))}"></script>
</body>
</html>`;

    this.panel.webview.onDidReceiveMessage((message: Incoming) => void this.onMessage(message));
    this.panel.onDidDispose(() => {
      this.controller?.abort();
      AskPanel.current = null;
    });
  }

  private post(message: unknown): void {
    void this.panel.webview.postMessage(message);
  }

  private async sendState(): Promise<void> {
    this.project = await this.deps.getProject();
    const threads = this.project ? this.deps.store.list(this.project.id) : [];
    if (this.project?.id !== this.activeProjectId) {
      this.activeThreadId = null;
      this.lastTurn = null;
      this.activeProjectId = this.project?.id ?? null;
    }
    const active = this.activeThreadId ? threads.find((t) => t.id === this.activeThreadId) : undefined;
    this.post({
      type: 'state',
      hasKey: this.deps.getApi() !== null,
      project: this.project ? { name: this.project.name } : null,
      busy: this.controller !== null,
      activeThreadId: this.activeThreadId,
      threads: threads.map((t) => ({ id: t.id, title: t.title, updatedAt: t.updatedAt })),
      turns: active ? renderStored(active) : [],
      lastTurn: this.lastTurn,
    });
  }

  private async onMessage(message: Incoming): Promise<void> {
    switch (message.type) {
      case 'ready':
        await this.sendState();
        break;
      case 'send':
        await this.send(message.question, TIERS.includes(message.tier) ? message.tier : 'auto');
        break;
      case 'cancel':
        this.controller?.abort();
        break;
      case 'newThread':
        if (this.controller) break;
        this.activeThreadId = null;
        this.lastTurn = null;
        await this.sendState();
        break;
      case 'openThread':
        if (this.controller) break;
        this.activeThreadId = message.id;
        this.lastTurn = null;
        await this.sendState();
        break;
      case 'deleteThread':
        if (this.controller) break;
        await this.deps.store.remove(message.id);
        if (this.activeThreadId === message.id) {
          this.activeThreadId = null;
          this.lastTurn = null;
        }
        await this.sendState();
        break;
      case 'open': {
        const url = safeHttpUrl(message.url);
        if (url) void vscode.env.openExternal(vscode.Uri.parse(url));
        break;
      }
      case 'openProject':
        if (this.project) void vscode.env.openExternal(vscode.Uri.parse(this.project.webUrl));
        break;
      case 'chooseProject':
        await vscode.commands.executeCommand('flowrelay.selectProject');
        await this.sendState();
        break;
      case 'setApiKey':
        await vscode.commands.executeCommand('flowrelay.setApiKey');
        await this.sendState();
        break;
      default:
        break;
    }
  }

  private async send(rawQuestion: string, tier: AskTierChoice): Promise<void> {
    const question = typeof rawQuestion === 'string' ? rawQuestion.trim() : '';
    const api = this.deps.getApi();
    if (this.controller || !api || !this.project || question.length === 0) return;
    if (question.length > 4000) {
      this.post({ type: 'turnEnd', html: '', sources: [], status: 'failed', error: 'Questions are capped at 4000 characters.' });
      return;
    }
    const project = this.project;
    const controller = new AbortController();
    this.controller = controller;
    this.lastTurn = null;
    this.post({ type: 'turnStart', question });
    const presenter = new TurnPresenter((m) => this.post(m));
    const result = await runAskTurn(
      api,
      { projectId: project.id, question, tier, threadId: this.activeThreadId, signal: controller.signal },
      (event) => presenter.handle(event),
    );
    this.controller = null;
    const done = presenter.finish(result);
    if (result.threadId) this.activeThreadId = result.threadId;
    if (result.status !== 'completed' && (done.text || result.error)) {
      this.lastTurn = {
        question,
        html: done.html,
        sources: done.sources,
        tier: result.tier,
        error: result.error?.message ?? null,
        stopped: result.status === 'aborted' || result.status === 'cancelled',
      };
    }
    if (result.status === 'completed' && result.threadId && done.text) {
      await this.deps.store.record(project.id, result.threadId, {
        question,
        answer: done.text,
        citations: result.citations,
        tier: result.tier,
        at: new Date().toISOString(),
      });
    }
    await this.sendState();
  }
}
