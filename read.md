# Server Project Manager — Summary

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
- Single tunnel exposes all projects (`host.bat` / `host.sh`).

## Project structure

```
Server Project Manager/
├── server.py          # Main server (ThreadingHTTPServer, ~2600 lines, stdlib only)
├── index.html         # HOST•DASHBOARD UI (ProjectFlow theme)
├── projects.json      # Project registry [{id, name, type, target, cmd, port...}]
├── credentials.json   # Admin accounts [{username, password, role}]
├── host.bat           # Windows: start backend + cloudflared quick tunnel
├── host.sh            # Linux/macOS mirror of host.bat
├── cloudflared.exe / cloudflared  # Tunnel binary
├── Project List/      # All uploaded / hosted projects live here
│   ├── unievent/      # static → ./Project List/unievent/prototype
│   ├── verifid/       # managed → python server.py, port 8100
│   └── baoncheck/     # static site
└── projects/demo/     # Example static demo
```

## Current projects (`projects.json`)

| id | name | type | target |
|----|------|------|--------|
| `unievent` | UniEvent | static | `./Project List/unievent/prototype` |
| `verifid` | VerifID | managed (`python server.py`, port `8100`) | `./Project List/verifid` |
| `baoncheck` | BaonCheck | static | `./Project List/baoncheck` |

## Key features in `server.py`

- **Dashboard API:** `GET /api/projects`, `POST /api/projects`, `/api/projects/update|delete|start|stop|runner`, `/api/detect`, `/api/upload`, `/api/browse`, `/api/system`, `/api/login`
- **ZIP upload:** `POST /api/upload?name=MySite` → extracts zip-slip-safe into `Project List/<slug>/`, strips single top-level folder, auto-detects `index.html` or runnable entry, auto-registers as `static` or `managed`. Any signed-in account may upload (max 2 projects each); admin uploads go live instantly, user uploads wait for admin approval (`/api/projects/approve|reject`). Pending projects are hidden from visitors and return 404 under `/p/` until approved.
- **Runner detection:** recursive folder walk (skips `node_modules`/`venv`/`.git`) ranking runnable-over-static at the same depth, so an app folder with both `server.py` and `index.html` runs instead of serving statically. Entries: `server.py`, `app.py`, `main.py`, `wsgi.py`, `run.py`, `manage.py` (Django, port baked in), `Procfile` web command, `package.json+start`, `server.js`/`index.js`/`app.js`. Warns when a python entry ignores the `PORT` env var. Double-wrapped zips are unwrapped. Assigned port passed as `PORT` env var.
- **Managed runner:** free-port pick (8100–8199), auto-installs `requirements.txt` (pip, once per change) or missing `node_modules` (`npm install`) into `runner-out.log`, detached process, `runner-out.log` / `runner-err.log`, 12s port-poll health check, `taskkill` / `killpg` stop.
- **Standalone runners:** `install_runner()` writes `runner.bat` + `runner.sh` into project folder (python / node / static templates) so each project can run alone on localhost.
- **Proxy:** forwards GET/POST/PUT/PATCH/DELETE to `127.0.0.1:<port>` with 20s timeout.
- **System monitor (admin-only):** non-blocking CPU deltas (`/proc/stat`, per-core on Linux; `GetSystemTimes` on Windows), RAM+swap (`/proc/meminfo` or `GlobalMemoryStatusEx`), disk (`shutil.disk_usage`), uptime, GPU (`nvidia-smi` + temp), 5s cache, `GET /api/system`.
- **Auth:**
  - Dashboard: public read-only list. Accounts: open signup (`Create account`) with roles `user` (instant) and `admin` (stays pending until an active admin approves it in the ACCOUNTS card). Mutations still need an active admin via `body.requester`. No `credentials.json` yet → default `admin/admin123`.
  - Projects: optional lock password (`locked` + `auth.password`) — link stays open, Run/Stop/Runner/Edit/Remove frozen until unlock. Path-scoped cookies `pm_<id>`.
- **Safety:** `BLOCKED` paths (`/server.py`, `/projects.json`, `/credentials.json`, `/.env`, `/.git`...), path-traversal checks, atomic `projects.json` writes.
- **Cleanup on delete:** removing a project can also wipe its files — the app is stopped, the top-level `Project List/<folder>` is deleted (read-only bits cleared), and any saved lock credentials + sessions are dropped. Only folders inside `Project List` are ever touched; projects pointing elsewhere keep their files. Rejecting a pending upload cleans up the same way.

## Dashboard (`index.html`)

Dark ProjectFlow UI, mobile-responsive. Admin sign-in dropdown, search + sort toolbar, Add form (naming modal + .zip upload), auto-refresh every 30s, live status dots (`online/running/starting/offline/missing/noindex`), Open/Run/Stop/Runner/Lock/Remove per card, HW monitor (CPU/RAM/GPU/HOST).

## How to run (single terminal)

```bat
host.bat
REM or: py -3 host.py  (python3 host.py on Linux, or sh host.sh)
REM env: PORT=8000
```

One terminal runs everything: `host.py` starts `server.py` (if `:8000` is free,
logs to `server-out.log` / `server-err.log`) plus the cloudflared quick tunnel
(full log in `tunnel.log`). The console shows only the pinned public link
(`https://xxxx.trycloudflare.com`, also saved to `tunnel-url.txt`) plus errors.
Ctrl+C stops tunnel + backend together.

Python pick order: `./python/` → `./venv/` → system `python`/`py` (stub-safe) → same for `python3` on POSIX. `host.*` auto-kills stale tunnels, starts backend if port free, verifies `/`, then runs `cloudflared tunnel --url`.

## Requirements

- Python 3 (any recent) — stdlib only
- `cloudflared` binary next to `host.bat` / `host.sh`
- Node.js only if hosting node managed projects
