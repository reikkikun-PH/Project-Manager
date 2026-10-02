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
| `Project List/` | All hosted projects, their logs and databases |
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

Anyone with the link can create a **User** account and queue an **Admin** request.
Fine for a classroom demo; for anything public, set a real password in
`credentials.json` first. Lock individual projects with **Lock** to hide their
Run/Stop/Remove buttons behind a password.