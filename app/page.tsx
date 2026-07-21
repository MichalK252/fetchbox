"use client";

import { useState, useEffect, useRef, useCallback, type FormEvent } from "react";

// ─── Types (mirrors the API response shape) ─────────────────────────

interface VideoFormat {
  format_id: string;
  ext: string;
  resolution: string;
  height: number | null;
  filesize: number | null;
  vcodec: string | null;
}

interface Job {
  id: string;
  url: string;
  status: string;
  title: string | null;
  thumbnail: string | null;
  duration: number | null;
  formats: VideoFormat[] | null;
  selected_format: string | null;
  file_path: string | null;
  file_name: string | null;
  progress: number | null;
  error_message: string | null;
}

// ─── Helpers ────────────────────────────────────────────────────────

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Human-readable status label */
function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    queued_metadata: "Queued — waiting for metadata…",
    fetching_metadata: "Fetching metadata…",
    metadata_ready: "Pick a format to download",
    queued_download: "Queued — waiting for download…",
    downloading: "Downloading…",
    done: "Done!",
    error: "Error",
  };
  return labels[status] ?? status;
}

// ─── Component ──────────────────────────────────────────────────────

export default function Home() {
  // Form state
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Job state
  const [job, setJob] = useState<Job | null>(null);

  // Polling ref (so we can clear it on unmount or reset)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Stop polling ──
  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // ── Poll the job status ──
  const startPolling = useCallback(
    (jobId: string) => {
      stopPolling();

      const poll = async () => {
        try {
          const res = await fetch(`/api/jobs/${jobId}`);
          if (!res.ok) return;
          const data: Job = await res.json();
          setJob(data);

          // Stop polling once the job reaches a terminal state
          if (data.status === "done" || data.status === "error") {
            stopPolling();
          }
        } catch {
          // Network hiccup — keep polling
        }
      };

      // Fire immediately, then on the interval
      poll();
      pollRef.current = setInterval(poll, 1_200);
    },
    [stopPolling],
  );

  // Clean up on unmount
  useEffect(() => stopPolling, [stopPolling]);

  // ── Submit a URL ──
  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    setJob(null);
    stopPolling();
    setSubmitting(true);

    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      const data = await res.json();

      if (!res.ok) {
        setFormError(data.error ?? `Request failed (${res.status})`);
        return;
      }

      // We got a job back — start polling
      setJob(data as Job);
      startPolling(data.id);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Select a format ──
  async function handleSelectFormat(formatId: string) {
    if (!job) return;

    try {
      const res = await fetch(`/api/jobs/${job.id}/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formatId }),
      });

      const data = await res.json();

      if (!res.ok) {
        setJob((prev) =>
          prev ? { ...prev, status: "error", error_message: data.error } : prev,
        );
        return;
      }

      setJob(data as Job);
      startPolling(job.id);
    } catch {
      // ignore
    }
  }

  // ── Reset to submit another URL ──
  function handleReset() {
    stopPolling();
    setJob(null);
    setFormError(null);
    setUrl("");
  }

  // ─── Render ───────────────────────────────────────────────────────

  return (
    <div className="flex flex-col min-h-screen items-center justify-between p-8 font-sans">
      <main className="w-full max-w-xl flex flex-col gap-6 my-auto">
        <h1 className="text-3xl font-semibold tracking-tight">Fetchbox</h1>

        {/* ── URL submission form ── */}
        {!job && (
          <form onSubmit={handleSubmit} className="flex gap-3">
            <input
              id="url-input"
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://youtube.com/watch?v=…"
              required
              className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm
                         outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500
                         dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
            <button
              id="submit-btn"
              type="submit"
              disabled={submitting}
              className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white
                         transition-colors hover:bg-zinc-700 disabled:opacity-50
                         dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {submitting ? "Sending…" : "Fetch"}
            </button>
          </form>
        )}

        {formError && (
          <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>
        )}

        {/* ── Job status card ── */}
        {job && (
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            {/* Header: thumbnail + title */}
            {job.thumbnail && (
              <img
                src={job.thumbnail}
                alt={job.title ?? "Video thumbnail"}
                className="w-full aspect-video object-cover"
              />
            )}

            <div className="p-4 flex flex-col gap-4">
              {/* Title + duration */}
              {job.title && (
                <div>
                  <h2 className="text-lg font-semibold leading-snug">
                    {job.title}
                  </h2>
                  {job.duration !== null && (
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
                      {formatDuration(job.duration)}
                    </p>
                  )}
                </div>
              )}

              {/* Status badge */}
              <div className="flex items-center gap-2">
                {/* Spinner for in-progress states */}
                {["queued_metadata", "fetching_metadata", "queued_download", "downloading"].includes(
                  job.status,
                ) && (
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-700 dark:border-zinc-600 dark:border-t-zinc-300" />
                )}

                {job.status === "done" && (
                  <span className="text-green-600 dark:text-green-400">✓</span>
                )}

                {job.status === "error" && (
                  <span className="text-red-600 dark:text-red-400">✗</span>
                )}

                <span className="text-sm text-zinc-600 dark:text-zinc-400">
                  {statusLabel(job.status)}
                </span>
              </div>

              {/* ── Progress bar (downloading) ── */}
              {job.status === "downloading" && job.progress !== null && (
                <div className="w-full">
                  <div className="h-2 w-full rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-zinc-800 dark:bg-zinc-200 transition-all duration-300 ease-out"
                      style={{ width: `${Math.min(job.progress, 100)}%` }}
                    />
                  </div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 text-right">
                    {job.progress.toFixed(1)}%
                  </p>
                </div>
              )}

              {/* ── Error message ── */}
              {job.status === "error" && job.error_message && (
                <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 rounded-md p-3">
                  {job.error_message}
                </p>
              )}

              {/* ── Format picker (metadata_ready) ── */}
              {job.status === "metadata_ready" && job.formats && job.formats.length > 0 && (
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Available formats:
                  </p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {job.formats
                      .slice()
                      .sort((a, b) => (b.height ?? 0) - (a.height ?? 0))
                      .map((f) => (
                        <button
                          key={f.format_id}
                          onClick={() => handleSelectFormat(f.format_id)}
                          className="flex flex-col items-center gap-0.5 rounded-md border border-zinc-200
                                     px-3 py-2 text-sm transition-colors hover:bg-zinc-100
                                     dark:border-zinc-700 dark:hover:bg-zinc-800"
                        >
                          <span className="font-medium">{f.resolution}</span>
                          <span className="text-xs text-zinc-500 dark:text-zinc-400">
                            {f.ext.toUpperCase()}
                            {f.filesize ? ` · ${formatBytes(f.filesize)}` : ""}
                          </span>
                        </button>
                      ))}
                  </div>
                </div>
              )}

              {/* ── Download link (done) ── */}
              {job.status === "done" && (
                <a
                  href={`/api/jobs/${job.id}/download`}
                  download={job.file_name ?? true}
                  className="flex h-10 items-center justify-center gap-2 rounded-md
                             bg-zinc-900 px-4 text-sm font-medium text-white
                             transition-colors hover:bg-zinc-700
                             dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V3"
                    />
                  </svg>
                  Download {job.file_name ?? "file"}
                </a>
              )}

              {/* ── Start over button ── */}
              {(job.status === "done" || job.status === "error") && (
                <button
                  onClick={handleReset}
                  className="text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400
                             dark:hover:text-zinc-200 transition-colors"
                >
                  ← Fetch another video
                </button>
              )}
            </div>
          </div>
        )}
      </main>

      <footer className="w-full text-center py-4 text-sm text-zinc-400 dark:text-zinc-600 mt-8">
        Michas223
      </footer>
    </div>
  );
}
