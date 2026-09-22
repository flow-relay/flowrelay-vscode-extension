/**
 * @license
 * Flow Relay Filter Panel UI
 * Copyright (c) 2026 Adriano Sorbello (atrisorb) <https://github.com/atrisorb>
 * Licensed under GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { SourceFilter, AvailableFilters, FigmaGateInfo } from './api';
import { SOURCE_NAMES, SOURCE_PROJECT_LABEL, sourceSlug } from './filter-data';

export type FilterResult = { sources: string[]; filters: Record<string, SourceFilter> };

type PanelOptions = {
  title: string;
  subtitle: string;
  generateLabel: string;
  figmaGate?: FigmaGateInfo | null;
};

// Canonical source order.
const SOURCE_ORDER = [
  'github', 'slack', 'discord', 'linear', 'notion', 'jira', 'gitlab', 'bitbucket',
  'azure_devops', 'figma', 'confluence', 'microsoft_outlook', 'microsoft_teams',
  'sentry', 'datadog',
];

type SourceModel = {
  source: string;
  name: string;
  icon: string;
  projectLabel: string;
  projects: { id: string; label: string }[];
  eventTypes: { value: string; label: string }[];
  branchesByProject: Record<string, { value: string; label: string }[]>;
  defaultBranchByProject: Record<string, string>;
  priorities: { value: string; label: string }[];
  disabled?: boolean;
  disabledNote?: string;
};

type Brand = {
  mascot: string;
  mark: string;
  fonts: { geist: string; geistMono: string; rubik300: string; rubik500: string };
};

const NONCE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function makeNonce(): string {
  const bytes = crypto.randomBytes(24);
  let out = '';
  for (const b of bytes) out += NONCE_CHARS[b % NONCE_CHARS.length];
  return out;
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function openFilterPanel(
  extensionUri: vscode.Uri,
  available: AvailableFilters,
  opts: PanelOptions,
): Promise<FilterResult | undefined> {
  return new Promise((resolve) => {
    const panel = vscode.window.createWebviewPanel(
      'flowrelayFilters',
      'Flow Relay',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      },
    );

    panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'icon.svg');

    const isDark =
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ||
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;
    const themeDir = isDark ? 'dark' : 'light';

    const iconUri = (source: string) =>
      panel.webview
        .asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'integrations', themeDir, `${sourceSlug(source)}.svg`))
        .toString();
    const asset = (...p: string[]) =>
      panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', ...p)).toString();

    const brand: Brand = {
      mascot: asset(isDark ? 'mascotte-dark-theme.svg' : 'mascotte.svg'),
      mark: asset('icon.svg'),
      fonts: {
        geist: asset('fonts', 'geist-sans.woff2'),
        geistMono: asset('fonts', 'geist-mono.woff2'),
        rubik300: asset('fonts', 'rubik-300.woff2'),
        rubik500: asset('fonts', 'rubik-500.woff2'),
      },
    };

    const sources = Object.keys(available).sort((a, b) => {
      const ia = SOURCE_ORDER.indexOf(a);
      const ib = SOURCE_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });

    const figmaGate = opts.figmaGate;
    const model: SourceModel[] = sources.map((source) => {
      const f = available[source];
      const figmaBlocked = source === 'figma' && figmaGate && !figmaGate.selectable;
      return {
        source,
        name: SOURCE_NAMES[source] ?? source,
        icon: iconUri(source),
        projectLabel: SOURCE_PROJECT_LABEL[source] ?? 'Resources',
        projects: f.projects ?? [],
        eventTypes: f.eventTypes ?? [],
        branchesByProject: f.branchesByProject ?? {},
        defaultBranchByProject: f.defaultBranchByProject ?? {},
        priorities: f.priorities ?? [],
        ...(figmaBlocked
          ? {
              disabled: true,
              disabledNote:
                'Needs the Global processing region – ' +
                (figmaGate.canManageResidency
                  ? 'switch this project to Global in the Flow Relay dashboard.'
                  : 'ask an organization admin to switch this project to Global.'),
            }
          : {}),
      };
    });

    let settled = false;
    const finish = (value: FilterResult | undefined) => {
      if (settled) return;
      settled = true;
      resolve(value);
      panel.dispose();
    };

    panel.webview.onDidReceiveMessage(
      (msg: { type?: string; sources?: string[]; filters?: Record<string, SourceFilter> }) => {
        if (msg?.type === 'generate') {
          finish({ sources: msg.sources ?? [], filters: msg.filters ?? {} });
        } else if (msg?.type === 'cancel') {
          finish(undefined);
        }
      },
    );

    panel.onDidDispose(() => finish(undefined));

    panel.webview.html = renderHtml(panel.webview, brand, model, opts);
  });
}

function renderHtml(
  webview: vscode.Webview,
  brand: Brand,
  model: SourceModel[],
  opts: PanelOptions,
): string {
  const nonce = makeNonce();
  const modelJson = JSON.stringify(model);

  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} https: data:`,
    `style-src 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `font-src ${webview.cspSource}`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    @font-face { font-family: 'Geist'; src: url('${brand.fonts.geist}') format('woff2'); font-weight: 100 900; font-style: normal; font-display: swap; }
    @font-face { font-family: 'Geist Mono'; src: url('${brand.fonts.geistMono}') format('woff2'); font-weight: 100 900; font-style: normal; font-display: swap; }
    @font-face { font-family: 'Rubik'; src: url('${brand.fonts.rubik300}') format('woff2'); font-weight: 300; font-style: normal; font-display: swap; }
    @font-face { font-family: 'Rubik'; src: url('${brand.fonts.rubik500}') format('woff2'); font-weight: 500; font-style: normal; font-display: swap; }

    :root {
      --bg: #f7f1e6; --bg-soft: #efe5d2; --surface: #fffefb; --surface-alt: #fbf5ea;
      --ink: #241b12; --ink-soft: #3f3325; --ink-muted: #6b5c49; --ink-faint: #9f8e78;
      --border: #e2d4bd; --border-soft: #ede2ce;
      --accent: #c25a2c; --accent-deep: #9b3f18; --accent-soft: #f2d8c3; --accent-tint: #faeadd;
      --on-accent: #fffefb; --danger: #a93724;
      --shadow: 0 1px 2px rgba(60,30,10,0.06), 0 8px 24px rgba(60,30,10,0.06);
    }
    body.vscode-dark, body.vscode-high-contrast {
      --bg: #1b130c; --bg-soft: #241a11; --surface: #241a11; --surface-alt: #2c2017;
      --ink: #f4e8d4; --ink-soft: #e0d2bb; --ink-muted: #b49e80; --ink-faint: #7a6952;
      --border: #3a2c1f; --border-soft: #2f2317;
      --accent: #e27a45; --accent-deep: #c25a2c; --accent-soft: #3a2417; --accent-tint: #2a1a11;
      --on-accent: #1b130c; --danger: #d86f58;
      --shadow: 0 1px 2px rgba(0,0,0,0.4), 0 8px 24px rgba(0,0,0,0.3);
    }

    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; height: 100%; }
    body {
      background: var(--bg); color: var(--ink);
      font-family: 'Geist', ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      font-size: 13px; line-height: 1.5; -webkit-font-smoothing: antialiased;
    }
    .mono { font-family: 'Geist Mono', ui-monospace, "SF Mono", Menlo, monospace; }

    .app { display: flex; flex-direction: column; min-height: 100vh; }
    .wrap { flex: 1; width: 100%; max-width: 860px; margin: 0 auto; padding: 26px 24px 110px; display: flex; flex-direction: column; }

    .brand { display: flex; align-items: center; gap: 9px; margin-bottom: 18px; }
    .brand-mark { width: 22px; height: 22px; }
    .wordmark { font-family: 'Rubik', sans-serif; font-size: 17px; letter-spacing: -0.012em; line-height: 1; }
    .wm-flow { font-weight: 500; color: var(--ink); }
    .wm-relay { font-weight: 300; color: var(--ink-muted); }

    .hero { display: flex; align-items: center; gap: 13px; margin-bottom: 16px; }
    .hero img { width: 42px; height: 42px; flex: none; }
    .hero h1 { margin: 0; font-size: 18px; font-weight: 650; letter-spacing: -0.01em; }
    .hero p { margin: 2px 0 0; font-size: 12.5px; color: var(--ink-muted); }

    .hint {
      display: flex; gap: 8px; align-items: flex-start;
      background: var(--accent-tint); border: 1px solid var(--accent-soft); color: var(--ink-soft);
      border-radius: 12px; padding: 10px 14px; font-size: 12px; margin-bottom: 16px;
    }
    .hint svg { flex: none; margin-top: 1px; color: var(--accent); }

    .card {
      flex: 1; background: var(--surface); border: 1px solid var(--border);
      border-radius: 14px; box-shadow: var(--shadow); padding: 14px 16px;
      display: flex; flex-direction: column; min-height: 320px;
    }

    .list-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
    .list-head .lbl { font-size: 12px; font-weight: 600; color: var(--ink-muted); }
    .link { background: none; border: none; cursor: pointer; font: inherit; font-size: 12px; color: var(--accent); padding: 0; }
    .link:hover { color: var(--accent-deep); }
    .link.danger:hover { color: var(--danger); }

    .scroll { flex: 1; overflow-y: auto; margin: 0 -4px; padding: 0 4px; }

    .row { display: flex; align-items: center; width: 100%; }
    .row-btn {
      display: flex; align-items: center; gap: 11px; flex: 1; min-width: 0;
      background: none; border: none; cursor: pointer; font: inherit; color: var(--ink-soft);
      padding: 7px 8px; border-radius: 9px; text-align: left;
    }
    .row-btn:hover { background: var(--bg-soft); }
    .row-btn.dis { opacity: 0.45; cursor: not-allowed; }
    .row-btn.dis:hover { background: none; }
    .row-note { margin: -2px 0 6px 36px; font-size: 11px; color: var(--ink-faint); }
    .row-btn .ic { width: 17px; height: 17px; flex: none; }
    .row-btn .nm { font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    .cbx {
      width: 17px; height: 17px; flex: none; border-radius: 5px; border: 1.5px solid var(--ink-faint);
      display: inline-flex; align-items: center; justify-content: center; color: transparent;
      transition: background 120ms ease, border-color 120ms ease;
    }
    .cbx.sm { width: 15px; height: 15px; border-radius: 4px; }
    .cbx.on { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
    .cbx.radio { border-radius: 999px; }
    .cbx svg { width: 11px; height: 11px; }

    .gear {
      position: relative; flex: none; margin-right: 2px; padding: 6px;
      background: none; border: none; cursor: pointer; color: var(--ink-faint); border-radius: 7px;
    }
    .gear:hover { background: var(--bg-soft); color: var(--ink-muted); }
    .gear svg { width: 15px; height: 15px; display: block; }
    .gear .badge {
      position: absolute; top: 0; right: 0; min-width: 15px; height: 15px; padding: 0 3px;
      border-radius: 999px; background: var(--accent); color: var(--on-accent);
      font-size: 9px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center;
    }

    .expand { margin-left: 9px; padding-left: 12px; border-left: 2px solid var(--accent-soft); margin-bottom: 4px; }
    .sect { padding: 8px 4px; }
    .sect + .sect { border-top: 1px solid var(--border-soft); }
    .sect-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
    .sect-title { display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 600; color: var(--ink-muted); }
    .pill { min-width: 18px; height: 18px; padding: 0 5px; border-radius: 5px; background: var(--accent-tint); color: var(--accent-deep); font-size: 11px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; }

    .opt {
      display: flex; align-items: center; gap: 9px; width: 100%; padding: 4px 4px;
      background: none; border: none; cursor: pointer; font: inherit; color: var(--ink-muted); text-align: left;
      border-radius: 7px; font-size: 12px;
    }
    .opt:hover { color: var(--ink); background: var(--bg-soft); }
    .opt .tx { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .opt .tag { margin-left: auto; font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-faint); flex: none; }

    .opt-scroll { max-height: 220px; overflow-y: auto; }
    .nest { margin-left: 16px; padding-left: 8px; border-left: 1px solid var(--border-soft); }
    .micro-title { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; color: var(--ink-faint); margin: 6px 0 2px; }

    .search {
      width: 100%; margin-bottom: 6px; height: 32px; padding: 0 10px;
      border-radius: 8px; border: 1px solid var(--border); background: var(--surface-alt);
      color: var(--ink); font: inherit; font-size: 12px; outline: none;
    }
    .search:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-tint); }

    .empty-opt { font-size: 12px; color: var(--ink-faint); padding: 8px 4px; }
    .empty { text-align: center; color: var(--ink-muted); padding: 48px 20px; }

    .chev { transition: transform 160ms ease; }
    .chev.open { transform: rotate(90deg); }

    .footer {
      position: fixed; left: 0; right: 0; bottom: 0;
      background: color-mix(in srgb, var(--bg) 88%, transparent);
      backdrop-filter: blur(8px); border-top: 1px solid var(--border-soft); padding: 14px 24px;
    }
    .footer .inner { width: 100%; max-width: 860px; margin: 0 auto; display: flex; justify-content: flex-end; gap: 10px; }
    button.btn { font: inherit; font-size: 13px; font-weight: 600; height: 40px; padding: 0 22px; border-radius: 999px; cursor: pointer; border: 1px solid transparent; }
    .btn-secondary { background: var(--surface); border-color: var(--border); color: var(--ink-soft); }
    .btn-secondary:hover { border-color: var(--ink-faint); }
    .btn-primary { background: var(--accent); color: var(--on-accent); display: inline-flex; align-items: center; gap: 8px; }
    .btn-primary:hover { background: var(--accent-deep); }
    button:focus-visible, .row-btn:focus-visible, .opt:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  </style>
</head>
<body>
  <div class="app">
    <div class="wrap">
      <div class="brand">
        <img class="brand-mark" src="${esc(brand.mark)}" alt="" />
        <span class="wordmark"><span class="wm-flow">Flow</span> <span class="wm-relay">Relay</span></span>
      </div>

      <div class="hero">
        <img src="${esc(brand.mascot)}" alt="" />
        <div>
          <h1>${esc(opts.title)}</h1>
          <p>${esc(opts.subtitle)}</p>
        </div>
      </div>

      <div class="hint">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
        <span>Pick sources and refine each with the filter button. Leave everything off to include all connected activity.</span>
      </div>

      <div class="card"><div id="list" class="scroll"></div></div>
    </div>
  </div>

  <div class="footer">
    <div class="inner">
      <button class="btn btn-secondary" id="cancel" type="button">Cancel</button>
      <button class="btn btn-primary" id="generate" type="button">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/><path d="M12 2.69l1.94 4.94L19 9.5l-5.06 1.87L12 16.31 10.06 11.37 5 9.5l5.06-1.87z"/></svg>
        ${esc(opts.generateLabel)}
      </button>
    </div>
  </div>

  <script nonce="${nonce}">window.__MODEL__ = ${modelJson};</script>
  <script nonce="${nonce}">${CLIENT_JS}</script>
</body>
</html>`;
}

const CLIENT_JS = [
  "(function(){",
  "var vscodeApi = acquireVsCodeApi();",
  "var MODEL = window.__MODEL__ || [];",
  "var ENABLED = MODEL.filter(function(m){ return !m.disabled; });",
  "var bySrc = {}; MODEL.forEach(function(m){ bySrc[m.source]=m; });",
  "var state = { selected:{}, filters:{}, expSource:null, expProject:null, search:{}, activeSearch:null };",
  "",
  "function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\\\"/g,'&quot;'); }",
  "function fobj(src){ if(!state.filters[src]) state.filters[src]={projects:{},eventTypes:{},branches:{},priorities:{}}; return state.filters[src]; }",
  "function on(o){ return Object.keys(o).filter(function(k){return o[k];}); }",
  "function count(src){ var f=state.filters[src]; if(!f) return 0; return on(f.projects).length+on(f.eventTypes).length+on(f.branches).length+on(f.priorities).length; }",
  "function ensureSel(src){ state.selected[src]=true; }",
  "function srcList(){ return MODEL.map(function(m){return m.source;}).filter(function(s){return state.selected[s];}); }",
  "function projBranches(src,id){ var m=bySrc[src]; var bp=(m&&m.branchesByProject)||{}; return bp[String(id).trim().toLowerCase()]||[]; }",
  "function defBranch(src,id){ var m=bySrc[src]; var d=(m&&m.defaultBranchByProject)||{}; return d[String(id).trim().toLowerCase()]||'main'; }",
  "",
  "var CHK='<svg viewBox=\\\"0 0 24 24\\\" fill=\\\"none\\\" stroke=\\\"currentColor\\\" stroke-width=\\\"3.2\\\" stroke-linecap=\\\"round\\\" stroke-linejoin=\\\"round\\\"><polyline points=\\\"20 6 9 17 4 12\\\"></polyline></svg>';",
  "var GEAR='<svg viewBox=\\\"0 0 24 24\\\" fill=\\\"none\\\" stroke=\\\"currentColor\\\" stroke-width=\\\"2\\\" stroke-linecap=\\\"round\\\" stroke-linejoin=\\\"round\\\"><line x1=\\\"4\\\" x2=\\\"20\\\" y1=\\\"6\\\" y2=\\\"6\\\"/><line x1=\\\"4\\\" x2=\\\"20\\\" y1=\\\"12\\\" y2=\\\"12\\\"/><line x1=\\\"4\\\" x2=\\\"20\\\" y1=\\\"18\\\" y2=\\\"18\\\"/><circle cx=\\\"8\\\" cy=\\\"6\\\" r=\\\"2\\\"/><circle cx=\\\"16\\\" cy=\\\"12\\\" r=\\\"2\\\"/><circle cx=\\\"9\\\" cy=\\\"18\\\" r=\\\"2\\\"/></svg>';",
  "var CHEV='<svg viewBox=\\\"0 0 24 24\\\" fill=\\\"none\\\" stroke=\\\"currentColor\\\" stroke-width=\\\"2.2\\\" stroke-linecap=\\\"round\\\" stroke-linejoin=\\\"round\\\"><polyline points=\\\"9 18 15 12 9 6\\\"></polyline></svg>';",
  "function box(checked,cls){ return '<span class=\\\"cbx '+(cls||'')+(checked?' on':'')+'\\\">'+(checked?CHK:'')+'</span>'; }",
  "",
  "function renderResources(m){",
  "  var f=fobj(m.source); var label=esc(m.projectLabel); var sel=f.projects; var selCount=on(sel).length;",
  "  var q=(state.search[m.source]||'').trim().toLowerCase();",
  "  var visible=m.projects.filter(function(p){ return !q || p.label.toLowerCase().indexOf(q)>=0 || p.id.toLowerCase().indexOf(q)>=0; });",
  "  var allSel=m.projects.length>0 && m.projects.every(function(p){return sel[p.id];});",
  "  var h='<div class=\\\"sect\\\"><div class=\\\"sect-head\\\"><div class=\\\"sect-title\\\">'+label+(selCount>0?'<span class=\\\"pill\\\">'+selCount+'</span>':'')+'</div>';",
  "  h+='<button class=\\\"link\\\" data-act=\\\"all-proj\\\" data-src=\\\"'+m.source+'\\\">'+(allSel?'Deselect all':'Select all')+'</button></div>';",
  "  if(m.projects.length>6){ h+='<input class=\\\"search\\\" data-search=\\\"'+m.source+'\\\" type=\\\"text\\\" placeholder=\\\"Search '+esc(m.projectLabel.toLowerCase())+'\\\" value=\\\"'+esc(state.search[m.source]||'')+'\\\" />'; }",
  "  h+='<div class=\\\"opt-scroll\\\">';",
  "  if(visible.length===0){ h+='<div class=\\\"empty-opt\\\">No matches.</div>'; }",
  "  visible.forEach(function(p){",
  "    var checked=!!sel[p.id]; var branches=projBranches(m.source,p.id); var prios=m.priorities||[];",
  "    var hasNest=branches.length>0||prios.length>0; var pexp=state.expProject===(m.source+':'+p.id);",
  "    h+='<div><div class=\\\"row\\\"><button class=\\\"opt\\\" data-act=\\\"toggle-proj\\\" data-src=\\\"'+m.source+'\\\" data-id=\\\"'+esc(p.id)+'\\\">'+box(checked,'sm')+'<span class=\\\"tx mono\\\">'+esc(p.label)+'</span></button>';",
  "    if(hasNest&&checked){ h+='<button class=\\\"gear\\\" data-act=\\\"exp-proj\\\" data-src=\\\"'+m.source+'\\\" data-id=\\\"'+esc(p.id)+'\\\" title=\\\"Branches and priority\\\"><span class=\\\"chev'+(pexp?' open':'')+'\\\" style=\\\"display:block;width:14px;height:14px\\\">'+CHEV+'</span></button>'; }",
  "    h+='</div>';",
  "    if(hasNest&&checked&&pexp){ h+='<div class=\\\"nest\\\">';",
  "      if(branches.length>0){ h+='<div class=\\\"micro-title\\\">Branch</div>'; var def=defBranch(m.source,p.id);",
  "        branches.forEach(function(b){ var bc=!!f.branches[b.value]; h+='<button class=\\\"opt\\\" data-act=\\\"toggle-branch\\\" data-src=\\\"'+m.source+'\\\" data-val=\\\"'+esc(b.value)+'\\\">'+box(bc,'sm radio')+'<span class=\\\"tx mono\\\">'+esc(b.label)+'</span>'+(b.value===def?'<span class=\\\"tag\\\">default</span>':'')+'</button>'; }); }",
  "      if(prios.length>0){ h+='<div class=\\\"micro-title\\\">Priority</div>';",
  "        prios.forEach(function(pr){ var pc=!!f.priorities[pr.value]; h+='<button class=\\\"opt\\\" data-act=\\\"toggle-prio\\\" data-src=\\\"'+m.source+'\\\" data-val=\\\"'+esc(pr.value)+'\\\">'+box(pc,'sm')+'<span class=\\\"tx\\\">'+esc(pr.label)+'</span></button>'; }); }",
  "      h+='</div>'; }",
  "    h+='</div>';",
  "  });",
  "  h+='</div></div>'; return h;",
  "}",
  "",
  "function renderEvents(m){",
  "  var f=fobj(m.source); var sel=f.eventTypes; var c=on(sel).length;",
  "  var allSel=m.eventTypes.length>0 && m.eventTypes.every(function(e){return sel[e.value];});",
  "  var h='<div class=\\\"sect\\\"><div class=\\\"sect-head\\\"><div class=\\\"sect-title\\\">Event types'+(c>0?'<span class=\\\"pill\\\">'+c+'</span>':'')+'</div>';",
  "  h+='<button class=\\\"link\\\" data-act=\\\"all-evt\\\" data-src=\\\"'+m.source+'\\\">'+(allSel?'Deselect all':'Select all')+'</button></div><div class=\\\"opt-scroll\\\">';",
  "  m.eventTypes.forEach(function(e){ var ec=!!sel[e.value]; h+='<button class=\\\"opt\\\" data-act=\\\"toggle-evt\\\" data-src=\\\"'+m.source+'\\\" data-val=\\\"'+esc(e.value)+'\\\">'+box(ec,'sm')+'<span class=\\\"tx\\\">'+esc(e.label)+'</span></button>'; });",
  "  h+='</div></div>'; return h;",
  "}",
  "",
  "function render(){",
  "  var total=srcList().length + MODEL.reduce(function(a,m){return a+count(m.source);},0);",
  "  var allSrc = ENABLED.length>0 && ENABLED.every(function(m){return state.selected[m.source];});",
  "  var h='<div class=\\\"list-head\\\"><span class=\\\"lbl\\\">Sources and filters</span>'+(total>0?'<button class=\\\"link danger\\\" data-act=\\\"clear\\\">Clear all</button>':'')+'</div>';",
  "  h+='<div class=\\\"row\\\"><button class=\\\"row-btn\\\" data-act=\\\"all-sources\\\">'+box(allSrc,'')+'<span class=\\\"nm\\\" style=\\\"font-weight:600\\\">All sources</span></button></div>';",
  "  if(MODEL.length===0){ h+='<div class=\\\"empty\\\">No connected sources for this project.</div>'; document.getElementById('list').innerHTML=h; return; }",
  "  MODEL.forEach(function(m){",
  "    if(m.disabled){",
  "      h+='<div><div class=\\\"row\\\"><span class=\\\"row-btn dis\\\">'+box(false,'')+'<img class=\\\"ic\\\" src=\\\"'+esc(m.icon)+'\\\" alt=\\\"\\\"/><span class=\\\"nm\\\">'+esc(m.name)+'</span></span></div>';",
  "      if(m.disabledNote){ h+='<div class=\\\"row-note\\\">'+esc(m.disabledNote)+'</div>'; }",
  "      h+='</div>'; return;",
  "    }",
  "    var selected=!!state.selected[m.source]; var exp=state.expSource===m.source;",
  "    var hasOpts=(m.projects.length>0)||(m.eventTypes.length>0); var c=count(m.source);",
  "    h+='<div><div class=\\\"row\\\"><button class=\\\"row-btn\\\" data-act=\\\"toggle-source\\\" data-src=\\\"'+m.source+'\\\">'+box(selected,'')+'<img class=\\\"ic\\\" src=\\\"'+esc(m.icon)+'\\\" alt=\\\"\\\"/><span class=\\\"nm\\\">'+esc(m.name)+'</span></button>';",
  "    if(hasOpts){ h+='<button class=\\\"gear\\\" data-act=\\\"exp-source\\\" data-src=\\\"'+m.source+'\\\" title=\\\"Filter options\\\">'+GEAR+(c>0?'<span class=\\\"badge\\\">'+c+'</span>':'')+'</button>'; }",
  "    h+='</div>';",
  "    if(exp){ h+='<div class=\\\"expand\\\">';",
  "      if(m.projects.length>0){ h+=renderResources(m); }",
  "      if(m.eventTypes.length>0){ h+=renderEvents(m); }",
  "      if(!hasOpts){ h+='<div class=\\\"empty-opt\\\">No filter options available yet.</div>'; }",
  "      h+='</div>'; }",
  "    h+='</div>';",
  "  });",
  "  document.getElementById('list').innerHTML=h;",
  "  if(state.activeSearch){ var inp=document.querySelector('[data-search=\\\"'+state.activeSearch+'\\\"]'); if(inp){ inp.focus(); var v=inp.value; inp.value=''; inp.value=v; } }",
  "}",
  "",
  "function toggleSource(src){ if(bySrc[src]&&bySrc[src].disabled) return; if(state.selected[src]){ delete state.selected[src]; delete state.filters[src]; if(state.expSource===src) state.expSource=null; } else { state.selected[src]=true; } }",
  "function toggleProj(src,id){ var f=fobj(src); if(f.projects[id]){ delete f.projects[id]; var bp=bySrc[src].branchesByProject||{}; var removed=(bp[String(id).trim().toLowerCase()]||[]).map(function(b){return b.value;}); var stillCovered={}; on(f.projects).forEach(function(pid){ (bp[String(pid).trim().toLowerCase()]||[]).forEach(function(b){stillCovered[b.value]=true;}); }); removed.forEach(function(bv){ if(!stillCovered[bv]) delete f.branches[bv]; }); } else { f.projects[id]=true; ensureSel(src); } }",
  "function toggleEvt(src,v){ var f=fobj(src); if(f.eventTypes[v]) delete f.eventTypes[v]; else { f.eventTypes[v]=true; ensureSel(src); } }",
  "function toggleBranch(src,v){ var f=fobj(src); ensureSel(src); var was=!!f.branches[v]; f.branches={}; if(!was) f.branches[v]=true; }",
  "function togglePrio(src,v){ var f=fobj(src); if(f.priorities[v]) delete f.priorities[v]; else { f.priorities[v]=true; ensureSel(src); } }",
  "function allProj(src){ var m=bySrc[src]; var f=fobj(src); var allSel=m.projects.every(function(p){return f.projects[p.id];}); if(allSel){ f.projects={}; } else { ensureSel(src); m.projects.forEach(function(p){f.projects[p.id]=true;}); } }",
  "function allEvt(src){ var m=bySrc[src]; var f=fobj(src); var allSel=m.eventTypes.every(function(e){return f.eventTypes[e.value];}); if(allSel){ f.eventTypes={}; } else { ensureSel(src); m.eventTypes.forEach(function(e){f.eventTypes[e.value]=true;}); } }",
  "",
  "document.getElementById('list').addEventListener('click', function(e){",
  "  var t=e.target.closest('[data-act]'); if(!t) return; var act=t.getAttribute('data-act'); var src=t.getAttribute('data-src'); var id=t.getAttribute('data-id'); var val=t.getAttribute('data-val'); state.activeSearch=null;",
  "  if(act==='all-sources'){ var all=ENABLED.every(function(m){return state.selected[m.source];}); if(all){ state.selected={}; state.filters={}; } else { state.selected={}; ENABLED.forEach(function(m){state.selected[m.source]=true;}); } }",
  "  else if(act==='clear'){ state.selected={}; state.filters={}; state.expSource=null; state.expProject=null; }",
  "  else if(act==='toggle-source'){ toggleSource(src); }",
  "  else if(act==='exp-source'){ state.expSource = state.expSource===src?null:src; }",
  "  else if(act==='toggle-proj'){ toggleProj(src,id); }",
  "  else if(act==='exp-proj'){ var key=src+':'+id; state.expProject = state.expProject===key?null:key; }",
  "  else if(act==='toggle-branch'){ toggleBranch(src,val); }",
  "  else if(act==='toggle-prio'){ togglePrio(src,val); }",
  "  else if(act==='toggle-evt'){ toggleEvt(src,val); }",
  "  else if(act==='all-proj'){ allProj(src); }",
  "  else if(act==='all-evt'){ allEvt(src); }",
  "  render();",
  "});",
  "",
  "document.getElementById('list').addEventListener('input', function(e){ var inp=e.target.closest('[data-search]'); if(!inp) return; var src=inp.getAttribute('data-search'); state.search[src]=inp.value; state.activeSearch=src; render(); });",
  "",
  "document.getElementById('cancel').addEventListener('click', function(){ vscodeApi.postMessage({type:'cancel'}); });",
  "document.getElementById('generate').addEventListener('click', function(){",
  "  var sources=srcList(); var filters={};",
  "  Object.keys(state.filters).forEach(function(src){ var f=state.filters[src]; var out={}; var pr=on(f.projects); var ev=on(f.eventTypes); var br=on(f.branches); var pri=on(f.priorities); if(pr.length) out.projects=pr; if(ev.length) out.eventTypes=ev; if(br.length) out.branches=br; if(pri.length) out.priorities=pri; if(Object.keys(out).length) filters[src]=out; });",
  "  vscodeApi.postMessage({type:'generate', sources:sources, filters:filters});",
  "});",
  "",
  "render();",
  "})();",
].join('\n');
