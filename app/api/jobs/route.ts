/**
 * POST /api/jobs
 *
 * Accepts { url: string } in the JSON body.
 * Validates the URL, creates a new job row in status "queued_metadata",
 * and returns the full job object with a 201 status.
 */

import { createJob } from "@/lib/db";

export async function POST(request: Request) {
  // --- 1. Parse the request body ---
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Request body must be valid JSON" },
      { status: 400 },
    );
  }

  // --- 2. Extract `url` from the body ---
  const { url } = body as { url?: string };

  if (typeof url !== "string" || url.trim() === "") {
    return Response.json(
      { error: "Missing or empty `url` field" },
      { status: 400 },
    );
  }

  // --- 3. Validate that it's a real http(s) URL ---
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return Response.json(
      { error: "Invalid URL format" },
      { status: 400 },
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return Response.json(
      { error: "URL must use http or https protocol" },
      { status: 400 },
    );
  }

  // --- 4. Create the job row ---
  const id = crypto.randomUUID();
  const job = createJob(id, parsed.href);

  return Response.json(job, { status: 201 });
}
