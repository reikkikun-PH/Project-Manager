# Host on Termux (Android) — step by step

No root needed. The backend is stdlib-only Python and Cloudflare publishes an
ARM64 `cloudflared` binary, so the whole stack runs on a phone.

> Golden rule: keep everything inside Termux home (`~`). Android mounts
> shared storage (`/sdcard`) as `noexec` — binaries and scripts won't run
> from there.

## 0. Automatic install (recommended)

In Termux (F-Droid build):

```sh
curl -L -o install-termux.sh https://raw.githubusercontent.com/reikkikun-PH/Project-Manager/main/install-termux.sh
sh install-termux.sh
```

That installs packages, detects your chip, clones this repo to `~/pm`,
downloads the right `cloudflared`, and creates `credentials.json`
(it never overwrites existing files — safe to re-run).
Options: `INSTALL_DIR=~/mysites sh install-termux.sh`,
`ADMIN_PASS='s3cret!' sh install-termux.sh`,
`sh install-termux.sh --force-cloudflared`.
Then skip to step 6. Manual steps below if you prefer doing it by hand.

## 1. Install Termux

Install **Termux from F-Droid** (the Play Store build is outdated and
unmaintained). Open it.

## 2. Install packages

```sh
pkg update && pkg upgrade -y
pkg install -y python unzip curl git nano
uname -m
```

* `aarch64` (most modern phones) → `cloudflared-linux-arm64` below
* `armv7l` (old 32-bit phones) → `cloudflared-linux-arm`

## 3. Get this project

```sh
cd ~
git clone https://github.com/reikkikun-PH/Project-Manager.git pm
cd pm
```

(`Project List/`, credentials, and the tunnel binary are intentionally not in
git — you add them below. `Project List/` is auto-created on first run.)

## 4. Install cloudflared (Termux package — built for Android)

```sh
pkg install -y cloudflared
cloudflared --version
```

`host.py` finds it on PATH automatically. Do **not** use the GitHub
`cloudflared-linux-*` binaries here — Android's linker rejects them
(`unexpected e_type`). Manual fallback only if the package is missing:

```sh
# aarch64: curl -L -o cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64
# 32-bit:  curl -L -o cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm
# chmod +x cloudflared
```

## 5. Create your admin login

```sh
cp credentials.example.json credentials.json
# Default login is admin / admin123 (change the password inside
# credentials.json if you host anything public).
```

## 6. Run it (single terminal)

```sh
python host.py
```

* Dashboard (open in Chrome on the phone): `http://127.0.0.1:8000`
* Sign in with your admin login from step 5.
* The **public link** (`https://xxx.trycloudflare.com`) stays pinned in the
  terminal and is also saved to `tunnel-url.txt`. It works over mobile data —
  no port forwarding, no root.
* Add sites from the dashboard: **Upload a project** → drop a `.zip`.
* Stop everything: `Ctrl+C` (volume-down + `C` in Termux).

## 7. Update to a new version

```sh
cd ~/pm
sh update-termux.sh
```

It backs up your state, pulls the new code, checks it parses, and tells you
to restart. **Your projects and logins are never touched** —
`Project List/`, `credentials.json`, `project_auth.json` and `cloudflared`
are all preserved (state files are backed up to `~/.pm-backups/<timestamp>/`
and restored around the pull).

```
sh update-termux.sh --check      # just show what's new, change nothing
sh update-termux.sh --force      # update even if you edited the code
sh update-termux.sh --no-backup  # skip the backup (not recommended)
```

Straight from GitHub (if the script is missing):

```sh
curl -L -o update-termux.sh \
  https://raw.githubusercontent.com/reikkikun-PH/Project-Manager/main/update-termux.sh
sh update-termux.sh
```

Notes:

* Stop the server first (`Ctrl+C`) — a running server keeps the **old** code
  in memory until you restart it. The script warns you if one is still up.
* If you edited `server.py` / `index.html` yourself, the script stops rather
  than overwriting your work. Commit or stash it, or use `--force` to have it
  stash and re-apply automatically (conflicting lines are shown for you to pick).
* If the pulled code ever fails to parse, you're told how to roll back with
  `git reset --hard HEAD~1`.

## 8. Keep it alive in the background

Android kills background apps. In Termux (same or second session):

```sh
termux-wake-lock
```

And in Android Settings → Apps → Termux → Battery → **Unrestricted**.
Release the lock when done: `termux-wake-unlock`.

Optional auto-start on reboot: install the **Termux:Boot** addon, then:

```sh
mkdir -p ~/.termux/boot
printf '#!/bin/sh\ncd ~/pm && python host.py\n' > ~/.termux/boot/start-pm.sh
chmod +x ~/.termux/boot/start-pm.sh
```

## Know before you host from a phone

* ✅ Static sites, dashboard, zip upload, locks, tunnel, hardware monitor
  (`/proc`-based stats work on Android kernels).
* ⚠️ Python app backends needing numpy/OpenCV (e.g. VerifID) almost certainly
  won't `pip install` on Termux — host those backends on a PC instead.
* ⚠️ Some carriers block QUIC/UDP — cloudflared falls back to HTTP/2 on its
  own, just slower to connect.
* ⚠️ Phone reboots, dead battery, or aggressive task killers stop the server.
  A phone is great for demos — use a PC for 24/7.
* ⚠️ `pkill` (stale-tunnel cleanup) needs `pkg install procps` — optional.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Permission denied` running `./cloudflared` | You're on `/sdcard` — move everything under `~`, then `chmod +x cloudflared` |
| `No working python found` | `pkg install python`, then retry |
| Port `8000` busy | `PORT=8001 python host.py` |
| Tunnel connects slowly | Carrier blocking UDP — wait, it falls back automatically |
| Termux dies in background | `termux-wake-lock` + Battery Unrestricted (step 7) |
| Want the newest version | `sh update-termux.sh` (step 7) — stop the server first |
| Page shows old content | Pull-to-refresh; the dashboard auto-refreshes every 30s |
