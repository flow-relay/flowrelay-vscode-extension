import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { SseParser, parseAskEvent, type AskEvent } from '../src/ask-stream';
import { FlowRelayAPI } from '../src/api';
import { runAskTurn } from '../src/ask-turn';

function frame(event: AskEvent, id: number): string {
  return `id: ${id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

test('SseParser reassembles frames split across chunks', () => {
  const parser = new SseParser();
  const text = frame({ type: 'status', phase: 'search', label: 'Searching' }, 1) + frame({ type: 'text.delta', text: 'Hi' }, 2);
  const frames = [];
  for (let i = 0; i < text.length; i += 7) frames.push(...parser.push(text.slice(i, i + 7)));
  assert.equal(frames.length, 2);
  assert.equal(frames[0].event, 'status');
  assert.equal(frames[0].id, '1');
  assert.deepEqual(parseAskEvent(frames[1]), { type: 'text.delta', text: 'Hi' });
});

test('SseParser handles CRLF, comments and multi-line data', () => {
  const parser = new SseParser();
  const frames = parser.push(': ping\r\n\r\nevent: x\r\ndata: a\r\ndata: b\r\n\r\n');
  assert.equal(frames.length, 1);
  assert.equal(frames[0].data, 'a\nb');
});

test('parseAskEvent rejects unknown types and bad JSON', () => {
  assert.equal(parseAskEvent({ id: null, event: 'x', data: '{"type":"nope"}' }), null);
  assert.equal(parseAskEvent({ id: null, event: 'x', data: 'not json' }), null);
  assert.equal(parseAskEvent({ id: null, event: 'x', data: '3' }), null);
});

interface Server {
  url: string;
  close(): Promise<void>;
  requests: { headers: http.IncomingHttpHeaders; body: string }[];
}

async function serve(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<Server> {
  const requests: Server['requests'] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      requests.push({ headers: req.headers, body });
      handler(req, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

test('askStream sends the SSE request and delivers events across chunk boundaries', async () => {
  const events: AskEvent[] = [
    { type: 'turn.start', threadId: 't1', userMessageId: 'u', messageId: 'm', tier: 'standard', routedBy: 'auto', credits: 0 },
    { type: 'text.delta', text: 'Hello ' },
    { type: 'text.delta', text: 'world [ev:abcdef12]' },
    { type: 'turn.end', status: 'completed', messageId: 'm', content: 'Hello world [ev:abcdef12]', citations: [{ ref: 'ev:abcdef12', eventId: 'e', source: 'github', title: 'PR 12', url: 'https://x.test/pr/12' }], charged: 0 },
  ];
  const server = await serve((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const all = events.map((e, i) => frame(e, i + 1)).join('');
    let at = 0;
    const timer = setInterval(() => {
      res.write(all.slice(at, at + 11));
      at += 11;
      if (at >= all.length) {
        clearInterval(timer);
        res.end();
      }
    }, 1);
  });
  try {
    const api = new FlowRelayAPI('fr_test', server.url);
    const result = await runAskTurn(
      api,
      { projectId: 'p1', question: 'What changed?', tier: 'deep', threadId: 't0', signal: new AbortController().signal },
      () => {},
    );
    assert.equal(result.status, 'completed');
    assert.equal(result.threadId, 't1');
    assert.equal(result.tier, 'standard');
    assert.equal(result.content, 'Hello world [ev:abcdef12]');
    assert.equal(result.citations[0].url, 'https://x.test/pr/12');
    const sent = server.requests[0];
    assert.equal(sent.headers.accept, 'text/event-stream');
    assert.equal(sent.headers.authorization, 'Bearer fr_test');
    assert.deepEqual(JSON.parse(sent.body), { question: 'What changed?', tier: 'deep', thread_id: 't0' });
  } finally {
    await server.close();
  }
});

test('askStream turns an HTTP error into a readable message', async () => {
  const server = await serve((_req, res) => {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Thread not found' }));
  });
  try {
    const api = new FlowRelayAPI('fr_test', server.url);
    const result = await runAskTurn(
      api,
      { projectId: 'p1', question: 'q', tier: 'auto', threadId: null, signal: new AbortController().signal },
      () => {},
    );
    assert.equal(result.status, 'failed');
    assert.match(result.error?.message ?? '', /404.*Thread not found/);
  } finally {
    await server.close();
  }
});

test('askStream reports a stream that closes before turn.end', async () => {
  const server = await serve((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(frame({ type: 'text.delta', text: 'partial' }, 1));
  });
  try {
    const api = new FlowRelayAPI('fr_test', server.url);
    const result = await runAskTurn(
      api,
      { projectId: 'p1', question: 'q', tier: 'auto', threadId: null, signal: new AbortController().signal },
      () => {},
    );
    assert.equal(result.status, 'failed');
    assert.equal(result.error?.code, 'interrupted');
    assert.equal(result.content, 'partial');
  } finally {
    await server.close();
  }
});

test('abort stops the request and reports aborted', async () => {
  let closed = false;
  const server = await serve((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(frame({ type: 'text.delta', text: 'a' }, 1));
    req.on('close', () => (closed = true));
  });
  try {
    const api = new FlowRelayAPI('fr_test', server.url);
    const controller = new AbortController();
    const result = await runAskTurn(
      api,
      { projectId: 'p1', question: 'q', tier: 'auto', threadId: null, signal: controller.signal },
      (event) => {
        if (event.type === 'text.delta') controller.abort();
      },
    );
    assert.equal(result.status, 'aborted');
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(closed, true);
  } finally {
    await server.close();
  }
});
