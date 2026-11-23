/**
 * @license
 * Flow Relay Ask markdown rendering
 * Copyright (c) 2026 Adriano Sorbello (atrisorb) <https://github.com/atrisorb>
 * Licensed under GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)
 */

import type { AskCitationRef } from './ask-stream';

const EV_REF = /\[(ev:[0-9a-fA-F-]{8,36})\]/g;

export class RefIndex {
  private readonly numbers = new Map<string, number>();
  private readonly citations = new Map<string, AskCitationRef>();

  number(ref: string): number {
    const key = ref.toLowerCase();
    let n = this.numbers.get(key);
    if (n === undefined) {
      n = this.numbers.size + 1;
      this.numbers.set(key, n);
    }
    return n;
  }

  set(citation: AskCitationRef): void {
    this.citations.set(citation.ref.toLowerCase(), citation);
  }

  get(ref: string): AskCitationRef | undefined {
    return this.citations.get(ref.toLowerCase());
  }

  scan(text: string): void {
    for (const match of text.matchAll(EV_REF)) this.number(match[1]);
  }

  sources(): { n: number; citation: AskCitationRef }[] {
    const out: { n: number; citation: AskCitationRef }[] = [];
    for (const [key, n] of this.numbers) {
      out.push({ n, citation: this.citations.get(key) ?? { ref: key, eventId: null } });
    }
    return out.sort((a, b) => a.n - b.n);
  }
}

export interface SourceView {
  n: number;
  title: string;
  source: string | null;
  url: string | null;
  createdAt: string | null;
}

export function collectSources(index: RefIndex, citations: AskCitationRef[]): SourceView[] {
  for (const citation of citations) {
    if (!citation.ref.toLowerCase().startsWith('ev:')) continue;
    index.set(citation);
    index.number(citation.ref);
  }
  return index.sources().map(({ n, citation }) => ({
    n,
    title: citation.title?.trim() || citation.ref,
    source: citation.source ?? null,
    url: safeHttpUrl(citation.url),
    createdAt: citation.createdAt ?? null,
  }));
}

export class ChatTextFormatter {
  private pending = '';

  constructor(private readonly index: RefIndex) {}

  push(delta: string): string {
    const text = this.pending + delta;
    const open = /\[[^\]\s]{0,40}$/.exec(text);
    const safe = open ? text.slice(0, open.index) : text;
    this.pending = open ? text.slice(open.index) : '';
    return this.replace(safe);
  }

  flush(): string {
    const rest = this.pending;
    this.pending = '';
    return this.replace(rest);
  }

  private replace(text: string): string {
    return text.replace(EV_REF, (_m, ref: string) => `[${this.index.number(ref)}]`);
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function inline(source: string, index: RefIndex, allowLinks = true): string {
  const stash: string[] = [];
  const hold = (html: string) => `\u0000${stash.push(html) - 1}\u0000`;
  let text = source.replace(/\u0000/g, '');

  text = text.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_m, _ticks: string, code: string) =>
    hold(`<code>${escapeHtml(code.trim())}</code>`),
  );
  text = escapeHtml(text);

  text = text.replace(EV_REF, (_m, ref: string) => {
    const n = index.number(ref);
    const url = safeHttpUrl(index.get(ref)?.url);
    return hold(
      url
        ? `<a class="ref" href="${escapeHtml(url)}" data-url="${escapeHtml(url)}" aria-label="Source ${n}">${n}</a>`
        : `<span class="ref" aria-label="Source ${n}">${n}</span>`,
    );
  });

  text = text.replace(/!\[([^\]]*)\]\([^)\s]*\)/g, (_m, alt: string) => alt);

  if (allowLinks) {
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label: string, href: string) => {
      const url = safeHttpUrl(href.replace(/&amp;/g, '&'));
      if (!url) return label;
      return hold(`<a href="${escapeHtml(url)}" data-url="${escapeHtml(url)}">${inline(label, index, false)}</a>`);
    });
  }

  text = text
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
    .replace(/(^|[^*\w])\*(?=\S)([^*\n]*?\S)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_(?=\S)([^_\n]*?\S)_(?!\w)/g, '$1<em>$2</em>');

  return text.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => stash[Number(i)] ?? '');
}

const FENCE = /^\s*(```+|~~~+)/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

interface ListNode {
  ordered: boolean;
  indent: number;
  items: { text: string; children: ListNode[] }[];
}

function renderList(node: ListNode, index: RefIndex): string {
  const tag = node.ordered ? 'ol' : 'ul';
  const items = node.items
    .map((item) => `<li>${inline(item.text, index)}${item.children.map((c) => renderList(c, index)).join('')}</li>`)
    .join('');
  return `<${tag}>${items}</${tag}>`;
}

function parseList(lines: string[], start: number): { html: (index: RefIndex) => string; next: number } {
  const roots: ListNode[] = [];
  const stack: ListNode[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    const match = LIST_ITEM.exec(line);
    if (!match) {
      if (line.trim() === '') {
        const ahead = lines.slice(i + 1).find((l) => l.trim() !== '');
        if (ahead && LIST_ITEM.test(ahead)) {
          i += 1;
          continue;
        }
        break;
      }
      if (/^\s{2,}\S/.test(line) && stack.length > 0) {
        const last = stack[stack.length - 1].items;
        last[last.length - 1].text += ` ${line.trim()}`;
        i += 1;
        continue;
      }
      break;
    }
    const indent = match[1].replace(/\t/g, '    ').length;
    const ordered = /\d/.test(match[2]);
    while (stack.length > 0 && stack[stack.length - 1].indent > indent) stack.pop();
    let node = stack[stack.length - 1];
    if (!node || node.indent < indent) {
      const created: ListNode = { ordered, indent, items: [] };
      if (node) {
        const parent = node.items[node.items.length - 1];
        parent.children.push(created);
      } else {
        roots.push(created);
      }
      stack.push(created);
      node = created;
    } else if (node.ordered !== ordered && stack.length === 1) {
      break;
    }
    node.items.push({ text: match[3], children: [] });
    i += 1;
  }
  return { html: (index) => roots.map((r) => renderList(r, index)).join(''), next: i };
}

function blocks(source: string, index: RefIndex): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) out.push(`<p>${inline(paragraph.join('\n'), index)}</p>`);
    paragraph = [];
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const marker = fence[1];
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith(marker)) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1;
      out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }
    if (line.trim() === '') {
      flush();
      i += 1;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      const level = Math.min(heading[1].length + 2, 6);
      out.push(`<h${level}>${inline(heading[2], index)}</h${level}>`);
      i += 1;
      continue;
    }
    if (HR.test(line) && !LIST_ITEM.test(line)) {
      flush();
      out.push('<hr>');
      i += 1;
      continue;
    }
    if (/^\s*>/.test(line)) {
      flush();
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      out.push(`<blockquote>${blocks(quote.join('\n'), index)}</blockquote>`);
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      flush();
      const head = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      const th = head.map((c) => `<th>${inline(c, index)}</th>`).join('');
      const tr = rows
        .map((r) => `<tr>${head.map((_h, k) => `<td>${inline(r[k] ?? '', index)}</td>`).join('')}</tr>`)
        .join('');
      out.push(`<div class="tbl"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`);
      continue;
    }
    if (LIST_ITEM.test(line)) {
      flush();
      const list = parseList(lines, i);
      out.push(list.html(index));
      i = Math.max(list.next, i + 1);
      continue;
    }
    paragraph.push(line);
    i += 1;
  }
  flush();
  return out.join('');
}

export function renderMarkdown(source: string, index: RefIndex = new RefIndex()): string {
  return blocks(source, index);
}
