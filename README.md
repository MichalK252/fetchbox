# Fetchbox

Fetchbox is a fast, minimal, and clean media downloader built with Next.js 16 (App Router), TypeScript, SQLite, `yt-dlp`, and `ffmpeg`.

It allows users to paste video links from YouTube, Erome, and 1,000+ supported platforms, select resolution and format options (MP4, WEBM, H.264, AV1, VP9), track real-time download progress, and stream finished video files directly.

---

## Features

- **Multi-Platform Support**: Download videos from YouTube, Erome, Reddit, Twitter, and any site supported by `yt-dlp`.
- **Categorized Format Selection**: High Definition (HD) and Standard Definition (SD) options grouped into MP4 and WEBM streams with codec tags (H.264, AV1, VP9).
- **Automatic Audio & Video Merging**: Uses `ffmpeg` to combine high-definition video and audio streams into standard `.mp4` containers.
- **Real-Time Progress Tracking**: Background polling reports download percentage directly on the UI.
- **SQLite Job Queue**: Powered by `better-sqlite3` with atomic transactions (`BEGIN IMMEDIATE`) to prevent concurrent process race conditions.
- **Automatic Cleanup**: A background worker routine deletes downloaded files and job rows older than 1 hour every 5 minutes.
- **Robust Download Streaming**: RFC 5987 / 6266 headers ensure special characters and unicode titles download cleanly across all browsers.

---

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS v4
- **Database**: SQLite via `better-sqlite3`
- **Media Processing**: `yt-dlp` & `ffmpeg-static`
- **Runner**: `tsx`

---

## Getting Started

### Prerequisites

1. **Node.js**: v20 or higher
2. **yt-dlp**: Must be installed and on your system `PATH`
   - **Windows**: `winget install yt-dlp`
   - **Mac**: `brew install yt-dlp`
   - **Linux**: `sudo apt install yt-dlp`

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/MichalK252/fetchbox.git
   cd fetchbox
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

### Running Locally

Start the application by running the Next.js web server and the background worker in two separate terminal windows:

**Terminal 1 (Web Application):**
```bash
npm run dev
```
Open http://localhost:3000 in your browser.

**Terminal 2 (Background Worker):**
```bash
npm run worker
```

---

## Deployment

### Dockerfile

```dockerfile
FROM node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    yt-dlp \
    ffmpeg \
    python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["sh", "-c", "npm run worker & npm start"]
```

---

## License

MIT License. Developed by Michas223.
