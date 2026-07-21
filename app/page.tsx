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

function formatCodecName(vcodec: string | null): string {
  if (!vcodec) return "";
  if (vcodec.startsWith("avc1")) return "H.264";
  if (vcodec.startsWith("av01")) return "AV1";
  if (vcodec.startsWith("vp9") || vcodec.startsWith("vp09")) return "VP9";
  if (vcodec.startsWith("vp8") || vcodec.startsWith("vp08")) return "VP8";
  return vcodec.split(".")[0];
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
    fetching_metadata: "Fetching video metadata…",
    metadata_ready: "Choose video quality",
    queued_download: "Queued for download…",
    downloading: "Downloading & processing video…",
    done: "Ready to download!",
    error: "Failed to process video",
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

      let data;
      try {
        data = await res.json();
      } catch {
        setFormError(`Server error (${res.status})`);
        return;
      }

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

      let data;
      try {
        data = await res.json();
      } catch {
        setJob((prev) =>
          prev ? { ...prev, status: "error", error_message: `Server error (${res.status})` } : prev,
        );
        return;
      }

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

  // ── Reset to submit another URL / Go Home ──
  function handleReset() {
    stopPolling();
    setJob(null);
    setFormError(null);
    setUrl("");
  }

  // Group formats into MP4 vs WEBM categories
  const sortedFormats = job?.formats
    ? job.formats.slice().sort((a, b) => (b.height ?? 0) - (a.height ?? 0))
    : [];

  const mp4Formats = sortedFormats.filter(
    (f) => (f.ext ?? "").toLowerCase() === "mp4",
  );
  const webmFormats = sortedFormats.filter(
    (f) => (f.ext ?? "").toLowerCase() === "webm",
  );
  const otherFormats = sortedFormats.filter((f) => {
    const ext = (f.ext ?? "").toLowerCase();
    return ext !== "mp4" && ext !== "webm";
  });

  // ─── Render ───────────────────────────────────────────────────────

  return (
    <div className="flex flex-col min-h-screen items-center justify-between p-6 sm:p-10 font-sans bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 transition-colors">
      <main className="w-full max-w-2xl flex flex-col gap-8 my-auto">
        
        {/* ── Brand Header (Clean Text) ── */}
        <header className="flex items-center justify-between">
          <button
            onClick={handleReset}
            className="group text-left outline-none"
          >
            <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
              Fetchbox
            </h1>
          </button>

          {/* Go Home Button (Shown when job is active) */}
          {job && (
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-all"
            >
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 00-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                />
              </svg>
              Go Home
            </button>
          )}
        </header>

        {/* ── URL Submission Form (White Fetch Button) ── */}
        {!job && (
          <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <input
                id="url-input"
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Paste video URL (YouTube, Erome, etc.)"
                required
                className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3.5 text-sm
                           outline-none transition-all placeholder:text-zinc-400
                           focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400/20
                           dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-700"
              />
            </div>
            {/* WHITE FETCH BUTTON */}
            <button
              id="submit-btn"
              type="submit"
              disabled={submitting}
              className="rounded-xl bg-white px-6 py-3.5 text-sm font-semibold text-zinc-900
                         border border-zinc-200 shadow-sm transition-all hover:bg-zinc-100
                         dark:bg-white dark:text-zinc-900 dark:border-zinc-200 dark:hover:bg-zinc-200
                         active:scale-95 disabled:opacity-50"
            >
              {submitting ? "Processing…" : "Fetch"}
            </button>
          </form>
        )}

        {formError && (
          <div className="rounded-xl bg-red-50 p-4 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400 border border-red-200 dark:border-red-900/50 flex items-center justify-between">
            <span>{formError}</span>
            <button
              onClick={() => setFormError(null)}
              className="text-xs font-semibold underline hover:no-underline ml-2"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* ── Active Job Card ── */}
        {job && (
          <div className="rounded-2xl border border-zinc-200 bg-white shadow-xl shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-none overflow-hidden transition-all">
            {/* Thumbnail Header */}
            {job.thumbnail && (
              <div className="relative aspect-video w-full overflow-hidden bg-zinc-900">
                <img
                  src={job.thumbnail}
                  alt={job.title ?? "Video thumbnail"}
                  className="h-full w-full object-cover"
                />
                {job.duration !== null && (
                  <span className="absolute bottom-3 right-3 rounded-md bg-black/75 px-2 py-1 text-xs font-medium text-white backdrop-blur-sm">
                    {formatDuration(job.duration)}
                  </span>
                )}
              </div>
            )}

            <div className="p-6 flex flex-col gap-6">
              {/* Title Header */}
              {job.title && (
                <div>
                  <h2 className="text-xl font-bold leading-snug tracking-tight text-zinc-900 dark:text-white">
                    {job.title}
                  </h2>
                </div>
              )}

              {/* Status Header & Progress */}
              <div className="flex items-center justify-between py-1 border-b border-zinc-100 dark:border-zinc-800/80 pb-4">
                <div className="flex items-center gap-2.5">
                  {["queued_metadata", "fetching_metadata", "queued_download", "downloading"].includes(
                    job.status,
                  ) && (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-800 border-t-transparent dark:border-zinc-200 dark:border-t-transparent" />
                  )}

                  {job.status === "done" && (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold text-xs">
                      ✓
                    </span>
                  )}

                  {job.status === "error" && (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500/10 text-red-600 dark:text-red-400 font-bold text-xs">
                      ✕
                    </span>
                  )}

                  <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
                    {statusLabel(job.status)}
                  </span>
                </div>

                {/* Go Home button header shortcut when selecting resolution */}
                {job.status === "metadata_ready" && (
                  <button
                    onClick={handleReset}
                    className="text-xs text-zinc-500 dark:text-zinc-400 hover:underline font-medium"
                  >
                    ← Fetch another
                  </button>
                )}
              </div>

              {/* ── Downloading Progress Bar ── */}
              {job.status === "downloading" && job.progress !== null && (
                <div className="w-full flex flex-col gap-2">
                  <div className="h-2.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-zinc-800 dark:bg-zinc-200 transition-all duration-300 ease-out"
                      style={{ width: `${Math.min(job.progress, 100)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400 font-mono">
                    <span>Downloading format {job.selected_format}</span>
                    <span>{job.progress.toFixed(1)}%</span>
                  </div>
                </div>
              )}

              {/* ── Error Display ── */}
              {job.status === "error" && job.error_message && (
                <div className="rounded-xl bg-red-50 dark:bg-red-950/40 p-4 border border-red-200 dark:border-red-900/50">
                  <p className="text-sm text-red-600 dark:text-red-400">
                    {job.error_message}
                  </p>
                </div>
              )}

              {/* ── Categorized Format Selector (MP4 Recommended vs WEBM) ── */}
              {job.status === "metadata_ready" && (
                <div className="flex flex-col gap-6">

                  {/* MP4 Formats Category (Recommended) */}
                  {mp4Formats.length > 0 && (
                    <div className="flex flex-col gap-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold tracking-wider uppercase text-zinc-400 dark:text-zinc-500">
                          MP4 Videos (Recommended)
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {mp4Formats.map((f) => (
                          <button
                            key={f.format_id}
                            onClick={() => handleSelectFormat(f.format_id)}
                            className="flex items-center justify-between rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 text-left transition-all hover:border-zinc-400 dark:hover:border-zinc-600 group outline-none"
                          >
                            <div className="flex items-center gap-2.5">
                              <span className="font-bold text-base text-zinc-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                                {f.resolution} MP4
                              </span>
                              {f.vcodec && (
                                <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-medium">
                                  {formatCodecName(f.vcodec)}
                                </span>
                              )}
                            </div>

                            {f.filesize && (
                              <span className="text-xs font-mono font-medium text-zinc-500 dark:text-zinc-400">
                                {formatBytes(f.filesize)}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* WEBM Formats Category */}
                  {webmFormats.length > 0 && (
                    <div className="flex flex-col gap-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold tracking-wider uppercase text-zinc-400 dark:text-zinc-500">
                          WEBM Videos
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {webmFormats.map((f) => (
                          <button
                            key={f.format_id}
                            onClick={() => handleSelectFormat(f.format_id)}
                            className="flex items-center justify-between rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 text-left transition-all hover:border-zinc-400 dark:hover:border-zinc-600 group outline-none"
                          >
                            <div className="flex items-center gap-2.5">
                              <span className="font-bold text-base text-zinc-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                                {f.resolution} WEBM
                              </span>
                              {f.vcodec && (
                                <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-medium">
                                  {formatCodecName(f.vcodec)}
                                </span>
                              )}
                            </div>

                            {f.filesize && (
                              <span className="text-xs font-mono font-medium text-zinc-500 dark:text-zinc-400">
                                {formatBytes(f.filesize)}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Other Formats Category */}
                  {otherFormats.length > 0 && (
                    <div className="flex flex-col gap-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold tracking-wider uppercase text-zinc-400 dark:text-zinc-500">
                          Other Options
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {otherFormats.map((f) => (
                          <button
                            key={f.format_id}
                            onClick={() => handleSelectFormat(f.format_id)}
                            className="flex items-center justify-between rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 text-left transition-all hover:border-zinc-400 dark:hover:border-zinc-600 group outline-none"
                          >
                            <div className="flex items-center gap-2.5">
                              <span className="font-bold text-base text-zinc-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                                {f.resolution} {f.ext ? f.ext.toUpperCase() : ""}
                              </span>
                              {f.vcodec && (
                                <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-medium">
                                  {formatCodecName(f.vcodec)}
                                </span>
                              )}
                            </div>

                            {f.filesize && (
                              <span className="text-xs font-mono font-medium text-zinc-500 dark:text-zinc-400">
                                {formatBytes(f.filesize)}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                </div>
              )}

              {/* ── Ready Download Link (done) ── */}
              {job.status === "done" && (
                <div className="flex flex-col gap-3">
                  <a
                    href={`/api/jobs/${job.id}/download`}
                    download={job.file_name ?? true}
                    className="flex h-12 items-center justify-center gap-2.5 rounded-xl
                               bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 px-5 text-sm font-semibold
                               shadow-lg transition-all hover:opacity-90 active:scale-98"
                  >
                    <svg
                      className="h-5 w-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V3"
                      />
                    </svg>
                    Download {job.file_name ?? "Video File"}
                  </a>
                </div>
              )}

              {/* ── Start Over / Go Home button at card bottom ── */}
              {(job.status === "done" || job.status === "error" || job.status === "metadata_ready") && (
                <div className="pt-2 flex justify-center border-t border-zinc-100 dark:border-zinc-800/60">
                  <button
                    onClick={handleReset}
                    className="text-xs font-semibold text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white transition-colors flex items-center gap-1.5 py-1.5 px-3.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M10 19l-7-7m0 0l7-7m-7 7h18"
                      />
                    </svg>
                    Fetch another video
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* ── Footer ── */}
      <footer className="w-full text-center py-4 text-xs font-medium text-zinc-400 dark:text-zinc-600 mt-10">
        Michas223
      </footer>
    </div>
  );
}
