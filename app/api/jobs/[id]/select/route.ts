/**
 * POST /api/jobs/[id]/select
 *
 * Accepts { formatId: string } in the JSON body.
 * Only allowed when the job's status is "metadata_ready".
 * Sets selected_format and flips the status to "queued_download".
 */

import { getJob, updateJob } from "@/lib/db";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // --- 1. Look up the job ---
  const job = getJob(id);

  if (!job) {
    return Response.json(
      { error: "Job not found" },
      { status: 404 },
    );
  }

  // --- 2. Guard: only metadata_ready jobs can select a format ---
  if (job.status !== "metadata_ready") {
    return Response.json(
      {
        error: `Cannot select a format when status is "${job.status}". ` +
               `Expected "metadata_ready".`,
      },
      { status: 409 },
    );
  }

  // --- 3. Parse the request body ---
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Request body must be valid JSON" },
      { status: 400 },
    );
  }

  const { formatId } = body as { formatId?: string };

  if (typeof formatId !== "string" || formatId.trim() === "") {
    return Response.json(
      { error: "Missing or empty `formatId` field" },
      { status: 400 },
    );
  }

  // --- 4. Optionally validate that the chosen formatId exists ---
  if (job.formats) {
    try {
      const formats = JSON.parse(job.formats) as { format_id: string }[];
      const valid = formats.some((f) => f.format_id === formatId);
      if (!valid) {
        return Response.json(
          { error: `Format "${formatId}" not found in this job's available formats` },
          { status: 400 },
        );
      }
    } catch {
      // If formats is somehow corrupted, skip validation and let
      // the download step discover the issue.
    }
  }

  // --- 5. Update the job ---
  const updated = updateJob(id, {
    selected_format: formatId,
    status: "queued_download",
  });

  // Parse formats for the response
  const response = {
    ...updated,
    formats: updated?.formats ? JSON.parse(updated.formats) : null,
  };

  return Response.json(response);
}
