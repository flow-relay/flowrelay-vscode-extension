/**
 * @license
 * Flow Relay chat participant request handler
 * Copyright (c) 2026 Adriano Sorbello (atrisorb) <https://github.com/atrisorb>
 * Licensed under GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)
 */

import { ChatTextFormatter, RefIndex, collectSources } from './ask-markdown';
import type { AskTierChoice } from './ask-stream';
import { runAskTurn, type AskStreamApi } from './ask-turn';
import type {
  CancellationTokenLike,
  ChatContextLike,
  ChatFollowupLike,
  ChatRequestLike,
  ChatResponseStreamLike,
  ChatResultLike,
} from './vscode-compat';

export const PARTICIPANT_ID = 'flowrelay.ask';

export interface ChatProject {
  id: string;
  name: string;
  webUrl: string;
}

export interface ChatDeps {
  getApi(): AskStreamApi | null;
  getProject(): Promise<ChatProject | null>;
  toUri(value: string): unknown;
}

const COMMAND_TIERS: Record<string, AskTierChoice> = {
  quick: 'quick',
  search: 'standard',
  deep: 'deep',
};

export function findThreadId(context: ChatContextLike, projectId: string): string | null {
  for (let i = context.history.length - 1; i >= 0; i -= 1) {
    const turn = context.history[i];
    const meta = turn.participant === PARTICIPANT_ID ? turn.result?.metadata : undefined;
    if (meta && meta.projectId === projectId && typeof meta.threadId === 'string') return meta.threadId;
  }
  return null;
}

export function provideFollowups(result: ChatResultLike): ChatFollowupLike[] {
  if (!result.metadata || typeof result.metadata.threadId !== 'string' || result.errorDetails) return [];
  return [
    { prompt: 'Go deeper on that answer', label: 'Go deeper', command: 'deep' },
    { prompt: 'Which work items are blocked, and why?', label: 'What is blocked?' },
    { prompt: 'What changed since the last handoff?', label: 'What changed?' },
  ];
}

const CONNECT_TEXT = {
  connect: (name: string) => `${name} is not connected yet. Connect it from the project page, then ask again.`,
  reauth: (name: string) => `${name} needs to be reconnected. Reconnect it from the project page, then ask again.`,
  eu_attestation: (name: string) =>
    `${name} needs an EU attestation before it can be used in this project. Confirm it from the project page, then ask again.`,
} as const;

export async function handleChatRequest(
  deps: ChatDeps,
  request: ChatRequestLike,
  context: ChatContextLike,
  stream: ChatResponseStreamLike,
  token: CancellationTokenLike,
): Promise<ChatResultLike> {
  const question = request.prompt.trim();
  const api = deps.getApi();
  if (!api) {
    stream.markdown('Set your Flow Relay API key to ask questions.');
    stream.button({ command: 'flowrelay.setApiKey', title: 'Set API key' });
    return {};
  }
  const project = await deps.getProject();
  if (!project) {
    stream.markdown('Choose a project first. Flow Relay answers from the project you pick.');
    stream.button({ command: 'flowrelay.selectProject', title: 'Choose project' });
    return {};
  }
  if (question.length === 0) {
    stream.markdown(`Ask a question about **${project.name}**. Use \`/quick\`, \`/search\` or \`/deep\` to pick how deep the answer goes.`);
    return {};
  }
  if (question.length > 4000) {
    return { errorDetails: { message: 'Questions are capped at 4000 characters.' } };
  }

  const controller = new AbortController();
  const subscription = token.onCancellationRequested(() => controller.abort());
  if (token.isCancellationRequested) controller.abort();

  const index = new RefIndex();
  const formatter = new ChatTextFormatter(index);
  let wrote = false;
  const write = (text: string) => {
    if (text.length === 0) return;
    wrote = true;
    stream.markdown(text);
  };

  try {
    const result = await runAskTurn(
      api,
      {
        projectId: project.id,
        question,
        tier: (request.command && COMMAND_TIERS[request.command]) || 'auto',
        threadId: findThreadId(context, project.id),
        signal: controller.signal,
      },
      (event) => {
        switch (event.type) {
          case 'status':
            stream.progress(event.label);
            break;
          case 'tool.start':
            stream.progress(event.label);
            break;
          case 'tool.end':
            if (event.status !== 'ok') stream.progress(event.summary);
            break;
          case 'text.delta':
            write(formatter.push(event.text));
            break;
          case 'citation':
            index.set(event);
            break;
          case 'connect.required':
            write(`\n\n> ${CONNECT_TEXT[event.reason](event.name)}\n\n`);
            stream.button({ command: 'vscode.open', title: 'Open project', arguments: [deps.toUri(project.webUrl)] });
            break;
          case 'approval.required':
            write(
              `\n\n> Flow Relay wants to run \`${event.tool}\` on ${event.server}. Approve it in the Flow Relay web or mobile app, then ask again.\n\n`,
            );
            stream.button({ command: 'vscode.open', title: 'Open project', arguments: [deps.toUri(project.webUrl)] });
            break;
          default:
            break;
        }
      },
    );
    write(formatter.flush());

    const metadata = result.threadId ? { threadId: result.threadId, projectId: project.id } : undefined;
    if (result.status === 'aborted' || result.status === 'cancelled') return { metadata };
    if (result.error && !wrote) return { metadata, errorDetails: { message: result.error.message } };

    if (!wrote && result.content) write(formatter.push(result.content) + formatter.flush());
    const sources = collectSources(index, result.citations);
    if (sources.length > 0) {
      const lines = sources.map((s) => {
        const label = s.title.replace(/[[\]]/g, '');
        return `${s.n}. ${s.url ? `[${label}](${s.url})` : label}${s.source ? ` – ${s.source}` : ''}`;
      });
      write(`\n\n**Sources**\n\n${lines.join('\n')}\n`);
      for (const s of sources) if (s.url) stream.reference(deps.toUri(s.url));
    }
    if (result.error) return { metadata, errorDetails: { message: result.error.message } };
    return { metadata };
  } finally {
    subscription.dispose();
  }
}
