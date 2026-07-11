/**
 * scripts/test-lib-ytdlp.ts
 *
 * Quick smoke-test for lib/ytdlp.ts — run from the project root:
 *
 *   node --experimental-strip-types scripts/test-lib-ytdlp.ts [URL]
 *
 * Without a URL it just checks if yt-dlp is available.
 * With a URL it fetches metadata and prints the result.
 */

import {
  checkYtDlpAvailable,
  fetchMetadata,
  YtDlpNotFoundError,
} from "../lib/ytdlp.ts";

async function main() {
  // ── 1. Check availability ──
  const available = await checkYtDlpAvailable();
  console.log(`yt-dlp available: ${available}`);

  if (!available) {
    console.log("Install yt-dlp to test metadata fetching.");
    return;
  }

  // ── 2. Fetch metadata if a URL was provided ──
  const url = process.argv[2];
  if (!url) {
    console.log("Pass a URL as an argument to test fetchMetadata().");
    return;
  }

  try {
    console.log(`\nFetching metadata for: ${url}\n`);
    const meta = await fetchMetadata(url);

    console.log(`Title:     ${meta.title}`);
    console.log(`Thumbnail: ${meta.thumbnail ?? "(none)"}`);
    console.log(`Duration:  ${meta.duration !== null ? `${meta.duration}s` : "(unknown)"}`);
    console.log(`Formats:   ${meta.formats.length} video format(s)\n`);

    // Print first 10 formats as a preview
    const preview = meta.formats.slice(0, 10);
    for (const f of preview) {
      const size = f.filesize
        ? `${(f.filesize / 1024 / 1024).toFixed(1)} MB`
        : "N/A";
      console.log(
        `  ${f.format_id.padEnd(10)} ${f.ext.padEnd(6)} ${f.resolution.padEnd(8)} ${size}`,
      );
    }

    if (meta.formats.length > 10) {
      console.log(`  ... and ${meta.formats.length - 10} more`);
    }
  } catch (err) {
    if (err instanceof YtDlpNotFoundError) {
      console.error(err.message);
    } else {
      console.error("Error:", err instanceof Error ? err.message : err);
    }
    process.exit(1);
  }
}

main();
