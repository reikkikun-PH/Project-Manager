import os
import sys
# --- Portable libs: allow copying folder anywhere (no pip install needed on target) ---
# If ./libs exists (vendored deps via `pip install --target libs -r requirements.txt`), add it to sys.path
_LIBS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "libs")
if os.path.isdir(_LIBS_DIR) and _LIBS_DIR not in sys.path:
    sys.path.insert(0, _LIBS_DIR)

import json
import base64
import mimetypes
import re
import cv2
import numpy as np
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, HTTPServer

# Port is overridable via env so the Project Manager can host this app on an
# assigned port (it passes PORT=...). Standalone default stays 8000.
PORT = int(os.environ.get("PORT", "8000"))
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
EMPLOYEE_DIR = os.path.join(BASE_DIR, "employee data")
LOGS_DIR = os.path.join(BASE_DIR, "logs")
MODELS_DIR = os.path.join(BASE_DIR, "models")
FACE_DETECTOR_MODEL = os.path.join(MODELS_DIR, "face_detection_yunet_2023mar.onnx")
FACE_RECOGNIZER_MODEL = os.path.join(MODELS_DIR, "face_recognition_sface_2021dec.onnx")

# Pure face-vision thresholds (SFace cosine similarity)
# 0.363 is SFace default FAR 1e-4; lower = more lenient for selfies
FACE_COSINE_THRESHOLD = 0.36
# Map cosine to confidence% for UI (cosine 0.36->55%, 1.0->99%)
MATCH_THRESHOLD = 55
HIGH_CONFIDENCE_EARLY_EXIT = 82

# Self-learning from logs: use recent verified captures as additional references
SELF_LEARN_ENABLED = True
SELF_LEARN_MAX_LOGS_PER_EMPLOYEE = 3  # how many recent logs to use per employee
SELF_LEARN_MIN_LOGS_FOR_TRUST = 1  # start learning after N logs exist

os.makedirs(LOGS_DIR, exist_ok=True)
os.makedirs(EMPLOYEE_DIR, exist_ok=True)

LOG_JSON = os.path.join(LOGS_DIR, "attendance_log.json")
CONFIG_JSON = os.path.join(BASE_DIR, "attendance_config.json")
DEFAULT_PRESENT_CUTOFF = "09:00"  # HH:MM 24h, local time – attendance after this is "Late"

def _validate_cutoff(value):
    if not isinstance(value, str):
        raise ValueError("Cutoff must be HH:MM")
    m = re.match(r"^([01]\d|2[0-3]):([0-5]\d)$", value.strip())
    if not m:
        raise ValueError("Cutoff must be HH:MM (00:00-23:59), e.g. 09:00")
    return value.strip()

def load_attendance_config():
    """Return {present_cutoff:str, presentCutoff:str, raw:dict}. Falls back to DEFAULT."""
    cfg = {"present_cutoff": DEFAULT_PRESENT_CUTOFF}
    if os.path.exists(CONFIG_JSON):
        try:
            with open(CONFIG_JSON, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    # Support both keys
                    raw = data.get("present_cutoff") or data.get("presentCutoff") or data.get("cutoff")
                    if raw:
                        cfg["present_cutoff"] = _validate_cutoff(str(raw))
                    # also carry other keys if present
                    for k in ("updated", "updatedBy"):
                        if k in data:
                            cfg[k] = data[k]
        except Exception as e:
            print(f"[Config] load fail, using default {DEFAULT_PRESENT_CUTOFF}: {e}")
    # normalized alias for frontend
    cfg["presentCutoff"] = cfg["present_cutoff"]
    return cfg

def save_attendance_config(cutoff_str):
    cutoff = _validate_cutoff(cutoff_str)
    cfg = {"present_cutoff": cutoff, "presentCutoff": cutoff, "updated": datetime.now().isoformat()}
    with open(CONFIG_JSON, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)
    print(f"[Config] saved cutoff={cutoff}")
    return cfg

def get_attendance_status(timestamp_dt):
    """Present if timestamp time <= cutoff, else Late."""
    try:
        cfg = load_attendance_config()
        cutoff_s = cfg.get("present_cutoff", DEFAULT_PRESENT_CUTOFF)
        h, mi = map(int, cutoff_s.split(":"))
        cutoff_minutes = h*60 + mi
        ts_minutes = timestamp_dt.hour*60 + timestamp_dt.minute
        # Also consider seconds: if exactly cutoff minute but seconds >0, still Present? Keep minute granularity
        # If strictly after cutoff minute, Late
        if ts_minutes <= cutoff_minutes:
            return "Present"
        else:
            return "Late"
    except Exception as e:
        print(f"[Status] fail: {e}")
        return "Present"

# --- Accounts & Roles ---
# Roles: "admin" (full control of panel + features) | "employee" (own attendance logs only)
VALID_ROLES = ("admin", "employee")
CREDS_PATH = os.path.join(BASE_DIR, "credentials.json")

def _normalize_role(role):
    r = (role or "").strip().lower()
    # Legacy entries without a role default to admin (previous full-access behavior)
    return r if r in VALID_ROLES else "admin"

def load_credentials():
    """Load accounts list; tolerates legacy {username, password} entries."""
    try:
        if os.path.exists(CREDS_PATH):
            with open(CREDS_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    return data
    except Exception as e:
        print(f"[Auth] load fail: {e}")
    return []

def save_credentials(accounts):
    with open(CREDS_PATH, "w", encoding="utf-8") as f:
        json.dump(accounts, f, indent=2, ensure_ascii=False)

def find_account(username):
    uname = (username or "").strip()
    for a in load_credentials():
        if isinstance(a, dict) and (a.get("username") or "") == uname:
            return a
    return None

def account_role(account):
    if not isinstance(account, dict):
        return "admin"
    return _normalize_role(account.get("role"))

def account_employee(account):
    """Linked employee display name used for log filtering (explicit link, else username)."""
    if not isinstance(account, dict):
        return ""
    link = (account.get("employee") or "").strip()
    if link:
        return link
    return (account.get("username") or "").strip()

def public_account(account):
    """Account safe for API responses (never leaks password)."""
    return {
        "username": account.get("username", ""),
        "role": account_role(account),
        "employee": account.get("employee", "") or "",
    }

def _norm_name(s):
    return re.sub(r"\s+", " ", (s or "").replace("_", " ").strip()).lower()

def requester_is_admin(body):
    """Check body.requester (or body.username) is an admin. Returns (account, error)."""
    req = ((body.get("requester") or body.get("username") or "") if isinstance(body, dict) else "").strip()
    if not req:
        return None, "Login required (admin)."
    acc = find_account(req)
    if acc is None:
        return None, "Unknown account - please sign in again."
    if account_role(acc) != "admin":
        return None, "Admin role required."
    return acc, None

def _validate_new_username(username, accounts):
    u = (username or "").strip()
    if len(u) < 3:
        raise ValueError("Username must be 3+ chars.")
    if len(u) > 32:
        raise ValueError("Username too long (max 32).")
    if not re.match(r"^[A-Za-z0-9_\-]+$", u):
        raise ValueError("Username: letters/numbers/_/- only.")
    existing = {(a.get("username") or "").lower() for a in accounts if isinstance(a, dict)}
    if u.lower() in existing:
        raise ValueError(f"Username '{u}' already exists.")
    return u

def count_admins(accounts):
    return sum(1 for a in accounts if account_role(a) == "admin")

def file_to_mat(file_path):
    img = cv2.imread(file_path)
    return img

def data_url_to_mat(data_url):
    if "," in data_url:
        _, raw_b64 = data_url.split(",", 1)
    else:
        raw_b64 = data_url
    img_bytes = base64.b64decode(raw_b64)
    nparr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    return img

def file_to_data_url(file_path):
    mime_type, _ = mimetypes.guess_type(file_path)
    if not mime_type:
        mime_type = "image/jpeg"
    with open(file_path, "rb") as f:
        encoded = base64.b64encode(f.read()).decode("utf-8")
    return f"data:{mime_type};base64,{encoded}"

def save_log_image(captured_image_data, employee_name):
    if "," in captured_image_data:
        _, raw_b64 = captured_image_data.split(",", 1)
    else:
        raw_b64 = captured_image_data

    now = datetime.now()
    timestamp = now.strftime("%Y-%m-%d_%H-%M-%S")
    sanitized_name = employee_name.replace(" ", "_")
    filename = f"{timestamp}_{sanitized_name}.jpg"
    dest_path = os.path.join(LOGS_DIR, filename)

    with open(dest_path, "wb") as f:
        f.write(base64.b64decode(raw_b64))

    return filename, now

def append_structured_log(name, confidence, filename, timestamp_dt, log_type="FACE", raw_tail=""):
    """Write proper log entry with time, name, confidence to attendance_log.json"""
    try:
        status = get_attendance_status(timestamp_dt)
        entry = {
            "timestamp": timestamp_dt.isoformat(),
            "displayTime": timestamp_dt.strftime("%Y-%m-%d %H:%M:%S"),
            "date": timestamp_dt.strftime("%Y-%m-%d"),
            "time": timestamp_dt.strftime("%H:%M:%S"),
            "name": name,
            "confidence": confidence,
            "file": filename,
            "type": log_type,
            "status": status,
            "detail": raw_tail[:120] if raw_tail else ""
        }
        logs = []
        if os.path.exists(LOG_JSON):
            try:
                with open(LOG_JSON, "r", encoding="utf-8") as f:
                    logs = json.load(f)
                    if not isinstance(logs, list):
                        logs = []
            except:
                logs = []
        logs.append(entry)
        # keep sorted newest first and limit to 500 entries
        logs = sorted(logs, key=lambda x: x["timestamp"], reverse=True)[:500]
        with open(LOG_JSON, "w", encoding="utf-8") as f:
            json.dump(logs, f, indent=2, ensure_ascii=False)
        return entry
    except Exception as e:
        print(f"[Log] append failed: {e}")
        return None

def load_structured_logs():
    """Load from attendance_log.json, fallback to parsing filenames in logs/"""
    if os.path.exists(LOG_JSON):
        try:
            with open(LOG_JSON, "r", encoding="utf-8") as f:
                logs = json.load(f)
                if isinstance(logs, list) and len(logs) > 0:
                    # Backfill status for old entries without it
                    for entry in logs:
                        if "status" not in entry or entry.get("status") not in ("Present", "Late"):
                            try:
                                ts = entry.get("timestamp") or entry.get("displayTime") or ""
                                # Try ISO parse
                                dt = None
                                if "T" in ts:
                                    dt = datetime.fromisoformat(ts)
                                elif " " in ts:
                                    dt = datetime.strptime(ts, "%Y-%m-%d %H:%M:%S")
                                else:
                                    # try time field
                                    t_s = entry.get("time", "00:00:00")
                                    h, m = map(int, t_s.split(":")[:2])
                                    dt = datetime.now().replace(hour=h, minute=m, second=0, microsecond=0)
                                entry["status"] = get_attendance_status(dt) if dt else "Present"
                            except:
                                entry["status"] = "Present"
                    return sorted(logs, key=lambda x: x["timestamp"], reverse=True)
        except:
            pass
    # Fallback: parse filenames like 2026-09-10_22-54-03_ricky.jpg
    fallback = []
    try:
        for fname in os.listdir(LOGS_DIR):
            if not fname.lower().endswith((".jpg", ".jpeg", ".png")):
                continue
            if fname == os.path.basename(LOG_JSON):
                continue
            # Try parse timestamp_name
            m = re.match(r"(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})_(.+)\.jpg$", fname, re.I)
            if m:
                date_s, time_s, name_s = m.groups()
                t = time_s.replace("-", ":")
                display = f"{date_s} {t}"
                iso = f"{date_s}T{t}"
                try:
                    dt = datetime.strptime(f"{date_s} {t}", "%Y-%m-%d %H:%M:%S")
                    status = get_attendance_status(dt)
                except:
                    status = "Present"
                fallback.append({
                    "timestamp": iso,
                    "displayTime": display,
                    "date": date_s,
                    "time": t,
                    "name": name_s.replace("_", " "),
                    "confidence": "",
                    "file": fname,
                    "type": "UNKNOWN",
                    "status": status,
                    "detail": ""
                })
        return sorted(fallback, key=lambda x: x["timestamp"], reverse=True)
    except Exception as e:
        print(f"[Log] fallback load fail: {e}")
        return []


def get_self_learn_refs(employee_sanitized):
    """Return up to N most recent verified log images for this employee (self-learning pool)."""
    if not SELF_LEARN_ENABLED:
        return []
    try:
        # Logs are named {timestamp}_{sanitized}.jpg, so filter by suffix
        suffix = f"_{employee_sanitized}.jpg"
        all_logs = [f for f in os.listdir(LOGS_DIR) if f.lower().endswith(suffix.lower())]
        # Most recent first (timestamp prefix sorts correctly)
        all_logs = sorted(all_logs, reverse=True)[:SELF_LEARN_MAX_LOGS_PER_EMPLOYEE]
        return [os.path.join(LOGS_DIR, f) for f in all_logs]
    except Exception as e:
        print(f"[Self-Learn] error listing logs for {employee_sanitized}: {e}")
        return []

# --- Employee Data Management ---
EMPLOYEE_VALID_EXTS = (".jpg", ".jpeg", ".png", ".webp")

def _sanitize_employee_name(name):
    # Allow letters, numbers, spaces, hyphen, underscore; collapse spaces
    name = (name or "").strip()
    name = re.sub(r"\s+", " ", name)
    # Remove dangerous chars but keep letters/numbers/space/_/-
    safe = re.sub(r"[^A-Za-z0-9 _\-]", "", name)
    safe = safe.strip()
    # Limit length
    return safe[:48]

def get_employee_list():
    """Return list of employees with file, name, url."""
    employees = []
    try:
        if not os.path.exists(EMPLOYEE_DIR):
            return employees
        for fname in sorted(os.listdir(EMPLOYEE_DIR)):
            if not fname.lower().endswith(EMPLOYEE_VALID_EXTS):
                continue
            full = os.path.join(EMPLOYEE_DIR, fname)
            if not os.path.isfile(full):
                continue
            base = os.path.splitext(fname)[0]
            display_name = base.replace("_", " ")
            # Encode URL safely (space -> %20)
            from urllib.parse import quote
            # Relative (no leading slash) so the app also works under a sub-path (/p/<id>/)
            url = "employee%20data/" + quote(fname)
            # File size / modified for info
            try:
                stat = os.stat(full)
                mtime = datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M")
            except:
                mtime = ""
            employees.append({"file": fname, "name": display_name, "url": url, "modified": mtime})
    except Exception as e:
        print(f"[Employee] list fail: {e}")
    return employees

def save_employee_image(name, image_data_url):
    """Save employee image. Returns (filename, saved_path) or raises ValueError."""
    safe_name = _sanitize_employee_name(name)
    if not safe_name or len(safe_name) < 1:
        raise ValueError("Name must contain letters/numbers.")
    if len(safe_name) < 2:
        raise ValueError("Name too short (min 2 chars).")
    if not image_data_url or "," not in image_data_url:
        raise ValueError("Invalid image data.")

    # Detect extension from data URL mime
    header, raw_b64 = image_data_url.split(",", 1)
    mime = "image/jpeg"
    if "image/png" in header:
        mime = "image/png"
    elif "image/webp" in header:
        mime = "image/webp"
    elif "image/jpeg" in header or "image/jpg" in header:
        mime = "image/jpeg"
    ext_map = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
    ext = ext_map.get(mime, ".jpg")

    # Validate base64 & image decodable
    try:
        img_bytes = base64.b64decode(raw_b64)
        nparr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None or img.size == 0:
            raise ValueError("Uploaded file is not a valid image.")
    except Exception as e:
        raise ValueError(f"Invalid image: {e}")

    # Optional: warn if no face detected but still allow (for objects/cartoons)
    # We don't block saving — admin may intentionally add objects/cartoons
    filename = safe_name.replace(" ", "_") + ext
    dest = os.path.join(EMPLOYEE_DIR, filename)
    # Avoid overwrite unless same sanitized name (case-insensitive check)
    existing_lower = {f.lower(): f for f in os.listdir(EMPLOYEE_DIR)}
    if filename.lower() in existing_lower and existing_lower[filename.lower()] != filename:
        # Use existing casing
        filename = existing_lower[filename.lower()]
        dest = os.path.join(EMPLOYEE_DIR, filename)
        # If file exists with different ext but same base, allow overwrite? Check duplicate base
    else:
        # Check duplicate name with different extension
        base_lower = safe_name.replace(" ", "_").lower()
        for f in os.listdir(EMPLOYEE_DIR):
            if os.path.splitext(f)[0].lower() == base_lower:
                raise ValueError(f"Employee '{safe_name}' already exists as '{f}'. Remove it first or use a different name.")

    # Enforce max employees to avoid abuse
    if len(get_employee_list()) >= 100:
        raise ValueError("Employee limit reached (100). Remove some first.")

    with open(dest, "wb") as f:
        f.write(img_bytes)
    print(f"[Employee] Added {safe_name} -> {filename}")
    return filename, dest

def delete_employee_file(file_name):
    """Delete employee file safely within EMPLOYEE_DIR. Returns True if deleted."""
    if not file_name:
        raise ValueError("No file specified.")
    # Prevent path traversal
    # Only allow basename with valid ext
    base = os.path.basename(file_name.strip())
    if base != file_name.strip():
        raise ValueError("Invalid file path.")
    if not base.lower().endswith(EMPLOYEE_VALID_EXTS):
        raise ValueError("Invalid file type.")
    if ".." in base or "/" in base or "\\" in base:
        raise ValueError("Invalid file name.")
    dest = os.path.join(EMPLOYEE_DIR, base)
    # Ensure dest is inside EMPLOYEE_DIR
    if os.path.commonpath([os.path.abspath(dest), os.path.abspath(EMPLOYEE_DIR)]) != os.path.abspath(EMPLOYEE_DIR):
        raise ValueError("Invalid file path.")
    if not os.path.exists(dest):
        raise ValueError(f"File not found: {base}")
    os.remove(dest)
    print(f"[Employee] Removed {base}")
    return True

# --- Pure face-vision (no LLM) using OpenCV YuNet + SFace ---
_detector = None
_recognizer = None

def _get_face_models(score_thresh=0.45):
    global _detector, _recognizer
    # Recreate detector if threshold changed
    if _detector is None or _recognizer is None or getattr(_get_face_models, "_thr", None) != score_thresh:
        if not os.path.exists(FACE_DETECTOR_MODEL) or not os.path.exists(FACE_RECOGNIZER_MODEL):
            raise FileNotFoundError(f"Missing face models in {MODELS_DIR} - expected yunet+sface onnx")
        _detector = cv2.FaceDetectorYN.create(FACE_DETECTOR_MODEL, "", (320, 320), score_thresh, 0.3, 5000)
        _recognizer = cv2.FaceRecognizerSF.create(FACE_RECOGNIZER_MODEL, "")
        _get_face_models._thr = score_thresh
    return _detector, _recognizer

def _get_face_feature(img, low_thr=0.45):
    """Detect largest face (real or cartoon) and return embedding. Supports fictional characters. Returns (feat, best, is_fallback)."""
    if img is None or img.size == 0:
        return None, "no image", False
    h, w = img.shape[:2]
    if h < 20 or w < 20:
        return None, "image too small", False
    # 1) YuNet for real faces (selfie-tolerant thresholds)
    for thr in (low_thr, 0.35, 0.3):
        detector, recognizer = _get_face_models(score_thresh=thr)
        detector.setInputSize((w, h))
        _, faces = detector.detect(img)
        if faces is not None and len(faces) > 0:
            best = max(faces, key=lambda f: f[2] * f[3])
            score = float(best[14]) if len(best) > 14 else 1.0
            if score < thr - 0.15 and len(faces) > 1:
                continue
            aligned = recognizer.alignCrop(img, best)
            feat = recognizer.feature(aligned)
            if thr != low_thr:
                print(f"[Face] recovered with thr {thr} (score {score:.2f})")
            return feat, best, False
    # Last resort: try upscaled for tiny faces
    try:
        h2, w2 = h*2, w*2
        if max(h2, w2) < 2000:
            img_up = cv2.resize(img, (w2, h2), interpolation=cv2.INTER_LINEAR)
            detector, recognizer = _get_face_models(score_thresh=0.35)
            detector.setInputSize((w2, h2))
            _, faces = detector.detect(img_up)
            if faces is not None and len(faces) > 0:
                best = max(faces, key=lambda f: f[2] * f[3])
                best[:4] /= 2
                aligned = recognizer.alignCrop(img, best)
                feat = recognizer.feature(aligned)
                print(f"[Face] recovered via 2x upscale")
                return feat, best, False
    except Exception:
        pass

    # 2) Fictional / cartoon fallback: whole-image SFace (YuNet often misses anime/illustrated faces)
    try:
        _, recognizer = _get_face_models()
        crop_h, crop_w = int(h*0.75), int(w*0.75)
        y0, x0 = (h - crop_h)//2, (w - crop_w)//2
        center = img[y0:y0+crop_h, x0:x0+crop_w]
        if center.size != 0:
            pseudo2 = np.array([[x0, y0, crop_w, crop_h, w/2-20, h/2-10, w/2+20, h/2-10, w/2, h/2, w/2-15, h/2+15, w/2+15, h/2+15, 0.55]], dtype=np.float32)
            aligned = recognizer.alignCrop(img, pseudo2[0])
            feat = recognizer.feature(aligned)
            print(f"[Face] cartoon whole-image fallback")
            return feat, pseudo2[0], True
    except Exception as e:
        print(f"[Face] cartoon fallback fail: {e}")

    return None, "no face detected (even cartoon fallback)", False

def _get_object_feature(img):
    """Generic object embedding: ORB + color histogram. Returns dict or None."""
    if img is None or img.size == 0:
        return None
    try:
        # Resize to 256 for stability
        small = cv2.resize(img, (256, 256), interpolation=cv2.INTER_AREA)
        # 1) ORB descriptors
        orb = cv2.ORB_create(nfeatures=300)
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        kp, des = orb.detectAndCompute(gray, None)
        # 2) HSV histogram (8x8x8 = 512 bins)
        hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
        hist = cv2.calcHist([hsv], [0,1,2], None, [8,8,8], [0,180,0,256,0,256])
        cv2.normalize(hist, hist)
        return {"orb_kp": kp, "orb_des": des, "hist": hist, "small": small}
    except Exception as e:
        print(f"[Object] feature fail: {e}")
        return None

def _object_match(feat1, feat2):
    """Compare two object features: returns score 0..1 (higher = more similar). Stricter to avoid face vs object false positives."""
    if feat1 is None or feat2 is None:
        return 0.0
    hist_score = cv2.compareHist(feat1["hist"], feat2["hist"], cv2.HISTCMP_CORREL)
    hist_score = (hist_score + 1) / 2  # 0..1
    des1, des2 = feat1["orb_des"], feat2["orb_des"]
    orb_score = 0.0
    if des1 is not None and des2 is not None and len(des1) >= 2 and len(des2) >= 2:
        bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=False)
        try:
            matches = bf.knnMatch(des1, des2, k=2)
            good = 0
            for m_n in matches:
                if len(m_n) != 2:
                    continue
                m, n = m_n
                if m.distance < 0.75 * n.distance:
                    good += 1
            total = min(len(des1), len(des2))
            orb_score = good / total if total > 0 else 0.0
        except Exception:
            orb_score = 0.0
    # Stricter combine: need BOTH hist and orb to be decent for objects
    # For face vs object, hist may be moderate but orb will be very low -> score stays low
    if orb_score < 0.12 and hist_score < 0.75:
        # Not enough keypoint matches and hist not very high -> likely different objects/faces
        return float(hist_score * 0.5)  # penalize
    score = 0.45 * hist_score + 0.55 * orb_score
    # Only boost hist if orb is near zero but hist very high (flat color objects)
    if orb_score < 0.05 and hist_score > 0.85:
        score = 0.75 * hist_score + 0.25 * orb_score
    return float(np.clip(score, 0, 1))

def _cosine_to_confidence(cosine, matched, is_cartoon=False):
    # Cartoon embeddings are noisier → slightly lower threshold & confidence curve
    thr = 0.32 if is_cartoon else FACE_COSINE_THRESHOLD
    if matched:
        # thr -> 60%, 1.0 -> 96-98%
        conf = int(60 + (cosine - thr) / (1.0 - thr) * 36)
        return max(58, min(96, conf)) if is_cartoon else max(55, min(98, conf))
    else:
        if cosine < 0.18:
            return 90
        if cosine < 0.28:
            return 80
        if cosine < thr:
            return 66
        return 60

def _verify_against_reference(ref_path, captured_mat, captured_feat, captured_info, emp_name, ref_label, captured_fallback=False):
    """Pure vision: face → cartoon → object. Returns (matched, confidence, tail)."""
    ref_img = cv2.imread(ref_path)
    if ref_img is None:
        print(f"[Skip] Cannot load ref {ref_path}")
        return False, 0, "load fail"
    ref_feat, ref_info, ref_fallback = _get_face_feature(ref_img)
    # Determine if we should try object pipeline: both sides are fallback (no real face)
    # _get_face_feature now returns 3 values, handle legacy 2-value return
    if isinstance(ref_fallback, str):  # old 2-value case
        ref_fallback = False
    # If ref had no face at all (even after cartoon fallback), go straight to object
    if ref_feat is None:
        # Try object pipeline for ref
        ref_obj = _get_object_feature(ref_img)
        cap_obj = _get_object_feature(captured_mat)
        if ref_obj is not None and cap_obj is not None:
            score = _object_match(ref_obj, cap_obj)
            obj_thr = 0.45  # tuned: hist+ORB 0.45 is reasonable for objects
            matched = score >= obj_thr
            conf = int(60 + (score - obj_thr)/(1 - obj_thr)*35) if matched else int(70 - score*30)
            conf = max(58, min(96, conf)) if matched else max(60, min(90, conf))
            tail = f"object_score={score:.3f} thr={obj_thr} -> {'MATCH' if matched else 'NO MATCH'} ({conf}%) ref={ref_label} [OBJECT]"
            print(f"\n[Vision] {emp_name} vs {ref_label} | OBJECT score={score:.4f} ({'MATCH' if matched else 'NO MATCH'} {conf}%)")
            return matched, conf, tail
        print(f"[Face] {emp_name} ref {ref_label}: {ref_info} -> skip")
        return False, 0, ref_info

    if captured_feat is None:
        # Captured has no face — try object comparison if ref is also object-like (fallback)
        if ref_fallback:
            cap_obj = _get_object_feature(captured_mat)
            ref_obj = _get_object_feature(ref_img)
            if cap_obj and ref_obj:
                score = _object_match(ref_obj, cap_obj)
                obj_thr = 0.45
                matched = score >= obj_thr
                conf = int(60 + (score - obj_thr)/(1 - obj_thr)*35) if matched else int(70 - score*30)
                conf = max(58, min(96, conf)) if matched else max(60, min(90, conf))
                print(f"\n[Vision] {emp_name} vs {ref_label} | OBJECT (captured no-face) score={score:.4f}")
                return matched, conf, f"object_score={score:.3f}"
        return False, 0, "no face in captured"

    # Both have face feats — check if either used cartoon fallback (object/cartoon)
    is_cartoon = bool(ref_fallback or captured_fallback or ("cartoon" in str(ref_info).lower() if ref_info is not None else False))
    # If both are fallback (likely object/cartoon), prefer object matcher as primary (more discriminative than SFace whole-image)
    if ref_fallback and captured_fallback:
        ref_obj = _get_object_feature(ref_img)
        cap_obj = _get_object_feature(captured_mat)
        if ref_obj and cap_obj:
            obj_score = _object_match(ref_obj, cap_obj)
            obj_thr = 0.62  # stricter for objects to avoid false positives (face vs chair was 0.686 false)
            matched = obj_score >= obj_thr
            # Also compute SFace cosine as secondary
            _, recognizer = _get_face_models()
            cosine = recognizer.match(ref_feat, captured_feat, cv2.FaceRecognizerSF_FR_COSINE) if ref_feat is not None and captured_feat is not None else 0.0
            # Combine: need both decent? For true object match, both SFace (whole-image) and object should be moderate
            # Use object score primary, SFace as tie-breaker
            if matched:
                conf = int(62 + (obj_score - obj_thr)/(1 - obj_thr)*34)
                conf = max(60, min(96, conf))
                print(f"\n[Vision] {emp_name} vs {ref_label} | OBJECT score={obj_score:.3f} cosine={cosine:.3f} MATCH ({conf}%)")
                return True, conf, f"object={obj_score:.3f} cosine={cosine:.3f} [OBJECT]"
            else:
                # Also check SFace override if object says no but SFace very high (e.g., cartoon face still valid)
                if cosine >= 0.55:
                    conf2 = _cosine_to_confidence(float(cosine), True, is_cartoon=True)
                    print(f"\n[Vision] {emp_name} vs {ref_label} | OBJECT {obj_score:.3f} NO MATCH but FACE {cosine:.3f} MATCH -> face wins")
                    return True, conf2, f"object={obj_score:.3f} face={cosine:.3f} [FACE OVERRIDE]"
                conf = int(70 - obj_score*30) if obj_score < obj_thr else 60
                print(f"\n[Vision] {emp_name} vs {ref_label} | OBJECT score={obj_score:.3f} NO MATCH ({conf}%)")
                return False, conf, f"object={obj_score:.3f} [OBJECT]"

    thr = 0.32 if is_cartoon else FACE_COSINE_THRESHOLD
    _, recognizer = _get_face_models()
    cosine = recognizer.match(ref_feat, captured_feat, cv2.FaceRecognizerSF_FR_COSINE)
    matched = cosine >= thr
    confidence = _cosine_to_confidence(float(cosine), matched, is_cartoon=is_cartoon)
    tag = "CARTOON" if is_cartoon else "FACE"
    # If face cosine is very low and BOTH are fallback (object vs object), double-check with object matcher
    if not matched and ref_fallback and captured_fallback and cosine < 0.30:
        ref_obj = _get_object_feature(ref_img)
        cap_obj = _get_object_feature(captured_mat)
        if ref_obj and cap_obj:
            obj_score = _object_match(ref_obj, cap_obj)
            if obj_score >= 0.62:
                conf2 = int(60 + (obj_score - 0.45) / 0.55 * 35)
                print(f"\n[Vision] {emp_name} vs {ref_label} | {tag} cosine={cosine:.4f} NO MATCH but OBJECT {obj_score:.3f} MATCH -> override")
                return True, max(confidence, conf2), f"cosine={cosine:.3f} + object={obj_score:.3f} [OBJECT OVERRIDE]"

    tail = f"cosine={cosine:.3f} thr={thr} -> {'MATCH' if matched else 'NO MATCH'} ({confidence}%) ref={ref_label} [{tag}]"
    print(f"\n[Vision] {emp_name} vs {ref_label} | {tag} cosine={cosine:.4f} ({'MATCH' if matched else 'NO MATCH'} {confidence}%)")
    return matched, confidence, tail


def verify_single_shot(image_b64):
    valid_extensions = (".jpg", ".jpeg", ".png", ".webp")
    employee_files = [f for f in os.listdir(EMPLOYEE_DIR) if f.lower().endswith(valid_extensions)]

    if not employee_files:
        return {"matched": False, "error": "No reference images in 'employee data' folder."}

    # Decode captured once and get its face/object feature
    captured_mat = data_url_to_mat(image_b64)
    if captured_mat is None:
        return {"matched": False, "error": "Invalid image data."}
    cap_res = _get_face_feature(captured_mat)
    # Support both 2 and 3-value return for backward compat
    if len(cap_res) == 3:
        captured_feat, cap_info, cap_fallback = cap_res
    else:
        captured_feat, cap_info = cap_res
        cap_fallback = False
    # For pure objects, face will be fallback but we still have a feat — don't reject yet, try object pipeline in verify
    if captured_feat is None:
        # No face even after fallback — try pure object detection for captured
        cap_obj = _get_object_feature(captured_mat)
        if cap_obj is None:
            print(f"[Vision] No face/object in captured: {cap_info}")
            return {"matched": False, "error": f"No face/object detected ({cap_info}). Try clearer image."}
        # Keep captured_feat as None but remember cap_obj fallback will be used per-ref
        # We'll still proceed and let _verify_against_reference handle object comparison
        print(f"[Vision] Captured has no face, using object pipeline")
        captured_feat = None
        cap_info = str(cap_info) + " + object"
    cap_is_cartoon_fallback = cap_fallback

    best_candidate = None  # (emp_name, confidence, ref_path)
    all_results = []

    for emp_file in employee_files:
        emp_path = os.path.join(EMPLOYEE_DIR, emp_file)
        emp_name = os.path.splitext(emp_file)[0].replace("_", " ")
        emp_sanitized = os.path.splitext(emp_file)[0]  # keep original sanitized for log match
        # Build reference pool: primary + self-learn logs
        ref_pool = [(emp_path, "ID photo")]
        for log_path in get_self_learn_refs(emp_sanitized):
            ref_pool.append((log_path, f"self-learn:{os.path.basename(log_path)}"))

        # Show self-learn status
        if len(ref_pool) > 1:
            print(f"[Self-Learn] {emp_name}: using {len(ref_pool)} refs (1 primary + {len(ref_pool)-1} recent logs)")

        best_for_employee = None  # (confidence, matched, ref_path)

        for ref_path, ref_label in ref_pool:
            matched, confidence, raw_tail = _verify_against_reference(ref_path, captured_mat, captured_feat, cap_info if 'cap_info' in locals() else "", emp_name, ref_label, captured_fallback=cap_is_cartoon_fallback if 'cap_is_cartoon_fallback' in locals() else False)
            all_results.append({"name": emp_name, "matched": matched, "confidence": confidence, "ref": ref_label})

            # Per-employee best (for logging)
            if matched and (best_for_employee is None or confidence > best_for_employee[0]):
                best_for_employee = (confidence, True, ref_path)

            # Global best across all employees
            if matched:
                if best_candidate is None or confidence > best_candidate[1]:
                    best_candidate = (emp_name, confidence, ref_path)
                if confidence >= HIGH_CONFIDENCE_EARLY_EXIT:
                    print(f"-> High-confidence early exit for {emp_name} via {ref_label} ({confidence}%)")
                    break

        # Early exit outer loop if very confident match found
        if best_candidate and best_candidate[1] >= HIGH_CONFIDENCE_EARLY_EXIT:
            break

    if best_candidate:
        emp_name, confidence, best_ref = best_candidate
        saved_file, ts = save_log_image(image_b64, emp_name)
        # Determine type from best_ref
        log_type = "FACE"
        raw_detail = ""
        # Find detail from all_results for best candidate
        for r in all_results:
            if r["name"] == emp_name and r["confidence"] == confidence:
                raw_detail = r.get("ref", "")
                if "OBJECT" in r.get("ref", "") or "OBJECT" in str(r):
                    log_type = "OBJECT"
                elif "CARTOON" in r.get("ref", ""):
                    log_type = "CARTOON"
                break
        # Also check ref path string
        if "object" in str(best_ref).lower():
            log_type = "OBJECT"
        entry = append_structured_log(emp_name, f"Verified ({confidence}%)", saved_file, ts, log_type=log_type, raw_tail=raw_detail)
        status = entry.get("status") if entry else get_attendance_status(ts)
        return {
            "matched": True,
            "name": emp_name,
            "confidence": f"Verified ({confidence}%)",
            "logFile": saved_file,
            "type": log_type,
            "status": status,
            "presentCutoff": load_attendance_config().get("presentCutoff")
        }

    # No confident match — provide helpful diagnostic
    if all_results:
        closest = max(all_results, key=lambda x: x["confidence"])
        print(f"[Result] No match. Closest: {closest['name']} at {closest['confidence']}% (threshold {MATCH_THRESHOLD}%)")
    return {"matched": False, "error": "Identity could not be confirmed."}

class AttendanceServerHandler(SimpleHTTPRequestHandler):
    def _set_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")

    def do_GET(self):
        # Block sensitive files from ever being served, even via cloudflared tunnel
        blocked = ("/credentials.json", "/.env", "/server.py", "/credentials", "/attendance_log.json", "/attendance_config.json")
        # Strip query string for check
        path_no_qs = self.path.split("?")[0].split("#")[0]
        if path_no_qs in blocked or path_no_qs.startswith("/.git") or path_no_qs.endswith(".env"):
            self.send_error(404, "Not found")
            return
        if path_no_qs in ("/api/config", "/api/attendance-config", "/api/attendance_config"):
            cfg = load_attendance_config()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._set_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps(cfg).encode("utf-8"))
            return
        if path_no_qs == "/api/employees":
            employees = get_employee_list()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._set_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({"employees": employees, "count": len(employees)}).encode("utf-8"))
            return
        if path_no_qs == "/api/accounts":
            # Admin only: list login accounts (passwords never exposed)
            try:
                import urllib.parse as _up2
                _q2 = _up2.parse_qs(_up2.urlparse(self.path).query)
                _req2 = (_q2.get("username") or [""])[0].strip()
            except Exception:
                _req2 = ""
            _acc2 = find_account(_req2) if _req2 else None
            if _acc2 is None or account_role(_acc2) != "admin":
                self.send_response(403)
                self.send_header("Content-Type", "application/json")
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": "Admin role required."}).encode("utf-8"))
                return
            accts = [public_account(a) for a in load_credentials() if isinstance(a, dict)]
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._set_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({"accounts": accts, "count": len(accts)}).encode("utf-8"))
            return
        if path_no_qs == "/api/logs":
            logs = load_structured_logs()
            # Role scoping: employees only see their own attendance logs
            try:
                import urllib.parse as _up
                _q = _up.parse_qs(_up.urlparse(self.path).query)
                _req_user = (_q.get("username") or [""])[0].strip()
            except Exception:
                _req_user = ""
            _req_role = "admin"
            _scope_name = ""
            if _req_user:
                _acc = find_account(_req_user)
                if _acc is not None and account_role(_acc) == "employee":
                    _req_role = "employee"
                    _scope_name = account_employee(_acc)
                    _want = _norm_name(_scope_name)
                    logs = [l for l in logs if _norm_name(l.get("name", "")) == _want]
            files = [l["file"] for l in logs]
            cfg = load_attendance_config()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._set_cors_headers()
            self.end_headers()
            # Return both structured logs and legacy files for compatibility + current cutoff
            self.wfile.write(json.dumps({"files": files, "logs": logs, "config": cfg, "presentCutoff": cfg.get("presentCutoff"), "role": _req_role, "scope": _scope_name}).encode("utf-8"))
            return
        if path_no_qs == "/api/logs/csv":
            logs = load_structured_logs()
            # Beginner-friendly CSV: clear headers, human-readable, Excel-safe with BOM and CRLF
            header = "Date,Time,Name,Status,Confidence,Type,Image File,Details"
            csv_lines = [header]
            for l in logs:
                # Split displayTime "2026-09-10 23:24:42" -> Date, Time
                dt = l.get("displayTime", "")
                date_s, time_s = (dt.split(" ", 1) + ["", ""])[:2] if " " in dt else (l.get("date", ""), l.get("time", ""))
                # Clean confidence "Verified (94%)" -> "94%" and status (uses stored Late/Present)
                conf_raw = l.get("confidence", "")
                m = re.search(r"(\d+%)", conf_raw)
                conf = m.group(1) if m else conf_raw
                status = l.get("status") or ("Present" if l.get("name") else "Unknown")
                # Friendly type
                type_map = {"FACE": "Face", "CARTOON": "Cartoon", "OBJECT": "Object", "UNKNOWN": "Unknown"}
                type_friendly = type_map.get(l.get("type", ""), l.get("type", ""))
                # Escape commas/quotes for CSV: wrap in quotes if needed
                def csv_esc(v):
                    s = str(v).replace('"', '""')
                    return f'"{s}"' if any(c in s for c in [",", '"', "\n"]) else s
                row = [
                    csv_esc(date_s),
                    csv_esc(time_s),
                    csv_esc(l.get("name", "").title()),
                    csv_esc(status),
                    csv_esc(conf),
                    csv_esc(type_friendly),
                    csv_esc(l.get("file", "")),
                    csv_esc(l.get("detail", "").replace(",", ";"))
                ]
                csv_lines.append(",".join(row))
            # Add summary footer for beginners
            csv_lines.append("")
            csv_lines.append(f"Total Records,{len(logs)}")
            csv_lines.append(f"Generated,{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
            csv_lines.append("Tip: Open in Excel/Google Sheets — Date and Time are separate for easy sorting/filtering")
            csv_data = "\r\n".join(csv_lines)
            # BOM for Excel to show UTF-8 correctly
            csv_bytes = ("\ufeff" + csv_data).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header("Content-Disposition", "attachment; filename=attendance_log.csv")
            self.send_header("Content-Length", str(len(csv_bytes)))
            self.end_headers()
            self.wfile.write(csv_bytes)
            return
        else:
            super().do_GET()

    def do_POST(self):
        path_no_qs = self.path.split("?")[0].split("#")[0]
        if path_no_qs == "/api/employees" and self.command == "POST":
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                post_data = self.rfile.read(content_length) if content_length else b"{}"
                body = json.loads(post_data.decode("utf-8")) if post_data else {}
                _admin, _err = requester_is_admin(body)
                if _err:
                    raise PermissionError(_err)
                name = (body.get("name") or body.get("employeeName") or "").strip()
                image = body.get("image") or body.get("dataUrl") or ""
                if not name:
                    raise ValueError("Employee name is required.")
                if not image:
                    raise ValueError("Image is required (JPEG/PNG/WEBP).")
                filename, _ = save_employee_image(name, image)
                employees = get_employee_list()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"ok": True, "file": filename, "employees": employees}).encode("utf-8"))
            except PermissionError as pe:
                self.send_response(403)
                self.send_header("Content-Type", "application/json")
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": str(pe)}).encode("utf-8"))
            except ValueError as ve:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": str(ve)}).encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": str(e)}).encode("utf-8"))
            return

        if path_no_qs == "/api/employees/delete":
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                post_data = self.rfile.read(content_length) if content_length else b"{}"
                body = json.loads(post_data.decode("utf-8")) if post_data else {}
                _admin, _err = requester_is_admin(body)
                if _err:
                    raise PermissionError(_err)
                file_name = (body.get("file") or body.get("filename") or "").strip()
                # Also allow delete by name
                if not file_name and body.get("name"):
                    safe = _sanitize_employee_name(body.get("name")).replace(" ", "_")
                    # Find matching file by base
                    for f in os.listdir(EMPLOYEE_DIR):
                        if os.path.splitext(f)[0].lower() == safe.lower():
                            file_name = f
                            break
                if not file_name:
                    raise ValueError("File or name is required.")
                delete_employee_file(file_name)
                employees = get_employee_list()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"ok": True, "employees": employees}).encode("utf-8"))
            except PermissionError as pe:
                self.send_response(403)
                self.send_header("Content-Type", "application/json")
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": str(pe)}).encode("utf-8"))
            except ValueError as ve:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": str(ve)}).encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": str(e)}).encode("utf-8"))
            return

        if path_no_qs in ("/api/config", "/api/attendance-config", "/api/attendance_config"):
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                post_data = self.rfile.read(content_length) if content_length else b"{}"
                body = json.loads(post_data.decode("utf-8")) if post_data else {}
                _admin, _err = requester_is_admin(body)
                if _err:
                    raise PermissionError(_err)
                # Accept multiple key variants
                cutoff = body.get("presentCutoff") or body.get("present_cutoff") or body.get("cutoff") or body.get("time")
                if not cutoff:
                    raise ValueError("Missing 'presentCutoff' (HH:MM, e.g. 09:00)")
                cfg = save_attendance_config(str(cutoff).strip())
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"ok": True, "config": cfg, "presentCutoff": cfg["presentCutoff"]}).encode("utf-8"))
            except PermissionError as pe:
                self.send_response(403)
                self.send_header("Content-Type", "application/json")
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": str(pe)}).encode("utf-8"))
            except ValueError as ve:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": str(ve)}).encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": str(e)}).encode("utf-8"))
            return

        if path_no_qs == "/api/accounts":
            # Admin only: create a login account (employee or admin)
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                post_data = self.rfile.read(content_length) if content_length else b"{}"
                body = json.loads(post_data.decode("utf-8")) if post_data else {}
                _admin, _err = requester_is_admin(body)
                if _err:
                    raise PermissionError(_err)
                accounts = load_credentials()
                username = _validate_new_username(body.get("username"), accounts)
                password = (body.get("password") or "")
                if len(password) < 4:
                    raise ValueError("Password must be 4+ chars.")
                role = _normalize_role(body.get("role") or "employee")
                employee = (body.get("employee") or "").strip()[:48]
                accounts.append({"username": username, "password": password, "role": role, "employee": employee})
                save_credentials(accounts)
                print(f"[Accounts] Added {username} (role={role})")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"ok": True, "accounts": [public_account(a) for a in accounts]}).encode("utf-8"))
            except PermissionError as pe:
                self.send_response(403)
                self.send_header("Content-Type", "application/json")
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": str(pe)}).encode("utf-8"))
            except ValueError as ve:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": str(ve)}).encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": str(e)}).encode("utf-8"))
            return

        if path_no_qs == "/api/accounts/update":
            # Admin only: change role / reset password / link employee
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                post_data = self.rfile.read(content_length) if content_length else b"{}"
                body = json.loads(post_data.decode("utf-8")) if post_data else {}
                _admin, _err = requester_is_admin(body)
                if _err:
                    raise PermissionError(_err)
                target = (body.get("target") or body.get("username") or "").strip()
                accounts = load_credentials()
                entry = None
                for a in accounts:
                    if isinstance(a, dict) and (a.get("username") or "") == target:
                        entry = a
                        break
                if entry is None:
                    raise ValueError(f"Account '{target}' not found.")
                if "role" in body and body.get("role") is not None and str(body.get("role")).strip() != "":
                    new_role = _normalize_role(body.get("role"))
                    if account_role(entry) == "admin" and new_role != "admin" and count_admins(accounts) <= 1:
                        raise ValueError("Cannot demote the last admin account.")
                    entry["role"] = new_role
                if "password" in body and (body.get("password") or "") != "":
                    if len(body.get("password")) < 4:
                        raise ValueError("Password must be 4+ chars.")
                    entry["password"] = body.get("password")
                if "employee" in body:
                    entry["employee"] = (body.get("employee") or "").strip()[:48]
                save_credentials(accounts)
                print(f"[Accounts] Updated {target}")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"ok": True, "accounts": [public_account(a) for a in accounts]}).encode("utf-8"))
            except PermissionError as pe:
                self.send_response(403)
                self.send_header("Content-Type", "application/json")
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": str(pe)}).encode("utf-8"))
            except ValueError as ve:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": str(ve)}).encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": str(e)}).encode("utf-8"))
            return

        if path_no_qs == "/api/accounts/delete":
            # Admin only: remove a login account
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                post_data = self.rfile.read(content_length) if content_length else b"{}"
                body = json.loads(post_data.decode("utf-8")) if post_data else {}
                _admin, _err = requester_is_admin(body)
                if _err:
                    raise PermissionError(_err)
                target = (body.get("target") or body.get("username") or "").strip()
                requester = ((body.get("requester") or "")).strip()
                if target == requester:
                    raise ValueError("You cannot delete your own account while signed in.")
                accounts = load_credentials()
                entry = None
                for a in accounts:
                    if isinstance(a, dict) and (a.get("username") or "") == target:
                        entry = a
                        break
                if entry is None:
                    raise ValueError(f"Account '{target}' not found.")
                if account_role(entry) == "admin" and count_admins(accounts) <= 1:
                    raise ValueError("Cannot delete the last admin account.")
                accounts = [a for a in accounts if not (isinstance(a, dict) and (a.get("username") or "") == target)]
                save_credentials(accounts)
                print(f"[Accounts] Deleted {target}")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"ok": True, "accounts": [public_account(a) for a in accounts]}).encode("utf-8"))
            except PermissionError as pe:
                self.send_response(403)
                self.send_header("Content-Type", "application/json")
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": str(pe)}).encode("utf-8"))
            except ValueError as ve:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": str(ve)}).encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": str(e)}).encode("utf-8"))
            return

        if path_no_qs == "/api/login":
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                post_data = self.rfile.read(content_length) if content_length else b"{}"
                body = json.loads(post_data.decode("utf-8")) if post_data else {}
                entered_user = (body.get("username") or "").strip()
                entered_pass = body.get("password") or ""

                # Read credentials server-side (never expose file)
                accounts = load_credentials()

                matched = None
                for a in accounts:
                    if isinstance(a, dict) and a.get("username") == entered_user and a.get("password") == entered_pass:
                        matched = a
                        break

                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self._set_cors_headers()
                self.end_headers()
                if matched is not None:
                    pub = public_account(matched)
                    self.wfile.write(json.dumps({"ok": True, "username": pub["username"], "role": pub["role"], "employee": pub["employee"]}).encode("utf-8"))
                else:
                    self.wfile.write(json.dumps({"ok": False, "error": "Invalid username or passcode."}).encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": str(e)}).encode("utf-8"))
            return

        if path_no_qs == "/api/verify-attendance":
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                post_data = self.rfile.read(content_length) if content_length else b"{}"
                body = json.loads(post_data.decode("utf-8")) if post_data else {}
                captured_image = body.get("image")
                if not captured_image:
                    raise ValueError("No image provided")
                result = verify_single_shot(captured_image)
            except Exception as e:
                result = {"matched": False, "error": str(e)}
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._set_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps(result).encode("utf-8"))
            return

        # Support DELETE verb via POST fallback already, but also native DELETE
        if path_no_qs == "/api/employees" and self.command == "DELETE":
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                post_data = self.rfile.read(content_length) if content_length else b"{}"
                body = json.loads(post_data.decode("utf-8")) if post_data else {}
                _admin, _err = requester_is_admin(body)
                if _err:
                    raise PermissionError(_err)
                # Also allow query ?file=xxx
                file_name = (body.get("file") or body.get("filename") or "").strip()
                if not file_name and "file=" in self.path:
                    import urllib.parse as up
                    qs = up.urlparse(self.path).query
                    file_name = up.parse_qs(qs).get("file", [""])[0]
                if not file_name:
                    raise ValueError("File is required.")
                delete_employee_file(file_name)
                employees = get_employee_list()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": True, "employees": employees}).encode("utf-8"))
            except PermissionError as pe:
                self.send_response(403)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": str(pe)}).encode("utf-8"))
            except ValueError as ve:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": str(ve)}).encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": str(e)}).encode("utf-8"))
            return
        else:
            self.send_error(404, "Endpoint not found")

    def end_headers(self):
        # Ensure CORS on ALL responses including static files served via SimpleHTTPRequestHandler
        try:
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
        except Exception:
            pass
        super().end_headers()

    def do_DELETE(self):
        # Delegate to do_POST logic for /api/employees
        self.do_POST()

    def do_OPTIONS(self):
        # CORS preflight if tunneled via cloudflared
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", PORT), AttendanceServerHandler)
    print(f"Attendance Backend running on http://localhost:{PORT}")
    server.serve_forever()