import { spawn } from "node:child_process";

// ─── 1. Read & validate the CLI argument ────────────────────────────

const url = process.argv[2];

if (!url) {
  console.error("Usage: node --experimental-strip-types scripts/test-ytdlp.ts <URL>");
  process.exit(1);
}

// Quick sanity check — we only accept http(s) URLs.
try {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("not http(s)");
  }
} catch {
  console.error(`Invalid URL: ${url}`);
  console.error("Please provide a full http:// or https:// URL.");
  process.exit(1);
}

// ─── 2. Spawn yt-dlp ────────────────────────────────────────────────
//
// Why `spawn` instead of `exec`?
//
//   • exec() buffers ALL of stdout/stderr into memory and gives you the
//     result in a single callback.  Fine for small outputs, but yt-dlp
//     can produce large JSON blobs, and later we'll want real-time
//     progress output (--newline flag) which arrives line-by-line.
//
//   • spawn() gives you the child's stdout and stderr as readable
//     Node.js Streams. You attach event listeners to consume data
//     incrementally. This is what we'll need for streaming download
//     progress in the future.
//
// spawn() returns a ChildProcess object. The key parts are:
//
//   child.stdout  — a Readable stream for the process's standard output
//   child.stderr  — a Readable stream for standard error
//   child          — emits events on the ChildProcess itself:
//                      "error"  → spawn itself failed (e.g. binary not found)
//                      "close"  → process exited and all stdio streams closed

const child = spawn("yt-dlp", [
  "-j",              // dump the entire info dict as a single JSON line
  "--no-playlist",   // if URL is a playlist, only process the single video
  "--no-warnings",   // suppress non-fatal warnings that clutter stderr
  url,
]);

// ─── 3. Collect stdout data ─────────────────────────────────────────
//
// child.stdout is a Readable stream. It emits "data" events as chunks
// of output arrive from the child process. Each chunk is a Buffer
// (binary bytes) — we call toString() to decode it as UTF-8.
//
// For yt-dlp -j the entire output is one big JSON line, but it may
// arrive in multiple chunks depending on OS buffering.  We accumulate
// everything into a single string and parse it after the process exits.

let stdoutData = "";

child.stdout.on("data", (chunk: Buffer) => {
  stdoutData += chunk.toString();
});

// ─── 4. Collect stderr data ─────────────────────────────────────────
//
// Same idea as stdout. yt-dlp writes errors and warnings here.
// We capture it so we can display a useful message if yt-dlp fails.

let stderrData = "";

child.stderr.on("data", (chunk: Buffer) => {
  stderrData += chunk.toString();
});

// ─── 5. Handle the "error" event on the ChildProcess ────────────────
//
// This fires when the spawn ITSELF fails — most commonly because the
// executable wasn't found on PATH (ENOENT).  This is NOT the same as
// yt-dlp running and returning a non-zero exit code; that's handled
// in the "close" event below.
//
// IMPORTANT: if "error" fires, "close" may or may not also fire
// depending on the error.  We use a flag to avoid double-handling.

let spawnFailed = false;

child.on("error", (err: NodeJS.ErrnoException) => {
  spawnFailed = true;

  if (err.code === "ENOENT") {
    console.error("yt-dlp is not installed or not on your PATH.");
    console.error("Install it: https://github.com/yt-dlp/yt-dlp#installation");
  } else {
    console.error(`Failed to spawn yt-dlp: ${err.message}`);
  }

  process.exit(1);
});

// ─── 6. Handle the "close" event ────────────────────────────────────
//
// "close" fires after the child process has exited AND all its stdio
// streams have been fully consumed (no more "data" events will fire).
// This is the safe place to process the collected output.
//
// Arguments:
//   code   — the exit code (0 = success), or null if killed by signal
//   signal — the signal name (e.g. "SIGTERM") if killed, otherwise null

child.on("close", (code: number | null, _signal: string | null) => {
  // If the spawn itself failed, we already handled it above.
  if (spawnFailed) return;

  // ── 6a. Non-zero exit → yt-dlp reported an error ──
  if (code !== 0) {
    console.error(`yt-dlp exited with code ${code}`);
    if (stderrData.trim()) {
      console.error("stderr output:");
      console.error(stderrData.trim());
    }
    process.exit(1);
  }

  // ── 6b. Parse the JSON blob ──
  let info: YtDlpInfo;
  try {
    info = JSON.parse(stdoutData);
  } catch (e) {
    console.error("Failed to parse yt-dlp JSON output.");
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }

  // ── 6c. Print the summary ──
  printSummary(info);
});

// ─── Types ──────────────────────────────────────────────────────────
//
// yt-dlp's JSON info dict is enormous. We only type the fields we use.

interface YtDlpFormat {
  format_id: string;
  ext: string;
  height?: number | null;
  resolution?: string | null;
  filesize?: number | null;
  filesize_approx?: number | null;
  vcodec?: string | null;
  acodec?: string | null;
}

interface YtDlpInfo {
  title?: string;
  duration?: number;
  formats?: YtDlpFormat[];
}

// ─── 7. Format and print ────────────────────────────────────────────

function printSummary(info: YtDlpInfo): void {
  console.log("──────────────────────────────────────────");
  console.log(`Title:    ${info.title ?? "(unknown)"}`);
  console.log(`Duration: ${formatDuration(info.duration)}`);
  console.log("──────────────────────────────────────────");

  if (!info.formats || info.formats.length === 0) {
    console.log("No formats found.");
    return;
  }

  // Filter to video-only formats.
  // yt-dlp marks audio-only formats with vcodec === "none".
  const videoFormats = info.formats.filter((f) => {
    return f.vcodec !== "none" && f.vcodec !== undefined && f.vcodec !== null;
  });

  if (videoFormats.length === 0) {
    console.log("No video formats found (all formats are audio-only).");
    return;
  }

  console.log(`\nVideo formats (${videoFormats.length} total):\n`);

  // Print a simple aligned table
  const rows = videoFormats.map((f) => ({
    id: f.format_id,
    ext: f.ext,
    resolution: f.height ? `${f.height}p` : f.resolution ?? "?",
    size: formatBytes(f.filesize ?? f.filesize_approx),
  }));

  // Column widths
  const colId   = Math.max(2,  ...rows.map((r) => r.id.length));
  const colExt  = Math.max(3,  ...rows.map((r) => r.ext.length));
  const colRes  = Math.max(3,  ...rows.map((r) => r.resolution.length));
  const colSize = Math.max(4,  ...rows.map((r) => r.size.length));

  const header =
    "ID".padEnd(colId) +
    "  Ext".padEnd(colExt + 2) +
    "  Res".padEnd(colRes + 2) +
    "  Size".padEnd(colSize + 2);

  console.log(header);
  console.log("─".repeat(header.length));

  for (const r of rows) {
    console.log(
      r.id.padEnd(colId) +
        "  " + r.ext.padEnd(colExt) +
        "  " + r.resolution.padEnd(colRes) +
        "  " + r.size.padEnd(colSize),
    );
  }
}

function formatDuration(seconds?: number): string {
  if (seconds === undefined || seconds === null) return "(unknown)";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatBytes(bytes?: number | null): string {
  if (bytes === undefined || bytes === null) return "N/A";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
