#!/bin/sh
# Server Project Manager - Termux one-shot installer (Android, no root).
# Run INSIDE Termux (F-Droid build). Safe to re-run: it never overwrites
# your credentials.json, cloudflared binary, or hosted projects.
#
# Usage:
#   sh install-termux.sh
#   INSTALL_DIR=~/mysites sh install-termux.sh        # custom folder
#   ADMIN_PASS='s3cret!' sh install-termux.sh         # also set admin login
#   sh install-termux.sh --force-cloudflared          # re-download tunnel binary
#
# Or straight from GitHub (needs curl only):
#   curl -L -o install-termux.sh \
#     https://raw.githubusercontent.com/reikkikun-PH/Project-Manager/main/install-termux.sh
#   sh install-termux.sh
#
# Afterwards:  cd ~/pm && python host.py
set -u

REPO="https://github.com/reikkikun-PH/Project-Manager.git"
INSTALL_DIR="${INSTALL_DIR:-$HOME/pm}"
FORCE_CF=0

for arg in "$@"; do
  case "$arg" in
    --force-cloudflared) FORCE_CF=1 ;;
    -h|--help)
      echo "Usage: sh install-termux.sh [--force-cloudflared]"
      echo "Env: INSTALL_DIR=~/pm  ADMIN_PASS='your-admin-password'"
      exit 0 ;;
    *) echo "[ERROR] Unknown option: $arg (try --help)"; exit 1 ;;
  esac
done

say() { echo "[installer] $*"; }
die() { echo "[ERROR] $*" >&2; exit 1; }

# --- 0. Must be Termux (needs `pkg`, Linux userland, exec-allowed $HOME) ---
[ -n "${PREFIX:-}" ] || die "Not running in Termux (no \$PREFIX). Install Termux from F-Droid first."
command -v pkg >/dev/null 2>&1 || die "'pkg' not found - is this Termux?"

# --- 1. System packages (cloudflared from Termux repo: built for Android) ---
say "Installing packages (python unzip curl git nano procps cloudflared)..."
pkg update -y || die "'pkg update' failed - check your connection."
pkg install -y python unzip curl git nano procps cloudflared || die "'pkg install' failed."

# --- 2. CPU arch -> cloudflared asset ---
ARCH="$(uname -m)"
case "$ARCH" in
  aarch64|arm64) CF_ASSET="cloudflared-linux-arm64" ;;
  armv7l|armv6l|arm) CF_ASSET="cloudflared-linux-arm" ;;
  *) die "Unsupported arch '$ARCH' (need aarch64 or 32-bit ARM)." ;;
esac
say "Arch: $ARCH -> $CF_ASSET"

# --- 3. Project files (clone first time, pull on re-run) ---
if [ -d "$INSTALL_DIR/.git" ]; then
  say "Updating existing install at $INSTALL_DIR ..."
  git -C "$INSTALL_DIR" pull --ff-only || say "git pull skipped (local changes kept)."
elif [ -e "$INSTALL_DIR" ]; then
  die "$INSTALL_DIR exists but is not a git checkout - move it or set INSTALL_DIR elsewhere."
else
  say "Cloning into $INSTALL_DIR ..."
  git clone "$REPO" "$INSTALL_DIR" || die "git clone failed."
fi
cd "$INSTALL_DIR" || die "Cannot cd to $INSTALL_DIR."

# --- 4. cloudflared: Termux package first, GitHub binary as fallback ---
# (GitHub's linux builds are not PIE - Android's linker rejects them with
#  "unexpected e_type". The Termux package is built for Android.)
CF_BIN=""
if [ -e "./cloudflared" ] && ! ./cloudflared --version >/dev/null 2>&1; then
  say "Removing broken ./cloudflared binary..."
  rm -f ./cloudflared
fi
if [ "$FORCE_CF" -eq 0 ] && command -v cloudflared >/dev/null 2>&1 \
    && cloudflared --version >/dev/null 2>&1; then
  CF_BIN="cloudflared"
  say "Using system cloudflared: $(command -v cloudflared)"
elif [ -x "./cloudflared" ] && [ "$FORCE_CF" -eq 0 ]; then
  CF_BIN="./cloudflared"
  say "cloudflared already present - skipping download."
else
  say "Downloading $CF_ASSET ..."
  rm -f ./cloudflared
  curl -L -o ./cloudflared \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/$CF_ASSET" \
    || die "Download failed."
  chmod +x ./cloudflared
  CF_BIN="./cloudflared"
fi
"$CF_BIN" --version >/dev/null 2>&1 || die "No working cloudflared found."
say "cloudflared OK: $($CF_BIN --version 2>/dev/null | head -n 1)"

# --- 5. Admin login (never overwrite an existing one) ---
if [ -f "./credentials.json" ]; then
  say "credentials.json already exists - kept as-is."
elif [ -n "${ADMIN_PASS:-}" ]; then
  printf '[\n  {\n    "username": "admin",\n    "password": %s,\n    "role": "admin"\n  }\n]\n' \
    "$(printf '%s' "$ADMIN_PASS" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
    > ./credentials.json
  say "Admin login created from ADMIN_PASS."
else
  cp ./credentials.example.json ./credentials.json
  say "Copied credentials.example.json -> credentials.json."
  say "EDIT IT NOW: nano credentials.json  (change CHANGE_ME_BEFORE_HOSTING)"
fi

chmod +x ./host.sh 2>/dev/null || true

echo ""
echo "Done. To host (single terminal):"
echo "  cd $INSTALL_DIR && python host.py"
echo "Dashboard: http://127.0.0.1:8000   (public link is pinned in the terminal)"
