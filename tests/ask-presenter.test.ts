import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TurnPresenter, type PanelMessage } from '../src/ask-presenter';
import type { AskTurnResult } from '../src/ask-turn';

const result = (over: Partial<AskTurnResult>): AskTurnResult => ({
  status: 'completed',
  threadId: 't',
  tier: 'standard',
  content: '',
  citations: [],
  error: null,
  ...over,
});

test('tool steps, answer html and the final message', async () => {
  const messages: PanelMessage[] = [];
  const p = new TurnPresenter((m) => messages.push(m));
  p.handle({ type: 'turn.start', threadId: 't', userMessageId: 'u', messageId: 'm', tier: 'deep', routedBy: 'auto', credits: 0 });
  p.handle({ type: 'tool.start', callId: 'c', name: 'search', label: 'Searching activity', argsPreview: '' });
  p.handle({ type: 'tool.end', callId: 'c', status: 'ok', summary: '3 events', latencyMs: 1 });
  p.handle({ type: 'text.delta', text: '<b>Hi</b> [ev:aaaaaaaa]' });
  const done = p.finish(result({ content: '<b>Hi</b> [ev:aaaaaaaa]', citations: [{ ref: 'ev:aaaaaaaa', eventId: 'e', title: 'PR', source: 'github', url: 'https://x.test/1' }] }));

  assert.deepEqual(messages[0], { type: 'tier', tier: 'deep' });
  assert.deepEqual(messages.find((m) => m.type === 'tool' && m.state === 'ok'), { type: 'tool', id: 'c', label: 'Searching activity', state: 'ok', summary: '3 events' });
  const answer = messages.find((m) => m.type === 'answer');
  assert.ok(answer && answer.type === 'answer' && answer.html.includes('&lt;b&gt;Hi&lt;/b&gt;'));
  const end = messages[messages.length - 1];
  assert.equal(end.type, 'turnEnd');
  assert.equal(done.sources[0].url, 'https://x.test/1');
  assert.match(done.html, /<a class="ref" href="https:\/\/x\.test\/1"/);
});

test('approval.required is explained and says this connection cannot answer it', () => {
  const messages: PanelMessage[] = [];
  const p = new TurnPresenter((m) => messages.push(m));
  p.handle({ type: 'approval.required', callId: 'c', server: 'Acme', tool: 'create_ticket', args: { title: 'x' } });
  const notice = messages[0];
  assert.ok(notice.type === 'notice' && notice.kind === 'approval');
  assert.match((notice as { text: string }).text, /web or mobile app/);
});

test('a failed turn reports its error', () => {
  const messages: PanelMessage[] = [];
  const p = new TurnPresenter((m) => messages.push(m));
  p.finish(result({ status: 'failed', error: { code: 'x', message: 'Boom', retryable: true } }));
  const end = messages[0];
  assert.ok(end.type === 'turnEnd' && end.error === 'Boom' && end.status === 'failed');
});
