# Complexity Buddy

A cute floating buddy for **LeetCode** and **NeetCode** that tells you the time & space
complexity of your code, powered by the **Groq** or **Gemini** API (your choice).

- It pops up on the right edge by itself on both sites. Drag it anywhere; it snaps to the left or right edge.
- **Hover** it to peek at the Time / Space complexity (analyzes your current code, cached if unchanged).
- **Click** it to pin the panel open. Click it again, or hit **−**, to tuck it away.
- **Optimal target**: a card shows the best time/space you should aim for on *this* problem (e.g. `O(n) time · O(1) space`)
  and whether your code is already there. On a problem page it sends the title plus the statement's stated requirements
  and constraints (LeetCode and NeetCode), so "must run in O(n) time" is respected. The target is remembered per problem so it
  doesn't change between hovers; the ↻ button recomputes it.
- The face and little badge always show the latest result: happy = fast, meh = n², worried = exponential.
- **Live update** toggle: re-analyzes a moment after you stop typing, even while the panel is tucked away.
- Select code on any page (solutions, discuss) and hover: it analyzes the selection instead of the editor.
- Clicking the toolbar icon also toggles the pin.
- Just the starter template (class + empty method, `pass`, `return 0`, ...)? It's detected locally and **no API call is made**.

## Install (unpacked)

1. Open `chrome://extensions` and switch on **Developer mode**.
2. **Load unpacked** and pick the `leetcode-complexity` folder (the one containing `manifest.json`).
3. Open a LeetCode or NeetCode problem. On first run the panel asks you to pick **Groq** or **Gemini** and paste a key
   (free keys: https://console.groq.com/keys, https://aistudio.google.com/apikey).

### Providers, keys & models

- Two providers, kept separate: **Groq** and **Gemini**. Pick one in settings (sliders icon); only that provider is used.
  Each has its own keys, its own model dropdown (filled with what your keys can actually use), and its own saved model.
- Add as many keys as you like per provider and give each a **nickname** (click a nickname to rename it). Keys are tried
  in order; if one is rate limited or rejected the next takes over, and the footer shows which one answered
  (e.g. `Personal 2/3`). A limited key sits out for the time the provider asks for, then goes back to being used.
  Remove a key with its `×` (click twice to confirm).
- Limits are per **account** on Groq and per **Google Cloud project** on Gemini, not per key, so extra keys only help if they
  come from different accounts/projects.
- Defaults: Groq `openai/gpt-oss-120b` (Groq retired Llama 3.3 / 3.1 on 2026-08-16) and Gemini `gemini-3.5-flash-lite`.
  Google limits the 2.5 models to projects that already used them, so new keys should use 3.x models. If a saved model
  is ever unavailable, the extension switches to a working one automatically.
- Gemini is called through Google's native `generateContent` API with the `x-goog-api-key` header. That works for both the older `AIza…` keys and the newer `AQ.…` keys that AI Studio issues now; the key format isn't restricted, Google decides validity.
- Keys live in `chrome.storage.local` and are only ever sent to their own provider's API.

## How it reads your code

- LeetCode exposes Monaco as `window.monaco`.
- NeetCode bundles Monaco without a global, so `page-bridge.js` finds it through webpack's module registry.
- CodeMirror editors and visible-lines scraping are fallbacks.

## Dev

`dev/harness.html` runs the real `content.js` + `code-check.js` + `page-bridge.js` against fake `chrome.*` APIs and a fake editor:

    cd leetcode-complexity && python3 -m http.server 8765   # then open http://localhost:8765/dev/harness.html
