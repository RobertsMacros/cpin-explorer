// Assemble the deployable site in ../site (gitignored) for Cloudflare Workers static assets.
// Copies only what the pages load, keeping the repo's layout so every relative link still works
// (pages live in prototypes/ and reach ../../assets and ../../data). Adds robots.txt, _headers
// (noindex: public but hidden from search engines), _redirects (/ -> the globe) and a 404 page.
// Run after `./cpin export` and `npm run search-index`, which write the derived data it needs.
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "site");
const MAX_FILE = 25 * 1024 * 1024;        // Cloudflare's per-file limit for static assets
const MAX_FILES = 20000;                  // and per deployment (free plan)

// What the pages need, relative to the repo root.
const INCLUDE = [
  "prototypes/about",
  "prototypes/dashboard", "prototypes/reader", "prototypes/saved", "prototypes/search", "prototypes/guide",
  "prototypes/redline-timeline", "prototypes/shared", "prototypes/vendor", "prototypes/data", "prototypes/reviews",
  "prototypes/package.json",
  "assets/cpin-explorer", "assets/roberts-macros",
  "data/countries", "data/images/manifest.json", "data/images/files", "data/pdfs/text/images",
];
// Never shipped: development screenshots, sample exports, the 23 MB file the search index is built
// from, and the export's similarity cache.
const EXCLUDE = [/\/screenshots(\/|$)/, /^prototypes\/saved\/samples(\/|$)/, /^prototypes\/data\/search-records\.jsonl$/,
  /^prototypes\/data\/series\/similarity-cache\.json$/, /(^|\/)\.DS_Store$/, /(^|\/)\.tmp-/];

const REQUIRED = ["prototypes/dashboard/data.json", "prototypes/data/series", "prototypes/search/pagefind", "data/images/files"];
for (const rel of REQUIRED) {
  try { await stat(path.join(ROOT, rel)); }
  catch { console.error(`missing ${rel}: run ./cpin export, ./cpin images and (cd web && npm run search-index) first`); process.exit(1); }
}

// Only referenced PDF pictures belong in a build. Older derived files can remain in the
// history store, including front matter removed by a newer extractor.
const pdfPictures = new Set();
async function collectPictures(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await collectPictures(file);
    else if (entry.name.endsWith(".json") && entry.name !== "similarity-cache.json") {
      const series = JSON.parse(await readFile(file, "utf8"));
      for (const source of Object.values(series.images || {})) {
        if (source.startsWith("../../data/pdfs/text/images/")) pdfPictures.add(path.basename(source));
      }
    }
  }
}
await collectPictures(path.join(ROOT, "prototypes/data/series"));

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const keep = (src) => {
  const rel = path.relative(ROOT, src).split(path.sep).join("/");
  if (EXCLUDE.some((re) => re.test(rel))) return false;
  return !rel.startsWith("data/pdfs/text/images/") || pdfPictures.has(path.basename(src));
};
for (const rel of INCLUDE) await cp(path.join(ROOT, rel), path.join(OUT, rel), { recursive: true, filter: keep });

await writeFile(path.join(OUT, "_redirects"), "/ /prototypes/dashboard/ 302\n/favicon.ico /assets/cpin-explorer/favicon.png 302\n");
// noindex on every response. robots.txt deliberately does not block pages: a crawler that can't fetch
// a page never sees its noindex, and may still list the bare URL. It does keep bots off the bulk data.
await writeFile(path.join(OUT, "_headers"), `/*
  X-Robots-Tag: noindex, nofollow, noarchive
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
/data/images/files/*
  Cache-Control: public, max-age=31536000, immutable
/prototypes/vendor/*
  Cache-Control: public, max-age=86400
`);
await writeFile(path.join(OUT, "robots.txt"), "User-agent: *\nDisallow: /data/\nDisallow: /prototypes/data/\nDisallow: /prototypes/search/pagefind/\n");
await writeFile(path.join(OUT, "404.html"), `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Not found · CPIN Explorer</title>
<link rel="icon" type="image/png" sizes="64x64" href="/assets/cpin-explorer/favicon.png">
<link rel="icon" type="image/svg+xml" href="/assets/cpin-explorer/favicon.svg">
<link rel="stylesheet" href="/prototypes/shared/theme.css">
<style>body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--font-text)}header{padding:.9rem clamp(1rem,2.4vw,2.75rem);border-bottom:1px solid var(--line)}
main{max-width:40rem;margin:16vh auto;padding:0 1rem}h1{font-family:var(--font-display,monospace);font-weight:400;font-size:2.6rem;color:var(--blue);margin:.2rem 0 1rem}</style>
<link rel="stylesheet" href="/prototypes/shared/brand.css">
<script type="module" src="/prototypes/shared/brand-mark.js" blocking="render"></script>
</head><body>
<header><a class="brand" href="/prototypes/dashboard/" aria-label="CPIN Explorer home"><svg class="brand-mark" viewBox="0 0 64 64" aria-hidden="true"><use href="/assets/cpin-explorer/mark.svg#mark"/></svg><span class="brand-name"><b>CPIN</b>EXPLORER</span></a></header>
<main><p class="eyebrow">CPIN Explorer</p><h1>Not found</h1>
<p>That page isn't here. <a href="/prototypes/dashboard/">Go to the globe</a>.</p></main></body></html>
`);

// Check Cloudflare's limits before uploading.
let files = 0, bytes = 0;
const big = [];
async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { await walk(p); continue; }
    const { size } = await stat(p);
    files++; bytes += size;
    if (size > MAX_FILE) big.push(`${path.relative(OUT, p)} (${(size / 1048576).toFixed(1)} MB)`);
  }
}
await walk(OUT);
console.log(`site/: ${files} files, ${(bytes / 1048576).toFixed(0)} MB`);
if (big.length || files > MAX_FILES) {
  console.error(big.length ? `over 25 MB: ${big.join(", ")}` : `${files} files is over the ${MAX_FILES} limit`);
  process.exit(1);
}
