/**
 * worker/worker.ts
 *
 * Background worker that polls the job queue and processes jobs.
 *
 * Run with:
 *   npm run worker          (uses tsx watch for auto-reload)
 *   npx tsx worker/worker.ts (one-shot)
 *
 * The worker runs two independent claim loops on a single interval:
 *
 *   1. Metadata jobs:  queued_metadata  → fetching_metadata → metadata_ready
 *   2. Download jobs:  queued_download  → downloading        → done
 *
 * Each iteration tries to claim ONE job of each type.  If a claim
 * succeeds, the job is processed before the next interval fires.
 * This keeps the worker simple and single-threaded — no risk of
 * overwhelming the system with concurrent yt-dlp processes.
 */

import path from "node:path";
import {
  claimNextJob,
  updateJob,
  type JobRow,
} from "../lib/db";
import {
  checkYtDlpAvailable,
  fetchMetadata,
  downloadFormat,
} from "../lib/ytdlp";

// ─── Constants ──────────────────────────────────────────────────────

/** How often we poll the queue (milliseconds). */
const POLL_INTERVAL_MS = 1_500;

/** Where downloads are saved, relative to the project root. */
const DOWNLOADS_DIR = path.resolve(import.meta.dirname, "..", "data", "downloads");

// ─── Startup check ──────────────────────────────────────────────────

async function ensureYtDlp(): Promise<void> {
  const ok = await checkYtDlpAvailable();
  if (!ok) {
    console.error("╔══════════════════════════════════════════════════╗");
    console.error("║  yt-dlp is not installed or not on your PATH.   ║");
    console.error("║                                                  ║");
    console.error("║  Install it:                                     ║");
    console.error("║    winget install yt-dlp                         ║");
    console.error("║    (then restart your terminal)                  ║");
    console.error("║                                                  ║");
    console.error("║  More info:                                      ║");
    console.error("║    https://github.com/yt-dlp/yt-dlp#installation║");
    console.error("╚══════════════════════════════════════════════════╝");
    process.exit(1);
  }
}

// ─── Metadata processing ────────────────────────────────────────────

async function processMetadataJob(job: JobRow): Promise<void> {
  console.log(`[metadata] Processing job ${job.id} — ${job.url}`);

  try {
    const meta = await fetchMetadata(job.url);

    updateJob(job.id, {
      status: "metadata_ready",
      title: meta.title,
      thumbnail: meta.thumbnail,
      duration: meta.duration,
      formats: JSON.stringify(meta.formats),
    });

    console.log(
      `[metadata] ✓ ${job.id} — "${meta.title}" (${meta.formats.length} formats)`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[metadata] ✗ ${job.id} — ${message}`);

    updateJob(job.id, {
      status: "error",
      error_message: message,
    });
  }
}

// ─── Download processing ────────────────────────────────────────────

async function processDownloadJob(job: JobRow): Promise<void> {
  console.log(
    `[download] Processing job ${job.id} — format ${job.selected_format}`,
  );

  if (!job.selected_format) {
    updateJob(job.id, {
      status: "error",
      error_message: "No format selected",
    });
    return;
  }

  // Build an output template that places files in data/downloads/
  // using the video title and extension.
  // %(title)s and %(ext)s are yt-dlp template variables.
  const outputTemplate = path.join(
    DOWNLOADS_DIR,
    "%(title)s.%(ext)s",
  );

  try {
    const filePath = await downloadFormat(
      job.url,
      job.selected_format,
      outputTemplate,
      (percent) => {
        // Update progress in the DB.  This fires frequently (~every
        // few hundred ms) so the API can relay it to the frontend.
        updateJob(job.id, { progress: percent });
      },
    );

    // Extract just the filename from the full path
    const fileName = path.basename(filePath);

    updateJob(job.id, {
      status: "done",
      progress: 100,
      file_path: filePath,
      file_name: fileName,
    });

    console.log(`[download] ✓ ${job.id} — saved to ${fileName}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[download] ✗ ${job.id} — ${message}`);

    updateJob(job.id, {
      status: "error",
      error_message: message,
    });
  }
}

// ─── Main loop ──────────────────────────────────────────────────────

async function tick(): Promise<void> {
  // ── 1. Try to claim a metadata job ──
  const metaJob = claimNextJob("queued_metadata", "fetching_metadata");
  if (metaJob) {
    await processMetadataJob(metaJob);
  }

  // ── 2. Try to claim a download job ──
  const dlJob = claimNextJob("queued_download", "downloading");
  if (dlJob) {
    await processDownloadJob(dlJob);
  }
}

async function main(): Promise<void> {
  console.log("Fetchbox Worker starting…");

  await ensureYtDlp();
  console.log("yt-dlp ✓");
  console.log(`Polling every ${POLL_INTERVAL_MS}ms\n`);

  // Run the first tick immediately, then set up the interval.
  await tick();

  setInterval(async () => {
    try {
      await tick();
    } catch (err) {
      // Guard against unexpected crashes in the loop.
      // Individual job errors are already caught inside
      // processMetadataJob / processDownloadJob — this
      // catches truly unexpected things like DB corruption.
      console.error("[worker] Unexpected error in tick:", err);
    }
  }, POLL_INTERVAL_MS);
}

main();
