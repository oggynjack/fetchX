<div align="center">

```
░▒▓████████▓▒░▒▓████████▓▒░▒▓████████▓▒░▒▓██████▓▒░░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░ 
░▒▓█▓▒░      ░▒▓█▓▒░         ░▒▓█▓▒░  ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░ 
░▒▓█▓▒░      ░▒▓█▓▒░         ░▒▓█▓▒░  ░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░ 
░▒▓██████▓▒░ ░▒▓██████▓▒░    ░▒▓█▓▒░  ░▒▓█▓▒░      ░▒▓████████▓▒░░▒▓██████▓▒░  
░▒▓█▓▒░      ░▒▓█▓▒░         ░▒▓█▓▒░  ░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░ 
░▒▓█▓▒░      ░▒▓█▓▒░         ░▒▓█▓▒░  ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░ 
░▒▓█▓▒░      ░▒▓████████▓▒░  ░▒▓█▓▒░   ░▒▓██████▓▒░░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░ 
```

### **Free Video & Audio Downloader**

[![License: MIT](https://img.shields.io/badge/License-MIT-FFD700.svg?style=for-the-badge)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.11+-3776AB.svg?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![Redis](https://img.shields.io/badge/Redis-7.0+-DC382D.svg?style=for-the-badge&logo=redis&logoColor=white)](https://redis.io)
[![yt-dlp](https://img.shields.io/badge/yt--dlp-latest-FF0000.svg?style=for-the-badge)](https://github.com/yt-dlp/yt-dlp)

**Download videos from YouTube, TikTok, Instagram, Twitter/X and 1000+ sites.**
**Free, fast, private. Whole playlists as ZIP, subtitles, and QR-to-phone downloads.**

[![Deploy](https://img.shields.io/badge/🚀_Deploy-Now-FFD700?style=for-the-badge)](#-quick-start)
[![Live Demo](https://img.shields.io/badge/🌐_Live_Demo-fetchx.0code.site-00FF88?style=for-the-badge)](https://fetchx.0code.site)

---

*Built with 💛 by [0Code](https://0code.store)*

</div>

---

## ✨ Features

```
┌─────────────────────────────────────────────────────────┐
│  🎬  Download from 1000+ sites                          │
│  📦  Batch downloads — whole playlists as ZIP            │
│  🎵  Audio extraction — MP3, M4A, WAV, OGG              │
│  📝  Subtitle download — SRT, VTT, ASS                   │
│  📱  QR code — scan to download on your phone            │
│  🔒  Privacy-first — no tracking, no logs                │
│  ⚡  Redis queue — concurrent processing                 │
│  🛡️  Cloudflare Turnstile — anti-bot protection          │
│  🌍  1000+ supported sites                               │
│  📱  Mobile-first responsive design                      │
└─────────────────────────────────────────────────────────┘
```

## 🎯 Supported Platforms

<div align="center">

| Platform | Status | Notes |
|----------|--------|-------|
| 🎬 YouTube | ✅ Full | Videos, playlists, shorts, subtitles |
| 📸 Instagram | ✅ Full | Posts, reels, stories, IGTV |
| 🐦 Twitter/X | ✅ Full | Videos, GIFs, spaces |
| 🎵 TikTok | ✅ Full | Videos, no watermark |
| 🎮 Twitch | ✅ Full | VODs, clips |
| 📺 Facebook | ✅ Full | Videos, reels |
| 🔵 Reddit | ✅ Full | Videos, GIFs |
| 📌 Pinterest | ✅ Full | Videos, images |
| 🎵 SoundCloud | ✅ Full | Tracks, playlists |
| 📹 Vimeo | ✅ Full | Videos |

</div>

## 🏗️ Architecture

```
                    ┌──────────────┐
                    │   Nginx/TB   │
                    │  (Reverse)   │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │   Flask App  │
                    │   (Port 8899)│
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
       ┌──────▼──────┐    │     ┌──────▼──────┐
       │   Worker 1  │    │     │   Worker 2  │
       │  (yt-dlp)   │    │     │  (yt-dlp)   │
       └──────┬──────┘    │     └──────┬──────┘
              │            │            │
              └────────────┼────────────┘
                           │
                    ┌──────▼───────┐
                    │    Redis     │
                    │  (Queue)     │
                    └──────────────┘
```

## 🚀 Quick Start

### Prerequisites

- Python 3.11+
- Redis 7.0+
- yt-dlp

### Installation

```bash
# Clone the repository
git clone https://github.com/oggynjack/fetchX.git
cd fetchX

# Install dependencies
pip install -r requirements.txt

# Install yt-dlp
pip install yt-dlp

# Create environment file
cp .env.example .env
# Edit .env with your settings

# Start Redis
redis-server --port 6381

# Start the application
python app.py

# Start workers (in separate terminals)
python worker.py
```

### Docker

```bash
docker-compose up -d
```

### PM2 (Production)

```bash
pm2 start ecosystem.config.js
pm2 save
```

## ⚙️ Configuration

Create a `.env` file:

```env
# Server
PORT=8899
HOST=0.0.0.0

# Redis
REDIS_URL=redis://localhost:6381

# Cloudflare Turnstile (optional)
TURNSTILE_SECRET=your_secret_here
```

## 📁 Project Structure

```
fetchX/
├── app.py                 # Main Flask application
├── worker.py              # Background worker process
├── jobs.py                # Job queue management
├── requirements.txt       # Python dependencies
├── ecosystem.config.js    # PM2 configuration
├── docker-compose.yml     # Docker setup
├── Dockerfile             # Container build
├── .env                   # Environment variables (git-ignored)
├── templates/
│   ├── index.html         # Main page
│   ├── privacy.html       # Privacy policy
│   └── terms.html         # Terms of service
├── static/
│   ├── css/
│   │   └── style.css      # Global styles
│   ├── js/
│   │   ├── app.js         # Frontend logic
│   │   └── globe.js       # 3D globe animation
│   └── favicon.svg        # App icon
└── downloads/             # Temporary download storage
```

## 🔌 API Reference

### Start Download

```http
POST /api/download
Content-Type: application/json

{
  "url": "https://youtube.com/watch?v=...",
  "format": "mp4",
  "title": "Video Title"
}
```

**Response:**
```json
{
  "job_id": "abc123",
  "status": "queued"
}
```

### Check Status

```http
GET /api/status/{job_id}
```

**Response:**
```json
{
  "status": "completed",
  "progress": 100,
  "download_url": "/downloads/abc123/video.mp4",
  "filename": "video.mp4"
}
```

### Get Formats

```http
POST /api/formats
Content-Type: application/json

{
  "url": "https://youtube.com/watch?v=..."
}
```

## 🎨 Design

<div align="center">

![fetchX Preview](fetchx-full.png)

</div>

- **Theme:** Dark mode with cyan accent (`#00F0FF`)
- **Fonts:** DM Sans (body), Space Grotesk (headings), JetBrains Mono (code)
- **Icons:** Phosphor Icons
- **Animations:** CSS transitions + custom 3D globe
- **Mobile:** Fully responsive, touch-optimized

## 🛡️ Security

- **Turnstile:** Cloudflare Turnstile v2 for bot protection
- **No tracking:** Privacy-first, no analytics beyond basic metrics
- **Auto-cleanup:** Downloads auto-delete after 1 hour
- **Rate limiting:** Built-in request throttling

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

---

<div align="center">

**Built with 💛 by [0Code](https://0code.store)**

*"Download anything. Own everything."*

</div>
