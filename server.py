"""Server Project Manager - host many projects on one address.

Dashboard at / lets you add projects:
  - static: serve a local folder (e.g. ./projects/demo)
  - proxy:  forward to an app already running on a local port

Every project is then reachable under /p/<id>/ on this same host,
so one Cloudflare tunnel (host.bat) exposes all of them.
Stdlib only - no pip install needed.
"""
import os
import re
import sys
import json
import time
import socket
import atexit
import shlex
import secrets
import shutil
import signal
import platform
import subprocess
import mimetypes
import urllib.request
import urllib.error
from http.server import SimpleHTTPRequestHandler, HTTPServer, ThreadingHTTPServer
from urllib.parse import urlparse, unquote, quote

IS_WINDOWS = os.name == "nt"

PORT = int(os.environ.get("PORT", "8000"))
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECTS_JSON = os.path.join(BASE_DIR, "projects.json")
INDEX_HTML = os.path.join(BASE_DIR, "index.html")
# All uploaded / new project folders live here by default.
PROJECTS_BASE = os.path.join(BASE_DIR, "Project List")
try:
    os.makedirs(PROJECTS_BASE, exist_ok=True)
except OSError:
    pass

VALID_TYPES = ("static", "proxy", "managed")
# Never serve these, even over the tunnel
BLOCKED = ("/server.py", "/projects.json", "/host.bat", "/host.sh",
           "/.env", "/credentials.json", "/project_auth.json", "/config")


_PROJECTS_CACHE = {"mtime": 0, "data": []}


def load_projects():
    try:
        mtime = os.path.getmtime(PROJECTS_JSON) if os.path.exists(PROJECTS_JSON) else 0
        if mtime and mtime == _PROJECTS_CACHE["mtime"]:
            return [p for p in _PROJECTS_CACHE["data"] if isinstance(p, dict)]
        if os.path.exists(PROJECTS_JSON):
            with open(PROJECTS_JSON, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    cleaned = [p for p in data if isinstance(p, dict)]
                    _PROJECTS_CACHE["mtime"] = mtime
                    _PROJECTS_CACHE["data"] = cleaned
                    return [p for p in cleaned if isinstance(p, dict)]
    except Exception as e:
        print(f"[Projects] load fail: {e}")
    return []


def save_projects(projects):
    # Atomic write (temp + replace) so concurrent threaded requests
    # never observe a half-written file.
    tmp = PROJECTS_JSON + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(projects, f, indent=2, ensure_ascii=False)
    os.replace(tmp, PROJECTS_JSON)
    try:
        _PROJECTS_CACHE["mtime"] = os.path.getmtime(PROJECTS_JSON)
        _PROJECTS_CACHE["data"] = [p for p in projects if isinstance(p, dict)]
    except OSError:
        pass


# --- Per-project lock credentials (admin dashboard settings store) ---
# Lock username/password live here - keyed by project id - never inside the
# project entries in projects.json. Admins set them from the dashboard Lock
# dialog; opening a locked project and unlocking both ask for them.
AUTH_PATH = os.path.join(BASE_DIR, "project_auth.json")
_AUTH_CACHE = {"mtime": 0, "data": {}}


def load_project_auth():
    """{pid: {username, password}}. Cached by mtime, never raises."""
    try:
        mtime = os.path.getmtime(AUTH_PATH) if os.path.exists(AUTH_PATH) else 0
        if mtime and mtime == _AUTH_CACHE["mtime"]:
            return dict(_AUTH_CACHE["data"])
        data = {}
        if os.path.exists(AUTH_PATH):
            with open(AUTH_PATH, "r", encoding="utf-8") as f:
                raw = json.load(f)
            if isinstance(raw, dict):
                for pid, cred in raw.items():
                    if isinstance(cred, dict) and cred.get("password"):
                        data[str(pid)] = {
                            "username": str(cred.get("username") or ""),
                            "password": str(cred.get("password")),
                        }
        _AUTH_CACHE["mtime"] = mtime
        _AUTH_CACHE["data"] = data
        return dict(data)
    except Exception as e:
        print(f"[Auth] load fail: {e}")
    return {}


def save_project_auth(data):
    tmp = AUTH_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(tmp, AUTH_PATH)
    try:
        _AUTH_CACHE["mtime"] = os.path.getmtime(AUTH_PATH)
        _AUTH_CACHE["data"] = dict(data)
    except OSError:
        pass


def project_creds(proj):
    """Saved lock credentials for a project: store first, legacy entry fallback."""
    pid = proj.get("id", "")
    cred = load_project_auth().get(pid)
    if isinstance(cred, dict) and cred.get("password"):
        return cred
    # Legacy: credentials once lived on the project entry itself.
    a = proj.get("auth")
    if isinstance(a, dict) and a.get("password"):
        return {"username": str(a.get("username") or ""),
                "password": str(a.get("password"))}
    return {}


# --- Admin auth (public read-only dashboard, admin manages) ---
CREDS_PATH = os.path.join(BASE_DIR, "credentials.json")


def load_credentials():
    try:
        if os.path.exists(CREDS_PATH):
            with open(CREDS_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    return data
    except Exception as e:
        print(f"[Auth] load fail: {e}")
    return []


def find_account(username):
    uname = (username or "").strip()
    for a in load_credentials():
        if isinstance(a, dict) and (a.get("username") or "") == uname:
            return a
    return None


def is_admin_user(username):
    acc = find_account(username) if (username or "").strip() else None
    return acc is not None and (acc.get("role") or "admin").strip().lower() == "admin"


def requester_is_admin(body):
    """Mutating calls must carry body.requester of an admin account."""
    req = ((body.get("requester") or "") if isinstance(body, dict) else "").strip()
    if not req:
        return None, "Admin sign-in required."
    acc = find_account(req)
    if acc is None:
        return None, "Unknown account - please sign in again."
    if (acc.get("role") or "admin").strip().lower() != "admin":
        return None, "Admin role required."
    return acc, None


def slugify(name):
    slug = re.sub(r"[^a-z0-9]+", "-", (name or "").strip().lower()).strip("-")
    return slug[:32] or "project"


def unique_id(base, projects):
    taken = {p.get("id", "") for p in projects}
    if base not in taken:
        return base
    i = 2
    while f"{base}-{i}" in taken:
        i += 1
    return f"{base}-{i}"


def find_project(pid):
    for p in load_projects():
        if p.get("id") == pid:
            return p
    return None


def resolve_static_root(target):
    """Resolve a static target to an absolute dir, or return None."""
    t = (target or "").strip()
    if not t:
        return None
    cand = t if os.path.isabs(t) else os.path.join(BASE_DIR, t)
    root = os.path.normpath(os.path.abspath(cand))
    if os.path.isdir(root):
        return root
    return None


def project_list_target(pid):
    """Default target string for a project id, e.g. './Project List/demo'."""
    return os.path.join(".", "Project List", pid)


def safe_project_dir(pid):
    """Absolute dir inside Project List for pid, or None if unsafe."""
    base = (pid or "").strip()
    if not base or base in (".", "..") or "/" in base or "\\" in base:
        return None
    cand = os.path.normpath(os.path.abspath(os.path.join(PROJECTS_BASE, base)))
    try:
        if os.path.commonpath([cand, PROJECTS_BASE]) != PROJECTS_BASE:
            return None
    except ValueError:
        return None
    return cand


def extract_zip_to(data, dest):
    """Extract zip bytes into dest (zip-slip safe). Returns file count."""
    import io
    import zipfile
    count = 0
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for info in z.infolist():
            name = info.filename.replace("\\", "/").lstrip("/")
            if not name or name.startswith("..") or "/../" in name:
                continue
            # Drop a single top-level wrapper folder (GitHub zips, etc.)
            # when every entry shares it - handled by caller via strip_root.
            full = os.path.normpath(os.path.join(dest, name))
            try:
                if os.path.commonpath([full, dest]) != dest:
                    continue
            except ValueError:
                continue
            if info.is_dir():
                os.makedirs(full, exist_ok=True)
            else:
                os.makedirs(os.path.dirname(full) or dest, exist_ok=True)
                with z.open(info) as src, open(full, "wb") as out:
                    out.write(src.read())
                count += 1
    return count


def _strip_single_root(dest):
    """If dest contains exactly one subfolder and no files, lift it up."""
    try:
        entries = os.listdir(dest)
    except OSError:
        return
    if len(entries) != 1:
        return
    inner = os.path.join(dest, entries[0])
    if not os.path.isdir(inner):
        return
    import shutil
    tmp = dest + ".__lift__"
    try:
        os.rename(inner, tmp)
        for n in os.listdir(tmp):
            os.rename(os.path.join(tmp, n), os.path.join(dest, n))
        os.rmdir(tmp)
    except OSError:
        pass


def _dir_files(root):
    try:
        return {f.lower() for f in os.listdir(root)}
    except OSError:
        return set()


def find_servable_target(target):
    """Best servable sub-target under an uploaded folder.

    Returns (target, kind) where kind is 'static' (has index.html),
    'runnable' (has server entry), or 'empty'. Handles zips whose
    site lives one level down, e.g. UniEvent.zip -> prototype/index.html.
    """
    root = resolve_static_root(target)
    if root is None:
        return target, "empty"
    files = _dir_files(root)
    if "index.html" in files or detect_runner(target).get("ok"):
        return target, ("static" if "index.html" in files else "runnable")
    # Immediate subfolders first (deterministic order)
    try:
        subs = sorted(d for d in os.listdir(root)
                      if os.path.isdir(os.path.join(root, d)))
    except OSError:
        return target, "empty"
    for d in subs:
        sub = target.rstrip("/\\") + "/" + d
        f = _dir_files(os.path.join(root, d))
        if "index.html" in f:
            return sub, "static"
    for d in subs:
        sub = target.rstrip("/\\") + "/" + d
        if detect_runner(sub).get("ok"):
            return sub, "runnable"
    # Two levels deep for index.html (e.g. dist/site/index.html)
    for d in subs:
        try:
            subs2 = sorted(e for e in os.listdir(os.path.join(root, d))
                           if os.path.isdir(os.path.join(root, d, e)))
        except OSError:
            continue
        for e in subs2:
            if "index.html" in _dir_files(os.path.join(root, d, e)):
                return target.rstrip("/\\") + "/" + d + "/" + e, "static"
    return target, "empty"


def port_open(port):
    try:
        s = socket.create_connection(("127.0.0.1", port), timeout=1.5)
        s.close()
        return True
    except OSError:
        return False


# --- System monitor (stdlib only, best effort per OS) ---
# CPU is measured as a delta since the previous probe - no blocking sleep,
# so /api/system never holds a thread. Accuracy improves with the real
# interval between polls (primed once at import).
_CPU_LAST = {"total": 0, "idle": 0, "per": {}}


def _cpu_times_linux():
    """(overall, per-core) (total, idle) jiffies from /proc/stat."""
    overall = None
    per = {}
    with open("/proc/stat", "r") as f:
        for line in f:
            if not line.startswith("cpu"):
                break
            parts = line.split()
            if len(parts) < 8:
                continue
            try:
                vals = list(map(int, parts[1:8]))
            except ValueError:
                continue
            if parts[0] == "cpu":
                overall = (sum(vals), vals[3] + vals[4])  # total, idle+iowait
            elif parts[0][3:].isdigit():
                per[parts[0]] = (sum(vals), vals[3] + vals[4])
    return overall, per


def _cpu_times_windows():
    """(overall, {}) via GetSystemTimes (100ns units). Per-core needs PDH."""
    import ctypes

    class FT(ctypes.Structure):
        _fields_ = [("low", ctypes.c_ulong), ("high", ctypes.c_ulong)]

    idle, kernel, user = FT(), FT(), FT()
    if not ctypes.windll.kernel32.GetSystemTimes(
            ctypes.byref(idle), ctypes.byref(kernel), ctypes.byref(user)):
        raise OSError("GetSystemTimes failed")

    def v(x):
        return (x.high << 32) | x.low

    return (v(kernel) + v(user), v(idle)), {}


def _cpu_percent():
    """(overall %, per-core [%]) since the last call. First call primes."""
    try:
        if os.path.exists("/proc/stat"):
            overall, per = _cpu_times_linux()
        elif IS_WINDOWS:
            overall, per = _cpu_times_windows()
        else:
            return None, []
        if overall is None:
            return None, []
    except Exception as e:
        print(f"[System] cpu probe fail: {e}")
        return None, []
    total, idle = overall
    last = _CPU_LAST
    if not last["total"] or total <= last["total"]:
        last.update({"total": total, "idle": idle, "per": per})
        return None, []
    dt = total - last["total"]
    pct = round(100.0 * (1.0 - (idle - last["idle"]) / dt), 1) if dt > 0 else 0.0
    cores = []
    for name in sorted(per, key=lambda c: int(c[3:])):
        t1, i1 = last["per"].get(name, (0, 0))
        t2, i2 = per[name]
        d = t2 - t1
        cores.append(round(100.0 * (1.0 - (i2 - i1) / d), 1) if d > 0 else 0.0)
    last.update({"total": total, "idle": idle, "per": per})
    return max(0.0, min(100.0, pct)), [max(0.0, min(100.0, c)) for c in cores]


try:
    _cpu_percent()  # prime the delta baseline at startup
except Exception:
    pass


def _cpu_temp():
    """Hottest thermal zone in C (Linux). None when unavailable."""
    try:
        hottest = None
        base = "/sys/class/thermal"
        for zone in os.listdir(base):
            if not zone.startswith("thermal_zone"):
                continue
            try:
                with open(os.path.join(base, zone, "temp"), "r") as f:
                    v = int(f.read().strip()) / 1000.0
            except (OSError, ValueError):
                continue
            if 0 < v < 150 and (hottest is None or v > hottest):
                hottest = v
        return round(hottest, 1) if hottest is not None else None
    except OSError:
        return None


def _ram_linux():
    info = {}
    with open("/proc/meminfo", "r") as f:
        for line in f:
            k, _, v = line.partition(":")
            try:
                info[k.strip()] = int(v.strip().split()[0])  # kB
            except (ValueError, IndexError):
                pass
    total = info.get("MemTotal", 0)
    avail = info.get("MemAvailable", info.get("MemFree", 0))
    swap_total = info.get("SwapTotal", 0)
    swap_free = info.get("SwapFree", 0)
    return (total // 1024, max(0, total - avail) // 1024,  # MB
            swap_total // 1024, max(0, swap_total - swap_free) // 1024)


def _ram_windows():
    import ctypes
    class MS(ctypes.Structure):
        _fields_ = [("dwLength", ctypes.c_ulong),
                    ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong),
                    ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong),
                    ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong),
                    ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]
    ms = MS()
    ms.dwLength = ctypes.sizeof(MS)
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(ms)):
        raise OSError("GlobalMemoryStatusEx failed")
    MB = 1024 * 1024
    total_mb = ms.ullTotalPhys // MB
    used_mb = (ms.ullTotalPhys - ms.ullAvailPhys) // MB
    # Page file beyond physical RAM acts as swap.
    swap_total = max(0, ms.ullTotalPageFile - ms.ullTotalPhys) // MB
    swap_used = max(0, (ms.ullTotalPageFile - ms.ullAvailPageFile)
                    - (ms.ullTotalPhys - ms.ullAvailPhys)) // MB
    return total_mb, used_mb, swap_total, swap_used


def _disk():
    """Manager drive usage in MB. Stdlib, cross-platform."""
    try:
        u = shutil.disk_usage(BASE_DIR)
        return u.total // (1024 * 1024), (u.total - u.free) // (1024 * 1024)
    except OSError:
        return None, None


def _uptime_secs():
    try:
        if os.path.exists("/proc/uptime"):
            with open("/proc/uptime", "r") as f:
                return int(float(f.read().split()[0]))
        if IS_WINDOWS:
            import ctypes
            return int(ctypes.windll.kernel32.GetTickCount64() // 1000)
    except (OSError, ValueError):
        pass
    return None


def _gpus():
    """NVIDIA via nvidia-smi (+ temp); [] when absent/unreadable."""
    if not shutil.which("nvidia-smi"):
        return []
    try:
        r = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=6)
        if r.returncode != 0:
            return []
        out = []
        for line in r.stdout.strip().splitlines():
            parts = [p.strip() for p in line.split(",")]
            if len(parts) >= 4:
                try:
                    temp = float(parts[4]) if len(parts) > 4 else None
                except ValueError:
                    temp = None
                out.append({"name": parts[0], "util": float(parts[1]),
                            "mem_used_mb": float(parts[2]),
                            "mem_total_mb": float(parts[3]),
                            "temp_c": temp})
        return out
    except Exception:
        return []


_SYSTEM_CACHE = {"at": 0.0, "data": None}
_SYSTEM_TTL = 5.0  # dashboard polls ~30s; spawn nvidia-smi at most 1x/5s


def system_info():
    """Cross-platform host stats. Unavailable metrics come back as None."""
    now = time.time()
    if _SYSTEM_CACHE["data"] is not None and (now - _SYSTEM_CACHE["at"]) < _SYSTEM_TTL:
        return _SYSTEM_CACHE["data"]
    cpu, cores = _cpu_percent()
    ram_total = ram_used = swap_total = swap_used = None
    try:
        if os.path.exists("/proc/meminfo"):
            ram_total, ram_used, swap_total, swap_used = _ram_linux()
        elif IS_WINDOWS:
            ram_total, ram_used, swap_total, swap_used = _ram_windows()
    except Exception as e:
        print(f"[System] ram probe fail: {e}")
    ram_pct = (round(100.0 * ram_used / ram_total, 1)
               if ram_total else None)
    swap_pct = (round(100.0 * swap_used / swap_total, 1)
                if swap_total else None)
    disk_total, disk_used = _disk()
    disk_pct = (round(100.0 * disk_used / disk_total, 1)
                if disk_total else None)
    data = {
        "platform": platform.system(),
        "cpu_count": os.cpu_count() or 0,
        "cpu_percent": cpu,
        "cpu_per_core": cores,
        "cpu_temp_c": _cpu_temp(),
        "ram_total_mb": ram_total,
        "ram_used_mb": ram_used,
        "ram_percent": ram_pct,
        "swap_total_mb": swap_total,
        "swap_used_mb": swap_used,
        "swap_percent": swap_pct,
        "disk_total_mb": disk_total,
        "disk_used_mb": disk_used,
        "disk_percent": disk_pct,
        "uptime_sec": _uptime_secs(),
        "gpus": _gpus(),
    }
    _SYSTEM_CACHE["at"] = now
    _SYSTEM_CACHE["data"] = data
    return data


# --- Localhost runners (AI Scanner architecture: detect, launch, verify) ---
# A "managed" project is launched by the manager itself:
# stub-safe python pick (like host.bat), free-port assignment,
# per-project logs (runner-out.log / runner-err.log next to the
# project, like server-out.log), and health verification before
# marking it running. Served through /p/<id>/ like proxy projects.
_RUNNERS = {}  # id -> {"proc": Popen|None, "port": int, "note": str}
_PYTHON = None
_START_GRACE = 12  # seconds to wait for the port on start


def find_python():
    """Cross-platform python pick, mirroring host.bat / host.sh order."""
    global _PYTHON
    if _PYTHON:
        return _PYTHON
    cands = []
    # Portable + venv layouts (both OS conventions, checked by existence)
    cands.append(os.path.join(BASE_DIR, "python", "python.exe"))
    cands.append(os.path.join(BASE_DIR, "python", "bin", "python"))
    cands.append(os.path.join(BASE_DIR, "python", "bin", "python3"))
    cands.append(os.path.join(BASE_DIR, "venv", "Scripts", "python.exe"))
    cands.append(os.path.join(BASE_DIR, "venv", "bin", "python"))
    cands.append(os.path.join(BASE_DIR, "venv", "bin", "python3"))
    # Current interpreter is always a valid fallback
    if sys.executable:
        cands.append(sys.executable)
    # PATH lookups: python3 first on POSIX, py first on Windows
    if IS_WINDOWS:
        cands += ["py", "python", "python3"]
    else:
        cands += ["python3", "python"]
    seen = set()
    for c in cands:
        if not c or c in seen:
            continue
        seen.add(c)
        if (os.sep in c or "/" in c) and not os.path.exists(c):
            continue
        try:
            r = subprocess.run([c, "--version"], capture_output=True, timeout=10)
            if r.returncode == 0:
                _PYTHON = c
                return c
        except Exception:
            continue
    return None


def free_port(start=8100, end=8199):
    for p in range(start, end + 1):
        if p == PORT:
            continue
        s = socket.socket()
        try:
            s.bind(("127.0.0.1", p))
            return p
        except OSError:
            continue
        finally:
            s.close()
    return None


def detect_runner(path):
    """Inspect a folder and suggest how to run it as a server."""
    root = resolve_static_root(path)
    if root is None:
        return {"ok": False, "error": f"Folder not found: '{path}'."}
    try:
        files = {f.lower() for f in os.listdir(root)}
    except OSError as e:
        return {"ok": False, "error": str(e)}
    port = free_port() or 8100
    env_note = "The assigned port is passed as the PORT env var - honor it inside the app."
    if "server.py" in files:
        return {"ok": True, "cmd": "python server.py", "port": port,
                "kind": "python", "note": env_note}
    if "app.py" in files:
        return {"ok": True, "cmd": "python app.py", "port": port,
                "kind": "python", "note": env_note}
    if "package.json" in files:
        try:
            with open(os.path.join(root, "package.json"), encoding="utf-8") as f:
                pkg = json.load(f)
            scripts = pkg.get("scripts") if isinstance(pkg, dict) else None
            if isinstance(scripts, dict) and scripts.get("start"):
                return {"ok": True, "cmd": "npm start", "port": port,
                        "kind": "node", "note": env_note}
        except Exception:
            pass
        if "server.js" in files:
            return {"ok": True, "cmd": "node server.js", "port": port,
                    "kind": "node", "note": env_note}
        return {"ok": False,
                "error": "package.json has no start script - add one or host as static."}
    if "server.js" in files:
        return {"ok": True, "cmd": "node server.js", "port": port,
                "kind": "node", "note": env_note}
    if "index.html" in files:
        return {"ok": False,
                "error": "Static site - no runner needed, host it as static."}
    return {"ok": False,
            "error": "No runnable entry found (server.py, app.py, package.json, server.js)."}


def _split_cmd(cmd_str):
    # Windows .bat parsing matches posix=False; POSIX shells need posix=True.
    try:
        parts = shlex.split(cmd_str, posix=not IS_WINDOWS)
    except ValueError:
        parts = [t.strip('"') for t in shlex.split(cmd_str, posix=False)]
        return [t for t in parts if t]
    if IS_WINDOWS:
        parts = [t.strip('"') for t in parts]
    return [t for t in parts if t]


PYTHON_LAUNCHERS = ("py", "py.exe", "python", "python.exe", "python3")


def _validate_managed(target, cmd, port):
    root = resolve_static_root(target)
    if root is None:
        raise ValueError(f"Folder not found: '{target}'.")
    if not (cmd or "").strip():
        raise ValueError("Run command is required (use Detect).")
    try:
        p = int(port)
    except (TypeError, ValueError):
        raise ValueError("Port must be a number.")
    if not 1 <= p <= 65535:
        raise ValueError("Port must be 1-65535.")
    if p == PORT:
        raise ValueError("Cannot use the manager's own port.")
    return root, p


def _log_tail(path, n=8):
    try:
        with open(path, "rb") as f:
            # Read only the tail (32KB) so huge runner logs never load fully.
            f.seek(0, 2)
            size = f.tell()
            f.seek(max(0, size - 32 * 1024))
            lines = f.read().decode("utf-8", "replace").strip().splitlines()
            return "\n".join(lines[-n:])
    except OSError:
        return ""


def start_managed(proj):
    """Launch a managed project. Returns (ok, message)."""
    pid = proj.get("id", "")
    stop_managed(pid)  # clear any previous attempt
    try:
        root, port = _validate_managed(proj.get("target"), proj.get("cmd"), proj.get("port"))
    except ValueError as ve:
        _RUNNERS[pid] = {"proc": None, "port": 0, "note": str(ve)}
        return False, str(ve)
    if port_open(port):
        msg = f"Port {port} is already in use."
        _RUNNERS[pid] = {"proc": None, "port": port, "note": msg}
        return False, msg
    parts = _split_cmd(proj.get("cmd") or "")
    if not parts:
        msg = "Empty run command."
        _RUNNERS[pid] = {"proc": None, "port": port, "note": msg}
        return False, msg
    if parts[0].lower() in PYTHON_LAUNCHERS:
        py = find_python()
        if not py:
            msg = "No working python found."
            _RUNNERS[pid] = {"proc": None, "port": port, "note": msg}
            return False, msg
        parts[0] = py
    env = dict(os.environ)
    env["PORT"] = str(port)
    out_log = os.path.join(root, "runner-out.log")
    err_log = os.path.join(root, "runner-err.log")
    node_like = parts[0].lower() in ("npm", "npm.cmd", "node", "node.exe", "npx", "npx.cmd")
    try:
        out = open(out_log, "ab")
        err = open(err_log, "ab")
        try:
            popen_kw = {"cwd": root, "env": env, "stdout": out, "stderr": err}
            if IS_WINDOWS:
                if node_like:
                    # npm/node on Windows need a shell for .cmd resolution
                    proc = subprocess.Popen(" ".join(parts), shell=True, **popen_kw)
                else:
                    flags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
                    proc = subprocess.Popen(parts, creationflags=flags, **popen_kw)
            else:
                # Detached group so stop can signal the whole tree;
                # no shell so POSIX arg splitting stays exact.
                proc = subprocess.Popen(parts, start_new_session=True, **popen_kw)
        finally:
            out.close()
            err.close()
    except Exception as e:
        msg = f"Launch failed: {e}"
        _RUNNERS[pid] = {"proc": None, "port": port, "note": msg}
        return False, msg
    _RUNNERS[pid] = {"proc": proc, "port": port, "note": ""}
    deadline = time.time() + _START_GRACE
    while time.time() < deadline:
        if proc.poll() is not None:
            tail = _log_tail(err_log) or _log_tail(out_log)
            msg = f"Exited (code {proc.returncode})." + (f" {tail}" if tail else "")
            _RUNNERS[pid] = {"proc": None, "port": port, "note": msg}
            print(f"[Runner] {pid} died on start: {msg}")
            return False, msg
        if port_open(port):
            print(f"[Runner] {pid} running on port {port} (pid {proc.pid})")
            return True, f"Running on port {port}."
        time.sleep(0.5)
    _RUNNERS[pid]["note"] = "Started but port not responding yet."
    print(f"[Runner] {pid} started (pid {proc.pid}), port {port} not answering yet")
    return True, "Started - waiting for the port."


def stop_managed(pid):
    """Terminate a managed project. Best effort, never raises."""
    r = _RUNNERS.get(pid)
    if not r:
        return
    proc = r.get("proc")
    r["proc"] = None
    r["note"] = ""
    if proc is None or proc.poll() is not None:
        return
    try:
        if IS_WINDOWS:
            try:
                subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                               capture_output=True, timeout=10)
            except Exception:
                try:
                    proc.terminate()
                except Exception:
                    pass
        else:
            # Signal the whole process group (npm -> node children)
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
            except Exception:
                try:
                    proc.terminate()
                except Exception:
                    pass
    except Exception:
        pass
    try:
        proc.wait(timeout=10)
    except Exception:
        try:
            if not IS_WINDOWS:
                try:
                    os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                except Exception:
                    proc.kill()
            else:
                proc.kill()
        except Exception:
            pass
        try:
            proc.wait(timeout=5)
        except Exception:
            pass
    print(f"[Runner] {pid} stopped")


def _stop_all_managed():
    for pid in list(_RUNNERS):
        try:
            stop_managed(pid)
        except Exception:
            pass


# --- Standalone localhost runners, one per project folder ---
# Writes runner.bat (Windows) + runner.sh (Linux/macOS) inside the
# project folder (AI Scanner architecture: interpreter pick, auto
# port bump, browser open, visible logs) so each project can also run
# as its own localhost server outside the manager:
#   python backend -> launches the app (e.g. python server.py), installs
#                     requirements.txt when present
#   node backend   -> launches the app (npm start / node server.js),
#                     runs npm install when node_modules is missing
#   static         -> serves the folder with stdlib http.server
RUNNER_PYTHON_TEMPLATE = """@echo off
setlocal
cd /d "%~dp0"
set PORT=__PORT__

echo ===================================================
echo  __NAME__ - Backend Runner (python)
echo  Local : http://localhost:%PORT%
echo ===================================================
echo.

REM Find working python (stub-safe: rejects the WindowsApps shim)
set PYTHON_CMD=
if exist "%~dp0python\\python.exe" set PYTHON_CMD=%~dp0python\\python.exe
if "%PYTHON_CMD%"=="" if exist "%~dp0venv\\Scripts\\python.exe" set PYTHON_CMD=%~dp0venv\\Scripts\\python.exe
if "%PYTHON_CMD%"=="" (
  where python >nul 2>&1
  if not errorlevel 1 (
    python --version >nul 2>&1
    if not errorlevel 1 set PYTHON_CMD=python
  )
)
if "%PYTHON_CMD%"=="" (
  where py >nul 2>&1
  if not errorlevel 1 (
    py --version >nul 2>&1
    if not errorlevel 1 set PYTHON_CMD=py
  )
)
if "%PYTHON_CMD%"=="" (
  echo [ERROR] No working python found. Install Python from python.org
  pause & exit /b 1
)
echo [OK] Python: %PYTHON_CMD%

REM Install dependencies when listed
if exist requirements.txt (
  echo [INFO] Installing Python dependencies from requirements.txt ...
  "%PYTHON_CMD%" -m pip install -r requirements.txt
  if %ERRORLEVEL% neq 0 echo [WARN] pip install reported issues - continuing anyway
)

echo [INFO] Starting backend (__CMD_LABEL__)...
echo [INFO] Keep this window open. Press Ctrl+C to stop.
start "" "http://localhost:%PORT%/"
"%PYTHON_CMD%" __CMD_ARGS__
echo.
echo [INFO] Backend stopped.
pause
"""

RUNNER_NODE_TEMPLATE = """@echo off
setlocal
cd /d "%~dp0"
set PORT=__PORT__

echo ===================================================
echo  __NAME__ - Backend Runner (node)
echo  Local : http://localhost:%PORT%
echo ===================================================
echo.

REM Find working node
set NODE_CMD=
where node >nul 2>&1
if not errorlevel 1 (
  node --version >nul 2>&1
  if not errorlevel 1 set NODE_CMD=node
)
if "%NODE_CMD%"=="" (
  echo [ERROR] Node.js not found. Install it from nodejs.org
  pause & exit /b 1
)
echo [OK] Node:
node --version

REM Install dependencies when listed but missing
if exist package.json (
  if not exist node_modules (
    echo [INFO] Installing Node dependencies with npm install ...
    call npm install
    if %ERRORLEVEL% neq 0 echo [WARN] npm install reported issues - continuing anyway
  )
)

echo [INFO] Starting backend (__CMD_LABEL__)...
echo [INFO] Keep this window open. Press Ctrl+C to stop.
start "" "http://localhost:%PORT%/"
__CMD_LINE__
echo.
echo [INFO] Backend stopped.
pause
"""
RUNNER_TEMPLATE = """@echo off
setlocal
cd /d "%~dp0"
set PORT=__PORT__

echo ===================================================
echo  __NAME__ - Localhost Runner (static server)
echo  Local : http://localhost:%PORT%
echo ===================================================
echo.

REM Find working python (stub-safe: rejects the WindowsApps shim)
set PYTHON_CMD=
if exist "%~dp0python\\python.exe" set PYTHON_CMD=%~dp0python\\python.exe
if "%PYTHON_CMD%"=="" if exist "%~dp0venv\\Scripts\\python.exe" set PYTHON_CMD=%~dp0venv\\Scripts\\python.exe
if "%PYTHON_CMD%"=="" (
  where python >nul 2>&1
  if not errorlevel 1 (
    python --version >nul 2>&1
    if not errorlevel 1 set PYTHON_CMD=python
  )
)
if "%PYTHON_CMD%"=="" (
  where py >nul 2>&1
  if not errorlevel 1 (
    py --version >nul 2>&1
    if not errorlevel 1 set PYTHON_CMD=py
  )
)
if "%PYTHON_CMD%"=="" (
  echo [ERROR] No working python found. Install Python from python.org
  pause & exit /b 1
)
echo [OK] Python: %PYTHON_CMD%

REM Bump port if busy (up to +10)
set TRIES=0
:findport
netstat -ano | findstr ":%PORT% " | findstr LISTENING >nul 2>&1
if %ERRORLEVEL% neq 0 goto :serve
set /a PORT+=1
set /a TRIES+=1
if %TRIES% geq 10 (
  echo [ERROR] No free port near __PORT__.
  pause & exit /b 1
)
goto :findport

:serve
echo [OK] Serving this folder at http://localhost:%PORT%
echo [INFO] Keep this window open. Press Ctrl+C to stop.
start "" "http://localhost:%PORT%/"
"%PYTHON_CMD%" -m http.server %PORT%
echo.
echo [INFO] Server stopped.
pause
"""

RUNNER_SH_PYTHON_TEMPLATE = """#!/bin/sh
# __NAME__ - Backend Runner (python) for Linux/macOS
# Usage: sh runner.sh  (or chmod +x runner.sh && ./runner.sh)
cd "$(dirname "$0")"
PORT="__PORT__"
export PORT

echo "==================================================="
echo " __NAME__ - Backend Runner (python)"
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

echo "[INFO] Starting backend (__CMD_LABEL__)..."
echo "[INFO] Keep this terminal open. Press Ctrl+C to stop."
(open_browser() { sleep 1
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "http://localhost:$PORT/" >/dev/null 2>&1 & fi
  if command -v open >/dev/null 2>&1; then open "http://localhost:$PORT/" >/dev/null 2>&1 & fi
}; open_browser) &
"$PYTHON_CMD" __CMD_ARGS__
echo ""
echo "[INFO] Backend stopped."
"""

RUNNER_SH_NODE_TEMPLATE = """#!/bin/sh
# __NAME__ - Backend Runner (node) for Linux/macOS
cd "$(dirname "$0")"
PORT="__PORT__"
export PORT

echo "==================================================="
echo " __NAME__ - Backend Runner (node)"
echo " Local : http://localhost:$PORT"
echo "==================================================="
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js not found. Install it from nodejs.org"
  exit 1
fi
echo "[OK] Node:"
node --version

if [ -f package.json ] && [ ! -d node_modules ]; then
  echo "[INFO] Installing Node dependencies with npm install ..."
  npm install || echo "[WARN] npm install reported issues - continuing anyway"
fi

echo "[INFO] Starting backend (__CMD_LABEL__)..."
echo "[INFO] Keep this terminal open. Press Ctrl+C to stop."
(open_browser() { sleep 1
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "http://localhost:$PORT/" >/dev/null 2>&1 & fi
  if command -v open >/dev/null 2>&1; then open "http://localhost:$PORT/" >/dev/null 2>&1 & fi
}; open_browser) &
__CMD_LINE__
echo ""
echo "[INFO] Backend stopped."
"""

RUNNER_SH_TEMPLATE = """#!/bin/sh
# __NAME__ - Localhost Runner (static server) for Linux/macOS
cd "$(dirname "$0")"
PORT="__PORT__"

echo "==================================================="
echo " __NAME__ - Localhost Runner (static server)"
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
while python3 -c "import socket; s=socket.socket(); s.settimeout(0.5); s.connect(('127.0.0.1', $PORT))" 2>/dev/null \
   || "$PYTHON_CMD" -c "import socket,sys; s=socket.socket(); s.settimeout(0.5); s.connect(('127.0.0.1', int(sys.argv[1])))" "$PORT" 2>/dev/null; do
  PORT=$((PORT + 1))
  TRIES=$((TRIES + 1))
  if [ "$TRIES" -ge 10 ]; then
    echo "[ERROR] No free port near __PORT__."
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
"""


def _runner_bat_name(name):
    safe = re.sub(r"[^A-Za-z0-9 _\-]", "", (name or "").strip())[:32].strip()
    return safe or "Project"


def _write_runner_file(dest, content, executable=False):
    with open(dest, "w", encoding="utf-8", newline="") as f:
        f.write(content)
    if executable and not IS_WINDOWS:
        try:
            st = os.stat(dest)
            os.chmod(dest, st.st_mode | 0o111)
        except OSError:
            pass


def install_runner(proj):
    """Write backend-aware runner.bat + runner.sh into the project folder.

    managed -> backend template using the entry's cmd/port
    static  -> backend template when a runnable entry is detected,
               otherwise the static file-server template
    proxy   -> refused (points elsewhere, nothing local to run)
    Returns (ok, msg, port)."""
    ptype = proj.get("type")
    if ptype == "proxy":
        return False, "Proxy projects point elsewhere - nothing local to run.", 0
    root = resolve_static_root(proj.get("target"))
    if root is None:
        return False, f"Folder not found: '{proj.get('target')}'.", 0
    kind = "static"
    cmd = ""
    port = free_port() or 8100
    if ptype == "managed":
        cmd = (proj.get("cmd") or "").strip()
        try:
            port = int(proj.get("port"))
        except (TypeError, ValueError):
            return False, "Managed project needs a valid port.", 0
        if not cmd:
            return False, "Managed project needs a run command.", 0
        first = (_split_cmd(cmd)[:1] or [""])[0].lower()
        kind = "node" if first in ("npm", "npm.cmd", "npx", "npx.cmd",
                                   "node", "node.exe") else "python"
    else:
        det = detect_runner(proj.get("target"))
        if det.get("ok"):
            cmd = det["cmd"]
            if det.get("kind") in ("python", "node"):
                kind = det.get("kind")
            port = det.get("port") or port
    if not 1 <= port <= 65535 or port == PORT:
        return False, f"Port {port} is not usable.", 0
    name = _runner_bat_name(proj.get("name"))
    bat_content = sh_content = ""
    if kind == "python":
        parts = _split_cmd(cmd)
        if len(parts) < 2:
            return False, f"Run command needs a script: '{cmd}'.", 0
        script_args = " ".join(parts[1:])
        bat_content = (RUNNER_PYTHON_TEMPLATE.replace("__PORT__", str(port))
                       .replace("__NAME__", name)
                       .replace("__CMD_LABEL__", cmd)
                       .replace("__CMD_ARGS__", script_args))
        # .sh uses python3 explicitly; map py/python -> python3 when possible
        sh_args = script_args
        sh_content = (RUNNER_SH_PYTHON_TEMPLATE.replace("__PORT__", str(port))
                      .replace("__NAME__", name)
                      .replace("__CMD_LABEL__", cmd)
                      .replace("__CMD_ARGS__", sh_args))
        label = "python backend"
    elif kind == "node":
        first = (_split_cmd(cmd)[:1] or [""])[0].lower()
        bat_line = ("call " + cmd) if first in ("npm", "npm.cmd", "npx", "npx.cmd") else cmd
        # POSIX sh does not use `call`
        sh_line = cmd
        bat_content = (RUNNER_NODE_TEMPLATE.replace("__PORT__", str(port))
                       .replace("__NAME__", name)
                       .replace("__CMD_LABEL__", cmd)
                       .replace("__CMD_LINE__", bat_line))
        sh_content = (RUNNER_SH_NODE_TEMPLATE.replace("__PORT__", str(port))
                      .replace("__NAME__", name)
                      .replace("__CMD_LABEL__", cmd)
                      .replace("__CMD_LINE__", sh_line))
        label = "node backend"
    else:
        bat_content = RUNNER_TEMPLATE.replace("__PORT__", str(port)).replace(
            "__NAME__", name)
        sh_content = RUNNER_SH_TEMPLATE.replace("__PORT__", str(port)).replace(
            "__NAME__", name)
        label = "static server"
    bat_dest = os.path.join(root, "runner.bat")
    sh_dest = os.path.join(root, "runner.sh")
    existed = os.path.exists(bat_dest) or os.path.exists(sh_dest)
    try:
        _write_runner_file(bat_dest, bat_content, executable=False)
        _write_runner_file(sh_dest, sh_content, executable=True)
    except OSError as e:
        return False, f"Could not write runner: {e}", 0
    print(f"[Runner] {'Rewrote' if existed else 'Installed'} standalone runner for {proj.get('id')} ({label}, port {port})")
    how = ("double-click runner.bat on Windows, or `sh runner.sh` on Linux/macOS")
    verb = "rewrote" if existed else "ready"
    return True, f"runner.bat + runner.sh {verb} ({label}, port {port}) - {how} in the project folder.", port


atexit.register(_stop_all_managed)


def runner_state(pid):
    """Live (state, note) for a managed project. No exceptions escape."""
    try:
        r = _RUNNERS.get(pid)
        if not r or r.get("proc") is None:
            return "stopped", (r or {}).get("note", "")
        proc = r["proc"]
        if proc.poll() is not None:
            r["proc"] = None
            r["note"] = r.get("note") or f"Exited (code {proc.returncode})."
            return "stopped", r["note"]
        if port_open(r["port"]):
            return "running", ""
        return "starting", r.get("note") or "Waiting for port..."
    except Exception:
        return "stopped", ""


def project_status(proj):
    """Live status for the dashboard. No exceptions escape."""
    try:
        ptype = proj.get("type")
        if ptype == "static":
            root = resolve_static_root(proj.get("target"))
            if root is None:
                return "missing"
            if os.path.isfile(os.path.join(root, "index.html")):
                return "online"
            return "noindex"
        if ptype == "managed":
            state, _note = runner_state(proj.get("id", ""))
            return state
        port = int(proj.get("target"))
        return "online" if port_open(port) else "offline"
    except Exception:
        return "offline"


def project_note(proj):
    if proj.get("type") != "managed":
        return ""
    _state, note = runner_state(proj.get("id", ""))
    return note


def public_project(proj):
    creds = project_creds(proj)
    out = {
        "id": proj.get("id", ""),
        "name": proj.get("name", ""),
        "type": proj.get("type", ""),
        "target": proj.get("target", ""),
        "url": f"/p/{proj.get('id', '')}/",
        "status": project_status(proj),
        "locked": project_locked(proj),
        "authUser": creds.get("username", ""),
    }
    if proj.get("type") == "managed":
        out["cmd"] = proj.get("cmd", "")
        out["port"] = proj.get("port", "")
        out["note"] = project_note(proj)
    elif proj.get("type") == "static":
        det = detect_runner(proj.get("target"))
        out["runnable"] = (
            {"cmd": det["cmd"], "port": det["port"], "kind": det.get("kind", "")}
            if det.get("ok") else None
        )
        root = resolve_static_root(proj.get("target"))
        out["runner"] = bool(root and (
            os.path.isfile(os.path.join(root, "runner.bat"))
            or os.path.isfile(os.path.join(root, "runner.sh"))))
        out["runnerPort"] = proj.get("runnerPort", "")
    out["lockPass"] = bool(creds.get("password"))
    return out


def public_view(proj):
    """Reduced project info for logged-out visitors (no local paths/commands)."""
    full = public_project(proj)
    return {k: full.get(k, "") for k in ("id", "name", "type", "url", "status", "locked")}


# --- Per-project owners (path-scoped cookie sessions) ---
# Each project may carry auth {username, password}. Sessions live in
# cookies scoped to Path=/p/<id>/ so different owners can stay signed
# in to different projects on the same address (Basic Auth would leak
# one login across every project on the origin).
_SESSION_TTL = 12 * 3600
_SESSIONS = {}  # token -> {"pid": str, "user": str, "exp": float}


def _prune_sessions():
    now = time.time()
    for tok in [t for t, s in _SESSIONS.items() if s.get("exp", 0) < now]:
        _SESSIONS.pop(tok, None)


def _drop_project_sessions(pid):
    for tok in [t for t, s in _SESSIONS.items() if s.get("pid") == pid]:
        _SESSIONS.pop(tok, None)


def project_locked(proj):
    # A project is locked ("frozen") when the admin dashboard settings store
    # holds credentials for it (or, legacy, the entry itself does). The lock
    # only freezes management actions (run/stop/runner/edit/remove) until
    # unlocked - viewing the project link always stays open.
    if proj.get("locked"):
        return True
    if load_project_auth().get(proj.get("id", ""), {}).get("password"):
        return True
    a = proj.get("auth")
    if not isinstance(a, dict):
        return False
    return bool(a.get("password") or (a.get("username") and a.get("password")))


def session_token_for(proj, headers):
    pid = proj.get("id", "")
    cname = f"pm_{pid}="
    cookie = headers.get("Cookie") or ""
    tok = ""
    for part in cookie.split(";"):
        part = part.strip()
        if part.startswith(cname):
            tok = part[len(cname):].strip().strip('"')
            break
    if not tok:
        return None
    _prune_sessions()
    sess = _SESSIONS.get(tok)
    if sess and sess.get("pid") == pid:
        return tok
    return None


def project_authorized(proj, headers):
    # Locked projects stay publicly viewable (anyone with the link can open
    # them). The lock only freezes management actions - never viewing.
    return True


def locked_change_error(pid):
    """Error message when pid is locked, else None. Guards management APIs."""
    proj = find_project(pid)
    if proj is not None and project_locked(proj):
        return "Project is locked - unlock it first to make changes."
    return None


def project_login_page(proj, error=""):
    import html as _html
    name = _html.escape(str(proj.get("name") or proj.get("id", "project")))
    err = f"<p class='err'>{_html.escape(error)}</p>" if error else ""
    return ("<!DOCTYPE html><html lang='en'><head><meta charset='UTF-8'>"
            "<meta name='viewport' content='width=device-width, initial-scale=1, viewport-fit=cover'>"
            f"<title>{name} - sign in</title>"
            "<link rel='preconnect' href='https://fonts.googleapis.com'>"
            "<link rel='preconnect' href='https://fonts.gstatic.com' crossorigin>"
            "<link href='https://fonts.googleapis.com/css2?family=DotGothic16&family=IBM+Plex+Mono:wght@400;500;600&display=swap' rel='stylesheet'>"
            "<style>*{box-sizing:border-box;margin:0;padding:0}"
            "body{color:#faf6ec;font-family:'IBM Plex Mono',ui-monospace,Menlo,Consolas,monospace;"
            "min-height:100vh;display:flex;align-items:center;justify-content:center;"
            "padding:24px 16px;background:"
            "radial-gradient(circle,rgba(255,255,255,0.055) 1px,transparent 1.6px) 0 0/22px 22px,"
            "linear-gradient(158deg,#ba9b7a 0%,#9d7d5d 16%,#564c44 34%,#222226 58%,#101113 78%,#0a0a0d 100%);"
            "background-attachment:fixed}"
            ".box{position:relative;overflow:hidden;background:linear-gradient(180deg,#1c1f26,#14161b);"
            "border:1px solid #2b2f37;border-radius:18px;padding:26px 24px;width:min(92vw,380px);"
            "box-shadow:0 18px 40px rgba(0,0,0,0.5)}"
            ".box::before{content:'';position:absolute;inset:0 0 auto 0;height:3px;"
            "background:linear-gradient(90deg,#ff4b1f,transparent 70%);opacity:0.7}"
            ".eyebrow{font-size:0.68rem;letter-spacing:4px;font-weight:600;color:rgba(250,246,236,0.9);"
            "text-shadow:0 1px 8px rgba(0,0,0,0.7)}"
            "h2{font-family:'DotGothic16','IBM Plex Mono',monospace;font-weight:400;"
            "font-size:1.5rem;letter-spacing:3px;color:#f5efe2;margin:8px 0 2px;"
            "overflow:hidden;text-overflow:ellipsis;white-space:nowrap}"
            "h2 span{color:#ff4b1f}"
            ".row{display:flex;align-items:center;gap:8px;margin:10px 0 2px}"
            ".tag{font-size:0.66rem;font-weight:600;letter-spacing:2px;text-transform:uppercase;"
            "padding:4px 10px;border-radius:20px;background:#0e1013;color:#ff4b1f;"
            "border:1px solid rgba(255,75,31,0.5)}"
            ".dots{height:8px;opacity:0.8;flex:1;"
            "background:radial-gradient(circle,rgba(242,237,228,0.4) 1.2px,transparent 1.8px) 0 0/10px 8px repeat-x}"
            "p.sub{color:#b7ab93;font-size:0.78rem;letter-spacing:0.4px;line-height:1.6;margin:8px 0 14px}"
            "input{width:100%;margin:6px 0;padding:10px 12px;min-height:44px;font:inherit;font-size:0.85rem;"
            "background:#0e1013;color:#faf6ec;border:1px solid #2b2f37;border-radius:12px;outline:none}"
            "input:focus{border-color:#ff4b1f;box-shadow:0 0 12px rgba(255,75,31,0.25)}"
            "button{width:100%;margin-top:10px;padding:10px 16px;min-height:44px;cursor:pointer;"
            "font:inherit;font-size:0.8rem;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;"
            "background:linear-gradient(180deg,#ff5a2a,#e23c10);border:1px solid #ff5a2a;color:#fff;"
            "border-radius:12px;box-shadow:0 4px 18px rgba(255,75,31,0.35)}"
            "button:hover{filter:brightness(1.1)}"
            ".err{color:#ff5a5a;font-size:0.8rem;letter-spacing:0.5px;margin:8px 0 0}"
            ".back{display:block;text-align:center;margin-top:14px;font-size:0.72rem;"
            "letter-spacing:2px;text-transform:uppercase;color:#ff4b1f;text-decoration:none}"
            ".back:hover{text-decoration:underline}</style></head><body><div class='box'>"
            "<div class='eyebrow'>PROJECT MANAGER</div>"
            f"<h2>{name}<span>&bull;</span></h2>"
            "<div class='row'><span class='tag'>Locked</span><span class='dots'></span></div>"
            "<p class='sub'>This project is protected &mdash; sign in to continue.</p>"
            f"{err}<form method='POST' action='./login'>"
            "<input name='username' placeholder='Username' autocomplete='username' maxlength='32'>"
            "<input name='password' type='password' placeholder='Password' autocomplete='current-password'>"
            "<button type='submit'>Sign in</button></form>"
            "<a class='back' href='/'>&larr; Dashboard</a></div></body></html>")


def serve_port(proj):
    """Local port serving this project (proxy target or managed port)."""
    if proj.get("type") == "managed":
        return int(proj.get("port"))
    return int(proj.get("target"))


class ManagerHandler(SimpleHTTPRequestHandler):
    server_version = "ProjectManager/1.0"
    protocol_version = "HTTP/1.1"  # keep-alive: fewer TCP+TLS handshakes per poll

    def handle_one_request(self):
        # Browsers/tunnel probes routinely close idle keep-alive connections
        # mid-read (WinError 10054). Swallow it instead of dumping a traceback.
        try:
            super().handle_one_request()
        except (ConnectionResetError, BrokenPipeError):
            try:
                self.close_connection = True
            except Exception:
                pass

    def _set_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")

    def _send_json(self, obj, code=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self._set_cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
        except (TypeError, ValueError):
            length = 0
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            data = json.loads(raw.decode("utf-8") or "{}")
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def _read_raw(self, limit=200 * 1024 * 1024):
        try:
            length = int(self.headers.get("Content-Length", 0))
        except (TypeError, ValueError):
            length = 0
        if length <= 0 or length > limit:
            return None
        data = self.rfile.read(length)
        return data if len(data) == length else None

    # ---------- GET ----------
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        for b in BLOCKED:
            if path == b or path.startswith(b + "/") or path.startswith("/.git"):
                self.send_error(404, "Not found")
                return

        if path in ("/", "/index.html"):
            if not os.path.exists(INDEX_HTML):
                self.send_error(404, "Dashboard not found")
                return
            with open(INDEX_HTML, "rb") as f:
                page = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(page)))
            self._set_cors_headers()
            self.end_headers()
            self.wfile.write(page)
            return

        if path == "/api/browse":
            # Admin-only server-side folder picker for the Add form
            try:
                import urllib.parse as _upb
                _qb = _upb.parse_qs(_upb.urlparse(self.path).query)
                _ub = (_qb.get("username") or [""])[0]
                _pb = (_qb.get("path") or [""])[0]
            except Exception:
                _ub, _pb = "", ""
            if not is_admin_user(_ub):
                _deny = json.dumps({"ok": False, "error": "Admin sign-in required."}).encode("utf-8")
                self.send_response(403)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(_deny)))
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(_deny)
                return
            if not _pb:
                roots = [{"label": "Project List (default)", "path": PROJECTS_BASE},
                         {"label": "Manager folder", "path": BASE_DIR}]
                home = os.path.expanduser("~")
                if os.path.isdir(home):
                    roots.append({"label": "Home", "path": home})
                desk = os.path.join(home, "Desktop")
                if os.path.isdir(desk):
                    roots.append({"label": "Desktop", "path": desk})
                if IS_WINDOWS:
                    for _d in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
                        _dp = f"{_d}:\\"
                        if os.path.isdir(_dp):
                            roots.append({"label": f"Drive {_d}", "path": _dp})
                else:
                    if os.path.isdir("/"):
                        roots.append({"label": "Root /", "path": "/"})
                    for _cand in ("/home", "/mnt", "/media", "/srv", "/opt"):
                        if os.path.isdir(_cand):
                            roots.append({"label": _cand, "path": _cand})
                self._send_json({"ok": True, "path": "", "parent": "",
                                 "dirs": [], "roots": roots,
                                 "platform": platform.system()})
                return
            ap = os.path.abspath(os.path.normpath(_pb))
            if not os.path.isdir(ap):
                self._send_json({"ok": False, "error": "Folder not found."}, 400)
                return
            try:
                names = sorted(n for n in os.listdir(ap)
                               if os.path.isdir(os.path.join(ap, n)))
            except OSError as e:
                self._send_json({"ok": False, "error": str(e)}, 400)
                return
            parent = os.path.dirname(ap)
            self._send_json({"ok": True, "path": ap,
                             "parent": "" if parent == ap else parent,
                             "dirs": names, "roots": []})
            return

        if path == "/api/system":
            # Admin-only host hardware snapshot for the dashboard monitor
            try:
                import urllib.parse as _ups
                _qs = _ups.parse_qs(_ups.urlparse(self.path).query)
                _us = (_qs.get("username") or [""])[0]
            except Exception:
                _us = ""
            if not is_admin_user(_us):
                self._send_json({"ok": False, "error": "Admin sign-in required."}, 403)
                return
            self._send_json({"ok": True, "system": system_info()})
            return

        if path == "/api/projects":
            try:
                import urllib.parse as _upq
                _q = _upq.parse_qs(_upq.urlparse(self.path).query)
                _req_user = (_q.get("username") or [""])[0]
            except Exception:
                _req_user = ""
            if is_admin_user(_req_user):
                self._send_json({"projects": [public_project(p) for p in load_projects()],
                                 "role": "admin"})
            else:
                # Logged-out visitors: names, status and links only
                self._send_json({"projects": [public_view(p) for p in load_projects()],
                                 "role": "visitor"})
            return

        if path == "/p" or path == "/p/":
            self._send_json({"projects": [public_view(p) for p in load_projects()]})
            return

        if path.startswith("/p/"):
            rest = unquote(path[len("/p/"):])
            pid, slash, sub = rest.partition("/")
            if pid and not slash:
                # /p/<id> -> /p/<id>/ so relative URLs resolve inside the project
                loc = path + "/"
                if parsed.query:
                    loc += "?" + parsed.query
                self.send_response(302)
                self.send_header("Location", loc)
                self.send_header("Content-Length", "0")
                self._set_cors_headers()
                self.end_headers()
                return
            proj = find_project(pid)
            if proj is None:
                self.send_error(404, f"Unknown project '{pid}'")
                return
            if sub == "login":
                if project_authorized(proj, self.headers):
                    self._redirect_project_home(pid)
                else:
                    self._serve_login_page(proj)
                return
            if sub == "logout":
                tok = session_token_for(proj, self.headers)
                if tok:
                    _SESSIONS.pop(tok, None)
                self.send_response(302)
                expired = f"pm_{pid}=; Path=/p/{pid}/; HttpOnly; SameSite=Lax; Max-Age=0"
                self.send_header("Location", f"/p/{pid}/login")
                self.send_header("Set-Cookie", expired)
                self.send_header("Content-Length", "0")
                self._set_cors_headers()
                self.end_headers()
                return
            if not project_authorized(proj, self.headers):
                self._serve_login_page(proj)
                return
            if proj.get("type") == "static":
                self._serve_static(proj, sub, parsed.query)
            else:
                self._serve_proxy(proj, sub, parsed.query)
            return

    def _redirect_project_home(self, pid):
        self.send_response(302)
        self.send_header("Location", f"/p/{pid}/")
        self.send_header("Content-Length", "0")
        self._set_cors_headers()
        self.end_headers()

    def _serve_login_page(self, proj, error=""):
        page = project_login_page(proj, error).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(page)))
        self._set_cors_headers()
        self.end_headers()
        self.wfile.write(page)

    def _project_login(self, proj):
        length = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(length) if length > 0 else b""
        ctype = self.headers.get("Content-Type", "")
        data = {}
        if "application/json" in ctype:
            try:
                data = json.loads(raw.decode("utf-8") or "{}")
            except Exception:
                data = {}
        else:
            from urllib.parse import parse_qs as _pqs
            q = _pqs(raw.decode("utf-8", "replace"))
            data = {k: v[0] if v else "" for k, v in q.items()}
        auth = project_creds(proj)
        saved_user = (auth.get("username") or "").strip()
        saved_pw = auth.get("password") or ""
        entered_user = (data.get("username") or "").strip()
        entered_pw = data.get("password") or ""
        # Username is only checked when the lock saved one; the password
        # always is. Password-only locks accept any (or blank) username.
        if saved_pw and entered_pw == saved_pw and (not saved_user or entered_user == saved_user):
            _prune_sessions()
            tok = secrets.token_urlsafe(32)
            _SESSIONS[tok] = {"pid": proj.get("id"), "user": entered_user or saved_user,
                              "exp": time.time() + _SESSION_TTL}
            print(f"[Auth] Project sign-in {proj.get('id')} as {entered_user or saved_user or 'owner'}")
            self.send_response(302)
            self.send_header("Location", f"/p/{proj.get('id')}/")
            self.send_header(
                "Set-Cookie",
                f"pm_{proj.get('id')}={tok}; Path=/p/{proj.get('id')}/; HttpOnly; SameSite=Lax")
            self.send_header("Content-Length", "0")
            self._set_cors_headers()
            self.end_headers()
            return
        self._serve_login_page(proj, "Invalid username or password.")
        return

    # ---------- static ----------
    def _serve_static(self, proj, sub, _query):
        root = resolve_static_root(proj.get("target"))
        if root is None:
            self.send_error(404, "Project folder missing")
            return
        rel = unquote(sub).lstrip("/")
        full = os.path.normpath(os.path.join(root, rel))
        try:
            inside = os.path.commonpath([full, root]) == root
        except ValueError:
            inside = False
        if not inside:
            self.send_error(404, "Not found")
            return
        if os.path.isdir(full):
            full = os.path.join(full, "index.html")
        if not os.path.isfile(full):
            if full == os.path.join(root, "index.html"):
                self.send_error(404, "No index.html in project folder - point the target at the folder that contains it")
            else:
                self.send_error(404, "Not found")
            return
        mime, _ = mimetypes.guess_type(full)
        try:
            size = os.path.getsize(full)
            fh = open(full, "rb")
        except OSError:
            self.send_error(404, "Not found")
            return
        self.send_response(200)
        self.send_header("Content-Type", mime or "application/octet-stream")
        self.send_header("Content-Length", str(size))
        self._set_cors_headers()
        self.end_headers()
        try:
            # Stream in chunks so large assets never sit fully in RAM.
            shutil.copyfileobj(fh, self.wfile)
        finally:
            fh.close()

    # ---------- proxy (also serves managed projects on their port) ----------
    def _serve_proxy(self, proj, sub, query):
        try:
            port = serve_port(proj)
        except (TypeError, ValueError):
            self.send_error(502, "Bad project port")
            return
        if port == PORT:
            self.send_error(502, "Project cannot proxy to the manager itself")
            return
        url = f"http://127.0.0.1:{port}/{quote(sub, safe='/')}"
        if query:
            url += f"?{query}"
        length = int(self.headers.get("Content-Length", 0) or 0)
        data = self.rfile.read(length) if length > 0 else None
        fwd = urllib.request.Request(url, data=data, method=self.command)
        if self.headers.get("Content-Type"):
            fwd.add_header("Content-Type", self.headers.get("Content-Type"))
        try:
            with urllib.request.urlopen(fwd, timeout=20) as r:
                self.send_response(r.status)
                self.send_header("Content-Type",
                                 r.headers.get("Content-Type") or "application/octet-stream")
                up_len = r.headers.get("Content-Length")
                if up_len:
                    self.send_header("Content-Length", up_len)
                    self._set_cors_headers()
                    self.end_headers()
                    # Stream upstream -> client, no full-body buffering.
                    shutil.copyfileobj(r, self.wfile)
                else:
                    body = r.read()
                    self.send_header("Content-Length", str(len(body)))
                    self._set_cors_headers()
                    self.end_headers()
                    self.wfile.write(body)
        except urllib.error.HTTPError as e:
            try:
                body = e.read()
            except Exception:
                body = b""
            self.send_response(e.code)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self._set_cors_headers()
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:
            msg = f"Project offline (port {port}): {e}".encode("utf-8")
            self.send_response(502)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(msg)))
            self._set_cors_headers()
            self.end_headers()
            self.wfile.write(msg)

    # ---------- POST ----------
    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # Project backends accept writes too (login, verify, save, ...).
        # No redirect here (unlike GET): a 302 would drop the method/body,
        # so a bare /p/<id> is proxied straight to the project root.
        if path.startswith("/p/"):
            self._handle_project_write(parsed)
            return

        if path == "/api/login":
            body = self._read_body()
            entered_user = (body.get("username") or "").strip()
            entered_pass = body.get("password") or ""
            matched = None
            for a in load_credentials():
                if (isinstance(a, dict) and a.get("username") == entered_user
                        and a.get("password") == entered_pass):
                    matched = a
                    break
            if matched is not None:
                role = (matched.get("role") or "admin").strip().lower()
                self._send_json({"ok": True, "username": matched.get("username", ""),
                                 "role": role})
            else:
                self._send_json({"ok": False, "error": "Invalid username or password."})
            return

        if path == "/api/upload":
            # Upload a .zip into Project List/<slug>/ and register it as a
            # project so it is immediately usable under /p/<id>/.
            # Raw zip bytes in body, params in query (avoids multipart parsing).
            # e.g. POST /api/upload?name=MySite&requester=admin&type=auto
            try:
                import urllib.parse as _upu
                _q = _upu.parse_qs(_upu.urlparse(self.path).query)
                _name = ((_q.get("name") or [""])[0] or "").strip()
                _req = ((_q.get("requester") or [""])[0] or "").strip()
                _want = ((_q.get("type") or ["auto"])[0] or "auto").strip().lower()
            except Exception:
                _name, _req, _want = "", "", "auto"
            _admin, _err = requester_is_admin({"requester": _req})
            if _err:
                # Drain body so the connection stays usable
                try:
                    self._read_raw()
                except Exception:
                    pass
                self._send_json({"ok": False, "error": _err}, 403)
                return
            if len(_name) < 2 or len(_name) > 48:
                try:
                    self._read_raw()
                except Exception:
                    pass
                self._send_json({"ok": False, "error": "Project name must be 2-48 chars."}, 400)
                return
            if _want not in ("auto", "static", "managed", "proxy"):
                _want = "auto"
            if _want == "proxy":
                try:
                    self._read_raw()
                except Exception:
                    pass
                self._send_json({"ok": False, "error": "Cannot upload for a proxy project."}, 400)
                return
            data = self._read_raw()
            if not data or len(data) < 4 or data[:2] != b"PK":
                self._send_json({"ok": False, "error": "Upload a .zip file (not detected)."}, 400)
                return
            projects = load_projects()
            pid = unique_id(slugify(_name), projects)
            dest = safe_project_dir(pid)
            if dest is None:
                self._send_json({"ok": False, "error": "Bad project name."}, 400)
                return
            try:
                os.makedirs(dest, exist_ok=True)
                n = extract_zip_to(data, dest)
                _strip_single_root(dest)
                top = len(os.listdir(dest)) if os.path.isdir(dest) else 0
            except Exception as e:
                self._send_json({"ok": False, "error": f"Unzip failed: {e}"}, 400)
                return
            base_target = project_list_target(pid)
            # Point at the nested folder when the site lives one level down
            # (e.g. UniEvent.zip -> prototype/index.html).
            target, found = find_servable_target(base_target)
            det = detect_runner(target)
            runnable = ({"cmd": det["cmd"], "port": det["port"],
                         "kind": det.get("kind", "")}
                        if det.get("ok") else None)
            ptype = _want
            if ptype == "auto":
                ptype = "managed" if runnable else "static"
            entry = {"id": pid, "name": _name, "type": ptype, "target": target}
            msg = ""
            if ptype == "managed":
                if runnable:
                    entry["cmd"] = runnable["cmd"]
                    entry["port"] = str(runnable["port"])
                else:
                    # Fall back to static so the upload is still viewable
                    # instead of failing outright.
                    entry["type"] = ptype = "static"
                    msg = " No runnable entry found - added as static."
            if ptype == "static" and resolve_static_root(target) is None:
                self._send_json({"ok": False, "error": "Upload extracted nothing usable."}, 400)
                return
            projects.append(entry)
            save_projects(projects)
            print(f"[Upload] {_name} -> {pid} ({n} files, {ptype}: {target})")
            self._send_json({"ok": True, "id": pid, "target": target,
                             "type": ptype, "files": n, "entries": top,
                             "runnable": runnable,
                             "url": f"/p/{pid}/",
                             "message": f"Added \"{_name}\" ({ptype}) under /p/{pid}/.{msg}",
                             "projects": [public_project(p) for p in load_projects()]})
            return

        if path == "/api/projects":
            body = self._read_body()
            _admin, _err = requester_is_admin(body)
            if _err:
                self._send_json({"ok": False, "error": _err}, 403)
                return
            try:
                name = (body.get("name") or "").strip()
                if len(name) < 2:
                    raise ValueError("Project name must be 2+ chars.")
                if len(name) > 48:
                    raise ValueError("Project name too long (max 48).")
                ptype = (body.get("type") or "static").strip().lower()
                if ptype not in VALID_TYPES:
                    raise ValueError("Type must be static, proxy or managed.")
                target = str(body.get("target") or "").strip()
                projects = load_projects()
                pid = unique_id(slugify(name), projects)
                if ptype in ("static", "managed"):
                    if not target:
                        # Default: new empty folder in Project List
                        target = project_list_target(pid)
                        os.makedirs(os.path.join(BASE_DIR, target), exist_ok=True)
                    elif (not os.path.isabs(target)
                          and "/" not in target.replace("\\", "/")
                          and not target.startswith(".")):
                        # Bare name -> Project List/<name>
                        target = project_list_target(slugify(target) or pid)
                entry = {"name": name, "type": ptype, "target": target}
                if ptype == "static":
                    if resolve_static_root(target) is None:
                        raise ValueError(
                            f"Folder not found: '{target}'. "
                            "Upload a .zip first or pick a folder under Project List.")
                elif ptype == "managed":
                    _validate_managed(target, body.get("cmd"), body.get("port"))
                    entry["cmd"] = (body.get("cmd") or "").strip()
                    entry["port"] = str(int(body.get("port")))
                else:
                    try:
                        port = int(target)
                    except (TypeError, ValueError):
                        raise ValueError("Proxy target must be a port number.")
                    if not 1 <= port <= 65535:
                        raise ValueError("Port must be 1-65535.")
                    if port == PORT:
                        raise ValueError("Cannot proxy to the manager itself.")
                entry["id"] = pid
                projects.append(entry)
                save_projects(projects)
                print(f"[Projects] Added {name} -> {pid} ({ptype}: {target})")
                self._send_json({"ok": True,
                                 "projects": [public_project(p) for p in projects]})
            except ValueError as ve:
                self._send_json({"ok": False, "error": str(ve)}, 400)
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)}, 500)
            return

        if path == "/api/detect":
            # Inspect a folder and suggest how to run it (for managed projects)
            body = self._read_body()
            _admin, _err = requester_is_admin(body)
            if _err:
                self._send_json({"ok": False, "error": _err}, 403)
                return
            det = detect_runner(body.get("path"))
            self._send_json(det, 200 if det.get("ok") else 400)
            return

        if path == "/api/projects/update":
            # Edit a project (e.g. convert static -> managed). Restarts nothing:
            # a running managed project is stopped so changes apply on next start.
            body = self._read_body()
            _admin, _err = requester_is_admin(body)
            if _err:
                self._send_json({"ok": False, "error": _err}, 403)
                return
            pid = (body.get("id") or "").strip()
            _lock_err = locked_change_error(pid)
            if _lock_err:
                self._send_json({"ok": False, "error": _lock_err}, 403)
                return
            try:
                projects = load_projects()
                entry = next((p for p in projects if p.get("id") == pid), None)
                if entry is None:
                    raise ValueError(f"Unknown project '{pid}'.")
                if "name" in body and (body.get("name") or "").strip():
                    name = body.get("name").strip()
                    if len(name) < 2 or len(name) > 48:
                        raise ValueError("Project name must be 2-48 chars.")
                    entry["name"] = name
                if "type" in body and (body.get("type") or "").strip():
                    ptype = body.get("type").strip().lower()
                    if ptype not in VALID_TYPES:
                        raise ValueError("Type must be static, proxy or managed.")
                    entry["type"] = ptype
                if "target" in body:
                    entry["target"] = str(body.get("target") or "").strip()
                if "cmd" in body:
                    entry["cmd"] = str(body.get("cmd") or "").strip()
                if "port" in body:
                    entry["port"] = str(body.get("port") or "").strip()
                # Re-validate the resulting entry
                ptype = entry.get("type", "static")
                if ptype == "static":
                    if resolve_static_root(entry.get("target")) is None:
                        raise ValueError(f"Folder not found: '{entry.get('target')}'.")
                    entry.pop("cmd", None)
                    entry.pop("port", None)
                elif ptype == "managed":
                    _validate_managed(entry.get("target"), entry.get("cmd"), entry.get("port"))
                    entry["port"] = str(int(entry.get("port")))
                else:
                    try:
                        port = int(entry.get("target"))
                    except (TypeError, ValueError):
                        raise ValueError("Proxy target must be a port number.")
                    if not 1 <= port <= 65535:
                        raise ValueError("Port must be 1-65535.")
                    if port == PORT:
                        raise ValueError("Cannot proxy to the manager itself.")
                    entry.pop("cmd", None)
                    entry.pop("port", None)
                stop_managed(pid)
                save_projects(projects)
                print(f"[Projects] Updated {pid}")
                self._send_json({"ok": True,
                                 "projects": [public_project(p) for p in projects]})
            except ValueError as ve:
                self._send_json({"ok": False, "error": str(ve)}, 400)
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)}, 500)
            return

        if path == "/api/projects/start":
            body = self._read_body()
            _admin, _err = requester_is_admin(body)
            if _err:
                self._send_json({"ok": False, "error": _err}, 403)
                return
            pid = (body.get("id") or "").strip()
            proj = find_project(pid)
            if proj is None:
                self._send_json({"ok": False, "error": f"Unknown project '{pid}'."}, 404)
                return
            _lock_err = locked_change_error(pid)
            if _lock_err:
                self._send_json({"ok": False, "error": _lock_err}, 403)
                return
            if proj.get("type") != "managed":
                self._send_json({"ok": False,
                                 "error": "Only managed projects can be started here."}, 400)
                return
            ok, msg = start_managed(proj)
            self._send_json({"ok": ok,
                             ("message" if ok else "error"): msg,
                             "projects": [public_project(p) for p in load_projects()]},
                            200 if ok else 500)
            return

        if path == "/api/projects/stop":
            body = self._read_body()
            _admin, _err = requester_is_admin(body)
            if _err:
                self._send_json({"ok": False, "error": _err}, 403)
                return
            pid = (body.get("id") or "").strip()
            if find_project(pid) is None:
                self._send_json({"ok": False, "error": f"Unknown project '{pid}'."}, 404)
                return
            _lock_err = locked_change_error(pid)
            if _lock_err:
                self._send_json({"ok": False, "error": _lock_err}, 403)
                return
            stop_managed(pid)
            print(f"[Projects] Stopped {pid}")
            self._send_json({"ok": True,
                             "projects": [public_project(p) for p in load_projects()]})
            return

        if path == "/api/projects/runner":
            # Generate a standalone localhost runner.bat inside a static project
            body = self._read_body()
            _admin, _err = requester_is_admin(body)
            if _err:
                self._send_json({"ok": False, "error": _err}, 403)
                return
            pid = (body.get("id") or "").strip()
            _lock_err = locked_change_error(pid)
            if _lock_err:
                self._send_json({"ok": False, "error": _lock_err}, 403)
                return
            try:
                projects = load_projects()
                entry = next((p for p in projects if p.get("id") == pid), None)
                if entry is None:
                    raise ValueError(f"Unknown project '{pid}'.")
                ok, msg, port = install_runner(entry)
                if not ok:
                    raise ValueError(msg)
                entry["runnerPort"] = str(port)
                save_projects(projects)
                self._send_json({"ok": True, "message": msg,
                                 "projects": [public_project(p) for p in projects]})
            except ValueError as ve:
                self._send_json({"ok": False, "error": str(ve)}, 400)
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)}, 500)
            return

        if path == "/api/projects/auth":
            # Lock a project (admin only). Saves per-project credentials
            # {username, password} in the dashboard settings store
            # (project_auth.json) - never inside the project entry.
            # Opening the project link and every unlock both ask for them.
            # Password (4-64 chars) is required; username is optional and,
            # when set, must also match on the project sign-in page.
            body = self._read_body()
            _admin, _err = requester_is_admin(body)
            if _err:
                self._send_json({"ok": False, "error": _err}, 403)
                return
            try:
                pid = (body.get("id") or "").strip()
                projects = load_projects()
                entry = next((p for p in projects if p.get("id") == pid), None)
                if entry is None:
                    raise ValueError(f"Unknown project '{pid}'.")
                pw = body.get("password") or ""
                if not (4 <= len(pw) <= 64):
                    raise ValueError("Lock password is required (4-64 chars).")
                uname = (body.get("username") or "").strip()
                if len(uname) > 32:
                    raise ValueError("Lock username too long (max 32).")
                store = load_project_auth()
                store[pid] = {"username": uname, "password": pw}
                save_project_auth(store)
                # Credentials live only in the store - scrub any legacy
                # copies off the project entry itself.
                entry.pop("auth", None)
                entry.pop("locked", None)
                _drop_project_sessions(pid)
                save_projects(projects)
                print(f"[Auth] Locked {pid} (credentials saved for '{uname or 'owner'}')")
                self._send_json({"ok": True,
                                 "projects": [public_project(p) for p in projects]})
            except ValueError as ve:
                self._send_json({"ok": False, "error": str(ve)}, 400)
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)}, 500)
            return

        if path == "/api/projects/auth/clear":
            body = self._read_body()
            _admin, _err = requester_is_admin(body)
            if _err:
                self._send_json({"ok": False, "error": _err}, 403)
                return
            pid = (body.get("id") or "").strip()
            projects = load_projects()
            entry = next((p for p in projects if p.get("id") == pid), None)
            if entry is None:
                self._send_json({"ok": False, "error": f"Unknown project '{pid}'."}, 404)
                return
            cur = load_project_auth().get(pid, {})
            if not cur.get("password"):
                # Legacy fallback: credentials once lived on the entry itself.
                legacy = entry.get("auth") if isinstance(entry.get("auth"), dict) else {}
                cur = {"username": str(legacy.get("username") or ""),
                       "password": str(legacy.get("password") or "")}
            if cur.get("password"):
                # Every unlock asks for the lock password - the admin
                # session alone is not enough.
                if (body.get("password") or "") != cur.get("password"):
                    self._send_json({"ok": False, "error": "Incorrect lock password."}, 403)
                    return
            store = load_project_auth()
            store.pop(pid, None)
            save_project_auth(store)
            entry.pop("auth", None)
            entry.pop("locked", None)
            _drop_project_sessions(pid)
            save_projects(projects)
            print(f"[Auth] Unlocked {pid}")
            self._send_json({"ok": True,
                             "projects": [public_project(p) for p in projects]})
            return

        if path == "/api/projects/delete":
            body = self._read_body()
            _admin, _err = requester_is_admin(body)
            if _err:
                self._send_json({"ok": False, "error": _err}, 403)
                return
            pid = (body.get("id") or "").strip()
            projects = load_projects()
            _lock_err = locked_change_error(pid)
            if _lock_err:
                self._send_json({"ok": False, "error": _lock_err}, 403)
                return
            kept = [p for p in projects if p.get("id") != pid]
            if len(kept) == len(projects):
                self._send_json({"ok": False, "error": f"Unknown project '{pid}'."}, 404)
                return
            save_projects(kept)
            print(f"[Projects] Deleted {pid}")
            self._send_json({"ok": True,
                             "projects": [public_project(p) for p in kept]})
            return

        self.send_error(404, "Endpoint not found")

    def _handle_project_write(self, parsed=None):
        """Route POST/PUT/DELETE/PATCH under /p/<id>/ to the project backend."""
        parsed = parsed or urlparse(self.path)
        path = parsed.path
        if not path.startswith("/p/"):
            self.send_error(404, "Endpoint not found")
            return
        rest = unquote(path[len("/p/"):])
        pid, _slash, sub = rest.partition("/")
        proj = find_project(pid)
        if proj is None:
            self.send_error(404, f"Unknown project '{pid}'")
            return
        if sub == "login":
            if self.command == "POST":
                self._project_login(proj)
            else:
                self.send_error(404, "Not found")
            return
        if not project_authorized(proj, self.headers):
            self._send_json({"ok": False, "error": "Project sign-in required."}, 401)
            return
        if proj.get("type") == "static":
            self.send_error(405, "Static projects do not accept writes")
            return
        self._serve_proxy(proj, sub, parsed.query)

    def do_PUT(self):
        self._handle_project_write()

    def do_DELETE(self):
        self._handle_project_write()

    def do_PATCH(self):
        self._handle_project_write()

    def end_headers(self):
        try:
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
        except Exception:
            pass
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()


if __name__ == "__main__":
    # Threaded: one slow proxied app (or a 12s start-poll) must never
    # head-of-line-block the dashboard or the tunnel health checks.
    server = ThreadingHTTPServer(("0.0.0.0", PORT), ManagerHandler)
    server.daemon_threads = True
    print(f"Project Manager running on http://localhost:{PORT}")
    print("Add projects in the dashboard, each served under /p/<id>/")
    server.serve_forever()
