FROM node:20-slim

# Install C++ build tools (build-essential, python3) for better-sqlite3 native compilation, plus yt-dlp & ffmpeg
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    yt-dlp \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci

# Copy application source code
COPY . .

# Build Next.js production bundle
RUN npm run build

# Expose port 3000
EXPOSE 3000

# Start background worker and Next.js web server concurrently
CMD ["sh", "-c", "npm run worker & npm start"]
