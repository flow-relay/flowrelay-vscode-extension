(function () {
  'use strict';
  var vscode = acquireVsCodeApi();
  var script = document.currentScript;
  var MARK_LIGHT = script.getAttribute('data-mark-light');
  var MARK_DARK = script.getAttribute('data-mark-dark');
  var app = document.getElementById('app');

  var TIERS = [
    { id: 'auto', label: 'Auto', hint: 'Pick the lightest tier that can answer' },
    { id: 'quick', label: 'Quick', hint: 'Answer from this thread' },
    { id: 'standard', label: 'Search', hint: 'Search the project' },
    { id: 'deep', label: 'Deep', hint: 'A longer analysis (slower)' }
  ];
  var TIER_NAMES = { quick: 'Quick', standard: 'Search', deep: 'Deep' };
  var EXAMPLES = [
    'What changed in this project in the last two weeks?',
    'Which work items are blocked, and why?',
    'What did the last handoff decide?'
  ];
  var isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');

  var state = { hasKey: false, project: null, busy: false, activeThreadId: null, threads: [], turns: [], lastTurn: null };
  var draft = { tier: 'auto', text: '' };
  var live = null;
  var statusText = '';

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function button(cls, label, onClick, aria) {
    var b = el('button', cls, label);
    b.type = 'button';
    if (aria) Object.keys(aria).forEach(function (k) { b.setAttribute(k, aria[k]); });
    b.addEventListener('click', onClick);
    return b;
  }

  function mark() {
    var wrap = el('span', 'mark');
    var light = document.createElement('img');
    light.className = 'img-light';
    light.src = MARK_LIGHT;
    light.alt = '';
    var dark = document.createElement('img');
    dark.className = 'img-dark';
    dark.src = MARK_DARK;
    dark.alt = '';
    wrap.appendChild(light);
    wrap.appendChild(dark);
    return wrap;
  }

  function wordmark() {
    var w = el('span', 'wordmark');
    w.appendChild(el('span', 'wm-flow', 'Flow'));
    w.appendChild(el('span', 'wm-relay', 'Relay'));
    w.appendChild(el('span', 'wm-dot', '.'));
    return w;
  }

  function post(message) {
    vscode.postMessage(message);
  }

  function sourcesNode(sources) {
    if (!sources || sources.length === 0) return null;
    var wrap = el('div', 'sources');
    wrap.setAttribute('role', 'list');
    wrap.setAttribute('aria-label', 'Sources');
    sources.forEach(function (s) {
      var label = s.n + '  ' + s.title;
      var chip;
      if (s.url) {
        chip = button('chip', '', function () { post({ type: 'open', url: s.url }); }, { 'aria-label': 'Open source ' + s.n + ': ' + s.title });
      } else {
        chip = el('span', 'chip static');
        chip.setAttribute('title', 'This source has no link');
      }
      chip.setAttribute('role', 'listitem');
      chip.appendChild(el('span', 'chip-n', String(s.n)));
      chip.appendChild(el('span', 'chip-t', s.title));
      if (s.source) chip.appendChild(el('span', 'chip-s', s.source));
      chip.setAttribute('data-label', label);
      wrap.appendChild(chip);
    });
    return wrap;
  }

  function answerCard(html, sources, tier, extra) {
    var card = el('div', 'answer');
    var body = el('div', 'md');
    body.innerHTML = html;
    card.appendChild(body);
    var s = sourcesNode(sources);
    if (s) card.appendChild(s);
    if (tier && TIER_NAMES[tier]) card.appendChild(el('div', 'tier', TIER_NAMES[tier]));
    if (extra) card.appendChild(extra);
    return card;
  }

  function userBubble(question) {
    var b = el('div', 'user');
    b.appendChild(el('div', 'who', 'You'));
    b.appendChild(el('div', 'q', question));
    return b;
  }

  function renderTurns(container) {
    state.turns.forEach(function (t) {
      var turn = el('section', 'turn');
      turn.appendChild(userBubble(t.question));
      turn.appendChild(answerCard(t.html, t.sources, t.tier));
      container.appendChild(turn);
    });
    var last = state.lastTurn;
    if (last) {
      var turn2 = el('section', 'turn');
      turn2.appendChild(userBubble(last.question));
      var note = null;
      if (last.error) {
        note = el('div', 'error');
        note.setAttribute('role', 'alert');
        note.textContent = last.error;
      } else if (last.stopped) {
        note = el('div', 'stopped', 'Stopped before the answer finished.');
      }
      turn2.appendChild(answerCard(last.html || '', last.sources, last.tier, note));
      container.appendChild(turn2);
    }
  }

  function renderLive(container) {
    if (!live) return;
    var turn = el('section', 'turn');
    turn.appendChild(userBubble(live.question));
    var tools = el('ul', 'tools');
    tools.setAttribute('aria-label', 'Steps');
    live.toolOrder.forEach(function (id) {
      var t = live.tools[id];
      var li = el('li', 'tool ' + t.state);
      li.appendChild(el('span', 'dot'));
      li.appendChild(el('span', 'tool-l', t.label));
      if (t.summary) li.appendChild(el('span', 'tool-s', t.summary));
      tools.appendChild(li);
    });
    if (live.toolOrder.length) turn.appendChild(tools);
    live.notices.forEach(function (n) {
      var box = el('div', 'notice ' + n.kind);
      box.setAttribute('role', 'group');
      box.setAttribute('aria-label', n.title);
      box.appendChild(el('div', 'notice-t', n.title));
      box.appendChild(el('div', 'notice-x', n.text));
      var actions = el('div', 'notice-a');
      actions.appendChild(button('btn secondary', 'Open project', function () { post({ type: 'openProject' }); }));
      box.appendChild(actions);
      turn.appendChild(box);
    });
    var card = el('div', 'answer');
    var body = el('div', 'md');
    body.id = 'live-answer';
    body.innerHTML = live.html;
    card.appendChild(body);
    if (!live.html) card.appendChild(el('div', 'thinking', statusText || 'Working on it'));
    turn.appendChild(card);
    container.appendChild(turn);
  }

  function emptyState(container) {
    var box = el('div', 'empty');
    if (!state.hasKey) {
      box.appendChild(el('h2', null, 'Connect Flow Relay'));
      box.appendChild(el('p', null, 'Set your API key to ask questions about your projects.'));
      box.appendChild(button('btn primary', 'Set API key', function () { post({ type: 'setApiKey' }); }));
    } else if (!state.project) {
      box.appendChild(el('h2', null, 'Choose a project'));
      box.appendChild(el('p', null, 'Flow Relay answers from the project you pick.'));
      box.appendChild(button('btn primary', 'Choose project', function () { post({ type: 'chooseProject' }); }));
    } else {
      box.appendChild(el('h2', null, 'Ask ' + state.project.name));
      box.appendChild(el('p', null, 'Answers come with the events they were built from. Try one of these.'));
      var list = el('div', 'examples');
      EXAMPLES.forEach(function (q) {
        list.appendChild(button('example', q, function () {
          draft.text = q;
          render();
          var ta = document.getElementById('composer');
          if (ta) ta.focus();
        }));
      });
      box.appendChild(list);
    }
    container.appendChild(box);
  }

  function threadList() {
    var aside = el('aside', 'threads');
    aside.setAttribute('aria-label', 'Threads');
    var head = el('div', 'threads-head');
    head.appendChild(el('span', 'lbl', 'Threads'));
    var newBtn = button('link', 'New thread', function () { post({ type: 'newThread' }); });
    newBtn.disabled = state.busy;
    head.appendChild(newBtn);
    aside.appendChild(head);
    var ul = el('ul', 'thread-list');
    if (state.threads.length === 0) ul.appendChild(el('li', 'none', 'No threads yet.'));
    state.threads.forEach(function (t) {
      var li = el('li', 'thread' + (t.id === state.activeThreadId ? ' active' : ''));
      var open = button('thread-open', t.title || 'Untitled', function () { post({ type: 'openThread', id: t.id }); }, t.id === state.activeThreadId ? { 'aria-current': 'true' } : null);
      open.disabled = state.busy;
      open.title = t.title;
      var del = button('thread-del', 'Delete', function () { post({ type: 'deleteThread', id: t.id }); }, { 'aria-label': 'Delete thread ' + (t.title || 'Untitled') });
      del.disabled = state.busy;
      li.appendChild(open);
      li.appendChild(del);
      ul.appendChild(li);
    });
    aside.appendChild(ul);
    return aside;
  }

  function composer() {
    var form = el('div', 'composer');
    var ta = document.createElement('textarea');
    ta.id = 'composer';
    ta.rows = 3;
    ta.value = draft.text;
    ta.placeholder = 'Ask about this project';
    ta.setAttribute('aria-label', 'Question');
    ta.maxLength = 4000;
    ta.addEventListener('input', function () { draft.text = ta.value; if (!state.busy) sendBtn.disabled = !canSend(); });
    form.appendChild(ta);

    var row = el('div', 'composer-row');
    var group = el('div', 'tiers');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', 'Answer depth');
    TIERS.forEach(function (t) {
      var on = draft.tier === t.id;
      var b = button('tier-btn' + (on ? ' on' : ''), t.label, function () { draft.tier = t.id; render(); }, { role: 'radio', 'aria-checked': String(on), title: t.hint });
      b.disabled = state.busy;
      group.appendChild(b);
    });
    row.appendChild(group);
    row.appendChild(el('span', 'hint', (isMac ? 'Cmd' : 'Ctrl') + '+Enter to send, Esc to ' + (state.busy ? 'stop' : 'clear')));
    var sendBtn;
    if (state.busy) {
      sendBtn = button('btn secondary', 'Stop', function () { post({ type: 'cancel' }); });
    } else {
      sendBtn = button('btn primary', 'Ask', submit);
      sendBtn.disabled = !canSend();
    }
    row.appendChild(sendBtn);
    form.appendChild(row);
    return form;
  }

  function canSend() {
    return !state.busy && state.hasKey && !!state.project && draft.text.trim().length > 0;
  }

  function submit() {
    if (!canSend()) return;
    var q = draft.text.trim();
    draft.text = '';
    post({ type: 'send', question: q, tier: draft.tier });
  }

  function render() {
    var keepScroll = document.getElementById('scroller');
    var atBottom = !keepScroll || keepScroll.scrollHeight - keepScroll.scrollTop - keepScroll.clientHeight < 40;
    var hadFocus = document.activeElement && document.activeElement.id === 'composer';
    var selStart = hadFocus ? document.activeElement.selectionStart : 0;

    app.textContent = '';
    var header = el('header', 'top');
    var brand = el('div', 'brand');
    brand.appendChild(mark());
    brand.appendChild(wordmark());
    header.appendChild(brand);
    var proj = el('div', 'proj');
    if (state.project) {
      proj.appendChild(el('span', 'proj-n', state.project.name));
      var change = button('link', 'Change', function () { post({ type: 'chooseProject' }); });
      change.disabled = state.busy;
      proj.appendChild(change);
    }
    header.appendChild(proj);
    app.appendChild(header);

    var status = el('div', 'sr-only');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.id = 'status';
    status.textContent = statusText;
    app.appendChild(status);

    var layout = el('div', 'layout');
    if (state.hasKey && state.project) layout.appendChild(threadList());
    var main = el('main', 'main');
    var scroller = el('div', 'scroller');
    scroller.id = 'scroller';
    scroller.setAttribute('role', 'log');
    scroller.setAttribute('aria-label', 'Conversation');
    scroller.tabIndex = 0;
    if (state.turns.length === 0 && !state.lastTurn && !live) emptyState(scroller);
    renderTurns(scroller);
    renderLive(scroller);
    main.appendChild(scroller);
    if (state.hasKey && state.project) main.appendChild(composer());
    layout.appendChild(main);
    app.appendChild(layout);

    if (atBottom) scroller.scrollTop = scroller.scrollHeight;
    else if (keepScroll) scroller.scrollTop = keepScroll.scrollTop;
    if (hadFocus) {
      var ta = document.getElementById('composer');
      if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = selStart; }
    }
  }

  function updateLiveAnswer() {
    var body = document.getElementById('live-answer');
    if (!body || !live) { render(); return; }
    body.innerHTML = live.html;
    var sc = document.getElementById('scroller');
    if (sc && sc.scrollHeight - sc.scrollTop - sc.clientHeight < 80) sc.scrollTop = sc.scrollHeight;
  }

  window.addEventListener('message', function (event) {
    var m = event.data;
    if (!m || typeof m.type !== 'string') return;
    switch (m.type) {
      case 'state':
        state = {
          hasKey: !!m.hasKey, project: m.project, busy: !!m.busy, activeThreadId: m.activeThreadId,
          threads: m.threads || [], turns: m.turns || [], lastTurn: m.lastTurn || null
        };
        if (!state.busy) live = null;
        statusText = '';
        render();
        break;
      case 'turnStart':
        state.busy = true;
        state.lastTurn = null;
        live = { question: m.question, html: '', tools: {}, toolOrder: [], notices: [] };
        statusText = 'Working on it';
        render();
        break;
      case 'status':
        statusText = m.text;
        var s = document.getElementById('status');
        if (s) s.textContent = m.text;
        if (live && !live.html) { var th = document.querySelector('.thinking'); if (th) th.textContent = m.text; }
        break;
      case 'tool':
        if (!live) break;
        if (!live.tools[m.id]) live.toolOrder.push(m.id);
        live.tools[m.id] = { label: m.label, state: m.state, summary: m.summary };
        render();
        break;
      case 'answer':
        if (!live) break;
        var first = !live.html;
        live.html = m.html;
        if (first) render(); else updateLiveAnswer();
        break;
      case 'notice':
        if (!live) break;
        live.notices.push(m);
        render();
        break;
      case 'turnEnd':
        statusText = m.status === 'completed' ? 'Answer ready.' : (m.error || 'Stopped.');
        if (!live) { var s2 = document.getElementById('status'); if (s2) s2.textContent = statusText; break; }
        live.html = m.html;
        var se = document.getElementById('status');
        if (se) se.textContent = statusText;
        break;
      default:
        break;
    }
  });

  document.addEventListener('click', function (event) {
    var a = event.target && event.target.closest ? event.target.closest('a[data-url]') : null;
    if (!a) return;
    event.preventDefault();
    post({ type: 'open', url: a.getAttribute('data-url') });
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit();
    } else if (event.key === 'Escape') {
      if (state.busy) {
        event.preventDefault();
        post({ type: 'cancel' });
      } else if (draft.text) {
        event.preventDefault();
        draft.text = '';
        render();
      }
    }
  });

  render();
  post({ type: 'ready' });
})();
