#!/bin/sh
# Server Project Manager - Termux helper (Android, no root).
# One script for setup and updates. Run INSIDE Termux (F-Droid build).
#
#   sh termux.sh setup              install packages, clone, tunnel, admin login
#   sh termux.sh update             pull the newest code (keeps your data)
#   sh termux.sh update --check     only report what is new, change nothing
#   sh termux.sh update --force     update even if you edited the code
#
# Env:
#   INSTALL_DIR=~/pm     where to clone            (default ~/pm)
#   BRANCH=main          branch to track
#   ADMIN_PASS='s3cret!' admin password during setup
#
# Or straight from GitHub (needs curl only):
#   curl -L -o termux.sh \
#     https://raw.githubusercontent.com/reikkikun-PH/Project-Manager/main/termux.sh
#   sh termux.sh setup
#
# Neither command ever touches: Project List/ (your projects),
# credentials.json (your logins), project_auth.json (lock passwords),
# cloudflared (the tunnel binary).
set -u

REPO="https://github.com/reikkikun-PH/Project-Manager.git"
INSTALL_DIR="${INSTALL_DIR:-$HOME/pm}"
BRANCH="${BRANCH:-main}"
# Runtime state preserved across updates.
STATE_FILES="projects.json credentials.json project_auth.json tunnel-url.txt"

CMD=""
FORCE=0
CHECK_ONLY=0
MAKE_BACKUP=1

for arg in "$@"; do
  case "$arg" in
    setup)              CMD="setup" ;;
    update)             CMD="update" ;;
    --check)            CHECK_ONLY=1 ;;
    --force)            FORCE=1 ;;
    --no-backup)        MAKE_BACKUP=0 ;;
    -h|--help|help|"")  CMD="help" ;;
    *) echo "[ERROR] Unknown option: $arg (try --help)"; exit 1 ;;
  esac
done

if [ "$CMD" = "help" ] || [ -z "$CMD" ]; then
  cat <<'USAGE'
Server Project Manager - Termux helper

  sh termux.sh setup    install everything and create your admin login
  sh termux.sh update   pull the newest version (your projects are kept)
  sh termux.sh update --check    show pending updates only

Options: --force (update even with local code edits), --no-backup
Env:     INSTALL_DIR=~/pm  BRANCH=main  ADMIN_PASS='your-password'

After setup, host everything from one terminal:
  cd ~/pm && python host.py
USAGE
  exit 0
fi

say()  { echo "[termux] $*"; }
warn() { echo "[WARN] $*" >&2; }
die()  { echo "[ERROR] $*" >&2; exit 1; }

require_termux() {
  [ -n "${PREFIX:-}" ] || die "Not running in Termux (no \$PREFIX).
       Install Termux from F-Droid first."
  command -v pkg >/dev/null 2>&1 || die "'pkg' not found - is this Termux?"
}

pick_python() {
  if [ -x "$PWD/python/bin/python3" ]; then echo "$PWD/python/bin/python3"; return; fi
  if [ -x "$PWD/python/bin/python" ]; then echo "$PWD/python/bin/python"; return; fi
  if [ -x "$PWD/venv/bin/python3" ]; then echo "$PWD/venv/bin/python3"; return; fi
  if [ -x "$PWD/venv/bin/python" ]; then echo "$PWD/venv/bin/python"; return; fi
  if command -v python3 >/dev/null 2>&1; then echo python3; return; fi
  if command -v python >/dev/null 2>&1; then echo python; return; fi
  echo ""
}

# --------------------------------------------------------------------------
# setup: packages, clone, tunnel binary, admin login. Safe to re-run.
# --------------------------------------------------------------------------
do_setup() {
  require_termux

  say "Installing packages (python unzip curl git nano procps cloudflared)..."
  pkg update -y || die "'pkg update' failed - check your connection."
  pkg install -y python unzip curl git nano procps cloudflared || die "'pkg install' failed."

  # ARM asset only matters for the GitHub fallback binary.
  ARCH="$(uname -m)"
  case "$ARCH" in
    aarch64|arm64)   CF_ASSET="cloudflared-linux-arm64" ;;
    armv7l|armv6l|arm) CF_ASSET="cloudflared-linux-arm" ;;
    *) CF_ASSET="" ;;
  esac
  say "Arch: $ARCH"

  if [ -d "$INSTALL_DIR/.git" ]; then
    say "Already installed at $INSTALL_DIR - keeping it (use 'sh termux.sh update')."
  elif [ -e "$INSTALL_DIR" ]; then
    die "$INSTALL_DIR exists but is not a git checkout - move it or set INSTALL_DIR elsewhere."
  else
    say "Cloning into $INSTALL_DIR ..."
    git clone "$REPO" "$INSTALL_DIR" || die "git clone failed."
  fi
  cd "$INSTALL_DIR" || die "Cannot cd to $INSTALL_DIR."

  # cloudflared: Termux package first (built for Android), GitHub second.
  # GitHub's linux builds are not PIE - Android's linker rejects them with
  # "unexpected e_type" - so the package is strongly preferred.
  if [ -e "./cloudflared" ] && ! ./cloudflared --version >/dev/null 2>&1; then
    say "Removing broken ./cloudflared binary..."
    rm -f ./cloudflared
  fi
  if command -v cloudflared >/dev/null 2>&1 && cloudflared --version >/dev/null 2>&1; then
    say "cloudflared OK: $(cloudflared --version 2>/dev/null | head -n 1)"
  elif [ -x "./cloudflared" ]; then
    say "cloudflared OK: $(./cloudflared --version 2>/dev/null | head -n 1)"
  elif [ -n "$CF_ASSET" ]; then
    say "Downloading $CF_ASSET ..."
    rm -f ./cloudflared
    curl -L -o ./cloudflared \
      "https://github.com/cloudflare/cloudflared/releases/latest/download/$CF_ASSET" \
      || die "Download failed (or install the package: pkg install cloudflared)."
    chmod +x ./cloudflared
    ./cloudflared --version >/dev/null 2>&1 || die "Downloaded binary will not run here."
    say "cloudflared OK."
  else
    warn "No cloudflared for arch '$ARCH' - install it with:  pkg install cloudflared"
  fi

  # Admin login. Without credentials.json the server falls back to
  # superadmin/admin123, so we only write a file when a password was
  # requested. The account written here is the super admin: the one account
  # that can never be removed from the accounts list.
  if [ -f "./credentials.json" ]; then
    say "credentials.json already exists - kept as-is."
  elif [ -n "${ADMIN_PASS:-}" ]; then
    PYJ="$(pick_python)"
    [ -n "$PYJ" ] || die "No python to write credentials.json safely."
    printf '[\n  {\n    "username": "superadmin",\n    "password": %s,\n    "role": "admin",\n    "status": "active",\n    "super": true\n  }\n]\n' \
      "$(printf '%s' "$ADMIN_PASS" | "$PYJ" -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
      > ./credentials.json
    say "Super admin login created from ADMIN_PASS."
  else
    say "No credentials.json - the default login is superadmin / admin123."
  fi

  chmod +x ./termux.sh 2>/dev/null || true

  echo ""
  say "Setup done. Host everything from one terminal:"
  say "    cd $INSTALL_DIR && python host.py"
  say "Dashboard: http://127.0.0.1:8000  (public link is pinned in the terminal)"
  say "Later:     cd $INSTALL_DIR && sh termux.sh update"
}

# --------------------------------------------------------------------------
# update: back up state, fast-forward pull, verify, restore state.
# --------------------------------------------------------------------------
do_update() {
  [ -d "$INSTALL_DIR/.git" ] || die "No git checkout at $INSTALL_DIR
       Install it first:  sh termux.sh setup"
  cd "$INSTALL_DIR" || die "Cannot cd to $INSTALL_DIR"

  PORT="${PORT:-8000}"
  if command -v curl >/dev/null 2>&1; then
    if curl -fsS -m 3 "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then
      warn "A server is still running on port $PORT - it keeps serving the OLD code."
      say "Stop it (Ctrl+C in that session, or Stop in the dashboard), then re-run."
    fi
  fi

  say "Fetching updates from origin/$BRANCH ..."
  git fetch --quiet origin "$BRANCH" || die "git fetch failed - check your connection."

  BEHIND="$(git rev-list --count HEAD..origin/$BRANCH 2>/dev/null || echo 0)"
  AHEAD="$(git rev-list --count origin/$BRANCH..HEAD 2>/dev/null || echo 0)"

  if [ "$CHECK_ONLY" -eq 1 ]; then
    if [ "$BEHIND" -eq 0 ]; then
      say "Already up to date (branch $BRANCH)."
    else
      say "$BEHIND new commit(s) on $BRANCH:"
      git --no-pager log --oneline "HEAD..origin/$BRANCH" | sed 's/^/    /'
    fi
    [ "$AHEAD" -gt 0 ] && say "Note: you have $AHEAD local commit(s) not on the remote."
    return 0
  fi

  if [ "$BEHIND" -eq 0 ]; then
    say "Already up to date (branch $BRANCH)."
    return 0
  fi
  say "$BEHIND new commit(s) on $BRANCH:"
  git --no-pager log --oneline "HEAD..origin/$BRANCH" | sed 's/^/    /'

  # Never silently clobber edits to the code.
  CODE_CHANGES="$(git status --porcelain -- . ':(exclude)projects.json' \
    ':(exclude)project_auth.json' ':(exclude)credentials.json' \
    ':(exclude)tunnel-url.txt' ':(exclude)Project List' | grep -v '^??' || true)"

  STASHED=0
  if [ -n "$CODE_CHANGES" ]; then
    say "You have local edits to tracked files:"
    echo "$CODE_CHANGES" | sed 's/^/    /'
    if [ "$FORCE" -eq 0 ]; then
      die "Refusing to pull over your edits.
       Commit them (git add -A && git commit -m 'my changes'), or stash them
       (git stash), or re-run with --force to auto-stash and re-apply."
    fi
    say "--force given: stashing your edits and re-applying them after the pull."
    git stash push -q -m "pm-autostash" -- . ':(exclude)projects.json' \
      ':(exclude)project_auth.json' ':(exclude)credentials.json' || die "git stash failed."
    STASHED=1
  fi

  BACKUP_DIR=""
  if [ "$MAKE_BACKUP" -eq 1 ]; then
    BACKUP_DIR="$HOME/.pm-backups/$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$BACKUP_DIR" || die "Could not create $BACKUP_DIR"
    for f in $STATE_FILES; do
      [ -f "$f" ] && cp -p "$f" "$BACKUP_DIR/$f"
    done
    say "State backed up to $BACKUP_DIR"
  fi

  restore_state() {
    [ -z "$BACKUP_DIR" ] && return 0
    for f in $STATE_FILES; do
      # Never let a pulled sample overwrite your real accounts/projects.
      if [ -f "$BACKUP_DIR/$f" ] && [ "$f" != "tunnel-url.txt" ]; then
        cp -p "$BACKUP_DIR/$f" "$f"
      fi
    done
  }

  restore_on_fail() {
    restore_state
    if [ "$STASHED" -eq 1 ] && [ -z "$(git diff --name-only --diff-filter=U)" ]; then
      warn "Restoring your stashed edits..."
      git stash pop >/dev/null 2>&1 \
        || warn "Your edits are still in the stash - get them with: git stash pop"
    fi
  }

  say "Pulling updates ..."
  if ! git merge --ff-only "origin/$BRANCH"; then
    restore_on_fail
    die "Update failed (history diverged or a conflict).
       Your state was restored. Resolve with:  git rebase origin/$BRANCH
       or reset with: git reset --hard origin/$BRANCH  (discards local commits)"
  fi

  restore_state

  CONFLICTED=0
  if [ "$STASHED" -eq 1 ]; then
    if git stash pop >/dev/null 2>&1; then
      say "Your local edits were re-applied."
    elif [ -n "$(git diff --name-only --diff-filter=U)" ]; then
      CONFLICTED=1
    else
      say "Your local edits were re-applied."
    fi
  fi

  if [ "$CONFLICTED" -eq 1 ]; then
    echo ""
    say "Update applied, but YOUR EDITS to the same lines conflicted."
    say "Both versions are in the file with <<<<<<< markers."
    say "  1. Open the conflicted files and pick the lines you want:"
    git --no-pager diff --name-only --diff-filter=U | sed 's/^/       /'
    say "  2. git add <file>   (marks it resolved)"
    say "  3. Restart: python host.py"
    say "Your edits are also safe in the stash (git stash list)."
    say "To drop the update entirely instead: git reset --hard HEAD~1"
    echo ""
    return 0
  fi

  # Verify the new code actually parses before telling them to restart.
  say "Checking server.py / host.py ..."
  PY="$(pick_python)"
  [ -n "$PY" ] || die "No working python found - install it with:  pkg install python"

  if "$PY" -m py_compile server.py host.py 2>/dev/null; then
    say "Syntax OK ($("$PY" -V 2>&1))."
  else
    rm -rf __pycache__ 2>/dev/null
    restore_state
    die "server.py or host.py has a syntax error in the NEW code.
       This is an upstream problem, not your data:
         git reset --hard HEAD~1     # roll back to the previous version
       State files (projects.json, credentials.json) are safe in: $BACKUP_DIR"
  fi
  rm -rf __pycache__ 2>/dev/null

  [ -f index.html ] || warn "index.html is missing - the dashboard may not load."
  if [ ! -f credentials.json ]; then
    say "No credentials.json yet - sign in with superadmin / admin123."
  fi
  if ! command -v cloudflared >/dev/null 2>&1 && [ ! -x ./cloudflared ]; then
    warn "No cloudflared found - the public link will not start."
    warn "Fix it with:  pkg install cloudflared"
  fi

  say "Updated to $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))."
  echo ""
  say "Next: stop the old server (Ctrl+C), then start again:"
  say "    cd $INSTALL_DIR && python host.py"
  echo ""
}

if [ "$CMD" = "setup" ]; then
  do_setup
else
  do_update
fi