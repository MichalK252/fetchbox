/**
 * POST /api/jobs
 *
 * Accepts a JSON body with { url: string }.
 * Validates that the URL is a well-formed http or https URL,
 * then echoes it back as JSON with a 201 status.
 */
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

  // --- 4. Echo it back (placeholder for future DB insert) ---
  return Response.json({ url: parsed.href }, { status: 201 });
}
