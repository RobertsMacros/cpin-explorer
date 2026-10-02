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
import { fileURLToPath } from "node:url";
import * as pagefind from "pagefind";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INPUT = process.argv[2] || join(ROOT, "prototypes/data/search-records.jsonl");
const OUTPUT = join(ROOT, "prototypes/search/pagefind");
const BATCH = 64;

async function sizeOf(dir) {
  let bytes = 0, files = 0;
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    bytes += (await stat(join(entry.parentPath ?? entry.path, entry.name))).size;
    files++;
  }
  return { bytes, files };
}

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
    batch.push({ url: r.url, content: r.content, language: r.language || "en", meta: r.meta, filters: r.filters });
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
