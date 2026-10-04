// Runs in the PAGE's JS world (content scripts live in an isolated world and
// can't see the editor). Answers one request: "give me the editor's code".
//
// Finding the editor:
//   LeetCode  -> exposes `window.monaco` directly.
//   NeetCode  -> bundles Monaco without a global, so we ask webpack's module
//                registry for the module that holds the Monaco API (read-only,
//                already-loaded module; cached after the first hit).
//   Fallbacks -> CodeMirror 5 / 6.
(() => {
  let cachedApi = null;
  let lastProbe = 0;

  function probeWebpack() {
    for (const key of Object.keys(window)) {
      if (!/^webpackChunk/.test(key) || !Array.isArray(window[key])) continue;
      let req;
      try { window[key].push([[Symbol('lcx')], {}, (r) => { req = r; }]); } catch { continue; }
      if (!req || !req.m) continue;
      for (const id of Object.keys(req.m)) {
        let src;
        try { src = Function.prototype.toString.call(req.m[id]); } catch { continue; }
        if (!src.includes('getEditors') || !src.includes('createModel')) continue;
        try {
          const ex = req(id);
          for (const c of [ex, ex && ex.default]) {
            if (c && c.editor && typeof c.editor.getEditors === 'function') return c;
          }
        } catch { /* try next candidate */ }
      }
    }
    return null;
  }

  function findMonaco() {
    if (window.monaco && window.monaco.editor) return window.monaco;
    if (cachedApi) return cachedApi;
    const now = Date.now();
    if (now - lastProbe < 4000) return null; // don't rescan on every request
    lastProbe = now;
    try { cachedApi = probeWebpack(); } catch { cachedApi = null; }
    return cachedApi;
  }

  function fromMonaco(m) {
    const editors = (m.editor.getEditors && m.editor.getEditors()) || [];
    let best = null;
    let bestScore = -1;
    for (const ed of editors) {
      const model = ed.getModel && ed.getModel();
      if (!model) continue;
      const text = model.getValue();
      if (!text.trim()) continue;
      const node = ed.getDomNode && ed.getDomNode();
      const r = node && node.getBoundingClientRect();
      const visible = !!(r && r.width > 0 && r.height > 0);
      const focused = !!(ed.hasTextFocus && ed.hasTextFocus());
      const score = (focused ? 1e7 : 0) + (visible ? 1e6 : 0) + Math.min(text.length, 1e5);
      if (score > bestScore) { bestScore = score; best = { code: text, lang: model.getLanguageId ? model.getLanguageId() : '' }; }
    }
    if (best) return best;
    // No editor object with code: fall back to the biggest model.
    for (const model of m.editor.getModels()) {
      const text = model.getValue();
      if (text.trim() && (!best || text.length > best.code.length)) {
        best = { code: text, lang: model.getLanguageId ? model.getLanguageId() : '' };
      }
    }
    return best;
  }

  function fromCodeMirror() {
    const cm5 = document.querySelector('.CodeMirror');
    if (cm5 && cm5.CodeMirror) return { code: cm5.CodeMirror.getValue(), lang: '' };
    const cm6 = document.querySelector('.cm-content');
    if (cm6) {
      const view = cm6.cmView && cm6.cmView.view;
      if (view && view.state) return { code: view.state.doc.toString(), lang: '' };
      return { code: [...cm6.querySelectorAll('.cm-line')].map((l) => l.textContent).join('\n'), lang: '' };
    }
    return null;
  }

  document.addEventListener('lcx:req', (e) => {
    let id = '';
    try { id = JSON.parse(e.detail).id; } catch { return; }

    let found = null;
    try {
      const m = findMonaco();
      if (m) found = fromMonaco(m);
      if (!found || !found.code.trim()) found = fromCodeMirror() || found;
    } catch { /* content script has a DOM fallback */ }

    const out = { id, code: (found && found.code) || '', lang: (found && found.lang) || '' };
    document.dispatchEvent(new CustomEvent('lcx:res', { detail: JSON.stringify(out) }));
  });
})();
