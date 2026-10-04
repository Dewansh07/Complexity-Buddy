# Complexity Buddy

A cute floating buddy for **LeetCode** and **NeetCode** that tells you the time & space
complexity of your code, powered by the Groq API.

- It pops up on the right edge by itself on both sites. Drag it anywhere; it snaps to the left or right edge.
- **Hover** it to peek at the Time / Space complexity (analyzes your current code, cached if unchanged).
- **Click** it to pin the panel open. Click it again, or hit **−**, to tuck it away.
- The face and little badge always show the latest result: happy = fast, meh = n², worried = exponential.
- **Live update** toggle: re-analyzes a moment after you stop typing, even while the panel is tucked away.
- Select code on any page (solutions, discuss) and hover: it analyzes the selection instead of the editor.
- Clicking the toolbar icon also toggles the pin.
- Just the starter template (class + empty method, `pass`, `return 0`, ...)? It's detected locally and **no API call is made**.

## Install (unpacked)

1. Open `chrome://extensions` and switch on **Developer mode**.
2. **Load unpacked** and pick this folder.
3. Open a LeetCode or NeetCode problem. On first run the panel asks for your Groq key
   (free at https://console.groq.com/keys). Paste it and press Save.

### Keys & models

- Add as many Groq keys as you like in settings (sliders icon). They're tried **in order**; if one is rate limited
  (or rejected) the next takes over automatically and the footer shows e.g. `key 2/3`. A rate-limited key sits out
  for the time Groq asks for, then goes back to being used. Remove a key with its `×` (click twice to confirm).
- Default model is `openai/gpt-oss-120b` (Groq retired the Llama 3.3 / 3.1 models on 2026-08-16). Pick another from the
  dropdown, which lists what your keys can use. `qwen/qwen3.8-27b` also works but is a Groq *preview* model.
  If a saved model is ever retired, the extension switches to a working one automatically.
- Keys live in `chrome.storage.local` and are only ever sent to `api.groq.com`.

## How it reads your code

- LeetCode exposes Monaco as `window.monaco`.
- NeetCode bundles Monaco without a global, so `page-bridge.js` finds it through webpack's module registry.
- CodeMirror editors and visible-lines scraping are fallbacks.

## Dev

`dev/harness.html` runs the real `content.js` + `code-check.js` + `page-bridge.js` against fake `chrome.*` APIs and a fake editor:

    python3 -m http.server 8765   # then open http://localhost:8765/dev/harness.html
