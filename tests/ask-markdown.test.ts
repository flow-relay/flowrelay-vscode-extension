import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChatTextFormatter, RefIndex, collectSources, renderMarkdown, safeHttpUrl } from '../src/ask-markdown';

test('raw HTML is escaped', () => {
  const html = renderMarkdown('<script>alert(1)</script> <img src=x onerror=alert(1)>');
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('<img'));
  assert.match(html, /&lt;script&gt;/);
});

test('images are dropped to their alt text', () => {
  const html = renderMarkdown('![diagram](https://x.test/a.png) done');
  assert.ok(!html.includes('<img'));
  assert.match(html, /diagram done/);
});

test('only http and https links are rendered as links', () => {
  const html = renderMarkdown('[ok](https://x.test/a?b=1&c=2) [bad](javascript:alert(1)) [data](data:text/html,x)');
  assert.match(html, /<a href="https:\/\/x\.test\/a\?b=1&amp;c=2" data-url="https:\/\/x\.test\/a\?b=1&amp;c=2">ok<\/a>/);
  assert.ok(!html.includes('href="javascript'));
  assert.equal((html.match(/<a /g) ?? []).length, 1);
  assert.ok(!html.includes('href="data:'));
});

test('attribute injection through a link target is neutralised', () => {
  const html = renderMarkdown('[x](https://x.test/"onmouseover="alert(1))');
  assert.ok(!/onmouseover="/.test(html.replace(/&quot;/g, '')) || !html.includes('" onmouseover'));
  assert.ok(!html.includes('"onmouseover="'));
});

test('inline refs are numbered by first appearance and link when a url is known', () => {
  const index = new RefIndex();
  index.set({ ref: 'ev:11111111', eventId: 'a', url: 'https://x.test/1', title: 'One' });
  const html = renderMarkdown('First [ev:22222222] then [ev:11111111] and [ev:22222222] again', index);
  assert.match(html, /<span class="ref" aria-label="Source 1">1<\/span>/);
  assert.match(html, /<a class="ref" href="https:\/\/x\.test\/1" data-url="https:\/\/x\.test\/1" aria-label="Source 2">2<\/a>/);
  assert.equal(index.number('ev:22222222'), 1);
});

test('block structure: headings, nested lists, code, quote, table, rule', () => {
  const html = renderMarkdown(
    ['# Title', '', 'Para with **bold**, *em* and `code <b>`.', '', '- a', '  - b', '- c', '', '1. one', '2. two', '', '```', '<x>', '```', '', '> quoted', '', '| h1 | h2 |', '| --- | --- |', '| a | b |', '', '---'].join('\n'),
  );
  assert.match(html, /<h3>Title<\/h3>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>em<\/em>/);
  assert.match(html, /<code>code &lt;b&gt;<\/code>/);
  assert.match(html, /<ul><li>a<ul><li>b<\/li><\/ul><\/li><li>c<\/li><\/ul>/);
  assert.match(html, /<ol><li>one<\/li><li>two<\/li><\/ol>/);
  assert.match(html, /<pre><code>&lt;x&gt;<\/code><\/pre>/);
  assert.match(html, /<blockquote><p>quoted<\/p><\/blockquote>/);
  assert.match(html, /<th>h1<\/th>/);
  assert.match(html, /<td>b<\/td>/);
  assert.match(html, /<hr>/);
});

test('an unclosed code fence from a streaming answer still renders safely', () => {
  const html = renderMarkdown('Look:\n```ts\nconst a = "<b>";');
  assert.match(html, /<pre><code>const a = &quot;&lt;b&gt;&quot;;<\/code><\/pre>/);
});

test('ChatTextFormatter numbers refs and holds back a partial ref', () => {
  const index = new RefIndex();
  const f = new ChatTextFormatter(index);
  const out = [f.push('See [ev:abc'), f.push('def12] and [FR-12] ok'), f.flush()].join('');
  assert.equal(out, 'See [1] and [FR-12] ok');
});

test('ChatTextFormatter releases a bracket that is not a ref', () => {
  const f = new ChatTextFormatter(new RefIndex());
  assert.equal(f.push('a [note'), 'a ');
  assert.equal(f.push(' and more'), '[note and more');
});

test('collectSources keeps only ev refs and drops unsafe urls', () => {
  const index = new RefIndex();
  index.number('ev:aaaaaaaa');
  const sources = collectSources(index, [
    { ref: 'ev:aaaaaaaa', eventId: 'e1', source: 'github', title: 'PR', url: 'javascript:alert(1)' },
    { ref: 'ev:bbbbbbbb', eventId: 'e2', source: 'slack', title: 'Thread', url: 'https://x.test/t' },
    { ref: 'FR-12', eventId: null },
  ]);
  assert.deepEqual(
    sources.map((s) => [s.n, s.title, s.url]),
    [
      [1, 'PR', null],
      [2, 'Thread', 'https://x.test/t'],
    ],
  );
});

test('safeHttpUrl', () => {
  assert.equal(safeHttpUrl('https://a.test/x'), 'https://a.test/x');
  assert.equal(safeHttpUrl('file:///etc/passwd'), null);
  assert.equal(safeHttpUrl(null), null);
  assert.equal(safeHttpUrl('not a url'), null);
});
