/**
 * GET /api/jobs/[id]/download
 *
 * Streams the finished file back to the client as an attachment.
 * Only works when the job status is "done" and file_path exists on disk.
 */

import { getJob } from "@/lib/db";
import { stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
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

  if (job.status !== "done" || !job.file_path) {
    return Response.json(
      { error: "File is not ready for download" },
      { status: 409 },
    );
  }

  // Verify the file still exists on disk
  let fileStats;
  try {
    fileStats = await stat(job.file_path);
  } catch {
    return Response.json(
      { error: "File not found on disk" },
      { status: 404 },
    );
  }

  // Determine a safe download filename
  const fileName = job.file_name || path.basename(job.file_path);

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
  const nodeStream = createReadStream(job.file_path);

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

  return new Response(webStream, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(fileStats.size),
      "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
    },
  });
}
