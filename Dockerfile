FROM node:20-slim

# Install yt-dlp, ffmpeg, and python3 for media extraction & processing
RUN apt-get update && apt-get install -y \
    yt-dlp \
    ffmpeg \
    python3 \
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
