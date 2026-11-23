import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PARTICIPANT_ID, findThreadId, handleChatRequest, provideFollowups, type ChatDeps } from '../src/chat-handler';
import type { AskEvent } from '../src/ask-stream';
import type { AskStreamApi } from '../src/ask-turn';
import type { CancellationTokenLike, ChatResponseStreamLike, CommandLike } from '../src/vscode-compat';

function fakeStream() {
  const out = { markdown: [] as string[], progress: [] as string[], references: [] as unknown[], buttons: [] as CommandLike[] };
  const stream: ChatResponseStreamLike = {
    markdown: (v) => out.markdown.push(v),
    progress: (v) => out.progress.push(v),
    reference: (v) => out.references.push(v),
    button: (c) => out.buttons.push(c),
  };
  return { out, stream };
}

function token() {
  const listeners: (() => void)[] = [];
  const t = {
    isCancellationRequested: false,
    onCancellationRequested: (listener: () => void) => {
      listeners.push(listener);
      return { dispose: () => undefined };
    },
    cancel() {
      t.isCancellationRequested = true;
      listeners.forEach((l) => l());
    },
  };
  return t satisfies CancellationTokenLike & { cancel(): void };
}

const project = { id: 'p1', name: 'Checkout v2', webUrl: 'https://flowrelay.test/projects/p1' };

function deps(api: AskStreamApi | null, proj: typeof project | null = project): ChatDeps {
  return { getApi: () => api, getProject: async () => proj, toUri: (v) => ({ uri: v }) };
}

function scripted(events: AskEvent[], seen?: { threadId?: string | null; tier?: string; question?: string }): AskStreamApi {
  return {
    async askStream(_p, question, options, onEvent) {
      if (seen) Object.assign(seen, { threadId: options.threadId, tier: options.tier, question });
      for (const e of events) onEvent(e);
    },
  };
}

const END = (content: string, citations = [] as never[]): AskEvent => ({ type: 'turn.end', status: 'completed', messageId: 'm', content, citations, charged: 0 });
const START: AskEvent = { type: 'turn.start', threadId: 'thread-1', userMessageId: 'u', messageId: 'm', tier: 'standard', routedBy: 'auto', credits: 0 };

test('streams text, progress, sources and references, and returns the thread id', async () => {
  const { out, stream } = fakeStream();
  const citation = { ref: 'ev:abcdef12', eventId: 'e1', source: 'github', title: 'PR 482', url: 'https://github.test/pr/482' };
  const api = scripted([
    START,
    { type: 'status', phase: 'plan', label: 'Planning' },
    { type: 'tool.start', callId: 'c1', name: 'search', label: 'Searching activity', argsPreview: '{}' },
    { type: 'tool.end', callId: 'c1', status: 'ok', summary: '3 events', latencyMs: 4 },
    { type: 'text.delta', text: 'Stripe won [ev:abc' },
    { type: 'text.delta', text: 'def12].' },
    END('Stripe won [ev:abcdef12].', [citation] as never[]),
  ]);
  const result = await handleChatRequest(deps(api), { prompt: 'Why Stripe?' }, { history: [] }, stream, token());
  assert.equal(out.markdown.join('').startsWith('Stripe won [1].'), true);
  assert.match(out.markdown.join(''), /\*\*Sources\*\*\n\n1\. \[PR 482\]\(https:\/\/github\.test\/pr\/482\) – github/);
  assert.deepEqual(out.progress, ['Planning', 'Searching activity']);
  assert.deepEqual(out.references, [{ uri: 'https://github.test/pr/482' }]);
  assert.deepEqual(result.metadata, { threadId: 'thread-1', projectId: 'p1' });
  assert.equal(result.errorDetails, undefined);
});

test('continues the thread of the previous turn in this chat session', async () => {
  const seen: { threadId?: string | null } = {};
  const history = [
    { participant: PARTICIPANT_ID, result: { metadata: { threadId: 'older', projectId: 'p1' } } },
    { participant: 'other.participant', result: { metadata: { threadId: 'nope', projectId: 'p1' } } },
    { participant: PARTICIPANT_ID, result: { metadata: { threadId: 'latest', projectId: 'p1' } } },
    { participant: PARTICIPANT_ID },
  ];
  await handleChatRequest(deps(scripted([START, END('ok')], seen)), { prompt: 'and then?' }, { history }, fakeStream().stream, token());
  assert.equal(seen.threadId, 'latest');
  assert.equal(findThreadId({ history }, 'p2'), null);
});

test('slash commands choose the tier', async () => {
  const seen: { tier?: string } = {};
  await handleChatRequest(deps(scripted([START, END('ok')], seen)), { prompt: 'dig', command: 'deep' }, { history: [] }, fakeStream().stream, token());
  assert.equal(seen.tier, 'deep');
  await handleChatRequest(deps(scripted([START, END('ok')], seen)), { prompt: 'dig', command: 'search' }, { history: [] }, fakeStream().stream, token());
  assert.equal(seen.tier, 'standard');
  await handleChatRequest(deps(scripted([START, END('ok')], seen)), { prompt: 'dig' }, { history: [] }, fakeStream().stream, token());
  assert.equal(seen.tier, 'auto');
});

test('cancellation aborts the request', async () => {
  const t = token();
  let aborted = false;
  const api: AskStreamApi = {
    askStream: (_p, _q, options) =>
      new Promise((resolve) => {
        options.signal?.addEventListener('abort', () => {
          aborted = true;
          resolve();
        });
        setTimeout(() => t.cancel(), 5);
      }),
  };
  const result = await handleChatRequest(deps(api), { prompt: 'long one' }, { history: [] }, fakeStream().stream, t);
  assert.equal(aborted, true);
  assert.equal(result.errorDetails, undefined);
});

test('an error before any text becomes errorDetails', async () => {
  const api = scripted([START, { type: 'error', errorCode: 'quota_exceeded', error: 'Out of quota.', retryable: false }]);
  const result = await handleChatRequest(deps(api), { prompt: 'q' }, { history: [] }, fakeStream().stream, token());
  assert.equal(result.errorDetails?.message, 'Out of quota.');
  assert.deepEqual(provideFollowups(result), []);
});

test('approval and connect events explain themselves and offer the project page', async () => {
  const { out, stream } = fakeStream();
  const api = scripted([
    START,
    { type: 'connect.required', serverId: 's', name: 'Acme MCP', reason: 'connect' },
    { type: 'approval.required', callId: 'c', server: 'Acme MCP', tool: 'create_ticket', args: {} },
    END(''),
  ]);
  await handleChatRequest(deps(api), { prompt: 'file a ticket' }, { history: [] }, stream, token());
  const text = out.markdown.join('');
  assert.match(text, /Acme MCP is not connected yet/);
  assert.match(text, /Approve it in the Flow Relay web or mobile app/);
  assert.equal(out.buttons.length, 2);
  assert.equal(out.buttons[0].command, 'vscode.open');
});

test('no key and no project give a button instead of a request', async () => {
  const a = fakeStream();
  await handleChatRequest(deps(null), { prompt: 'q' }, { history: [] }, a.stream, token());
  assert.equal(a.out.buttons[0].command, 'flowrelay.setApiKey');
  const b = fakeStream();
  await handleChatRequest(deps(scripted([]), null), { prompt: 'q' }, { history: [] }, b.stream, token());
  assert.equal(b.out.buttons[0].command, 'flowrelay.selectProject');
});

test('follow-ups appear after a completed turn', async () => {
  const followups = provideFollowups({ metadata: { threadId: 't', projectId: 'p' } });
  assert.equal(followups[0].command, 'deep');
  assert.ok(followups.length >= 2);
});
