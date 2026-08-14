# Claude, git in here!

A personal dashboard with two tabs:
- **Repos** — every GitHub repo you have access to, with an AI-generated summary and a one-click "Open in VS Code."
- **Usage** — your rolling 5-hour Claude Code usage window, read from local session logs.

## Architecture

- `index.html` / `style.css` / `app.js` / `auth.js` / `repos.js` / `config.js` — static frontend, hosted on GitHub Pages. No build step, no framework, no third-party JS (kept minimal on purpose, since this page holds your GitHub token in `localStorage`).
- `worker/` — a small Cloudflare Worker that does two things a static page can't do safely: exchange the GitHub OAuth code for a token (needs a client secret), and call the Claude API to summarize repos (needs your Anthropic key kept off the public page).
- `usage-source.js` / `usage-blocks.js` / `usage-calibration.js` / `usage.js` — the Usage tab. Reads `~/.claude/projects/*/*.jsonl` directly in the browser via the File System Access API (Chrome/Edge only) — no local script to run. See "Usage tab" below for how the quota bar works.

## Setup

Some of this only you can do (things that require clicking through GitHub/Cloudflare's own web UI, or typing a secret value that shouldn't pass through an AI agent). The rest can be run for you. Steps are in dependency order.

### 1. You: create a GitHub OAuth App

Go to https://github.com/settings/developers → "New OAuth App":
- **Homepage URL**: `https://<your-username>.github.io/claude-git-in-here/`
- **Authorization callback URL**: same as above

Save it, copy the **Client ID**, and give it to me — I'll put it in `config.js` and `worker/wrangler.toml`. Then click **Generate a new client secret** — copy that too, but don't paste it to me in chat; you'll enter it directly at a prompt in step 5.

### 2. You: have (or create) a Cloudflare account

https://dash.cloudflare.com — free tier is fine. Once logged in, find your **Account ID** in the dashboard sidebar and give it to me for `worker/wrangler.toml`.

### 3. You: get an Anthropic API key

From https://console.anthropic.com — used server-side by the Worker to generate repo summaries. Same rule as the GitHub secret: you'll enter it directly at a prompt, not in chat.

### 4. Agent: create and push the GitHub repo

```
gh repo create claude-git-in-here --public --source=. --remote=origin
git push -u origin main
```

(Public is required for GitHub Pages on a free personal GitHub plan.)

### 5. You + Agent: deploy the Worker

```
cd worker
npx wrangler login        # opens a browser tab — click "Allow"
npx wrangler secret put GITHUB_CLIENT_SECRET   # paste the secret from step 1 when prompted
npx wrangler secret put ANTHROPIC_API_KEY       # paste the key from step 3 when prompted
npx wrangler deploy
```

The deploy output includes your Worker's `*.workers.dev` URL — that gets filled into `config.js` as `WORKER_URL`.

### 6. Agent: enable GitHub Pages and finalize config

- Fill `config.js` (`GITHUB_CLIENT_ID`, `WORKER_URL`) and `worker/wrangler.toml` (`GITHUB_CLIENT_ID`, `account_id`).
- Enable Pages: `gh api repos/<owner>/claude-git-in-here/pages -X POST -f source[branch]=main -f 'source[path]=/'` (falls back to Settings → Pages in the GitHub UI if the API call needs the first activation done manually).
- Commit and push the filled-in config.
- Give it a few minutes to propagate, then visit `https://<your-username>.github.io/claude-git-in-here/`.

## Usage tab

The first time you open the tab, click **Connect usage logs** and pick your `~/.claude/projects` folder in the native file picker. The browser remembers that grant (via IndexedDB) so you won't be asked again unless you revoke it. This only works in Chromium browsers (Chrome, Edge) — the File System Access API isn't implemented in Safari or Firefox yet.

**Window boundaries.** A 5-hour window opens on your *first message* in it, not the first assistant reply — the app derives boundaries from every turn's timestamp (not just usage-bearing assistant turns) so the countdown lines up with the real window instead of running late.

**The quota bar.** Anthropic doesn't expose the actual token/message ceiling for your plan's 5-hour window anywhere in the local logs, so there's no way to compute a true "% used" from raw token counts alone. Instead:
1. Open your own Claude usage indicator (`/usage`) and note the % it shows.
2. Paste that into the **Calibrate** field in the Usage tab at roughly the same moment.
3. The app backs out an implied budget from your current window's token cost at that instant, and reuses it for future windows until you recalibrate.

Before you calibrate, the bar falls back to your heaviest observed window so far (×1.25 headroom) if you have history, or a labelled placeholder floor if you don't — both are clearly marked as estimates, not Anthropic's real number.

If a window was opened somewhere this machine has no record of (claude.ai, another device), use **Set override** to pin the real reset time instead of the locally-derived guess.

## Notes on scope and security

- OAuth scope is `repo` (read+write on public and private repos) — the app only ever issues GET requests, but GitHub has no read-only scope that includes private repos, so the grant is broader than what's used. Edit `GITHUB_SCOPE` in `config.js` to `public_repo` if you'd rather exclude private repos and narrow the grant.
- The GitHub token is stored in `localStorage` so you stay logged in across sessions. That's a real tradeoff: an XSS bug in this page could read it. Mitigations in place: no third-party JS, no bundler/dependencies in the frontend, and a `script-src 'self'` CSP. Revoke access anytime from https://github.com/settings/applications.
- Usage log access is local-only: the File System Access grant lives in this browser profile, and file contents never leave your machine — only the numbers computed from them are rendered on the page.

## Redeploying after edits

- Frontend changes: commit and push to `main`; GitHub Pages redeploys automatically.
- Worker changes: `cd worker && npx wrangler deploy`.
