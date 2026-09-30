#!/bin/sh
# VerifID - Backend Runner (python) for Linux/macOS
# Usage: sh runner.sh  (or chmod +x runner.sh && ./runner.sh)
cd "$(dirname "$0")"
PORT="8100"
export PORT

echo "==================================================="
echo " VerifID - Backend Runner (python)"
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

if [ -f requirements.txt ]; then
  echo "[INFO] Installing Python dependencies from requirements.txt ..."
  "$PYTHON_CMD" -m pip install -r requirements.txt || echo "[WARN] pip install reported issues - continuing anyway"
fi

echo "[INFO] Starting backend (python server.py)..."
echo "[INFO] Keep this terminal open. Press Ctrl+C to stop."
(open_browser() { sleep 1
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "http://localhost:$PORT/" >/dev/null 2>&1 & fi
  if command -v open >/dev/null 2>&1; then open "http://localhost:$PORT/" >/dev/null 2>&1 & fi
}; open_browser) &
"$PYTHON_CMD" server.py
echo ""
echo "[INFO] Backend stopped."
