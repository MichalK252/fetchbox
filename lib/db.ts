/**
 * lib/db.ts
 *
 * SQLite-backed job queue using better-sqlite3.
 *
 * The database file lives at `data/fetchbox.db` relative to the
 * project root.  The `data/` directory is created automatically
 * if it doesn't exist.
 *
 * Why better-sqlite3?
 *   It's synchronous (no callbacks/promises), which makes
 *   transactions trivial — you just call methods in sequence
 *   and they run on the same connection in the same thread.
 *   This is perfect for a local job queue where atomicity matters
 *   but throughput requirements are low.
 */

import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

// ─── Status enum ────────────────────────────────────────────────────

export const JOB_STATUSES = [
  "queued_metadata",
  "fetching_metadata",
  "metadata_ready",
  "queued_download",
  "downloading",
  "done",
  "error",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

// ─── Row type ───────────────────────────────────────────────────────

export interface JobRow {
  id: string;
  url: string;
  status: JobStatus;
  title: string | null;
  thumbnail: string | null;
  /** Duration in seconds */
  duration: number | null;
  /** JSON-serialised array of VideoFormat objects from lib/ytdlp.ts */
  formats: string | null;
  selected_format: string | null;
  file_path: string | null;
  file_name: string | null;
  /** Download progress 0-100 */
  progress: number | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Fields that can be passed to updateJob().
 * Omit `id`, `created_at` — those are immutable.
 * `updated_at` is set automatically.
 */
export type JobUpdate = Partial<Omit<JobRow, "id" | "created_at" | "updated_at">>;

// ─── Database singleton ─────────────────────────────────────────────
//
// We keep a module-level singleton so every import shares the same
// connection.  better-sqlite3 connections are NOT thread-safe, but
// Node.js is single-threaded so this is fine.

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db) return _db;

  // Resolve the data directory relative to the project root.
  // __dirname in ESM context points to lib/, so go one level up.
  const dataDir = path.join(process.cwd(), "data");

  // Create data/ if it doesn't exist
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = path.join(dataDir, "fetchbox.db");
  _db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance.
  _db.pragma("journal_mode = WAL");

  // Create the jobs table if it doesn't exist.
  _db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id              TEXT PRIMARY KEY,
      url             TEXT    NOT NULL,
      status          TEXT    NOT NULL DEFAULT 'queued_metadata',
      title           TEXT,
      thumbnail       TEXT,
      duration        REAL,
      formats         TEXT,
      selected_format TEXT,
      file_path       TEXT,
      file_name       TEXT,
      progress        REAL,
      error_message   TEXT,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  return _db;
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Insert a new job in `queued_metadata` status.
 *
 * @param id   A unique identifier (e.g. crypto.randomUUID())
 * @param url  The validated URL to process
 * @returns    The newly created job row
 */
export function createJob(id: string, url: string): JobRow {
  const db = getDb();

  const stmt = db.prepare(`
    INSERT INTO jobs (id, url, status)
    VALUES (@id, @url, 'queued_metadata')
  `);

  stmt.run({ id, url });

  return getJob(id)!;
}

/**
 * Fetch a single job by id.  Returns undefined if not found.
 */
export function getJob(id: string): JobRow | undefined {
  const db = getDb();
  const stmt = db.prepare("SELECT * FROM jobs WHERE id = ?");
  return stmt.get(id) as JobRow | undefined;
}

/**
 * Update arbitrary fields on a job.  `updated_at` is set
 * automatically to the current time.
 *
 * @param id      The job id
 * @param fields  An object with only the columns you want to change
 * @returns       The updated job row (or undefined if id not found)
 *
 * @example
 *   updateJob(id, { status: "metadata_ready", title: "My Video" })
 */
export function updateJob(id: string, fields: JobUpdate): JobRow | undefined {
  const db = getDb();

  // Build a dynamic SET clause from the provided fields.
  const keys = Object.keys(fields) as (keyof JobUpdate)[];
  if (keys.length === 0) return getJob(id);

  // Always touch updated_at
  const setClauses = keys
    .map((k) => `${k} = @${k}`)
    .concat("updated_at = datetime('now')");

  const sql = `UPDATE jobs SET ${setClauses.join(", ")} WHERE id = @id`;
  const stmt = db.prepare(sql);
  stmt.run({ ...fields, id });

  return getJob(id);
}

/**
 * Atomically claim the oldest job in `fromStatus` and move it to
 * `toStatus`.  Returns the claimed job, or undefined if none are
 * available.
 *
 * ─── Why this needs to be a transaction ───
 *
 * The claim involves two steps:
 *   1. SELECT the oldest job in `fromStatus`
 *   2. UPDATE that job's status to `toStatus`
 *
 * Without a transaction, two concurrent callers (e.g. two worker
 * iterations in the same event loop, or two separate processes
 * opening the same DB file) could both execute step 1 before either
 * executes step 2.  They'd SELECT the *same* row and both think
 * they own it, leading to duplicate processing.
 *
 * Wrapping both steps in an IMMEDIATE transaction guarantees:
 *
 *   • The BEGIN IMMEDIATE acquires a RESERVED lock on the database
 *     *before* any reads.  Any other connection trying to BEGIN
 *     IMMEDIATE at the same time will block (or get SQLITE_BUSY)
 *     until this transaction commits or rolls back.
 *
 *   • The SELECT + UPDATE run as an atomic unit — no other writer
 *     can interleave between them.
 *
 * better-sqlite3 makes this especially clean because its `.transaction()`
 * helper automatically wraps the callback in BEGIN/COMMIT/ROLLBACK
 * and retries on SQLITE_BUSY by default.
 *
 * @param fromStatus  The status to look for (e.g. "queued_metadata")
 * @param toStatus    The status to set on the claimed job (e.g. "fetching_metadata")
 */
export function claimNextJob(
  fromStatus: JobStatus,
  toStatus: JobStatus,
): JobRow | undefined {
  const db = getDb();

  // db.transaction() wraps the callback in BEGIN IMMEDIATE … COMMIT.
  // If another connection holds a write lock, better-sqlite3 will
  // throw SQLITE_BUSY (you can configure a timeout with db.pragma("busy_timeout")).
  const claim = db.transaction(() => {
    const selectStmt = db.prepare(`
      SELECT * FROM jobs
      WHERE status = ?
      ORDER BY created_at ASC
      LIMIT 1
    `);

    const job = selectStmt.get(fromStatus) as JobRow | undefined;
    if (!job) return undefined;

    const updateStmt = db.prepare(`
      UPDATE jobs
      SET status = ?, updated_at = datetime('now')
      WHERE id = ?
    `);

    updateStmt.run(toStatus, job.id);

    // Return the row with the *new* status
    return { ...job, status: toStatus } as JobRow;
  });

  return claim();
}

/**
 * Find jobs in a terminal state (done or error) whose updated_at
 * is older than `olderThanMs` milliseconds ago.
 *
 * Used by the cleanup routine to remove expired jobs and their
 * downloaded files from disk.
 *
 * @param olderThanMs  Age threshold in milliseconds (e.g. 3_600_000 = 1 hour)
 * @returns            Array of stale job rows
 */
export function listStaleJobs(olderThanMs: number): JobRow[] {
  const db = getDb();

  // SQLite's datetime() returns UTC strings in "YYYY-MM-DD HH:MM:SS" format.
  // We compute the cutoff as a UTC datetime string and compare directly.
  // datetime('now', '-3600 seconds') gives us "1 hour ago".
  const cutoffSeconds = Math.floor(olderThanMs / 1000);

  const stmt = db.prepare(`
    SELECT * FROM jobs
    WHERE status IN ('done', 'error')
      AND updated_at <= datetime('now', '-' || ? || ' seconds')
    ORDER BY updated_at ASC
  `);

  return stmt.all(cutoffSeconds) as JobRow[];
}

/**
 * Permanently delete a job row from the database.
 *
 * Note: this does NOT delete any files on disk — the caller is
 * responsible for cleaning up the downloaded file before calling
 * this function.
 *
 * @param id  The job id to delete
 * @returns   true if a row was deleted, false if the id wasn't found
 */
export function deleteJob(id: string): boolean {
  const db = getDb();
  const stmt = db.prepare("DELETE FROM jobs WHERE id = ?");
  const result = stmt.run(id);
  return result.changes > 0;
}

/**
 * Close the database connection.  Useful for clean shutdown in tests
 * or scripts.  After calling this, the next database operation will
 * re-open the connection.
 */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
