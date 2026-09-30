# Host on Termux (Android) — step by step

No root needed. The backend is stdlib-only Python and Cloudflare publishes an
ARM64 `cloudflared` binary, so the whole stack runs on a phone.

> Golden rule: keep everything inside Termux home (`~`). Android mounts
> shared storage (`/sdcard`) as `noexec` — binaries and scripts won't run
> from there.

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

## 4. Download cloudflared (pick your arch from step 2)

```sh
# aarch64:
curl -L -o cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64
# 32-bit ARM instead:
# curl -L -o cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm
chmod +x cloudflared
./cloudflared --version
```

## 5. Create your admin login

```sh
cp credentials.example.json credentials.json
nano credentials.json   # change "CHANGE_ME_BEFORE_HOSTING" to your password
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

## 7. Keep it alive in the background

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
| Page shows old content | Pull-to-refresh; the dashboard auto-refreshes every 30s |
