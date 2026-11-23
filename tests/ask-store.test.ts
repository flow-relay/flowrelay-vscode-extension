import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AskStore, MAX_ANSWER, MAX_THREADS, MAX_TURNS, type MementoLike } from '../src/ask-store';

function memory(): MementoLike {
  const data = new Map<string, unknown>();
  return {
    get: <T>(key: string, fallback: T) => (data.has(key) ? (data.get(key) as T) : fallback),
    update: async (key, value) => {
      data.set(key, JSON.parse(JSON.stringify(value)));
    },
  };
}

const turn = (question: string, at: string) => ({ question, answer: `A: ${question}`, citations: [], tier: 'quick', at });

test('a first turn creates the thread and later turns extend it', async () => {
  const store = new AskStore(memory());
  await store.record('p1', 't1', turn('  What   changed?  ', '2026-11-23T10:00:00Z'));
  await store.record('p1', 't1', turn('And why?', '2026-11-23T10:05:00Z'));
  const [thread] = store.list('p1');
  assert.equal(thread.title, 'What changed?');
  assert.equal(thread.turns.length, 2);
  assert.equal(thread.updatedAt, '2026-11-23T10:05:00Z');
});

test('threads are listed per project, newest first', async () => {
  const store = new AskStore(memory());
  await store.record('p1', 'a', turn('old', '2026-11-20T10:00:00Z'));
  await store.record('p1', 'b', turn('new', '2026-11-22T10:00:00Z'));
  await store.record('p2', 'c', turn('other', '2026-11-23T10:00:00Z'));
  assert.deepEqual(store.list('p1').map((t) => t.id), ['b', 'a']);
  assert.deepEqual(store.list('p2').map((t) => t.id), ['c']);
});

test('caps: turns per thread, threads overall, answer length', async () => {
  const store = new AskStore(memory());
  for (let i = 0; i < MAX_TURNS + 5; i += 1) await store.record('p', 't', turn(`q${i}`, `2026-11-23T10:${String(i).padStart(2, '0')}:00Z`));
  assert.equal(store.get('t')?.turns.length, MAX_TURNS);
  for (let i = 0; i < MAX_THREADS + 3; i += 1) await store.record('p', `x${i}`, turn(`q${i}`, `2026-12-01T10:${String(i).padStart(2, '0')}:00Z`));
  assert.equal(store.list('p').length, MAX_THREADS);
  await store.record('p', 'long', { ...turn('big', '2027-01-01T00:00:00Z'), answer: 'x'.repeat(MAX_ANSWER + 100) });
  assert.equal(store.get('long')?.turns[0].answer.length, MAX_ANSWER);
});

test('remove deletes a thread', async () => {
  const store = new AskStore(memory());
  await store.record('p1', 't1', turn('q', '2026-11-23T10:00:00Z'));
  await store.remove('t1');
  assert.equal(store.get('t1'), undefined);
});
