# MonkeyPilot

MonkeyPilot is a Chrome extension (Manifest V3) that acts as an AI browser co-pilot: it manages tabs and tab groups, runs agent-driven workflows from a side panel, and includes stealth helpers for bot-detection test pages. A small local Python server (`server.py`) syncs agent logs and workspace operations when you need offline tooling alongside the extension.

**[Try the bot-detection playground →](https://subtiliorars-sys.github.io/MonkeyPilot/test_playground.html)** — static test page on GitHub Pages (no extension install). Load the unpacked extension in Chrome for the full side-panel agent.

## Run and verify

**Extension (Chrome)**

1. Open `chrome://extensions`, enable Developer mode.
2. Load unpacked and select this repo root (must contain `manifest.json`).
3. Click the toolbar icon to open the side panel and exercise tab/agent actions.

**Local server (optional)**

```bash
python server.py
```

Server listens on `http://localhost:5000`. Quick check: `curl http://localhost:5000/logs` should return JSON (empty history or a status message).

**Static test pages**

Open `test_playground.html` or `test_dashboard.html` in the browser (file or via a simple static server) to exercise bot-detection and dashboard UI without the store build.

## Ecosystem routing

Cross-repo agent routing and fleet wiring live in the [subtiliorars-sys/neural-network](https://github.com/subtiliorars-sys/neural-network) connectome—not in this repo. Use that project for how MonkeyPilot fits the wider CodeMonkeys / Agent Corps graph.
