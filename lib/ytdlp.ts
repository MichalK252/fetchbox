/**
 * lib/ytdlp.ts
 *
 * Framework-agnostic wrapper around the yt-dlp CLI.
 * Uses child_process.spawn for all interactions so we get streaming
 * access to stdout/stderr (needed for real-time progress reporting).
 *
 * Exports:
 *   checkYtDlpAvailable()  — probe whether yt-dlp is on PATH
 *   fetchMetadata(url)     — get title, thumbnail, duration, and formats
 *   downloadFormat(…)      — download a specific format with progress
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";

// ─── Public types ───────────────────────────────────────────────────

/** A single video format extracted from yt-dlp metadata. */
export interface VideoFormat {
  format_id: string;
  ext: string;
  resolution: string;
  height: number | null;
  filesize: number | null;
  /** Original vcodec string, e.g. "avc1.64001F" or "vp9". */
  vcodec: string | null;
}

/** Human-readable codec name, e.g. "H.264", "AV1", "VP9". */
export function formatCodecName(vcodec: string | null): string {
  if (!vcodec) return "";
  if (vcodec.startsWith("avc1")) return "H.264";
  if (vcodec.startsWith("av01")) return "AV1";
  if (vcodec.startsWith("vp9") || vcodec.startsWith("vp09")) return "VP9";
  if (vcodec.startsWith("vp8") || vcodec.startsWith("vp08")) return "VP8";
  return vcodec.split(".")[0];
}

/** The metadata object returned by fetchMetadata(). */
export interface VideoMetadata {
  title: string;
  thumbnail: string | null;
  /** Duration in seconds. */
  duration: number | null;
  /** Only formats that contain a video stream (audio-only excluded). */
  formats: VideoFormat[];
}

// ─── Raw yt-dlp JSON types (internal) ───────────────────────────────

interface RawFormat {
  format_id: string;
  ext: string;
  height?: number | null;
  resolution?: string | null;
  filesize?: number | null;
  filesize_approx?: number | null;
  vcodec?: string | null;
  acodec?: string | null;
}

interface RawInfo {
  title?: string;
  thumbnail?: string | null;
  duration?: number | null;
  formats?: RawFormat[];
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Wrap spawn() in a Promise that collects stdout/stderr and resolves
 * when the process exits.  Rejects on spawn errors (ENOENT) and
 * non-zero exit codes.
 *
 * `onStdoutLine` is an optional callback invoked for every complete
 * line written to stdout.  This is how downloadFormat() receives
 * real-time progress updates.
 */
function runYtDlp(
  args: string[],
  onStdoutLine?: (line: string) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("yt-dlp", args, {
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
      },
    });

    let stdout = "";
    let stderr = "";

    // ── stdout ──
    // When onStdoutLine is provided we split the stream into lines
    // as they arrive so the caller can react to each one (e.g. parse
    // progress percentages).  We also accumulate the full output so
    // the resolved value always contains everything.
    let lineBuffer = "";

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;

      if (onStdoutLine) {
        // Chunks can contain partial lines.  Buffer until we see '\n'.
        lineBuffer += text;
        const lines = lineBuffer.split("\n");
        // The last element is either "" (if text ended with \n) or an
        // incomplete line — keep it in the buffer for next time.
        lineBuffer = lines.pop()!;
        for (const line of lines) {
          if (line.length > 0) onStdoutLine(line);
        }
      }
    });

    // ── stderr ──
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    // ── spawn error (binary not found, permission denied, etc.) ──
    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        reject(new YtDlpNotFoundError());
      } else {
        reject(new Error(`Failed to spawn yt-dlp: ${err.message}`));
      }
    });

    // ── process exited ──
    child.on("close", (code) => {
      // Flush any remaining partial line
      if (onStdoutLine && lineBuffer.length > 0) {
        onStdoutLine(lineBuffer);
      }

      if (code !== 0) {
        const message = stderr.trim() || `yt-dlp exited with code ${code}`;
        reject(new YtDlpError(message, code ?? 1));
        return;
      }

      resolve(stdout);
    });
  });
}

// ─── Custom error classes ───────────────────────────────────────────

export class YtDlpNotFoundError extends Error {
  constructor() {
    super(
      "yt-dlp is not installed or not on your PATH. " +
        "Install it: https://github.com/yt-dlp/yt-dlp#installation",
    );
    this.name = "YtDlpNotFoundError";
  }
}

export class YtDlpError extends Error {
  public exitCode: number;
  constructor(message: string, exitCode: number) {
    super(message);
    this.name = "YtDlpError";
    this.exitCode = exitCode;
  }
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Quick check: is yt-dlp installed and runnable?
 *
 * Spawns `yt-dlp --version` — if it exits 0 we're good.
 * Resolves `true`/`false`; never throws.
 */
export async function checkYtDlpAvailable(): Promise<boolean> {
  try {
    await runYtDlp(["--version"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch video metadata without downloading.
 *
 * Spawns `yt-dlp -j --no-playlist --no-warnings <url>`, parses the
 * single-line JSON output, and returns a cleaned-up VideoMetadata
 * object with only video-capable formats.
 *
 * @throws {YtDlpNotFoundError} if yt-dlp binary is missing
 * @throws {YtDlpError}         on any yt-dlp failure (bad URL, etc.)
 */
export async function fetchMetadata(url: string): Promise<VideoMetadata> {
  const raw = await runYtDlp([
    "-j",            // single-line JSON dump
    "--no-playlist", // don't expand playlists
    "--no-warnings", // suppress non-fatal warnings
    url,
  ]);

  let info: RawInfo;
  try {
    info = JSON.parse(raw);
  } catch {
    throw new Error("Failed to parse JSON metadata from yt-dlp output");
  }

  // Filter to formats that actually carry a video stream.
  // yt-dlp sets vcodec to "none" for audio-only streams.
  const videoFormats: VideoFormat[] = (info.formats ?? [])
    .filter(
      (f) => f.vcodec !== "none" && f.vcodec !== undefined && f.vcodec !== null,
    )
    .map((f) => ({
      format_id: f.format_id,
      ext: f.ext,
      resolution: f.height ? `${f.height}p` : (f.resolution ?? "unknown"),
      height: f.height ?? null,
      filesize: f.filesize ?? f.filesize_approx ?? null,
      vcodec: f.vcodec ?? null,
    }));

  return {
    title: info.title ?? "(unknown)",
    thumbnail: info.thumbnail ?? null,
    duration: info.duration ?? null,
    formats: videoFormats,
  };
}

/**
 * Download a specific format and report real-time progress.
 *
 * Spawns:
 *   yt-dlp -f <formatId> -o <outputTemplate> --newline --no-playlist <url>
 *
 * The `--newline` flag forces yt-dlp to print each progress update on
 * its own line (instead of overwriting with \r).  This lets us parse
 * lines like:
 *
 *   [download]  42.3% of ~150.00MiB at  5.23MiB/s ETA 00:18
 *
 * and extract the percentage.
 *
 * @param url            The video URL
 * @param formatId       The format_id to download (from fetchMetadata)
 * @param outputTemplate yt-dlp output template, e.g. "downloads/%(title)s.%(ext)s"
 * @param onProgress     Called with a number 0–100 as the download progresses
 * @returns              The absolute path of the downloaded file
 *
 * @throws {YtDlpNotFoundError} if yt-dlp binary is missing
 * @throws {YtDlpError}         on any yt-dlp failure
 */
export async function downloadFormat(
  url: string,
  formatId: string,
  outputTemplate: string,
  onProgress: (percent: number) => void,
): Promise<string> {
  // ── Progress-line regex ──
  // Matches lines like:
  //   [download]  42.3% of ~150.00MiB ...
  //   [download] 100% of 150.00MiB ...
  // Captures the percentage number.
  const progressRe = /\[download\]\s+([\d.]+)%/;

  // Track the last file destination line:
  //   [download] Destination: /path/to/file.mp4
  //   [download] /path/to/file.mp4 has already been downloaded
  const destinationRe = /\[download\] Destination:\s+(.+)/;
  const alreadyRe = /\[download\]\s+(.+) has already been downloaded/;

  // We'll also use --print after_move:filepath to reliably get the
  // final path after any post-processing moves/merges.
  let candidatePath = "";

  const formatSpec = formatId.includes("+")
    ? formatId
    : `${formatId}+bestaudio/best`;

  const args = [
    "-f",
    formatSpec,
    "-o",
    outputTemplate,
    "--merge-output-format", "mp4",
    "--remux-video", "mp4",
    "--newline",       // one progress line per update
    "--no-playlist",
    "--progress",      // force progress reporting alongside --print
    "--print", "after_move:filepath",  // print final path after post-processing
  ];

  if (ffmpegPath) {
    args.push("--ffmpeg-location", ffmpegPath);
  }

  args.push(url);

  const output = await runYtDlp(
    args,
    (line) => {
      // ── Parse progress updates ──
      const progressMatch = line.match(progressRe);
      if (progressMatch) {
        const pct = parseFloat(progressMatch[1]);
        if (!Number.isNaN(pct)) {
          onProgress(pct);
        }
        return;
      }

      // ── Capture potential file path ──
      const trimmed = line.trim();
      const destMatch = trimmed.match(destinationRe);
      const alreadyMatch = trimmed.match(alreadyRe);

      if (destMatch) {
        candidatePath = destMatch[1].trim();
      } else if (alreadyMatch) {
        candidatePath = alreadyMatch[1].trim();
      } else if (trimmed.length > 0 && !trimmed.startsWith("[")) {
        candidatePath = trimmed;
      }
    },
  );

  // ── Find the actual file path that exists on disk ──
  let finalPath = "";

  if (candidatePath && fs.existsSync(candidatePath)) {
    finalPath = candidatePath;
  } else {
    // Scan all non-empty stdout lines in reverse to find the one that exists on disk
    const lines = output.trim().split("\n").map((l) => l.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      if (fs.existsSync(lines[i])) {
        finalPath = lines[i];
        break;
      }
    }
  }

  // Fallback if file check fails
  if (!finalPath) {
    const lines = output.trim().split("\n").map((l) => l.trim()).filter(Boolean);
    finalPath = candidatePath || lines[lines.length - 1] || "";
  }

  return finalPath;
}
