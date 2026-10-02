# Server Project Manager

Host many projects on **one address** with one Python server + one Cloudflare tunnel.

> Dashboard at `/` → every project is reachable under `/p/<id>/` on the same host.

No dependencies — **stdlib only**, no `pip install` needed.

## What it does

- Central dashboard (`index.html`) to **add / run / stop / lock / remove** projects.
- Serves 3 project types:
  - `static` — serve a local folder (e.g. `./Project List/unievent/prototype`)
  - `proxy` — forward to an app already running on a local port (e.g. `3000`)
  - `managed` — launched by the manager itself (`python server.py`, `npm start`, etc.) with health-check + logs
- Public link per project: `http://localhost:8000/p/<id>/` → public via Cloudflare `https://xxxx.trycloudflare.com/p/<id>/`
- One tunnel exposes all projects (`host.bat` on Windows, `python host.py` anywhere).
- Accounts + approvals: anyone can sign up, **admin** requests need approval, and each
  user may host **2 projects**, also needing approval.

## Files (8 tracked — everything else is your data)

```
Server Project Manager/
├── server.py              # Main server (ThreadingHTTPServer, ~3000 lines, stdlib only)
├── index.html             # HOST•DASHBOARD UI (CSS + JS inline)
├── host.py                # Supervisor: backend + tunnel in one terminal
├── host.bat               # Windows launcher for host.py
├── termux.sh              # Termux/Android: `setup` (install) and `update` (pull)
├── projects.example.json  # Sample registry — copy to projects.json if you want it
├── read.md                # This file
└── .gitignore
```

Created at runtime (never in git):

| File | What it holds |
|------|---------------|
| `projects.json` | Project registry `[{id, name, type, target, cmd, port, owner, approval}]` |
| `credentials.json` | Accounts `[{username, password, role, status}]` |
| `project_auth.json` | Per-project lock passwords |
| `Project List/` | All hosted projects (uploaded zips, their logs, databases) |
| `cloudflared` / `.exe` | Tunnel binary |
| `*.log`, `tunnel-url.txt` | Backend / runner / tunnel logs and the pinned public link |

A fresh clone starts with **no** projects — the dashboard shows an empty state and you
upload your first `.zip`. To start from the samples instead:
`copy projects.example.json projects.json`.

## Key features in `server.py`

- **Dashboard API:** `GET /api/projects`, `POST /api/projects`, `/api/projects/update|delete|start|stop|runner|approve|reject`, `/api/detect`, `/api/upload`, `/api/browse`, `/api/system`, `/api/accounts*`, `/api/register`, `/api/login`
- **ZIP upload:** `POST /api/upload?name=MySite` → extracts zip-slip-safe into `Project List/<slug>/`, strips wrapper folders, auto-detects `index.html` or a runnable entry, auto-registers as `static` or `managed`. Any signed-in account may upload (max 2 each); admin uploads go live instantly, user uploads wait for approval. Pending projects are hidden from visitors and 404 under `/p/` until approved.
- **Runner detection:** recursive folder walk (skips `node_modules`/`venv`/`.git`) ranking runnable-over-static at the same depth, so an app folder with both `server.py` and `index.html` runs instead of serving statically. Entries: `server.py`, `app.py`, `main.py`, `wsgi.py`, `run.py`, `manage.py` (Django, port baked in), `Procfile` web command, `package.json+start`, `server.js`/`index.js`/`app.js`. Warns when a python entry ignores the `PORT` env var.
- **Managed runner:** free-port pick (8100–8199, never reusing another project's port), auto-installs `requirements.txt` (pip, once per change) or missing `node_modules` (`npm install`) into `runner-out.log`, detached process, 12s port-poll health check, `taskkill`/`killpg` stop. A busy port auto-bumps to a free one and saves it.
- **Standalone runners:** the Runner button writes `runner.bat` + `runner.sh` into the project folder so it can also run alone on localhost.
- **Proxy:** forwards GET/POST/PUT/PATCH/DELETE to `127.0.0.1:<port>`, forwarding cookies and rewriting app redirects back under `/p/<id>/`.
- **System monitor (admin-only):** non-blocking CPU deltas (`/proc/stat` + `loadavg` fallback, per-core; `GetSystemTimes` on Windows), ARM/SoC model + arch, RAM+swap, disk, uptime, GPU (`nvidia-smi`), 5s cache, `GET /api/system`.
- **Auth:**
  - Accounts: open signup with roles `user` (instant) and `admin` (pending until an active admin approves it in the ACCOUNTS card). Without `credentials.json` the default login is `admin` / `admin123`.
  - Projects: optional lock password — link stays open, Run/Stop/Runner/Edit/Remove frozen until unlock. Path-scoped cookies `pm_<id>`.
- **Safety:** `BLOCKED` paths (`/server.py`, `/projects.json`, `/credentials.json`, `/.env`, `/.git`…), path-traversal checks, atomic JSON writes.
- **Cleanup on delete:** removing a project can also wipe its files — the app is stopped, the top-level `Project List/<folder>` is deleted, and saved lock credentials + sessions are dropped. Only folders inside `Project List` are ever touched.

## Dashboard (`index.html`)

Dark ProjectFlow UI, mobile-first (bottom-sheet dialogs, 48px touch targets, no iOS
zoom on focus). Sign-in + **Create account**, search + sort toolbar, `.zip` upload with
progress, live status dots, Open/Run/Stop/Runner/Lock/Remove per card, ACCOUNTS
approvals, HW monitor. Auto-refreshes every 30s.

## How to run (single terminal)

```bat
host.bat                REM Windows - double-click or from a terminal
```

```sh
python host.py          # Windows: py -3 host.py   |   Linux/macOS/Termux: python3 host.py
PORT=8000 python host.py
```

One terminal runs everything: `host.py` starts `server.py` (if the port is free,
logs to `server-out.log` / `server-err.log`) plus the cloudflared quick tunnel (full
log in `tunnel.log`). The console shows only the pinned public link (also saved to
`tunnel-url.txt`) plus errors. It checks DNS first and retries the tunnel up to 3
times if a quick tunnel fails to start. Ctrl+C stops tunnel + backend together.

## Hosting on a phone (Termux / Android)

No root needed. Keep everything inside Termux home (`~`) — Android mounts `/sdcard`
as `noexec`, so binaries won't run from there.

```sh
# 1. Install Termux from F-Droid (the Play Store build is unmaintained), then:
curl -L -o termux.sh \
  https://raw.githubusercontent.com/reikkikun-PH/Project-Manager/main/termux.sh

# 2. Install packages, clone the repo, set up cloudflared + admin login
sh termux.sh setup
#    Optional: ADMIN_PASS='s3cret!' sh termux.sh setup

# 3. Run everything from this one terminal
cd ~/pm && python host.py
```

`setup` installs `python curl git unzip nano procps cloudflared` (the Termux package is
built for Android — GitHub's `linux-*` binaries are rejected with `unexpected e_type`),
clones to `~/pm`, and never overwrites an existing `credentials.json`.

**Updating later:**

```sh
cd ~/pm && sh termux.sh update              # back up state, pull, verify
sh termux.sh update --check                 # just show what's new
sh termux.sh update --force                 # update even if you edited the code
```

It backs up `projects.json` / `credentials.json` / `project_auth.json` to
`~/.pm-backups/<timestamp>/`, fast-forwards the pull, restores your data, checks the
new code parses, and tells you to restart. It **refuses** to overwrite your own edits
to `server.py` / `index.html` (commit, stash, or use `--force`). Stop the server first
(Ctrl+C) — a running server keeps serving the old code.

**Keep it alive in the background:** Android kills background apps, so run
`termux-wake-lock`, and set Android Settings → Apps → Termux → Battery →
**Unrestricted**. To auto-start on boot (Termux:Boot addon):

```sh
mkdir -p ~/.termux/boot
printf '#!/bin/sh\ncd ~/pm && python host.py\n' > ~/.termux/boot/start-pm.sh
chmod +x ~/.termux/boot/start-pm.sh
```

**Know before you host from a phone**

- ✅ Static sites, dashboard, zip upload, locks, tunnel, hardware monitor.
- ⚠️ Backends needing numpy/OpenCV usually won't `pip install` on Termux — host those on a PC.
- ⚠️ Some carriers block QUIC/UDP — cloudflared falls back to HTTP/2 on its own.
- ⚠️ Reboots, dead battery or aggressive task killers stop the server. Great for demos.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `No working python found` | Install Python (`pkg install python` on Termux, python.org on Windows) |
| `Permission denied` running `./cloudflared` | You're on `/sdcard` — move everything under `~`, then `chmod +x cloudflared` |
| Port `8000` busy | `PORT=8001 python host.py` |
| Tunnel fails / `no such host` | No working DNS — reconnect Wi-Fi/mobile data, or re-run `host.py` (it retries 3×) |
| App exits with `ModuleNotFoundError` | Press **Run** again — `requirements.txt` installs automatically on first run |
| `Port 810x is already in use` | The manager auto-bumps to a free port and saves it; or **Stop** the other project |
| Project stuck on "awaiting approval" | Sign in as admin → **ACCOUNTS** → Approve |
| Tunnel connects slowly | Carrier blocking UDP — it falls back automatically |
| Page shows old content | Restart the server; the dashboard also auto-refreshes every 30s |

## Requirements

- Python 3 (any recent) — stdlib only
- `cloudflared` on PATH or next to `host.py` (Windows: `cloudflared.exe`)
- Node.js only if hosting node managed projects