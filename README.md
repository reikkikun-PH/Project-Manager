# Server Project Manager

**Host many projects on one address.** One Python backend, one dashboard, one
Cloudflare tunnel — every project lives at `/p/<id>/` on the same link.

- **Stdlib only.** No `pip install`, no build step. Python 3 and nothing else.
- **8 files.** `server.py`, `index.html`, `host.py`, `host.bat`, `termux.sh`,
  `projects.example.json`, `README.md`, `.gitignore`.
- **Works on a phone.** Termux/Android, ARM included — the same code.

> **New here?** [`Architecture/index.html`](Architecture/index.html) is an
> interactive 3D map of how it all fits together, written for people who don't
> read code. Open it in a browser — no server needed. It is documentation only
> and is never served by the app.

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

The dashboard is at `http://localhost:8000` — sign in with
**`superadmin` / `admin123`** unless you set your own in `credentials.json`.

`superadmin` is the **super admin**: the built-in owner account, and the only
one that can never be removed from the accounts list. That is deliberate — if
every admin account were ever removed there would be nothing left to sign in
with and no way to create a new admin. Keep its password somewhere safe, and do
not reuse it elsewhere.

Writing `credentials.json` yourself? Give that account `"super": true`. Older
files containing only a plain `admin` account are upgraded automatically the
first time the server reads them.

### Per-project resource usage

Every project card shows its own resource line for the **uploader and admins** (it
carries the same private-data rules as the configuration — other users and visitors
see nothing):

| Shown | Meaning |
|---|---|
| `CPU ▓▓░░ 3.1%` | That project's process CPU since the previous poll |
| `RAM 41.6 MB` | Working set of its process |
| `up 12m` | How long it has been running |
| `port 8100` | The port it was given |
| `disk 40.84 MB` | Size of its project folder |
| `files 38 · dirs 3` | What is inside that folder |
| `largest: …onnx (36.9 MB)` | Its three biggest files |
| `logs out 1.2 MB` | Runner log sizes, handy when something is looping |

The HOST box in the hardware panel totals it up: apps running, RAM and CPU summed
across all of them, and total project disk + file count.

How it is measured, and why it stays cheap:

- **CPU%** is a delta between two samples of the process CPU counter
  (`GetProcessTimes` on Windows, `/proc/<pid>/stat` on Linux/Termux), so the first
  poll shows "measuring" rather than a wrong number.
- **RAM** is the working set (`GetProcessMemoryInfo` / `/proc/<pid>/statm`).
- **Disk** walks the project folder, but stops after 4 seconds or 40 000 files and
  caches the result for 20 seconds — a folder full of model weights can't stall a
  dashboard refresh, and the card shows `partial` when the walk was cut short.
- Everything is best-effort and wrapped so it can never break the dashboard; a field
  that cannot be read is simply omitted.

On the current machine that reads roughly: VerifID ~41 MB RAM for a 40.8 MB folder
(dominated by a 36.9 MB face-recognition model), the three static sites under 0.15 MB
each, and the whole board ~41 MB RAM + ~41 MB disk.

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
- **Accounts with roles.** Anyone can sign up with an email address. A **user**
  confirms it with a 6-digit code and is straight in — no approval, nobody to
  wait on. **admin** requests and **project uploads** wait for approval.
- **Hardware panel** — CPU (with ARM/SoC model), RAM, disk, GPU, uptime.

### Approval e-mails (optional)

When someone requests **admin access** or **uploads a project waiting for approval**,
the manager can email you so you don't have to keep the dashboard open. It uses a
hosted email API over plain HTTP with the stdlib — no extra packages.

Two providers are supported. **Brevo is the default** because it needs no domain
of your own; Resend is kept as an alternative.

Create `notify.json` next to your state (it is gitignored, so the key is never
uploaded):

```json
{
  "enabled": true,
  "provider": "brevo",
  "brevoApiKey": "xkeysib-...",
  "from": "Project Manager <you@gmail.com>",
  "to": "you@example.com"
}
```

Or set `BREVO_API_KEY` and `NOTIFY_TO` as environment variables instead.

#### Brevo (recommended — no domain needed)

[Brevo](https://brevo.com)'s free plan sends **300 emails/day** and, crucially,
lets you register a sender by confirming a 6-digit code sent to that address.
So `you@gmail.com` becomes a legitimate sender **without any DNS records**, and
can then mail anyone. Steps:

1. Sign up at brevo.com → **Settings → Senders & Domains → Add a new sender**.
2. Enter your address, confirm the 6-digit code Brevo emails you.
3. **SMTP & API → API Keys → Generate a new key**, and put it in `notify.json`.

The `from` address **must be a sender registered on the account** — Brevo rejects
anything else with a 400. `Send test e-mail` in the ACCOUNTS card checks this and
tells you before a real approval is affected.

**Trade-off:** a `gmail.com` sender can't be DKIM- or SPF-authenticated, so some
of these land in spam. Authenticating a domain (or using a provider that supports
Brevo's SMTP relay with a custom domain) fixes it. The test e-mail reports this
so it isn't a surprise.

#### Resend (alternative — needs a verified domain)

```json
{
  "enabled": true,
  "provider": "resend",
  "resendApiKey": "re_...",
  "from": "Project Manager <notifications@yourdomain.com>",
  "to": "you@example.com"
}
```

Set `provider` to `"resend"` (or drop `brevoApiKey`) to switch. Keep both keys in
the file if you like — the `provider` key picks one.

Resend's shared `onboarding@resend.dev` domain is **testing-only**: it may only
send to the address on your Resend account, and returns HTTP 403 for anyone else.
Verify your own domain at resend.com/domains before using this for real mail.

What gets emailed:

| Trigger | Sent to | Email |
|---|---|---|
| Signup asking for the **admin** role | you | username, their email, where to approve it, and the session link |
| The same signup, **to the applicant** | **them** | "we received your request, wait here for the decision" |
| A **user** account signup | you | username, their email, and a note that it is waiting on their code |
| A **user** account signup, **the code** | **them** | the 6-digit code, what it is for, and how long it lasts |
| A **user's** project upload (waiting for approval) | you | project name, id, type, owner, and where it will be live |
| An **admin** upload | — | *nothing* — it goes live immediately |
| You **approve** an admin request | **the applicant** | approved — sign in now, with the link |
| You **reject** an admin request | **the applicant** | declined, and who decided it |

An applicant therefore gets **two** messages for an admin request: an
acknowledgement ("we got it, wait") and later the decision ("approved" or
"declined"). The acknowledgement matters because without it someone who signs
up has no way to know their request even arrived.

### The confirmation popup after signup

Submitting the form pops up a short modal — **REQUEST RECEIVED / Waiting for
approval** for an admin request, **EMAIL CONFIRMED / Ready to sign in** once a
user has entered their code. It says what happened, which address it went to,
and what to do next. One button dismisses it; Escape or a click outside works
too.

A **user** signup goes somewhere else first: straight to **CONFIRM YOUR EMAIL**,
with a box for the 6-digit code, a **Resend** button and **Do this later** —
they are not asked to wait for an approval that will never come. If the code
could **not** be sent, that screen says so in red and explains that the account
cannot be used until a code arrives; it never claims to have sent something the
mail API rejected. Registration still succeeds either way, because a mail outage
must not block someone signing up — but unlike before, the account is not usable
until the code lands, and the screen is explicit about that.

If the code e-mail could not be sent, the signup modal's red warning tells them
to write the address down.

### Every account needs an email address, and users confirm it with a code

Signup asks for an email address and it is **required for every account**.

- A **user** signs up with an address, gets a **6-digit code** emailed to it, and
  enters the code. That is the whole approval process — no administrator is
  involved at any point. Until the code comes back the account exists but
  **cannot sign in**, so nobody can register using an address they do not own.
- An **admin** request is treated as already verified: its gate is a human
  approver, not a code, so it is queued as **PENDING** exactly as before.

Emails are stored lower-cased on the account (`credentials.json`) and must be
unique across accounts, so one person cannot hold several identities the
approver can't tell apart.

**UNVERIFIED** in the ACCOUNTS card is a distinct state from **PENDING**, and the
difference matters: *pending* means a human is holding it up, *unverified* means
nobody is — the applicant just has not entered the code yet. Unverified rows are
therefore **not** counted by the pending badge and have **no Approve button**,
because approving them would hand out a working account for an unproven address.
They do keep a **Remove** button, so an abandoned signup can be cleared and the
username freed.

Accounts created before verification existed have no `verified` key and are
**treated as verified**, so upgrading never locks an existing install out of its
own dashboard. A pending admin with no address is tagged **NO EMAIL** in the list
so you know to tell them yourself.

#### How the code is handled

- Six digits from the CSPRNG, digits only — no `O`/`0` or `1`/`l` to mistype.
- The code is **never stored**. Only a salted SHA-256 hash is kept, in memory,
  so a dump of the running process cannot be replayed as a sign-in.
- Valid for **10 minutes**, then it must be requested again.
- **Five wrong guesses** burn the code. Six digits is a million combinations, so
  this is what stops guessing.
- **60-second cooldown** between sends, and **5 codes per account per hour**, so
  the endpoint cannot be used to mail-bomb an address.
- Codes live in memory only: restarting the server invalidates them. That costs
  one **Resend** click, which is why the popup offers it.
- The mail is sent **synchronously** and the response reports what the mail API
  actually said. If the code could not be sent you are told so plainly and given
  a resend button, rather than being left staring at an empty inbox.

If someone reaches the code step from a failed sign-in (their password was right,
their address is not confirmed), the login card grows an **"I have a code"**
button so they never have to sign up again.


Removing an *active* account sends no "declined" mail — declining a request and
revoking access are different things, and only the first is a decision on an
application.

#### Decision e-mails are verified, not assumed

Approving or rejecting sends synchronously and reports what the mail API
**actually accepted**. If the send is rejected the approval still stands — you
are never locked out by a mail failure — but the ACCOUNTS card turns amber and
says so, naming the cause. With Brevo, a bad `from` looks like this:

> Approved `bob`, but `bob@example.com` was **NOT** emailed — the `from` address
> is not a verified Brevo sender — add and confirm it under Settings > Senders &
> Domains. Tell them yourself.

Common causes get specific advice: an unregistered `from`, a bad API key, rate
limiting, or a sandbox-domain restriction. Only decision e-mails are synchronous;
uploads and signup notifications stay fire-and-forget so a slow mail API can never
delay them.

Verify it end to end from the dashboard: sign in as superadmin → **ACCOUNTS** →
**Send test e-mail**. Every attempt (sent or failed) is also appended to
`notify.log`, so you can check delivery history without a console:

```sh
cat notify.log          # or: type notify.log   on Windows
```

Notes:

- If a test e-mail arrives but an approval one doesn't, the difference is *which*
  trigger fired: admin uploads send nothing because they need no approval, and a
  decision e-mail only goes out when the account actually has an address on file.
- **A successful send means the provider accepted the message, not that it was
  delivered.** Both Brevo (Emails → Logs) and Resend (Emails → Logs) show
  per-message delivery status. Check spam/quarantine too.
- **Free sender domains cost you deliverability.** Sending as `you@gmail.com`
  carries no DKIM/SPF, so expect a share of messages in spam. Authenticate a
  domain when this project needs to be reliable.

- Sending happens in a background thread with a 12s timeout, so a slow or broken mail
  API never delays an upload; failures are only written to the server log
  (`[Notify] FAILED: …`). Approval decisions are the exception — see above.
- Links in e-mails are probed for liveness before being printed, so a mail never
  advertises a dead tunnel. The first check after startup waits up to 9s for a
  verdict rather than falling back to a `127.0.0.1` link.
- `from` must be a registered sender on the provider. Brevo rejects an unknown
  one with a 400; Resend's `onboarding@resend.dev` only works for your own
  Resend account address. This matters most for **decision e-mails**, which go to
  other people's addresses and are rejected outright without a proper sender.
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
| CPU / RAM / disk / PID of the project | **yes** | **yes** | no | no |
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
| Project stuck "awaiting approval" | Sign in as superadmin → **ACCOUNTS** → Approve |
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