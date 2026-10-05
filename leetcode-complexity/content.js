// Complexity Buddy — floating widget for LeetCode / NeetCode.
//   idle   : a cute round buddy docked to the left/right edge (drag to move)
//   hover  : peek panel with time & space complexity
//   click  : pin the panel open  (click again, or "−", to tuck it away)
(() => {
  'use strict';
  if (window.top !== window || document.getElementById('lcx-host')) return;

  const DEFAULT_MODEL = 'openai/gpt-oss-120b';
  const MODEL_SUGGESTIONS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'];
  const RETIRED_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
  const UI_KEY = 'lcxUi';
  const EDGE = 10;          // gap between buddy and screen edge
  const HOVER_OPEN_MS = 140;
  const HOVER_CLOSE_MS = 380;
  const POLL_MS = 1500;

  const state = {
    side: 'right',
    y: Math.round(window.innerHeight * 0.4),
    pinned: false,
    open: false,
    hasKey: false,
    model: DEFAULT_MODEL,
    targets: {}, // slug -> { time, space, how }: the optimal we already established per problem
    auto: false,
  };

  // ---------- storage ----------
  const alive = () => !!(chrome.runtime && chrome.runtime.id);
  const store = {
    get: (keys) => new Promise((res) => { try { chrome.storage.local.get(keys, (v) => res(v || {})); } catch { res({}); } }),
    set: (obj) => new Promise((res) => { try { chrome.storage.local.set(obj, res); } catch { res(); } }),
    remove: (keys) => new Promise((res) => { try { chrome.storage.local.remove(keys, res); } catch { res(); } }),
  };
  const persistUi = () => store.set({ [UI_KEY]: { side: state.side, y: state.y, pinned: state.pinned } });

  // ---------- markup ----------
  const ICON_REFRESH = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.5 2.5v3h-3"/></svg>';
  const ICON_SLIDERS = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 4.5h6M12 4.5h2M2 11.5h2M7 11.5h7"/><circle cx="10" cy="4.5" r="1.6"/><circle cx="5.5" cy="11.5" r="1.6"/></svg>';
  const ICON_MINUS = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3.5 8h9"/></svg>';

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    button, input { font: inherit; }

    .widget {
      position: fixed; left: 0; top: 0; width: max-content; z-index: 2147483647;
      font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #e8ecf1; -webkit-font-smoothing: antialiased;
      visibility: hidden;
    }
    .widget.ready { visibility: visible; }
    .col { display: flex; flex-direction: column; align-items: center; gap: 5px; touch-action: none; user-select: none; -webkit-user-select: none; }
    .ready .col { animation: pop .55s cubic-bezier(.3,1.6,.5,1) both; }

    /* ---------- the buddy ---------- */
    .buddy {
      --c1: #a78bfa; --c2: #60a5fa;
      position: relative; width: 48px; height: 48px; padding: 0; border-radius: 50%; cursor: grab;
      border: 2px solid rgba(255,255,255,.9);
      background: linear-gradient(135deg, var(--c1), var(--c2));
      box-shadow: 0 6px 18px rgba(0,0,0,.35), inset 0 -5px 9px rgba(0,0,0,.14);
      transition: transform .18s cubic-bezier(.3,1.6,.5,1), box-shadow .18s;
    }
    .buddy[data-g="good"] { --c1: #34d399; --c2: #22d3ee; }
    .buddy[data-g="ok"]   { --c1: #fbbf24; --c2: #fb923c; }
    .buddy[data-g="bad"]  { --c1: #fb7185; --c2: #f43f5e; }
    .buddy:hover { transform: scale(1.09); box-shadow: 0 8px 22px rgba(0,0,0,.4), inset 0 -5px 9px rgba(0,0,0,.14); }
    .buddy:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
    .dragging .buddy { cursor: grabbing; transform: scale(1.12); }
    .face { display: block; animation: bob 3.4s ease-in-out infinite; }
    .open .face, .dragging .face { animation: none; }
    .eye { transform-box: fill-box; transform-origin: center; animation: blink 5.2s infinite; }
    .busy .eyes { animation: look 1s ease-in-out infinite; }
    .mouth { fill: none; stroke: #1f2937; stroke-width: 2.4; stroke-linecap: round; display: none; }
    .m-na, .sweat { display: none; }
    .buddy[data-g="na"] .m-na { display: inline; }
    .buddy[data-g="good"] .m-good, .buddy[data-g="ok"] .m-ok, .buddy[data-g="bad"] .m-bad { display: inline; }
    .buddy[data-g="bad"] .sweat { display: inline; }
    .ring { position: absolute; inset: -5px; border-radius: 50%; border: 2.5px solid transparent; border-top-color: rgba(255,255,255,.95); opacity: 0; pointer-events: none; }
    .busy .ring { opacity: 1; animation: spin .8s linear infinite; }

    .badge {
      display: grid; gap: 1px; padding: 3px 8px; border-radius: 10px; pointer-events: none;
      background: rgba(20,22,28,.94); border: 1px solid rgba(255,255,255,.12);
      box-shadow: 0 4px 12px rgba(0,0,0,.3);
      font: 600 10.5px/1.25 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: nowrap;
    }
    .badge i { font-style: normal; color: #7b8494; margin-right: 5px; }

    /* ---------- panel (floats beside the buddy, toward screen centre) ---------- */
    .panel-wrap { position: absolute; top: 0; width: max-content; padding: 0 10px; }
    .side-right .panel-wrap { right: 100%; }
    .side-left  .panel-wrap { left: 100%; }
    .panel {
      width: 330px; max-height: min(74vh, 600px); display: flex; flex-direction: column; overflow: hidden;
      background: rgba(22,24,30,.97); border: 1px solid rgba(255,255,255,.1); border-radius: 14px;
      box-shadow: 0 18px 50px rgba(0,0,0,.5);
      animation: slide .16s ease-out both;
    }
    .side-right .panel { transform-origin: right top; }
    .side-left  .panel { transform-origin: left top; }
    header { display: flex; align-items: center; gap: 2px; padding: 8px 8px 8px 14px; cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; background: rgba(255,255,255,.035); border-bottom: 1px solid rgba(255,255,255,.07); }
    .dragging header { cursor: grabbing; }
    .title { font-weight: 650; font-size: 13px; letter-spacing: .01em; }
    .spacer { flex: 1; }
    .hbtn { display: grid; place-items: center; width: 26px; height: 26px; border: 0; border-radius: 7px; background: transparent; color: #a3acbb; cursor: pointer; }
    .hbtn:hover { background: rgba(255,255,255,.1); color: #fff; }
    .body { padding: 12px; overflow: auto; display: flex; flex-direction: column; gap: 10px; }
    #vMain, #vSet { display: flex; flex-direction: column; gap: 10px; }

    .src { font-size: 11px; color: #8b94a4; min-height: 15px; }
    #result { display: flex; flex-direction: column; gap: 8px; transition: opacity .15s; }
    .loading #result { opacity: .5; }
    .card { --c: #94a3b8; padding: 9px 12px 10px; border-radius: 10px; background: rgba(255,255,255,.05); border-left: 3px solid var(--c); }
    .card.good { --c: #4ade80; } .card.ok { --c: #fbbf24; } .card.bad { --c: #f87171; }
    .card .k { font-size: 10.5px; letter-spacing: .09em; text-transform: uppercase; color: #8b94a4; }
    .card .v { font: 700 19px/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--c); word-break: break-word; }
    .card .why { margin-top: 2px; font-size: 12px; color: #b4bccb; }
    .card.target { --c: #38bdf8; }
    .target .thead { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .target .chip { text-transform: none; letter-spacing: 0; font-size: 10.5px; font-weight: 600; padding: 1px 8px; border-radius: 999px; white-space: nowrap; }
    .target.hit .chip { background: rgba(74,222,128,.16); color: #4ade80; }
    .target.gap .chip { background: rgba(251,191,36,.16); color: #fbbf24; }
    .target .v { font-size: 15px; }
    .badge.hit { border-color: rgba(74,222,128,.6); }
    .note { font-size: 12px; color: #b4bccb; padding: 0 2px; }
    .note b { color: #e8ecf1; font-weight: 600; margin-right: 4px; }
    .note.tip b { color: #7dd3fc; }
    .skel { height: 66px; border-radius: 10px; background: linear-gradient(100deg, rgba(255,255,255,.04) 30%, rgba(255,255,255,.1) 50%, rgba(255,255,255,.04) 70%); background-size: 200% 100%; animation: shimmer 1.2s linear infinite; }
    .err { padding: 10px 12px; border-radius: 10px; background: rgba(248,113,113,.12); border: 1px solid rgba(248,113,113,.3); color: #fecaca; font-size: 12.5px; }
    .empty { padding: 14px 4px; text-align: center; color: #98a1b1; font-size: 12.5px; }

    .live { display: flex; align-items: center; gap: 9px; font-size: 12px; color: #aab3c2; cursor: pointer; user-select: none; -webkit-user-select: none; }
    .live input { position: absolute; opacity: 0; pointer-events: none; }
    .sw { position: relative; width: 28px; height: 16px; border-radius: 9px; background: rgba(255,255,255,.18); transition: background .15s; flex: none; }
    .sw::after { content: ""; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: #fff; transition: transform .15s; }
    .live input:checked + .sw { background: #34d399; }
    .live input:checked + .sw::after { transform: translateX(12px); }
    .live input:focus-visible + .sw { outline: 2px solid #7dd3fc; outline-offset: 2px; }

    footer { display: flex; justify-content: space-between; gap: 10px; padding: 7px 14px 9px; font-size: 10.5px; color: #6f7888; border-top: 1px solid rgba(255,255,255,.06); }

    footer span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    footer span:last-child { white-space: nowrap; }
    .fl { font-size: 11.5px; color: #aab3c2; display: flex; justify-content: space-between; margin-bottom: -4px; }
    .fl a { color: #7dd3fc; text-decoration: none; } .fl a:hover { text-decoration: underline; }
    input[type="password"], input[type="text"] { width: 100%; padding: 8px 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(0,0,0,.28); color: #f1f5f9; outline: none; }
    input[type="password"]:focus, input[type="text"]:focus { border-color: #60a5fa; }
    .hint { font-size: 11.5px; color: #8b94a4; margin-top: -4px; }
    .hint.ok { color: #4ade80; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; }
    .btn { padding: 7px 14px; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #e8ecf1; cursor: pointer; font-weight: 550; }
    .btn:hover { background: rgba(255,255,255,.12); }
    .btn.primary { border: 0; color: #06241b; background: linear-gradient(135deg, #34d399, #22d3ee); }
    .btn.primary:hover { filter: brightness(1.08); }
    .btn:disabled { opacity: .55; cursor: default; }

    .klist { display: flex; flex-direction: column; gap: 6px; }
    .kitem { display: flex; align-items: center; gap: 8px; padding: 5px 5px 5px 10px; border-radius: 8px; background: rgba(255,255,255,.05); font-size: 12px; }
    .knum { width: 10px; text-align: center; color: #6f7888; font-size: 11px; }
    .kdot { width: 8px; height: 8px; border-radius: 50%; background: #4ade80; flex: none; }
    .kdot.rate { background: #fbbf24; } .kdot.invalid { background: #f87171; }
    .kmask { font: 600 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #e8ecf1; }
    .kstat { margin-left: auto; font-size: 11px; color: #8b94a4; white-space: nowrap; }
    .kstat.rate { color: #fbbf24; } .kstat.invalid { color: #f87171; }
    .kdel { min-width: 24px; height: 24px; padding: 0 6px; border: 0; border-radius: 6px; background: transparent; color: #8b94a4; font-size: 15px; line-height: 1; cursor: pointer; }
    .kdel:hover { background: rgba(255,255,255,.1); color: #fff; }
    .kdel.armed { background: rgba(248,113,113,.18); color: #fca5a5; font-size: 11px; font-weight: 600; }
    .knone { padding: 4px 2px; font-size: 12px; color: #98a1b1; }
    .addrow { display: flex; gap: 8px; }
    .addrow input { flex: 1; min-width: 0; }
    .hint.err { color: #fca5a5; }
    .saved { color: #4ade80; }
    .selwrap { position: relative; }
    .selwrap::after { content: ""; position: absolute; right: 13px; top: 50%; width: 6px; height: 6px; border-right: 1.6px solid #aab3c2; border-bottom: 1.6px solid #aab3c2; transform: translateY(-70%) rotate(45deg); pointer-events: none; }
    select { width: 100%; padding: 8px 30px 8px 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(0,0,0,.28); color: #f1f5f9; outline: none; cursor: pointer; font-size: 13px; appearance: none; -webkit-appearance: none; }
    select:focus { border-color: #60a5fa; }
    select option { background: #1b1e26; color: #f1f5f9; }
    .btn.danger { color: #fca5a5; margin-left: auto; }

    @keyframes pop { from { opacity: 0; transform: scale(.4); } to { opacity: 1; transform: scale(1); } }
    @keyframes slide { from { opacity: 0; transform: scale(.95) translateY(-4px); } to { opacity: 1; transform: none; } }
    @keyframes bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-2px); } }
    @keyframes blink { 0%, 93%, 100% { transform: scaleY(1); } 96% { transform: scaleY(.1); } }
    @keyframes look { 0%, 100% { transform: translateX(-2px); } 50% { transform: translateX(2px); } }
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes shimmer { to { background-position: -200% 0; } }
    @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
  `;

  const host = document.createElement('div');
  host.id = 'lcx-host';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>${CSS}</style>
    <div class="widget side-right" id="w">
      <div class="panel-wrap" id="pw" hidden>
        <section class="panel" id="panel" role="dialog" aria-label="Code complexity">
          <header id="head">
            <span class="title">Complexity</span>
            <span class="spacer"></span>
            <button class="hbtn" id="btnRe" title="Re-analyze" aria-label="Re-analyze">${ICON_REFRESH}</button>
            <button class="hbtn" id="btnSet" title="Settings" aria-label="Settings">${ICON_SLIDERS}</button>
            <button class="hbtn" id="btnMin" title="Minimize" aria-label="Minimize">${ICON_MINUS}</button>
          </header>
          <div class="body">
            <div id="vMain">
              <div class="src" id="src"></div>
              <div id="result"></div>
              <label class="live"><input type="checkbox" id="auto"><span class="sw"></span>Live update while I type</label>
            </div>
            <div id="vSet" hidden>
              <div class="note" id="setNote"></div>
              <div class="fl"><span>Groq API keys</span><a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer">get a free key</a></div>
              <div class="klist" id="keyList"></div>
              <div class="addrow">
                <input id="key" type="password" placeholder="Paste a Groq key (gsk_…)" autocomplete="off" spellcheck="false">
                <button class="btn primary" id="btnAdd">Add</button>
              </div>
              <div class="hint" id="keyMsg"></div>
              <div class="fl"><span>Model</span><span class="saved" id="modelSaved"></span></div>
              <div class="selwrap"><select id="model" aria-label="Model"></select></div>
              <div class="row"><button class="btn" id="btnBack">Done</button></div>
            </div>
          </div>
          <footer><span id="footL"></span><span id="footR"></span></footer>
        </section>
      </div>
      <div class="col" id="col">
        <button class="buddy" id="buddy" data-g="na" aria-label="Complexity buddy: hover to peek, click to pin">
          <svg class="face" viewBox="0 0 48 48" width="44" height="44" aria-hidden="true">
            <g class="eyes">
              <ellipse class="eye" cx="17" cy="21" rx="3.2" ry="4.2" fill="#1f2937"/>
              <ellipse class="eye" cx="31" cy="21" rx="3.2" ry="4.2" fill="#1f2937"/>
              <circle cx="18.1" cy="19.4" r="1.1" fill="#fff"/><circle cx="32.1" cy="19.4" r="1.1" fill="#fff"/>
            </g>
            <ellipse cx="10.5" cy="29" rx="3.6" ry="2.3" fill="#fb7185" opacity=".5"/>
            <ellipse cx="37.5" cy="29" rx="3.6" ry="2.3" fill="#fb7185" opacity=".5"/>
            <path class="mouth m-good" d="M18.5 30 Q24 36.5 29.5 30"/>
            <path class="mouth m-ok" d="M19.5 32.5 H28.5"/>
            <path class="mouth m-bad" d="M18.5 34 Q24 28.5 29.5 34"/>
            <ellipse class="m-na" cx="24" cy="32" rx="2.2" ry="2.7" fill="#1f2937"/>
            <path class="sweat" d="M39 11 q3.2 4.2 0 6.4 q-3.2 -2.2 0 -6.4z" fill="#bae6fd"/>
          </svg>
          <span class="ring"></span>
        </button>
        <div class="badge" id="badge" hidden><span><i>T</i><b id="bT"></b></span><span><i>S</i><b id="bS"></b></span></div>
      </div>
    </div>`;

  const $ = (id) => shadow.getElementById(id);
  const w = $('w'), pw = $('pw'), col = $('col'), head = $('head'), buddy = $('buddy'), badge = $('badge');
  const resultEl = $('result'), srcEl = $('src'), vMain = $('vMain'), vSet = $('vSet');
  const keyIn = $('key'), modelIn = $('model'), autoChk = $('auto');
  const hasRealCode = (c) => (self.lcxHasRealCode ? self.lcxHasRealCode(c) : true); // code-check.js

  // ---------- helpers ----------
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const hashStr = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h) + ':' + s.length; };

  // Cosmetic only: colour a complexity string good / ok / bad.
  function grade(c) {
    const s = String(c || '').toLowerCase().replace(/\s+/g, '');
    if (!/o\(/.test(s) || s.includes('?')) return 'na';
    if (/!|\d\^[a-z(]|[nmk]\^[nm]\b/.test(s)) return 'bad';
    if (/\^[3-9]|[³⁴]/.test(s)) return 'bad';
    if (/\^2|²|[a-z]\*(?!log)[a-z]|[a-z][×·][a-z]|\b[nm]{2}\b/.test(s)) return 'ok';
    return 'good';
  }
  const RANK = { na: 0, good: 1, ok: 2, bad: 3 };
  const worst = (a, b) => (RANK[a] >= RANK[b] ? a : b);

  // ---------- placement ----------
  function placePanel() {
    if (pw.hidden) return;
    const top = parseFloat(w.style.top) || 0;
    const ph = pw.offsetHeight;
    const vh = window.innerHeight;
    let off = 0;
    if (top + ph > vh - EDGE) off = vh - EDGE - (top + ph);
    if (top + off < EDGE) off = EDGE - top;
    pw.style.top = off + 'px';
  }

  function place(animate) {
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const r = w.getBoundingClientRect();
    const x = state.side === 'left' ? EDGE : vw - r.width - EDGE;
    const y = clamp(state.y, EDGE, Math.max(EDGE, vh - r.height - EDGE));
    w.style.transition = animate ? 'left .3s cubic-bezier(.2,.9,.25,1.05), top .3s cubic-bezier(.2,.9,.25,1)' : 'none';
    w.style.left = x + 'px';
    w.style.top = y + 'px';
    w.classList.toggle('side-left', state.side === 'left');
    w.classList.toggle('side-right', state.side !== 'left');
    placePanel();
  }

  // ---------- drag (buddy + panel header) ----------
  function makeDraggable(handle, { onClick, ignore } = {}) {
    let s = null;
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (ignore && e.target.closest(ignore))) return;
      const r = w.getBoundingClientRect();
      s = { x: e.clientX, y: e.clientY, left: r.left, top: r.top, moved: false, id: e.pointerId };
      try { handle.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    });
    handle.addEventListener('pointermove', (e) => {
      if (!s || e.pointerId !== s.id) return;
      const dx = e.clientX - s.x, dy = e.clientY - s.y;
      if (!s.moved && Math.hypot(dx, dy) < 5) return;
      s.moved = true;
      w.classList.add('dragging');
      const r = w.getBoundingClientRect();
      const vw = document.documentElement.clientWidth, vh = window.innerHeight;
      w.style.transition = 'none';
      w.style.left = clamp(s.left + dx, 0, vw - r.width) + 'px';
      w.style.top = clamp(s.top + dy, 0, vh - r.height) + 'px';
      placePanel();
    });
    const end = (e) => {
      if (!s || e.pointerId !== s.id) return;
      const moved = s.moved;
      s = null;
      w.classList.remove('dragging');
      if (!moved) { if (onClick && e.type === 'pointerup') onClick(); return; }
      const r = w.getBoundingClientRect();
      state.side = r.left + r.width / 2 < document.documentElement.clientWidth / 2 ? 'left' : 'right';
      state.y = r.top;
      place(true);
      persistUi();
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }
  makeDraggable(col, { onClick: () => togglePin() });
  makeDraggable(head, { ignore: '.hbtn' });

  // ---------- open / pin ----------
  let hoverTimer = 0, leaveTimer = 0;

  function updateFooter(meta) {
    if (meta != null) $('footL').dataset.meta = meta;
    $('footL').textContent = $('footL').dataset.meta || '';
    $('footR').textContent = state.pinned ? 'Pinned · “−” to hide' : 'Click to pin';
  }

  function setOpen(open) {
    if (state.open === open) { updateFooter(); return; }
    state.open = open;
    pw.hidden = !open;
    w.classList.toggle('open', open);
    updateFooter();
    if (open) { placePanel(); onOpened(); }
  }

  function onOpened() {
    if (!state.hasKey) { showView('set', 'Paste your Groq API key to get started.'); return; }
    showView('main');
    analyze({ retries: 3 });
  }

  function pin() { state.pinned = true; persistUi(); setOpen(true); updateFooter(); }
  function unpin() { state.pinned = false; persistUi(); clearTimeout(hoverTimer); clearTimeout(leaveTimer); setOpen(false); }
  function togglePin() { state.pinned ? unpin() : pin(); }

  w.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(leaveTimer);
    if (state.open || w.classList.contains('dragging')) return;
    hoverTimer = setTimeout(() => setOpen(true), HOVER_OPEN_MS);
  });
  w.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(hoverTimer);
    if (state.pinned || w.classList.contains('dragging')) return;
    leaveTimer = setTimeout(() => { if (!state.pinned && !w.classList.contains('dragging')) setOpen(false); }, HOVER_CLOSE_MS);
  });
  // Focusing a field (API key) means the user is mid-edit: keep the panel up.
  w.addEventListener('focusin', (e) => { if (e.target.matches('input[type="password"], input[type="text"], select') && !state.pinned) pin(); });

  $('btnMin').addEventListener('click', unpin);
  $('btnRe').addEventListener('click', () => { showView('main'); analyze({ force: true }); });
  $('btnSet').addEventListener('click', () => { if (!state.pinned) pin(); showView(vSet.hidden ? 'set' : 'main'); });
  buddy.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePin(); } });

  // Keep LeetCode/NeetCode hotkeys from firing while typing here, and keep the
  // page's text selection alive when clicking buttons (so selected code still works).
  for (const t of ['keydown', 'keyup', 'keypress']) w.addEventListener(t, (e) => e.stopPropagation());
  w.addEventListener('mousedown', (e) => { if (!e.target.closest('input, select, option, label, a')) e.preventDefault(); });

  // ---------- views ----------
  function showView(name, note) {
    const set = name === 'set';
    vMain.hidden = set;
    vSet.hidden = !set;
    if (set) {
      $('setNote').textContent = note || 'Keys are tried in order. If one gets rate limited, the next takes over automatically.';
      $('btnBack').hidden = !state.hasKey;
      refreshKeys();
      if (state.hasKey) refreshModelList();
    }
    requestAnimationFrame(placePanel);
  }

  // ----- keys (stored & rotated by the background worker; this is just the editor) -----
  const fmtWait = (s) => (s >= 3600 ? `${Math.ceil(s / 3600)}h` : s >= 60 ? `${Math.ceil(s / 60)}m` : `${s}s`);
  function setKeyMsg(text, kind) { const m = $('keyMsg'); m.textContent = text || ''; m.className = 'hint' + (kind ? ' ' + kind : ''); }

  async function refreshKeys() {
    try {
      const r = await chrome.runtime.sendMessage({ type: 'keys:list' });
      if (r && r.ok) { state.hasKey = r.keys.length > 0; $('btnBack').hidden = !state.hasKey; renderKeys(r.keys); }
    } catch (e) { setKeyMsg(friendly(e), 'err'); }
  }

  function renderKeys(list) {
    if (!list.length) { $('keyList').replaceChildren(el('div', 'knone', 'No keys saved yet.')); return; }
    $('keyList').replaceChildren(...list.map((k, i) => {
      const row = el('div', 'kitem');
      const label = k.status === 'rate' ? `rate limited · ${fmtWait(k.wait)}` : k.status === 'invalid' ? 'rejected' : 'ready';
      const del = el('button', 'kdel', '×');
      del.title = 'Remove this key';
      del.setAttribute('aria-label', 'Remove key ' + (i + 1));
      let armed = 0; // two-step remove so a stray click can never delete a key
      del.addEventListener('click', async () => {
        if (!armed) {
          del.textContent = 'Remove?'; del.classList.add('armed');
          armed = setTimeout(() => { armed = 0; del.textContent = '×'; del.classList.remove('armed'); }, 3000);
          return;
        }
        clearTimeout(armed);
        await chrome.runtime.sendMessage({ type: 'keys:remove', id: k.id });
        cache.clear(); lastKey = '';
        await refreshKeys();
      });
      row.append(el('span', 'knum', String(i + 1)), el('span', 'kdot ' + k.status), el('span', 'kmask', k.masked), el('span', 'kstat ' + k.status, label), del);
      return row;
    }));
    requestAnimationFrame(placePanel);
  }

  async function addKey() {
    const v = keyIn.value.trim();
    if (!v) return;
    const wasEmpty = !state.hasKey;
    $('btnAdd').disabled = true;
    setKeyMsg('Checking key…');
    try {
      const r = await chrome.runtime.sendMessage({ type: 'keys:add', key: v });
      if (r && r.ok) {
        keyIn.value = '';
        setKeyMsg('Key added ✓', 'ok');
        cache.clear(); lastKey = ''; pausedUntil = 0;
        await refreshKeys();
        if (wasEmpty) { showView('main'); analyze({ force: true }); }
      } else setKeyMsg((r && r.error) || 'Could not add that key.', 'err');
    } catch (e) {
      setKeyMsg(friendly(e), 'err');
    } finally {
      $('btnAdd').disabled = false;
    }
  }
  $('btnAdd').addEventListener('click', addKey);
  keyIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') addKey(); });
  $('btnBack').addEventListener('click', () => { showView('main'); analyze(); });

  // ----- model picker (a real <select>: <datalist> doesn't open inside a shadow root) -----
  let modelList = MODEL_SUGGESTIONS.slice();
  function fillModels() {
    const list = modelList.slice();
    if (!list.includes(state.model)) list.unshift(state.model);
    modelIn.replaceChildren(...list.map((m) => { const o = document.createElement('option'); o.value = m; o.textContent = m; return o; }));
    modelIn.value = state.model;
  }
  modelIn.addEventListener('change', () => {
    state.model = modelIn.value;
    store.set({ model: state.model });
    cache.clear(); lastKey = '';
    const t = $('modelSaved'); t.textContent = 'Saved ✓';
    setTimeout(() => { t.textContent = ''; }, 1500);
  });

  // Fill the dropdown with what the saved keys can actually use right now.
  async function refreshModelList() {
    try {
      const r = await chrome.runtime.sendMessage({ type: 'models' });
      if (r && r.ok && r.models.length) { modelList = r.models; fillModels(); }
    } catch { /* keep the static suggestions */ }
  }

  autoChk.addEventListener('change', () => store.set({ auto: autoChk.checked }));

  async function loadSettings() {
    const s = await store.get(['groqKeys', 'groqKey', 'model', 'auto', 'lcxTargets']);
    state.targets = s.lcxTargets && typeof s.lcxTargets === 'object' ? s.lcxTargets : {};
    state.hasKey = (Array.isArray(s.groqKeys) && s.groqKeys.length > 0) || !!s.groqKey; // groqKey = pre-multi-key installs
    state.auto = !!s.auto;
    autoChk.checked = state.auto;
    state.model = s.model && !RETIRED_MODELS.includes(s.model) ? s.model : DEFAULT_MODEL;
    fillModels();
  }

  // ---------- reading the code ----------
  function readEditor() {
    return new Promise((resolve) => {
      const id = Math.random().toString(36).slice(2);
      const timer = setTimeout(() => done(null), 1200);
      function onRes(e) {
        let d; try { d = JSON.parse(e.detail); } catch { return; }
        if (d && d.id === id) done(d);
      }
      function done(v) { clearTimeout(timer); document.removeEventListener('lcx:res', onRes); resolve(v); }
      document.addEventListener('lcx:res', onRes);
      document.dispatchEvent(new CustomEvent('lcx:req', { detail: JSON.stringify({ id }) }));
    });
  }

  function scrapeVisibleLines() {
    let best = '';
    document.querySelectorAll('.monaco-editor .view-lines').forEach((vl) => {
      const rows = [...vl.querySelectorAll('.view-line')]
        .sort((a, b) => (parseFloat(a.style.top) || 0) - (parseFloat(b.style.top) || 0))
        .map((r) => r.textContent.replace(/ /g, ' '));
      const t = rows.join('\n');
      if (t.trim().length > best.trim().length) best = t;
    });
    return best;
  }

  async function getSource(preferEditor) {
    if (!preferEditor) {
      const sel = window.getSelection();
      const text = sel ? String(sel).trim() : '';
      const an = sel && sel.anchorNode;
      const inOurUi = !!an && (an === host || host.contains(an) || an.getRootNode() === shadow);
      if (text.length >= 12 && !inOurUi) return { code: text, lang: '', source: 'selection' };
    }
    const r = await readEditor();
    if (r && r.code && r.code.trim()) return { code: r.code, lang: r.lang || '', source: 'editor' };
    const dom = scrapeVisibleLines();
    if (dom.trim()) return { code: dom, lang: '', source: 'editor (visible lines)' };
    return null;
  }
  const keyOf = (src) => hashStr(src.lang + '\u0000' + src.code) + '|' + problemSlug();

  // ---------- problem context: which question, what it demands, how big n can be ----------
  const titleCase = (t) => t.replace(/-+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const problemSlug = () => { const m = location.pathname.match(/\/problems\/([^/?#]+)/); return m ? m[1].toLowerCase() : ''; };

  function problemContext() {
    const slug = problemSlug();
    if (!slug) return null;
    let title = document.title
      .replace(/\s*[-|–—]\s*(?:LeetCode|NeetCode).*$/i, '')
      .replace(/\s*[-|–—]\s*(?:Solutions?|Description|Submissions?|Editorial|Discuss(?:ion)?)\s*$/i, '')
      .trim();
    if (!title || /^(?:leetcode|neetcode)\b/i.test(title)) title = titleCase(slug);
    const ctx = { slug, title, site: /neetcode/i.test(location.hostname) ? 'NeetCode' : 'LeetCode', hints: [], constraints: '' };

    // Only the statement panel (when it's on screen), so we never pick up complexity claims from a solution/discussion.
    const root = document.querySelector('[data-track-load="description_content"], .question-tab');
    if (root) {
      const lines = root.innerText.split(/\n+/).map((l) => l.trim()).filter(Boolean);
      ctx.hints = lines
        .filter((l) => l.length <= 240 && /O\(|follow[- ]?up|constant (?:extra )?space|auxiliary space|in[- ]place|without (?:using )?extra|extra space/i.test(l))
        .slice(0, 3);
      const ci = lines.findIndex((l) => /^constraints:?$/i.test(l));
      if (ci >= 0) {
        ctx.constraints = lines.slice(ci + 1, ci + 6)
          .filter((l) => l.length <= 120 && !/^(?:topics|recommended|hints?|company|follow)/i.test(l))
          .join(' ; ').slice(0, 300);
      }
    }
    return ctx;
  }

  function rememberTarget(slug, o) {
    state.targets[slug] = { time: o.time, space: o.space, how: o.how };
    const keys = Object.keys(state.targets);
    if (keys.length > 400) for (const k of keys.slice(0, keys.length - 400)) delete state.targets[k];
    store.set({ lcxTargets: state.targets });
  }

  // Rough ordering of common Big-O shapes, used to veto an LLM "you're at the target" that contradicts the numbers.
  function rank(c) {
    const t = String(c || '').toLowerCase().replace(/\s+/g, '').replace(/^o\(/, '').replace(/\)$/, '');
    if (!t) return null;
    if (/!|\d\^[a-z(]|[nmk]\^[nm]\b/.test(t)) return 7;
    if (/\^[3-9]|[³⁴]/.test(t)) return 5;
    if (/\^2|²|[a-z]\*(?!log)[a-z]|[a-z][×·][a-z]|\b[nm]{2}\b/.test(t)) return 4;
    if (/[nmk]\*?log|log[nmk]\*?[nmk]/.test(t)) return 3;
    if (/^log/.test(t)) return 1;
    if (/^\d+$/.test(t)) return 0;
    if (/[nmkve]/.test(t)) return 2;
    return null;
  }
  const normC = (c) => String(c || '').toLowerCase().replace(/\s+/g, '');
  function atTarget(r) {
    const o = r && r.optimal;
    if (!o) return false;
    const rt = rank(r.time), ro = rank(o.time), rs = rank(r.space), rso = rank(o.space);
    const worse = (a, b) => a != null && b != null && a > b;
    if (worse(rt, ro) || worse(rs, rso)) return false;                 // clearly above the target, whatever the LLM said
    if (rt != null && ro != null && rs != null && rso != null) return true; // comparable and nothing is worse: at (or beyond) the target
    return !!o.matches || (normC(o.time) === normC(r.time) && normC(o.space) === normC(r.space));
  }

  // ---------- analysis ----------
  const cache = new Map();
  let busy = false, lastKey = '', pausedUntil = 0;

  function setBusy(b) {
    busy = b;
    w.classList.toggle('busy', b);
    $('panel').classList.toggle('loading', b);
  }

  function setBuddy(r, hit) {
    const gt = grade(r && r.time), gs = grade(r && r.space);
    buddy.dataset.g = r ? worst(gt, gs) : 'na';
    if (!r) { badge.hidden = true; return; }
    $('bT').textContent = r.time;
    $('bS').textContent = r.space;
    $('bT').style.color = { good: '#4ade80', ok: '#fbbf24', bad: '#f87171', na: '#94a3b8' }[gt];
    $('bS').style.color = { good: '#4ade80', ok: '#fbbf24', bad: '#f87171', na: '#94a3b8' }[gs];
    badge.hidden = false;
    badge.classList.toggle('hit', !!hit);
    buddy.title = `Time ${r.time} · Space ${r.space}` + (r.optimal ? ` · Target ${r.optimal.time} / ${r.optimal.space}${hit ? ' ✓' : ''}` : '');
  }

  function card(label, value, why) {
    const c = el('div', 'card ' + grade(value));
    c.append(el('div', 'k', label), el('div', 'v', value));
    if (why) c.append(el('div', 'why', why));
    return c;
  }
  function targetCard(o, hit) {
    const c = el('div', 'card target ' + (hit ? 'hit' : 'gap'));
    const head = el('div', 'k thead');
    head.append(el('span', null, 'Optimal target'), el('span', 'chip', hit ? '✓ You’re there' : '↑ Room to improve'));
    c.append(head, el('div', 'v', `${o.time} time · ${o.space} space`));
    if (o.how) c.append(el('div', 'why', o.how));
    return c;
  }
  function note(label, text, cls) {
    const n = el('div', 'note' + (cls ? ' ' + cls : ''));
    n.append(el('b', null, label), document.createTextNode(text));
    return n;
  }

  function renderResult(entry, src, cached) {
    const r = entry.result;
    const nodes = [card('Time', r.time, r.timeWhy), card('Space', r.space, r.spaceWhy)];
    const hit = atTarget(r);
    if (r.optimal) nodes.push(targetCard(r.optimal, hit));
    if (r.approach) nodes.push(note('Your approach', r.approach));
    resultEl.replaceChildren(...nodes);
    const lines = src.code.split('\n').length;
    srcEl.textContent = `${src.source}${src.lang ? ' · ' + src.lang : ''} · ${lines} line${lines === 1 ? '' : 's'}`;
    updateFooter(`${entry.model} · ${cached ? 'cached' : (entry.ms / 1000).toFixed(1) + 's'}${entry.keyCount > 1 ? ` · key ${entry.keyIndex}/${entry.keyCount}` : ''}${entry.switchedFrom ? ' · auto-switched' : ''}`);
    setBuddy(r, hit);
    placePanel();
  }

  function renderError(res) {
    if (res.code === 'NO_KEY' || res.code === 'BAD_KEY') {
      if (res.code === 'NO_KEY') state.hasKey = false;
      showView('set', res.error);
      return;
    }
    resultEl.replaceChildren(el('div', 'err', res.error || 'Something went wrong.'));
    srcEl.textContent = '';
    pausedUntil = Date.now() + (res.retryAfter ? res.retryAfter * 1000 : 20000);
    placePanel();
  }

  function renderEmpty(msg = 'No code found yet. Open the editor, or select a code block, then hover again.') {
    resultEl.replaceChildren(el('div', 'empty', msg));
    srcEl.textContent = '';
    setBuddy(null);
    placePanel();
  }

  const friendly = (e) => (/context invalidated/i.test(String(e && e.message)) ? 'The extension was updated — refresh this tab.' : String((e && e.message) || e));

  async function analyze({ force = false, retries = 0, preferEditor = false } = {}) {
    if (!state.hasKey) { showView('set', 'Paste your Groq API key to get started.'); return; }
    if (busy) return;
    if (!alive()) { renderError({ error: 'The extension was updated — refresh this tab.' }); return; }

    const src = await getSource(preferEditor);
    if (!src) {
      if (retries > 0) {
        if (!resultEl.children.length) resultEl.replaceChildren(el('div', 'skel'));
        setTimeout(() => analyze({ force, retries: retries - 1, preferEditor }), 1200);
      } else if (!resultEl.querySelector('.card')) renderEmpty();
      return;
    }

    const k = keyOf(src);
    if (!hasRealCode(src.code)) { // only the starter template: nothing to analyze, don't spend an API call
      lastKey = k;
      renderEmpty('Just the starter template so far. Write some code, then hover again.');
      srcEl.textContent = '';
      updateFooter('no API call used');
      return;
    }
    if (!force && cache.has(k)) { lastKey = k; renderResult(cache.get(k), src, true); return; }

    if (!resultEl.children.length) resultEl.replaceChildren(el('div', 'skel'), el('div', 'skel'));
    setBusy(true);
    try {
      const ctx = problemContext();
      const anchor = !force && ctx && state.targets[ctx.slug] ? state.targets[ctx.slug] : null;
      const res = await chrome.runtime.sendMessage({
        type: 'analyze', code: src.code, lang: src.lang, anchor,
        problem: ctx && { title: ctx.title, site: ctx.site, hints: ctx.hints, constraints: ctx.constraints },
      });
      if (res && res.ok) {
        const o = res.result.optimal;
        if (anchor) res.result.optimal = { ...(o || {}), ...anchor, matches: !!(o && o.matches) }; // keep the target stable across hovers
        else if (o && ctx) rememberTarget(ctx.slug, o);                                          // first time (or a forced refresh): remember it
        cache.set(k, res); lastKey = k; renderResult(res, src, false);
      }
      else renderError(res || { error: 'No response from the extension.' });
    } catch (e) {
      renderError({ error: friendly(e) });
    } finally {
      setBusy(false);
    }
  }

  // "Live" mode: re-analyze shortly after the code stops changing (even while the panel is tucked away).
  let lastSeen = '';
  setInterval(async () => {
    if (!state.auto || !state.hasKey || busy || document.hidden || Date.now() < pausedUntil || !alive()) return;
    const src = await getSource(true);
    if (!src) return;
    const k = keyOf(src);
    if (!hasRealCode(src.code)) { // cleared back to the template: reset, no API call
      if (k !== lastKey) { lastKey = k; renderEmpty('Just the starter template so far. Write some code, then hover again.'); updateFooter('no API call used'); }
      return;
    }
    if (k === lastKey) { lastSeen = k; return; }
    if (k !== lastSeen) { lastSeen = k; return; } // wait for one quiet tick
    analyze({ preferEditor: true });
  }, POLL_MS);

  // ---------- boot ----------
  try {
    chrome.runtime.onMessage.addListener((m) => { if (m && m.type === 'toggle') togglePin(); });
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== 'local') return;
      if (ch.groqKeys || ch.groqKey) loadSettings().then(() => { if (!vSet.hidden) refreshKeys(); });
      if (ch.auto) { state.auto = !!ch.auto.newValue; autoChk.checked = state.auto; }
      if (ch.model) { state.model = ch.model.newValue || DEFAULT_MODEL; fillModels(); }
    });
  } catch { /* extension context gone */ }
  window.addEventListener('resize', () => place(false));
  new ResizeObserver(() => placePanel()).observe(pw);
  new ResizeObserver(() => place(false)).observe(col);

  (async () => {
    const s = await store.get([UI_KEY]);
    const ui = s[UI_KEY] || {};
    if (ui.side === 'left' || ui.side === 'right') state.side = ui.side;
    if (typeof ui.y === 'number') state.y = ui.y;
    await loadSettings();

    document.documentElement.appendChild(host);
    place(false);
    w.classList.add('ready');

    // First run (no key) pops the setup open; otherwise restore the pinned state.
    if (!state.hasKey) { state.pinned = true; setOpen(true); }
    else if (ui.pinned) { state.pinned = true; setOpen(true); }
    updateFooter();
  })();
})();
