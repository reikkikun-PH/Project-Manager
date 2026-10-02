# Server Project Manager

**Host many projects on one address.** One Python backend, one dashboard, one
Cloudflare tunnel — every project lives at `/p/<id>/` on the same link.

- **Stdlib only.** No `pip install`, no build step. Python 3 and nothing else.
- **8 files.** `server.py`, `index.html`, `host.py`, `host.bat`, `termux.sh`,
  `projects.example.json`, `README.md`, `.gitignore`.
- **Works on a phone.** Termux/Android, ARM included — the same code.

---

## Quick start

**Windows** — double-click `host.bat` (or `py -3 host.py`).

**Linux / macOS**

```sh
python3 host.py          # PORT=8001 python3 host.py to use another port
```

**Android (Termux)**

```sh
curl -L -o termux.sh https://raw.githubusercontent.com/reikkikun-PH/Project-Manager/main/termux.sh
sh termux.sh setup       # installs packages, clones, sets up cloudflared + login
cd ~/pm && python host.py
```

One terminal then runs the backend **and** the tunnel, printing the pinned public
link (`https://xxxx.trycloudflare.com`) and a link per project. Ctrl+C stops both.

The dashboard is at `http://localhost:8000` — sign in with **`admin` / `admin123`**
unless you set your own in `credentials.json`.

### The session link

As soon as the tunnel is up, the dashboard shows the **current public link** — in the
header (`PUBLIC https://xxxx.trycloudflare.com`) and in the footer, both clickable —
and every approval e-mail links to it instead of `127.0.0.1`, which would be useless
to anyone not sitting at the host PC.

The link is verified live rather than trusted blindly: the manager re-checks its own
tunnel every 10 seconds, so a link that has gone dead stops being advertised within
about half a minute (this matters because an expired `trycloudflare.com` domain still
returns HTTP 200 with a placeholder page, so the check asks for `/api/session` and
requires this instance's own JSON back). With no tunnel running, the dashboard says
`no tunnel yet` rather than showing a stale URL.

Project cards keep using whatever address you opened the dashboard with, so browsing
locally stays local and browsing via the tunnel keeps the tunnel link.

---

## What it does

- **Dashboard** to add / run / stop / lock / remove projects, with live status dots.
- **Three project types**
  - `static` — serve a folder (`./Project List/demo`)
  - `managed` — the manager launches it (`python server.py`, `npm start`, …), auto-installs
    `requirements.txt`, health-checks the port, streams logs
  - `proxy` — forward to an app already running on a local port
- **Upload a `.zip`** → it's extracted, its entry point is detected, and it becomes a
  site at `/p/<id>/` automatically.
- **One tunnel for everything.** Per-project public links share a single address.
- **Accounts with roles.** Anyone can sign up; **admin** requests and **project
  uploads** wait for approval.
- **Hardware panel** — CPU (with ARM/SoC model), RAM, disk, GPU, uptime.

### Approval e-mails (optional)

When someone requests **admin access** or **approves-pending project upload**, the
manager can email you so you don't have to keep the dashboard open. It uses the
[Resend](https://resend.com) HTTP API with the stdlib — no extra packages.

Create `notify.json` next to your state (it is gitignored, so the key is never
uploaded):

```json
{
  "enabled": true,
  "resendApiKey": "re_...",
  "to": "you@example.com",
  "from": "Project Manager <onboarding@resend.dev>"
}
```

Or set `RESEND_API_KEY` and `NOTIFY_TO` as environment variables instead.

What gets emailed:

| Trigger | Email |
|---|---|
| Signup asking for the **admin** role | username, where to approve it, and the session link |
| A **user** account signup | username, and a note that it's active immediately |
| A **user's** project upload (waiting for approval) | project name, id, type, owner, and where it will be live |
| An **admin** upload | *nothing* — it goes live immediately |

Verify it end to end from the dashboard: sign in as admin → **ACCOUNTS** →
**Send test e-mail**. Every attempt (sent or failed) is also appended to
`notify.log`, so you can check delivery history without a console:

```sh
cat notify.log          # or: type notify.log   on Windows
```

Notes:

- If a test e-mail arrives but an approval one doesn't, the difference is *which*
  trigger fired: admin uploads send nothing because they need no approval.
- **Check spam/quarantine too.** Mail from the shared `onboarding@resend.dev`
  domain is very likely to be filtered by Gmail. Verifying your own domain in
  Resend and using it as `from` is the reliable fix.
- A successful send means Resend accepted the message, not that Gmail delivered
  it. The Resend dashboard (Emails → Logs) shows per-message delivery status.

- Sending happens in a background thread with a 12s timeout, so a slow or broken mail
  API never delays an upload; failures are only written to the server log
  (`[Notify] FAILED: …`).
- `from` must be a domain you verified in Resend. `onboarding@resend.dev` only works
  for sending to your own Resend account email — use your own domain for anyone else.
- For an extra instance, copy `notify.json` into that instance's data folder
  (`instances/<name>/`) or export the env vars before starting it.

### Run two managers at once (multi-instance)

Each instance owns its **own projects, logins, folders, app ports and public link** —
so two unrelated sets of projects get two different links instead of sharing one.

```bat
REM first (default): manager on 8000, apps on 8100-8199, state in the manager folder
host.bat

REM second: name + slot + own port, state in instances\<name>\, apps on 8200-8299
set PM_INSTANCE=lab & set PM_SLOT=1 & set PORT=8010 & py -3 host.py
```

```sh
python host.py                                                   # instance "main"
PM_INSTANCE=lab PM_SLOT=1 PORT=8010 python3 host.py             # second instance
PM_INSTANCE=lab2 PORT=8020 python3 host.py                      # slot from the name
```

| Variable | Meaning | Default |
|----------|---------|---------|
| `PM_INSTANCE` | Instance name (shown in the dashboard and banner) | `main` |
| `PM_SLOT` | Port slot: `0` → 8100-8199, `1` → 8200-8299, `2` → 8300-8399 | digits in the name, else `0` |
| `PM_PORT_BASE` | Override the app port base directly | `8100 + slot × 100` |
| `PM_DATA_DIR` | Where this instance keeps its state | `instances/<name>/`, or the manager folder for `main` |
| `PORT` | The manager's own port | `8000` |

Rules that keep instances from colliding:

- A named instance **must** have an explicit slot (`PM_SLOT` or digits in the name) —
  otherwise the manager refuses to start and tells you the exact command to run.
- Each instance stores `projects.json`, `credentials.json`, `project_auth.json` and its
  own `Project List/` in its data dir, so two instances can host projects with the
  **same name** without overwriting each other.
- App ports are handed out only inside that instance's 100-port range.
- Starting on a port already serving a *different* instance is refused, so you never
  silently attach to the wrong one.
- Each instance gets its own tunnel link, and its own `tunnel-<name>.log`.

### Accounts and approvals

| Action | Who | Result |
|---|---|---|
| Create account as **User** | anyone | active immediately |
| Create account as **Admin** | anyone | **pending** until an admin approves it |
| Upload a project | signed-in user | **pending** until an admin approves it |
| Upload a project | admin | live immediately |

Each account may host **2 projects** (pending ones count). Admins manage everything;
users manage only their own projects. Pending projects are invisible to visitors and
return 404 until approved.

### Who sees what

| | Uploader | Admin | Other user | Visitor |
|---|---|---|---|---|
| **Open** the project at `/p/<id>/` | yes | yes | yes | yes |
| Name, type, live status | yes | yes | yes | yes |
| Folder path, run command, port | **yes** | **yes** | no | no |
| Run / Stop / Runner / Remove / Lock | **yes** | **yes** | no | no |
| Runner errors, lock owner | yes | yes | no | no |

A project's configuration is only ever sent to the person who uploaded it and to
admins — other users (signed in or not) get just the name, type, status and the open
link, so one student's setup details are never exposed to the class. The API enforces
this server-side, not just in the UI: other users also get `403` if they try to start,
stop, edit or delete a project they don't own.

---

## Files

Only these 8 files are in git — everything else is *your* data:

| File | Role |
|------|------|
| `server.py` | The whole backend: HTTP server, API, runners, system monitor (~3100 lines, stdlib only) |
| `index.html` | Dashboard: CSS + JS inline, no build step, no CDN |
| `host.py` | Supervisor — runs backend + tunnel in one terminal, retries, pins the link |
| `host.bat` | Windows launcher for `host.py` |
| `termux.sh` | Android: `setup` (install) and `update` (pull) |
| `projects.example.json` | Sample registry — `copy projects.example.json projects.json` |
| `README.md` | This file |

Created at runtime, **never in git**:

| File | What it holds |
|------|---------------|
| `projects.json` | Project registry — changes as you use the dashboard |
| `credentials.json` | Accounts and roles |
| `project_auth.json` | Per-project lock passwords |
| `notify.json` | Approval e-mail settings (holds the Resend API key) |
| `notify.log` | Every notification attempt (`SENT` / `FAILED` / `SKIPPED`) |
| `Project List/` | All hosted projects, their logs and databases |
| `instances/<name>/` | Everything above, for each extra instance |
| `cloudflared` / `.exe` | Tunnel binary (~90MB) |
| `*.log`, `tunnel-url.txt` | Backend / runner / tunnel logs, pinned public link |

Because your data is untracked, `termux.sh update` can never clobber it.

---

## How it works

**Dashboard API** — `GET /api/projects`, `POST /api/projects`, plus
`/api/projects/{update,delete,start,stop,runner,approve,reject}`, `/api/upload`,
`/api/detect`, `/api/browse`, `/api/system`, `/api/accounts*`, `/api/register`,
`/api/login`.

**Upload** — `POST /api/upload?name=MySite` extracts the zip (zip-slip safe), unwraps
GitHub-style folder nesting, and auto-detects the entry point: static site or runnable
app.

**Detection** — a recursive walk that skips `node_modules` / `venv` / `.git`, ranking
*runnable over static* at the same depth, so an app folder holding both `server.py` and
`index.html` actually runs. Recognises `server.py`, `app.py`, `main.py`, `wsgi.py`,
`run.py`, `manage.py` (Django, port baked in), `Procfile` web commands,
`package.json` start scripts, and `server.js` / `index.js` / `app.js`. Warns when a
Python entry ignores the `PORT` env var.

**Managed runners** — each project gets its **own port** (8100–8199, never reusing one
already assigned; a busy port auto-bumps and saves). On first run it installs
`requirements.txt` (once per change, hash-cached) or missing `node_modules`, then
launches detached and waits up to 12s for the port. `taskkill` / `killpg` on stop.

**Proxying** — forwards GET/POST/PUT/PATCH/DELETE, carries cookies both ways, and
rewrites app redirects back under `/p/<id>/`. Buffers small responses so
single-threaded backends (Flask's dev server) aren't held open by a slow tunnel client.

**System monitor** (admin-only) — CPU deltas from `/proc/stat` with a `/proc/loadavg`
fallback, per-core bars, ARM/SoC model detection via `getprop` + `/proc/cpuinfo`,
RAM/swap, disk, uptime, and GPU via `nvidia-smi`. Cached 5s so a dashboard poll never
blocks.

**Safety** — sensitive paths are never served (`/server.py`, `/projects.json`,
`/credentials.json`, `/.env`, `/.git`, …), path traversal is checked on every static
and proxy request, JSON writes are atomic, and deleting a project can only ever remove
a **top-level folder inside `Project List`** (plus stop the app and drop its lock
credentials and sessions).

---

## Dashboard

Dark ProjectFlow theme, mobile-first: bottom-sheet dialogs, 48px touch targets, 16px
inputs (no iOS focus zoom), search + sort toolbar, upload progress, approve/reject
badges, and a hardware panel. Refreshes every 30s.

---

## Hosting on a phone (Termux / Android)

Keep everything inside Termux home (`~`) — Android mounts `/sdcard` as `noexec`, so
binaries won't run from there. Install Termux from **F-Droid** (the Play Store build is
unmaintained).

`sh termux.sh setup` installs `python curl git unzip nano procps cloudflared`, clones
to `~/pm` and never overwrites an existing `credentials.json`. Use the Termux
`cloudflared` package: GitHub's `linux-*` binaries are rejected by Android's linker
(`unexpected e_type`).

```sh
sh termux.sh update              # back up state, pull updates, verify syntax
sh termux.sh update --check      # only show what's new
sh termux.sh update --force      # update even if you edited the code
```

It backs up `projects.json` / `credentials.json` / `project_auth.json` to
`~/.pm-backups/<timestamp>/`, fast-forwards the pull, restores your data, checks the
new code parses, then tells you to restart. It **refuses** to overwrite your edits to
`server.py` / `index.html` unless you pass `--force`.

**Keep it alive:** Android kills background apps, so run `termux-wake-lock` and set
Settings → Apps → Termux → Battery → **Unrestricted**. To auto-start on boot
(Termux:Boot addon):

```sh
mkdir -p ~/.termux/boot
printf '#!/bin/sh\ncd ~/pm && python host.py\n' > ~/.termux/boot/start-pm.sh
chmod +x ~/.termux/boot/start-pm.sh
```

**Know before you host from a phone**

- ✅ Static sites, dashboard, zip upload, locks, tunnel, hardware monitor.
- ⚠️ Backends needing numpy/OpenCV usually won't `pip install` on Termux — host those on a PC.
- ⚠️ Some carriers block QUIC/UDP — cloudflared falls back to HTTP/2 on its own.
- ⚠️ Reboots, dead battery or task killers stop the server. Fine for demos.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `No working python found` | Install Python (`pkg install python`, or python.org on Windows) |
| `Permission denied` running `./cloudflared` | You're on `/sdcard` — move everything under `~`, then `chmod +x cloudflared` |
| Port `8000` busy | `PORT=8001 python host.py` |
| Tunnel fails with `no such host` | No working DNS — reconnect, then re-run `host.py` (it retries 3×) |
| App exits with `ModuleNotFoundError` | Press **Run** again — `requirements.txt` installs automatically |
| `Port 810x is already in use` | The manager auto-bumps to a free port and saves it; or **Stop** the other project |
| Project stuck "awaiting approval" | Sign in as admin → **ACCOUNTS** → Approve |
| Page shows old content | Restart the server; the dashboard also auto-refreshes every 30s |

---

## Requirements

- Python 3 (any recent version) — stdlib only
- `cloudflared` on PATH or next to `host.py` (Windows: `cloudflared.exe`)
- Node.js only if you host Node managed projects

## Security note

Anyone with the link can create a **User** account and queue an **Admin** request, and
anyone can *open* projects that are live. Project configuration (folder path, run
command, port) is only visible to the uploader and to admins. Fine for a classroom
demo; for anything public, set a real password in `credentials.json` first. Lock
individual projects with **Lock** to hide their Run/Stop/Remove buttons behind a
password.