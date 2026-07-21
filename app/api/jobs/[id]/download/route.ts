/**
 * GET /api/jobs/[id]/download
 *
 * Streams the finished file back to the client as an attachment.
 * Only works when the job status is "done" and file_path exists on disk.
 */

import { getJob } from "@/lib/db";
import { stat } from "node:fs/promises";
import { createReadStream, readdirSync, statSync } from "node:fs";
import path from "node:path";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const job = getJob(id);

  if (!job) {
    return Response.json({ error: "Job not found" }, { status: 404 });
  }

  if (job.status !== "done") {
    return Response.json(
      { error: "File is not ready for download" },
      { status: 409 },
    );
  }

  // Robust target path resolution:
  // 1. Primary: job.file_path stored in DB
  // 2. Fallback: process.cwd() + data/downloads/ + job.file_name
  // 3. Last resort: scan data/downloads/ for a matching file
  const downloadsDir = path.join(process.cwd(), "data", "downloads");
  let targetPath: string | null = job.file_path;
  let fileStats;

  // --- Attempt 1: exact file_path from DB ---
  if (targetPath) {
    try {
      fileStats = await stat(targetPath);
    } catch {
      targetPath = null;
    }
  }

  // --- Attempt 2: reconstruct from file_name ---
  if (!targetPath && job.file_name) {
    const altPath = path.join(downloadsDir, job.file_name);
    try {
      fileStats = await stat(altPath);
      targetPath = altPath;
    } catch {
      targetPath = null;
    }
  }

  // --- Attempt 3: scan the downloads directory ---
  // yt-dlp may sanitize characters differently on Windows
  // (e.g. | → ｜, stripping special chars), so the stored
  // file_name may not match the actual file on disk.
  // Look for the most recently modified file whose name
  // shares the same extension and overlapping words with the title.
  if (!targetPath && job.title) {
    try {
      const files = readdirSync(downloadsDir);
      const titleWords = job.title
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2);

      let bestMatch: { path: string; score: number; mtime: number } | null = null;

      for (const f of files) {
        const fLower = f.toLowerCase();
        const score = titleWords.filter((w) => fLower.includes(w)).length;
        if (score < titleWords.length * 0.4) continue; // need at least 40% word overlap

        const fullPath = path.join(downloadsDir, f);
        const fStat = statSync(fullPath);
        if (!bestMatch || score > bestMatch.score || fStat.mtimeMs > bestMatch.mtime) {
          bestMatch = { path: fullPath, score, mtime: fStat.mtimeMs };
        }
      }

      if (bestMatch) {
        targetPath = bestMatch.path;
        fileStats = statSync(targetPath);
      }
    } catch {
      // directory doesn't exist or other error — fall through to 404
    }
  }

  if (!targetPath || !fileStats) {
    return Response.json(
      { error: "File not found on disk" },
      { status: 404 },
    );
  }

  // Determine a safe download filename
  const fileName = job.file_name || path.basename(targetPath);

  // Guess a MIME type from the extension
  const ext = path.extname(fileName).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".flv": "video/x-flv",
    ".m4a": "audio/mp4",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
  };
  const contentType = mimeTypes[ext] || "application/octet-stream";

  // Create a Node.js readable stream and convert it to a Web
  // ReadableStream that the Response constructor accepts.
  const nodeStream = createReadStream(targetPath);

  const webStream = new ReadableStream({
    start(controller) {
      nodeStream.on("data", (chunk: string | Buffer) => {
        const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        controller.enqueue(new Uint8Array(buf));
      });
      nodeStream.on("end", () => {
        controller.close();
      });
      nodeStream.on("error", (err) => {
        controller.error(err);
      });
    },
    cancel() {
      nodeStream.destroy();
    },
  });

  // Create RFC 5987 / RFC 6266 compatible Content-Disposition header
  // safeAscii is a fallback for older parsers
  const safeAscii = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "");
  // utf8Encoded handles unicode symbols (Polish letters, ｜, —, etc.)
  const utf8Encoded = encodeURIComponent(fileName)
    .replace(/['()]/g, escape)
    .replace(/\*/g, "%2A");

  return new Response(webStream, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(fileStats.size),
      "Content-Disposition": `attachment; filename="${safeAscii}"; filename*=UTF-8''${utf8Encoded}`,
    },
  });
}
