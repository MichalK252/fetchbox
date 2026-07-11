/**
 * scripts/test-db.ts
 *
 * Smoke-test for lib/db.ts — exercises all four CRUD functions.
 *
 * Run:
 *   node --experimental-strip-types scripts/test-db.ts
 */

import {
  createJob,
  getJob,
  updateJob,
  claimNextJob,
  closeDb,
} from "../lib/db.ts";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`  ✓ ${message}`);
}

console.log("── Testing lib/db.ts ──\n");

// 1. createJob
const job1 = createJob("test-1", "https://example.com/video1");
assert(job1.id === "test-1", "createJob returns correct id");
assert(job1.url === "https://example.com/video1", "createJob returns correct url");
assert(job1.status === "queued_metadata", "createJob sets status to queued_metadata");
assert(job1.title === null, "createJob sets title to null");

// 2. getJob
const fetched = getJob("test-1");
assert(fetched !== undefined, "getJob finds the job");
assert(fetched!.id === "test-1", "getJob returns correct id");

const missing = getJob("nonexistent");
assert(missing === undefined, "getJob returns undefined for missing id");

// 3. updateJob
const updated = updateJob("test-1", {
  status: "metadata_ready",
  title: "Test Video",
  duration: 120,
  formats: JSON.stringify([{ format_id: "22", ext: "mp4" }]),
});
assert(updated !== undefined, "updateJob returns the row");
assert(updated!.status === "metadata_ready", "updateJob changes status");
assert(updated!.title === "Test Video", "updateJob changes title");
assert(updated!.duration === 120, "updateJob changes duration");

// 4. claimNextJob
// Create two more jobs in queued_metadata
createJob("test-2", "https://example.com/video2");
createJob("test-3", "https://example.com/video3");

// test-1 is already metadata_ready, so claimNextJob for queued_metadata
// should grab test-2 (oldest queued_metadata)
const claimed = claimNextJob("queued_metadata", "fetching_metadata");
assert(claimed !== undefined, "claimNextJob finds a job");
assert(claimed!.id === "test-2", "claimNextJob picks the oldest job");
assert(claimed!.status === "fetching_metadata", "claimNextJob sets the new status");

// Verify test-2 is actually updated in the database
const test2Check = getJob("test-2");
assert(test2Check!.status === "fetching_metadata", "claimNextJob persists the status change");

// Claim again — should get test-3
const claimed2 = claimNextJob("queued_metadata", "fetching_metadata");
assert(claimed2!.id === "test-3", "second claimNextJob gets next job");

// Claim again — nothing left in queued_metadata
const claimed3 = claimNextJob("queued_metadata", "fetching_metadata");
assert(claimed3 === undefined, "claimNextJob returns undefined when queue is empty");

console.log("\n── All tests passed ──");

// Clean up: close the DB and delete the test data
closeDb();

// Remove the test database file
import fs from "node:fs";
import path from "node:path";
const dbPath = path.resolve(import.meta.dirname, "..", "data", "fetchbox.db");
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
// Also remove WAL/SHM files if present
for (const suffix of ["-wal", "-shm"]) {
  const p = dbPath + suffix;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
console.log("(cleaned up test database)");
