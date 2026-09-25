"""fetchX — yt-dlp work: info lookup, video/audio/subtitle downloads, playlist ZIPs."""

import os
import json
import subprocess
import yt_dlp
import glob
import time
import zipfile
import shutil


def fetch_info(url):
    """Fetch video info using yt-dlp Python API."""
    ydl_opts = {
        'quiet': True,
        'no_warnings': True,
        'extract_flat': False,
    }
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            
            if not info:
                return {"error": "No info extracted"}
            
            # Build quality options
            best_by_height = {}
            for f in info.get("formats", []):
                height = f.get("height")
                if height and f.get("vcodec", "none") != "none":
                    tbr = f.get("tbr") or 0
                    if height not in best_by_height or tbr > (best_by_height[height].get("tbr") or 0):
                        best_by_height[height] = f
            
            formats = []
            for height, f in sorted(best_by_height.items()):
                formats.append({
                    "id": f.get("format_id", ""),
                    "label": f"{height}p",
                    "ext": f.get("ext", "mp4"),
                    "filesize": f.get("filesize"),
                })
            
            # Available subtitle/caption languages (manual subs first, then auto-captions)
            manual_subs = list((info.get("subtitles") or {}).keys())
            auto_subs = list((info.get("automatic_captions") or {}).keys())
            sub_langs, seen_langs = [], set()
            for code in manual_subs + auto_subs:
                if code and code not in seen_langs:
                    seen_langs.add(code)
                    sub_langs.append(code)

            return {
                "title": info.get("title", ""),
                "thumbnail": info.get("thumbnail", ""),
                "duration": info.get("duration"),
                "uploader": info.get("uploader", ""),
                "formats": formats,
                "subtitles": sub_langs[:40],
            }
    except Exception as e:
        return {"error": str(e)}


def fetch_playlist(url):
    """Fetch playlist entries (flat, no per-video info) using yt-dlp Python API."""
    ydl_opts = {
        'quiet': True,
        'no_warnings': True,
        'extract_flat': True,
    }
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            entries = info.get("entries", []) if info else []
            urls, meta = [], []
            for e in entries:
                if not e:
                    continue
                u = e.get("url")
                if not u:
                    continue
                urls.append(u)
                meta.append({
                    "url": u,
                    "title": e.get("title") or "",
                    "duration": e.get("duration"),
                })
            return {
                "urls": urls,
                "entries": meta,
                "title": (info or {}).get("title") or "",
            }
    except Exception as e:
        return {"error": str(e)}


def _progress_hook(job_file, d):
    """yt-dlp progress hook — writes progress to job file."""
    if d.get("status") == "downloading":
        total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
        downloaded = d.get("downloaded_bytes") or 0
        speed = d.get("speed") or 0
        eta = d.get("eta") or 0
        percent = round((downloaded / total) * 100, 1) if total else 0
        
        with open(job_file, "w") as f:
            json.dump({
                "status": "downloading",
                "progress": percent,
                "speed": speed,
                "eta": eta,
                "downloaded": downloaded,
                "total": total,
            }, f)
    
    elif d.get("status") == "finished":
        with open(job_file, "w") as f:
            json.dump({"status": "merging", "progress": 99}, f)


def _transcode_to_h264(filepath, download_dir, safe_title):
    """Force-convert any video to H.264 + AAC MP4 using ffmpeg."""
    if not os.path.exists(filepath):
        return filepath
    
    # Check if already H.264
    probe = subprocess.run(
        ['ffprobe', '-v', 'quiet', '-select_streams', 'v:0',
         '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', filepath],
        capture_output=True, text=True, timeout=30
    )
    codec = (probe.stdout or '').strip()
    
    # Check if has audio stream
    audio_probe = subprocess.run(
        ['ffprobe', '-v', 'quiet', '-select_streams', 'a:0',
         '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', filepath],
        capture_output=True, text=True, timeout=30
    )
    has_audio = bool((audio_probe.stdout or '').strip())
    
    # Transcode if codec is not H.264 or has no audio
    needs_transcode = codec not in ('h264', 'avc1') or not has_audio
    
    if needs_transcode:
        mp4_path = os.path.join(download_dir, f"{safe_title}_final.mp4")
        cmd = [
            'ffmpeg', '-y', '-i', filepath,
            '-c:v', 'libx264', '-crf', '23', '-preset', 'fast',
            '-movflags', '+faststart',
        ]
        if has_audio:
            cmd += ['-c:a', 'aac', '-b:a', '128k']
        else:
            # No audio — just copy whatever's there or skip
            cmd += ['-an']
        
        cmd.append(mp4_path)
        subprocess.run(cmd, capture_output=True, timeout=300)
        
        if os.path.exists(mp4_path):
            os.remove(filepath)
            return mp4_path
    
    return filepath


def download_video(job_id, url, format_choice, format_id, title, download_dir, lang=""):
    """Download video and write status to job file."""
    job_file = os.path.join(download_dir, f"{job_id}.json")
    
    # Update status to downloading
    with open(job_file, "w") as f:
        json.dump({"status": "downloading", "progress": 0, "rq_job_id": job_id}, f)
    
    # Build output template
    safe_title = "".join(c for c in title if c.isalnum() or c in " -_").strip()[:80] or "download"
    output_path = os.path.join(download_dir, f"{safe_title}.%(ext)s")
    
    # Progress hook
    hook = lambda d: _progress_hook(job_file, d)
    
    if format_choice == "subs":
        ydl_opts = {
            'quiet': True,
            'no_warnings': True,
            'skip_download': True,
            'writesubtitles': True,
            'writeautomaticsub': True,
            'subtitleslangs': [lang] if lang else ['en'],
            'subtitlesformat': 'vtt/srt/best',
            'outtmpl': output_path,
            'progress_hooks': [hook],
        }
    elif format_choice == "audio":
        ydl_opts = {
            'quiet': True,
            'no_warnings': True,
            'format': 'bestaudio/best',
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }],
            'outtmpl': output_path,
            'progress_hooks': [hook],
        }
    else:
        # Always download bestvideo + bestaudio — this guarantees both streams
        # The format_id is a hint but we always merge video+audio
        ydl_opts = {
            'quiet': True,
            'no_warnings': True,
            'format': 'bestvideo+bestaudio/best',
            'merge_output_format': 'mp4',
            'outtmpl': output_path,
            'progress_hooks': [hook],
        }
    
    started = time.time()
    try:
        if format_choice == "subs":
            # Subtitle fetch is quick and fires no byte-progress hooks
            with open(job_file, "w") as f:
                json.dump({"status": "downloading", "progress": 50}, f)

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
        
        # Find the downloaded file — match by extension kind so a leftover
        # subtitle/media file from an earlier run with the same title never wins
        media_exts = (".mp4", ".webm", ".mkv", ".mov", ".m4v",
                      ".mp3", ".m4a", ".aac", ".opus", ".ogg", ".wav", ".flac")
        sub_exts = (".vtt", ".srt", ".ass", ".lrc", ".ttml", ".dfxp")
        wanted_exts = sub_exts if format_choice == "subs" else media_exts
        pattern = os.path.join(download_dir, f"{safe_title}.*")
        # Only files written by this run — never reuse a same-titled file from an
        # earlier job still sitting in the 1-hour cleanup window
        files = [f for f in glob.glob(pattern)
                 if f.lower().endswith(wanted_exts) and os.path.getmtime(f) >= started - 2]

        # For subtitles, prefer the track that was actually requested
        if format_choice == "subs" and lang:
            lang_files = [f for f in files if f".{lang}." in os.path.basename(f)]
            if lang_files:
                files = lang_files
        
        if files:
            filepath = files[0]
            
            # For video: force H.264 + audio for iOS compatibility
            if format_choice not in ("audio", "subs"):
                filepath = _transcode_to_h264(filepath, download_dir, safe_title)
            
            filename = os.path.basename(filepath)
            with open(job_file, "w") as f:
                json.dump({
                    "status": "done",
                    "file": filepath,
                    "filename": filename,
                    "progress": 100,
                }, f)
        else:
            err = ("No subtitles available in that language"
                   if format_choice == "subs"
                   else "Download completed but file not found")
            with open(job_file, "w") as f:
                json.dump({"status": "error", "error": err}, f)
    except Exception as e:
        with open(job_file, "w") as f:
            json.dump({"status": "error", "error": str(e)}, f)


def download_batch(job_id, urls, format_choice, download_dir, title=""):
    """Download every URL sequentially and bundle the files into one ZIP."""
    job_file = os.path.join(download_dir, f"{job_id}.json")
    batch_dir = os.path.join(download_dir, f"batch_{job_id}")
    os.makedirs(batch_dir, exist_ok=True)
    total = len(urls) or 1

    def write_job(payload):
        with open(job_file, "w") as f:
            json.dump(payload, f)

    state = {"index": 0}

    def hook(d):
        if d.get("status") != "downloading":
            return
        got = d.get("downloaded_bytes") or 0
        want = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
        frac = (got / want) if want else 0
        pct = round(min((state["index"] + frac) / total * 100, 99), 1)
        write_job({"status": "downloading", "progress": pct,
                   "file": state["index"] + 1, "files": total})

    outtmpl = os.path.join(batch_dir, '%(title)s [%(id)s].%(ext)s')
    if format_choice == "audio":
        base_opts = {
            'quiet': True,
            'no_warnings': True,
            'format': 'bestaudio/best',
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }],
            'outtmpl': outtmpl,
        }
    else:
        # Prefer MP4/H.264+AAC so playlist files play on iOS without
        # per-video transcoding (that would blow the job timeout)
        base_opts = {
            'quiet': True,
            'no_warnings': True,
            'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
            'merge_output_format': 'mp4',
            'outtmpl': outtmpl,
        }

    write_job({"status": "downloading", "progress": 0, "file": 1, "files": total})
    try:
        for i, u in enumerate(urls):
            state["index"] = i
            write_job({"status": "downloading",
                       "progress": round(i / total * 100, 1),
                       "file": i + 1, "files": total})
            try:
                opts = dict(base_opts, progress_hooks=[hook])
                with yt_dlp.YoutubeDL(opts) as ydl:
                    ydl.download([u])
            except Exception:
                continue  # dead/private entry — keep the rest of the batch alive

        skip_exts = (".part", ".ytdl", ".json")
        files = sorted(
            os.path.join(batch_dir, f)
            for f in os.listdir(batch_dir)
            if os.path.isfile(os.path.join(batch_dir, f))
            and not f.startswith(".") and not f.endswith(skip_exts)
        )
        if not files:
            write_job({"status": "error",
                       "error": "All downloads failed — try again later"})
            return

        write_job({"status": "merging", "progress": 99})
        safe_title = "".join(c for c in (title or "playlist")
                             if c.isalnum() or c in " -_").strip()[:60] or "playlist"
        zip_name = f"{safe_title} ({len(files)} file{'s' if len(files) != 1 else ''}).zip"
        zip_path = os.path.join(download_dir, zip_name)
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_STORED) as zf:
            for fp in files:
                zf.write(fp, arcname=os.path.basename(fp))

        write_job({"status": "done", "file": zip_path,
                   "filename": zip_name, "progress": 100})
    except Exception as e:
        write_job({"status": "error", "error": str(e)})
    finally:
        shutil.rmtree(batch_dir, ignore_errors=True)
