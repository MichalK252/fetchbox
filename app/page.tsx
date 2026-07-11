"use client";

import { useState, type FormEvent } from "react";

/**
 * Home page — a minimal form that POSTs a URL to /api/jobs
 * and displays the JSON response underneath.
 *
 * Marked "use client" because it uses React state and
 * browser-only APIs (fetch, form events).
 */
export default function Home() {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setResult(null);
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      const data = await res.json();

      if (!res.ok) {
        // The API returns { error: "…" } on validation failures
        setError(data.error ?? `Request failed (${res.status})`);
      } else {
        setResult(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col flex-1 items-center justify-center p-8 font-sans">
      <main className="w-full max-w-lg flex flex-col gap-8">
        <h1 className="text-2xl font-semibold tracking-tight">Fetchbox</h1>

        {/* ── URL submission form ── */}
        <form onSubmit={handleSubmit} className="flex gap-3">
          <input
            id="url-input"
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            required
            className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm
                       outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500
                       dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
          <button
            id="submit-btn"
            type="submit"
            disabled={loading}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white
                       transition-colors hover:bg-zinc-700 disabled:opacity-50
                       dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {loading ? "Sending…" : "Submit"}
          </button>
        </form>

        {/* ── Error message ── */}
        {error && (
          <p id="error-message" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        {/* ── JSON response ── */}
        {result && (
          <pre
            id="json-result"
            className="overflow-x-auto rounded-md bg-zinc-100 p-4 text-sm
                       dark:bg-zinc-800 dark:text-zinc-200"
          >
            {JSON.stringify(result, null, 2)}
          </pre>
        )}
      </main>
    </div>
  );
}
