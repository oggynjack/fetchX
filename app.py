"""fetchX — Flask web app: serves the UI and queues download jobs.

Workers (worker.py) pick jobs up from Redis and write progress into JSON
status files under downloads/, which this app serves back to the browser.
"""

import os
import json
import uuid
import glob
import shutil
import time
import threading
import redis
import requests as http_requests
from flask import Flask, request, jsonify, send_file, render_template
from rq import Queue

from jobs import fetch_info, fetch_playlist, download_video, download_batch

app = Flask(__name__)

# Configuration
DOWNLOAD_DIR = os.path.join(os.path.dirname(__file__), "downloads")
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

# Auto-cleanup: delete files older than 1 hour
CLEANUP_MAX_AGE = 3600  # seconds


def _cleanup_once():
    """Remove downloads older than CLEANUP_MAX_AGE — files and leftover job dirs."""
    now = time.time()
    for path in glob.glob(os.path.join(DOWNLOAD_DIR, "*")):
        try:
            if now - os.path.getmtime(path) <= CLEANUP_MAX_AGE:
                continue
            if os.path.isfile(path):
                os.remove(path)
            elif os.path.isdir(path):
                # Playlist temp dir left behind by a worker killed mid-job
                shutil.rmtree(path, ignore_errors=True)
        except Exception:
            pass


def _cleanup_old_files():
    """Background thread — runs _cleanup_once() every 5 minutes."""
    while True:
        _cleanup_once()
        time.sleep(300)

cleanup_thread = threading.Thread(target=_cleanup_old_files, daemon=True)
cleanup_thread.start()

# Redis connection
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6381")
redis_conn = redis.from_url(REDIS_URL)
q = Queue(connection=redis_conn)

# Cloudflare Turnstile
TURNSTILE_SECRET = os.environ.get("TURNSTILE_SECRET", "")
TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


def verify_turnstile(token, ip):
    """Verify Cloudflare Turnstile token. Returns True if valid or not configured."""
    if not TURNSTILE_SECRET:
        return True  # Skip verification if secret not set

    if not token:
        return False

    try:
        resp = http_requests.post(TURNSTILE_VERIFY_URL, data={
            "secret": TURNSTILE_SECRET,
            "response": token,
            "remoteip": ip,
        }, timeout=10)
        result = resp.json()
        return result.get("success", False)
    except Exception:
        return False


def require_turnstile(f):
    """Decorator: verify Turnstile token from request body before handling."""
    from functools import wraps

    @wraps(f)
    def decorated(*args, **kwargs):
        data = request.get_json(silent=True) or {}
        token = data.get("token", "")
        ip = request.remote_addr

        if not verify_turnstile(token, ip):
            return jsonify({"error": "Verification failed. Please complete the captcha."}), 403

        return f(*args, **kwargs)
    return decorated


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/privacy")
def privacy():
    return render_template("privacy.html")


@app.route("/terms")
def terms():
    return render_template("terms.html")


@app.route("/api/info", methods=["POST"])
@require_turnstile
def get_info():
    data = request.json
    url = data.get("url", "").strip()
    if not url:
        return jsonify({"error": "No URL provided"}), 400

    result = fetch_info(url)
    if "error" in result:
        return jsonify(result), 400
    return jsonify(result)


@app.route("/api/playlist", methods=["POST"])
@require_turnstile
def get_playlist_info():
    data = request.json
    url = data.get("url", "").strip()
    if not url:
        return jsonify({"error": "No URL provided"}), 400

    result = fetch_playlist(url)
    if "error" in result:
        return jsonify(result), 400
    return jsonify(result)


@app.route("/api/download", methods=["POST"])
@require_turnstile
def start_download():
    data = request.json
    url = data.get("url", "").strip()
    format_choice = data.get("format", "video")
    format_id = data.get("format_id")
    title = data.get("title", "")
    lang = data.get("lang", "")

    if not url:
        return jsonify({"error": "No URL provided"}), 400

    job_id = uuid.uuid4().hex[:10]

    # Enqueue job to Redis
    job = q.enqueue(
        download_video,
        job_id, url, format_choice, format_id, title, DOWNLOAD_DIR, lang,
        job_timeout="10m",
        result_ttl=3600,
    )

    # Initialize job file
    job_file = os.path.join(DOWNLOAD_DIR, f"{job_id}.json")
    with open(job_file, "w") as f:
        json.dump({"status": "queued", "rq_job_id": job.id}, f)

    return jsonify({"job_id": job_id})


@app.route("/api/batch", methods=["POST"])
@require_turnstile
def start_batch():
    data = request.json
    urls = data.get("urls") or []
    format_choice = data.get("format", "video")
    title = data.get("title", "")

    if isinstance(urls, str):
        urls = [urls]
    urls = [u.strip() for u in urls if isinstance(u, str) and u.strip()][:40]
    if not urls:
        return jsonify({"error": "No URLs provided"}), 400

    job_id = uuid.uuid4().hex[:10]

    job = q.enqueue(
        download_batch,
        job_id, urls, format_choice, DOWNLOAD_DIR, title,
        job_timeout="30m",
        result_ttl=3600,
    )

    job_file = os.path.join(DOWNLOAD_DIR, f"{job_id}.json")
    with open(job_file, "w") as f:
        json.dump({"status": "queued", "rq_job_id": job.id}, f)

    return jsonify({"job_id": job_id})


@app.route("/api/status/<job_id>")
def check_status(job_id):
    job_file = os.path.join(DOWNLOAD_DIR, f"{job_id}.json")
    if not os.path.exists(job_file):
        return jsonify({"error": "Job not found"}), 404

    with open(job_file, "r") as f:
        data = json.load(f)

    return jsonify({
        "status": data.get("status", "unknown"),
        "error": data.get("error"),
        "filename": data.get("filename"),
        "progress": data.get("progress", 0),
        "speed": data.get("speed"),
        "eta": data.get("eta"),
        "file": data.get("file"),
        "files": data.get("files"),
    })


@app.route("/api/file/<job_id>")
def download_file(job_id):
    job_file = os.path.join(DOWNLOAD_DIR, f"{job_id}.json")
    if not os.path.exists(job_file):
        return jsonify({"error": "File not ready"}), 404

    with open(job_file, "r") as f:
        data = json.load(f)

    if data.get("status") != "done" or not data.get("file"):
        return jsonify({"error": "File not ready"}), 404

    return send_file(data["file"], as_attachment=True, download_name=data.get("filename", "download"))


@app.route("/api/queue/stats")
def queue_stats():
    return jsonify({
        "queued": len(q),
        "started": len(q.started_job_registry),
        "finished": len(q.finished_job_registry),
        "failed": len(q.failed_job_registry),
    })


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8899))
    host = os.environ.get("HOST", "0.0.0.0")
    app.run(host=host, port=port, debug=False)
