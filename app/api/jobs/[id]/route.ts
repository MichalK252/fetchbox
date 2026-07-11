/**
 * GET /api/jobs/[id]
 *
 * Returns the current state of a job.
 * The `formats` column is stored as a JSON string in SQLite —
 * we parse it back into a real array before sending the response
 * so the client gets structured data.
 */

import { getJob } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const job = getJob(id);

  if (!job) {
    return Response.json(
      { error: "Job not found" },
      { status: 404 },
    );
  }

  // Parse the JSON-encoded formats column so the client
  // receives a proper array instead of a string.
  const response = {
    ...job,
    formats: job.formats ? JSON.parse(job.formats) : null,
  };

  return Response.json(response);
}
