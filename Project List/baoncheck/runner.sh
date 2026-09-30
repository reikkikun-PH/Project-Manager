#!/bin/sh
# BaonCheck - Localhost Runner (static server) for Linux/macOS
cd "$(dirname "$0")"
PORT="8100"

echo "==================================================="
echo " BaonCheck - Localhost Runner (static server)"
echo " Local : http://localhost:$PORT"
echo "==================================================="
echo ""

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

TRIES=0
while python3 -c "import socket; s=socket.socket(); s.settimeout(0.5); s.connect(('127.0.0.1', $PORT))" 2>/dev/null    || "$PYTHON_CMD" -c "import socket,sys; s=socket.socket(); s.settimeout(0.5); s.connect(('127.0.0.1', int(sys.argv[1])))" "$PORT" 2>/dev/null; do
  PORT=$((PORT + 1))
  TRIES=$((TRIES + 1))
  if [ "$TRIES" -ge 10 ]; then
    echo "[ERROR] No free port near 8100."
    exit 1
  fi
done

echo "[OK] Serving this folder at http://localhost:$PORT"
echo "[INFO] Keep this terminal open. Press Ctrl+C to stop."
if command -v xdg-open >/dev/null 2>&1; then xdg-open "http://localhost:$PORT/" >/dev/null 2>&1 & fi
if command -v open >/dev/null 2>&1; then open "http://localhost:$PORT/" >/dev/null 2>&1 & fi
"$PYTHON_CMD" -m http.server "$PORT"
echo ""
echo "[INFO] Server stopped."
