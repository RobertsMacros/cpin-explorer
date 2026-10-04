// Full-text search index for the prototypes, built with Pagefind (MIT, https://pagefind.app) from the
// section records written by `cpin.search_records`. Self-hosted: the browser loads
// prototypes/search/pagefind/pagefind.js and fetches only the index chunks a query needs.
//
//   PYTHONPATH=../src ../.venv/bin/python -m cpin.search_records   # -> prototypes/data/search-records.jsonl
//   node build-search.mjs                                          # -> prototypes/search/pagefind/
//   (or both: npm run search-index)
//
// The output is generated and git-ignored; rebuild it after `./cpin export`.
import { createReadStream } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INPUT = process.argv[2] || join(ROOT, "prototypes/data/search-records.jsonl");
const OUTPUT = join(ROOT, "prototypes/search/pagefind");
const BATCH = 64;

/**
 * A search record as Pagefind takes it. Pagefind keeps a record's url, content, language, meta and filters and
 * nothing else, and its meta values are strings. A record of text read from a PDF (`text_from_pdf: true`, set by
 * cpin.search_records for a note published as a PDF only) carries that into its meta as "true", so the search
 * can mark the passage "From the PDF" and not call it word for word.
 */
export function indexRecord(r) {
  const { text_from_pdf: inMeta, ...meta } = r.meta || {};
  const fromPdf = [r.text_from_pdf, inMeta].some((x) => x === true || x === "true");
  return { url: r.url, content: r.content, language: r.language || "en", meta: fromPdf ? { ...meta, text_from_pdf: "true" } : meta, filters: r.filters };
}

async function sizeOf(dir) {
  let bytes = 0, files = 0;
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    bytes += (await stat(join(entry.parentPath ?? entry.path, entry.name))).size;
    files++;
  }
  return { bytes, files };
}

// Run as a script (not when a test imports indexRecord).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pagefind = await import("pagefind");
  const t0 = performance.now();
  const { index, errors } = await pagefind.createIndex({ forceLanguage: "en" });
  if (!index) throw new Error(`Pagefind did not start: ${errors.join("; ")}`);

  let count = 0, failed = 0, batch = [];
  const urls = new Set();                                       // Pagefind merges records that share a URL
  const flush = async () => {
    const results = await Promise.all(batch.map((r) => index.addCustomRecord(r)));
    for (const res of results) if (res.errors?.length) { failed++; console.error(res.errors.join("; ")); }
    batch = [];
  };
  try {
    const lines = createInterface({ input: createReadStream(INPUT, "utf8"), crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.trim()) continue;
      const r = JSON.parse(line);
      if (urls.has(r.url)) { failed++; console.error(`Duplicate URL (records would merge): ${r.url}`); }
      urls.add(r.url);
      batch.push(indexRecord(r));
      count++;
      if (batch.length >= BATCH) await flush();
    }
  } catch (error) {
    if (error.code === "ENOENT") {
      console.error(`No records at ${INPUT}. Run: PYTHONPATH=../src ../.venv/bin/python -m cpin.search_records`);
      await pagefind.close();
      process.exit(1);
    }
    throw error;
  }
  await flush();
  const t1 = performance.now();

  await rm(OUTPUT, { recursive: true, force: true });          // hashed chunk names: no stale files left behind
  const written = await index.writeFiles({ outputPath: OUTPUT });
  if (written.errors?.length) throw new Error(written.errors.join("; "));
  await pagefind.close();
  const t2 = performance.now();

  const { bytes, files } = await sizeOf(OUTPUT);
  console.log(`Indexed ${count} records${failed ? ` (${failed} failed)` : ""} in ${((t1 - t0) / 1000).toFixed(1)}s, `
    + `wrote ${files} files (${(bytes / 1e6).toFixed(1)} MB) to ${OUTPUT} in ${((t2 - t1) / 1000).toFixed(1)}s.`);
  if (failed) process.exit(1);
}
