#!/bin/sh
# Server Project Manager - Termux updater (Android, no root).
# Run INSIDE Termux (F-Droid build). Safe to re-run.
#
# Usage:
#   sh update-termux.sh              # back up state, pull updates, verify
#   sh update-termux.sh --check      # only report how many updates are waiting
#   sh update-termux.sh --force      # also pull when you edited tracked files
#   sh update-termux.sh --no-backup  # skip the state backup (not recommended)
#
# Or straight from GitHub (needs curl only):
#   curl -L -o update-termux.sh \
#     https://raw.githubusercontent.com/reikkikun-PH/Project-Manager/main/update-termux.sh
#   sh update-termux.sh
#
# What it never touches:
#   Project List/      your uploaded projects
#   credentials.json   your admin login
#   project_auth.json  per-project lock passwords
#   cloudflared        the tunnel binary
#
# Afterwards: restart the host - Ctrl+C in the running host.py, then run it again.
set -u

INSTALL_DIR="${INSTALL_DIR:-$HOME/pm}"
BRANCH="${BRANCH:-main}"
CHECK_ONLY=0
FORCE=0
MAKE_BACKUP=1

for arg in "$@"; do
  case "$arg" in
    --check)     CHECK_ONLY=1 ;;
    --force)     FORCE=1 ;;
    --no-backup) MAKE_BACKUP=0 ;;
    -h|--help)
      echo "Usage: sh update-termux.sh [--check] [--force] [--no-backup]"
      echo "Env: INSTALL_DIR=~/pm  BRANCH=main"
      exit 0 ;;
    *) echo "[ERROR] Unknown option: $arg (try --help)"; exit 1 ;;
  esac
done

say()  { echo "[update] $*"; }
warn() { echo "[WARN] $*" >&2; }
die()  { echo "[ERROR] $*" >&2; exit 1; }

# Runtime state we must preserve across a pull (these change as you use
# the dashboard, so they are backed up and restored around the update).
STATE_FILES="projects.json credentials.json project_auth.json tunnel-url.txt"

[ -d "$INSTALL_DIR/.git" ] || die "No git checkout at $INSTALL_DIR
       Install it first:  sh install-termux.sh"
cd "$INSTALL_DIR" || die "Cannot cd to $INSTALL_DIR"

# Remember the pre-update commit so we can offer a one-line rollback
PREV_COMMIT="$(git rev-parse HEAD 2>/dev/null)"
NEWCOMMIT="HEAD~1"

# --- 1. Is the server running? Restarting is needed after any update. ---
# A live backend keeps the OLD code in memory, so warn loudly.
PORT="${PORT:-8000}"
if command -v curl >/dev/null 2>&1; then
  if curl -fsS -m 3 "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then
    warn "A server is still running on port $PORT."
    say "Ctrl+C in that Termux session (or press Stop), then re-run this script."
    warn "Until you restart it, you keep running the old code."
  fi
fi

# --- 2. See what is waiting upstream ---
say "Fetching updates from origin/$BRANCH ..."
git fetch --quiet origin "$BRANCH" || die "git fetch failed - check your connection."

BEHIND="$(git rev-list --count HEAD..origin/$BRANCH 2>/dev/null || echo 0)"
AHEAD="$(git rev-list --count origin/$BRANCH..HEAD 2>/dev/null || echo 0)"

if [ "$CHECK_ONLY" -eq 1 ]; then
  if [ "$BEHIND" -eq 0 ]; then
    say "Already up to date (branch $BRANCH)."
  else
    say "$BEHIND new commit(s) available on $BRANCH:"
    git --no-pager log --oneline "HEAD..origin/$BRANCH" | sed 's/^/    /'
  fi
  [ "$AHEAD" -gt 0 ] && say "Note: you have $AHEAD local commit(s) not on the remote."
  exit 0
fi

if [ "$BEHIND" -eq 0 ]; then
  say "Already up to date (branch $BRANCH)."
  exit 0
fi
say "$BEHIND new commit(s) on $BRANCH:"
git --no-pager log --oneline "HEAD..origin/$BRANCH" | sed 's/^/    /'

# --- 3. Refuse to silently clobber your edits ---
# Local changes to CODE are the risky case, so we stop unless --force.
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

# --- 4. Back up runtime state ---
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

# --- 5. Pull ---
say "Pulling updates ..."
if ! git merge --ff-only "origin/$BRANCH"; then
  restore_on_fail
  die "Update failed (history diverged or a conflict).
       Your state was restored. Resolve with:  git rebase origin/$BRANCH
       or reset with: git reset --hard origin/$BRANCH  (discards local commits)"
fi

# --- 6. Re-apply your work ---
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
  exit 0
fi

# --- 7. Verify the new code actually parses ---
say "Checking server.py / host.py ..."
PY=""
for cand in python python3 py; do
  if command -v "$cand" >/dev/null 2>&1 && "$cand" -c "import sys" >/dev/null 2>&1; then
    PY="$cand"
    break
  fi
done
[ -n "$PY" ] || die "No working python found - install it with:  pkg install python"

if "$PY" -m py_compile server.py host.py 2>/dev/null; then
  say "Syntax OK ($($PY -V 2>&1))."
else
  rm -rf __pycache__ 2>/dev/null
  restore_state
  die "server.py or host.py has a syntax error in the NEW code.
       This is an upstream problem, not your data:
         git reset --hard $NEWCOMMIT   # roll back to the previous version
       State files (projects.json, credentials.json) are safe in: $BACKUP_DIR"
fi
rm -rf __pycache__ 2>/dev/null

[ -f index.html ] || warn "index.html is missing - the dashboard may not load."

# --- 8. Remind about the runtime bits ---
if [ ! -f credentials.json ]; then
  say "No credentials.json yet - sign in with admin / admin123."
fi
if ! command -v cloudflared >/dev/null 2>&1 && [ ! -x ./cloudflared ]; then
  warn "No cloudflared found - the public link will not start."
  warn "Fix it with:  pkg install cloudflared"
fi

NEWVER="$(git rev-parse --short HEAD 2>/dev/null)"
say "Updated to $NEWVER ($(git rev-parse --abbrev-ref HEAD))."
echo ""
say "Next: press Ctrl+C in the running host.py, then start again:"
say "    cd $INSTALL_DIR && python host.py"
echo ""