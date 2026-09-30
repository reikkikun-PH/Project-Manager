"""Single-terminal host supervisor (Windows + Linux/macOS, stdlib only).

Usage:
    python host.py              # or: py -3 host.py | python3 host.py
    PORT=8000 python host.py

Runs BOTH in this one terminal:
  1. backend  - server.py on 127.0.0.1:PORT (started only if the port is free;
                backend logs go to server-out.log / server-err.log)
  2. tunnel   - cloudflared quick tunnel to that port (full log to tunnel.log;
                this console shows only the pinned public link + errors)

Ctrl+C stops the tunnel (and the backend, if this script started it).
"""
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", "8000"))
LOCAL_URL = f"http://127.0.0.1:{PORT}"
ENTRY = os.path.join(BASE_DIR, "server.py")
TUNNEL_LOG = os.path.join(BASE_DIR, "tunnel.log")
URL_FILE = os.path.join(BASE_DIR, "tunnel-url.txt")
OUT_LOG = os.path.join(BASE_DIR, "server-out.log")
ERR_LOG = os.path.join(BASE_DIR, "server-err.log")
URL_RE = re.compile(rb"https://[a-z0-9-]+\.trycloudflare\.com")
IS_WINDOWS = os.name == "nt"


def log(msg):
    print(f"[host] {msg}", flush=True)


def set_title(text):
    try:
        if IS_WINDOWS:
            import ctypes
            ctypes.windll.kernel32.SetConsoleTitleW(text)
        else:
            sys.stdout.write(f"\033]0;{text}\007")
            sys.stdout.flush()
    except Exception:
        pass


def port_open(port):
    try:
        s = socket.create_connection(("127.0.0.1", port), timeout=1.5)
        s.close()
        return True
    except OSError:
        return False


def find_cloudflared():
    if IS_WINDOWS:
        cand = os.path.join(BASE_DIR, "cloudflared.exe")
        return cand if os.path.isfile(cand) else None
    for name in ("cloudflared", "cloudflared-linux"):
        cand = os.path.join(BASE_DIR, name)
        if os.path.isfile(cand) and os.access(cand, os.X_OK):
            return cand
    return shutil.which("cloudflared")


def clean_stale():
    """Best effort: kill leftover tunnels for this same URL (avoids dupes)."""
    try:
        if IS_WINDOWS:
            ps = ("powershell -NoProfile -Command "
                  "\"Get-CimInstance Win32_Process -Filter \\\"Name='cloudflared.exe'\\\" "
                  f"| Where-Object {{ $_.CommandLine -like '*{LOCAL_URL}*' }} "
                  "| ForEach-Object { Stop-Process -Id $_.ProcessId -Force }\"")
            subprocess.run(ps, capture_output=True, timeout=15)
        elif shutil.which("pkill"):
            subprocess.run(["pkill", "-f", f"cloudflared.*{LOCAL_URL}"],
                           capture_output=True, timeout=10)
    except Exception:
        pass
    time.sleep(1)


def wait_for_backend(timeout=20):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if port_open(PORT):
            return True
        time.sleep(0.5)
    return port_open(PORT)


def backend_ok():
    try:
        with urllib.request.urlopen(LOCAL_URL + "/", timeout=5) as r:
            r.read(64)
        return True
    except Exception:
        return False


def banner(url):
    print("=" * 51, flush=True)
    print("  PUBLIC LINK - pinned, always the latest lines:", flush=True)
    print(f"  {url}", flush=True)
    print(f"  Local : {LOCAL_URL}", flush=True)
    print(f"  Each project: {url}/p/ID/", flush=True)
    print("  Full tunnel log: tunnel.log (safe to ignore)", flush=True)
    print("=" * 51, flush=True)
    # Per-project public links (best effort).
    try:
        import json
        with open(os.path.join(BASE_DIR, "projects.json"), encoding="utf-8") as f:
            projects = json.load(f)
        shown = 0
        for p in projects if isinstance(projects, list) else []:
            if not isinstance(p, dict) or not p.get("id"):
                continue
            if shown >= 10:
                print(f"  ... +{len(projects) - shown} more (see dashboard)", flush=True)
                break
            print(f"  {url}/p/{p['id']}/  ({p.get('name', p['id'])})", flush=True)
            shown += 1
    except Exception:
        pass
    sys.stdout.flush()


def main():
    print("=" * 51, flush=True)
    print("  Server Project Manager - single terminal host", flush=True)
    print(f"  Local : {LOCAL_URL}", flush=True)
    print("=" * 51, flush=True)

    cf = find_cloudflared()
    if not cf:
        log("ERROR: cloudflared not found next to host.py "
            "(cloudflared.exe on Windows, ./cloudflared on Linux).")
        log("Download: https://developers.cloudflare.com/cloudflare-one/"
            "connections/connect/networks/downloads/")
        return 1
    log(f"cloudflared: {cf}")
    if not os.path.isfile(ENTRY):
        log(f"ERROR: {ENTRY} not found.")
        return 1

    backend = None
    if port_open(PORT):
        log(f"Backend already running on {LOCAL_URL}")
    else:
        log("Cleaning old tunnels...")
        clean_stale()
        log(f"Starting backend: {sys.executable} server.py")
        out = open(OUT_LOG, "ab")
        err = open(ERR_LOG, "ab")
        try:
            env = dict(os.environ)
            env["PORT"] = str(PORT)
            backend = subprocess.Popen(
                [sys.executable, ENTRY], cwd=BASE_DIR, env=env,
                stdout=out, stderr=err)
        finally:
            out.close()
            err.close()
        if not wait_for_backend():
            log(f"ERROR: backend did not open port {PORT} - see {ERR_LOG}.")
            stop(backend)
            return 1
    if not backend_ok():
        log(f"ERROR: backend not responding at {LOCAL_URL}/.")
        stop(backend)
        return 1
    log(f"Backend OK at {LOCAL_URL}")

    # Fresh tunnel log so we never parse a stale link.
    try:
        if os.path.exists(TUNNEL_LOG):
            os.remove(TUNNEL_LOG)
    except OSError:
        pass
    tlog = open(TUNNEL_LOG, "ab")
    log("Starting tunnel (public link appears below)...")
    set_title("Starting tunnel... - Server Project Manager")
    tunnel = subprocess.Popen(
        [cf, "tunnel", "--url", LOCAL_URL],
        cwd=BASE_DIR, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)

    url = {"current": None}

    def watch():
        try:
            for raw in iter(tunnel.stdout.readline, b""):
                if not raw:
                    break
                try:
                    tlog.write(raw)
                    tlog.flush()
                except OSError:
                    pass
                try:
                    line = raw.decode("utf-8", "replace").strip()
                except Exception:
                    continue
                m = URL_RE.search(raw)
                if m:
                    found = m.group(0).decode("ascii")
                    if found != url["current"]:
                        url["current"] = found
                        set_title(f"PUBLIC: {found} - Server Project Manager")
                        try:
                            with open(URL_FILE, "w", encoding="utf-8") as f:
                                f.write(found + "\n")
                        except OSError:
                            pass
                        banner(found)
                    continue
                low = line.lower()
                if "err" in low or "fail" in low or "warn" in low:
                    print(f"[tunnel] {line}", flush=True)
        finally:
            try:
                tlog.close()
            except Exception:
                pass

    t = threading.Thread(target=watch, daemon=True)
    t.start()

    rc = 0
    try:
        backend_warned = False
        while tunnel.poll() is None:
            if backend is not None and backend.poll() is not None and not backend_warned:
                log(f"WARNING: backend exited (code {backend.returncode}) - see {ERR_LOG}.")
                backend_warned = True
            time.sleep(1)
        log(f"Tunnel exited (code {tunnel.returncode}). Last log lines:")
        try:
            with open(TUNNEL_LOG, "rb") as f:
                tail = f.read().decode("utf-8", "replace").strip().splitlines()[-5:]
            for line in tail:
                print(f"[tunnel] {line}", flush=True)
        except OSError:
            pass
        rc = 1
    except KeyboardInterrupt:
        print("", flush=True)
        log("Stopping (Ctrl+C)...")
    finally:
        stop(tunnel, name="tunnel")
        stop(backend, name="backend")  # None-safe; only kills what we started
        set_title("Server Project Manager - stopped")
        log("Bye. Re-run host.py (or host.bat / host.sh) to share again.")
    return rc


def stop(proc, name="process"):
    if proc is None:
        return
    try:
        if proc.poll() is not None:
            return
        proc.terminate()
        try:
            proc.wait(timeout=8)
        except Exception:
            proc.kill()
    except Exception as e:
        log(f"(stop {name}: {e})")


if __name__ == "__main__":
    sys.exit(main())
