#!/bin/sh
# Server Project Manager - single terminal host (Linux/macOS).
# Thin launcher: host.py runs backend + tunnel as children in this terminal.
# Usage: sh host.sh  (or chmod +x host.sh && ./host.sh)
# Env: PORT=8000 sh host.sh
cd "$(dirname "$0")"
PORT="${PORT:-8000}"
export PORT

pick_python() {
  if [ -x "$PWD/python/bin/python3" ]; then echo "$PWD/python/bin/python3"; return; fi
  if [ -x "$PWD/python/bin/python" ]; then echo "$PWD/python/bin/python"; return; fi
  if [ -x "$PWD/venv/bin/python3" ]; then echo "$PWD/venv/bin/python3"; return; fi
  if [ -x "$PWD/venv/bin/python" ]; then echo "$PWD/venv/bin/python"; return; fi
  if command -v python3 >/dev/null 2>&1; then echo python3; return; fi
  if command -v python >/dev/null 2>&1; then echo python; return; fi
  echo ""
}
PYTHON_CMD="$(pick_python)"
if [ -z "$PYTHON_CMD" ]; then
  echo "[ERROR] No working python found. Install python3."
  exit 1
fi
echo "[OK] Python: $PYTHON_CMD"

if [ ! -f "./host.py" ]; then
  echo "[ERROR] host.py not found next to host.sh"
  exit 1
fi

# Single terminal: host.py runs backend + tunnel as children here.
# Ctrl+C stops everything.
exec "$PYTHON_CMD" ./host.py
