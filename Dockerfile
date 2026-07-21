FROM node:20-slim

# Install C++ build tools, python3, curl, ffmpeg
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    curl \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install latest official yt-dlp binary directly from GitHub releases
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

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
