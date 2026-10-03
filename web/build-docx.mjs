// What "Export to Word" on the saved page needs, built here so nothing loads from a CDN at run time:
//
//   prototypes/vendor/docx.js        the docx library (MIT; with JSZip and pako) as one ES module. The
//                                    saved page imports it only when someone clicks Export to Word.
//   prototypes/vendor/fonts/*.ttf    Geist faces Word can embed in a .docx. Word needs TrueType or
//                                    OpenType, not WOFF2: Geist Sans ships static .ttf files; Geist
//                                    Pixel only WOFF2, so it is decompressed with fontTools.
//
// With --samples it also writes prototypes/saved/samples/: the two exports made from real passages
// in data/countries/ (sample-highlights.json holds the highlight records they were made from).
//
// Run: cd web && npm run docx            (fonts: ../.venv/bin/pip install fonttools brotli)
//      cd web && npm run docx-samples
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const VENDOR = join(ROOT, "prototypes/vendor");
const GEIST = join(ROOT, "web/node_modules/geist/dist/fonts");
const PYTHON = join(ROOT, ".venv/bin/python");

/** readFileSync that waits for a file iCloud has evicted: the first read of one can come back empty. */
export function readBytes(path) {
  for (let attempt = 1; ; attempt++) {
    const bytes = readFileSync(path);
    if (bytes.length || !statSync(path).size || attempt >= 8) return bytes;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150 * attempt);
  }
}
const read = (p) => readBytes(join(ROOT, p)).toString("utf8");

/* ------------------------------------------------------------------ 1. the docx library */

async function bundleDocx() {
  const { build } = await import("esbuild");
  const version = JSON.parse(read("web/node_modules/docx/package.json")).version;
  await build({
    stdin: { contents: `export * from "docx";`, resolveDir: join(ROOT, "web"), loader: "js" },
    bundle: true,
    format: "esm",
    platform: "neutral",
    mainFields: ["module", "main"],
    minify: true,
    outfile: join(VENDOR, "docx.js"),
    legalComments: "inline",
    banner: { js: `/* docx ${version} (MIT, https://github.com/dolanmiu/docx) with JSZip (MIT) and pako (MIT). Built by web/build-docx.mjs. */` },
    logLevel: "warning",
  });
  return version;
}

/* ------------------------------------------------------------------ 2. fonts Word can embed */

// Word finds an embedded font by its family name, so each file is written to name exactly the family
// the document asks for: "Geist" (regular and italic), "Geist SemiBold" and "Geist Pixel Square".
// Their typographic-family records ("Geist", "Geist Pixel"), which macOS would prefer, are dropped.
// The licence (OFL 1.1, no reserved font name) allows this. Sources are tried in order; a variable
// font is instanced at the weight wanted. (On this Mac, iCloud sometimes evicts files under
// node_modules, and reading an evicted file can hang, so evicted sources are skipped.)
export const DOCX_FONT_FILES = [
  { file: "Geist-Regular.ttf", family: "Geist", style: "Regular", weight: 400,
    from: ["geist-sans/Geist-Regular.ttf", "geist-sans/Geist-Variable.ttf", "vendor:Geist-Variable.woff2"] },
  { file: "Geist-Italic.ttf", family: "Geist", style: "Italic", weight: 400, italic: true,
    from: ["geist-sans/Geist-Italic.ttf", "geist-sans/Geist-Italic[wght].ttf", "geist-sans/Geist-Italic.woff2"] },
  { file: "Geist-SemiBold.ttf", family: "Geist SemiBold", style: "Regular", weight: 600,
    from: ["geist-sans/Geist-SemiBold.ttf", "geist-sans/Geist-Variable.ttf", "vendor:Geist-Variable.woff2"] },
  { file: "GeistPixel-Square.ttf", family: "Geist Pixel Square", style: "Regular", weight: 400,
    from: ["vendor:GeistPixel-Square.woff2", "geist-pixel/GeistPixel-Square.woff2"] },
];

const PREPARE_FONT = `
import json, os, sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
spec, dst = json.loads(sys.argv[1]), sys.argv[2]
DATALESS = 0x40000000                      # evicted by iCloud: reading it may block
sources = [p for p in spec["from"] if os.path.exists(p)]
usable = [p for p in sources if not (getattr(os.stat(p), "st_flags", 0) & DATALESS)]
if not usable:
    sys.exit("no readable source (evicted or missing): " + ", ".join(spec["from"]))
src = usable[0]
font = TTFont(src, recalcTimestamp=False)
font.flavor = None
if "fvar" in font:
    font = instancer.instantiateVariableFont(font, {"wght": spec["weight"]})
name = font["name"]
for i in (1, 2, 4, 6, 16, 17, 21, 22, 25):
    name.removeNames(nameID=i)
family, style = spec["family"], spec["style"]
full = family if style == "Regular" else family + " " + style
for i, value in ((1, family), (2, style), (4, full), (6, full.replace(" ", "-") if style != "Regular" else family.replace(" ", "") + "-Regular")):
    name.setName(value, i, 3, 1, 0x409)
    name.setName(value, i, 1, 0, 0)
os2 = font["OS/2"]
os2.usWeightClass = spec["weight"]
italic = bool(spec.get("italic"))
os2.fsSelection = (os2.fsSelection & ~0b1100001) | (0b1 if italic else 0b1000000)
font["head"].macStyle = 0b10 if italic else 0
if "post" in font:
    font["post"].italicAngle = font["post"].italicAngle if italic else 0
font.save(dst)
if os2.fsType & 0x0002:
    sys.exit("restricted-licence embedding: Word would refuse to embed " + dst)
print("  %-22s %-20s from %s" % (os.path.basename(dst), full, os.path.relpath(src)))
`;

function prepareFonts() {
  const out = join(VENDOR, "fonts");
  mkdirSync(out, { recursive: true });
  for (const f of DOCX_FONT_FILES) {
    const dst = join(out, f.file);
    const from = f.from.map((p) => (p.startsWith("vendor:") ? join(out, p.slice(7)) : join(GEIST, p)));
    try {
      execFileSync(PYTHON, ["-c", PREPARE_FONT, JSON.stringify({ ...f, from }), dst],
        { stdio: ["ignore", "inherit", "pipe"], timeout: 60_000 });
    } catch (error) {
      const why = String(error.stderr || error.message).trim().split("\n").at(-1);
      if (existsSync(dst)) { console.warn(`kept the existing ${f.file}: ${why}`); continue; }
      throw new Error(`${f.file}: ${why}\nfontTools is needed: ../.venv/bin/pip install fonttools brotli`);
    }
  }
}

/* ------------------------------------------------------------------ 3. sample highlights from real notes */

// The same records the reader saves (prototypes/reader/reader.js, saveHighlight), built from the
// verbatim bodies in data/countries/. Text offsets are into the body's text, as the reader's are;
// tags are dropped and entities decoded, which is what the browser's textContent gives here.
const ENTITY = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s) => s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e) =>
  e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITY[e] ?? m);
export const textOf = (html) => decode(html.replace(/<[^>]+>/g, ""));
const collapse = (s) => s.replace(/\s+/g, " ").trim();

const NOTES = "data/countries";
export const SAMPLE_PASSAGES = [
  { country: "iran", note: "country-policy-and-information-note-military-service-iran-august-2026-accessible", para: "9.1.1",
    comment: "Supreme Leader commands the armed forces: relevant to imputed political opinion if the appellant deserts.",
    createdAt: "2026-09-29T09:41:00Z" },
  { country: "iran", note: "country-policy-and-information-note-military-service-iran-august-2026-accessible", para: "4.2.1",
    comment: "", createdAt: "2026-09-29T09:44:00Z" },
  // Saved while v6.0 was live; v7.0 rewrote the paragraph, so this one has changed since it was saved.
  { country: "iran", note: "country-policy-and-information-note-illegal-exit-iran-may-2022-accessible", para: "2.4.5", sha: "16b5494999962447",
    comment: "Check the v7.0 wording before relying on this.", createdAt: "2025-06-10T14:05:00Z", savedWhileLive: true },
  { country: "afghanistan", note: "country-policy-and-information-note-humanitarian-situation-afghanistan-april-2026-accessible", para: "8.4.2",
    comment: "", createdAt: "2026-09-30T16:20:00Z" },
];

/** A record as the reader would save it for one numbered paragraph (its words after the number). */
export async function sampleHighlights({ passages = SAMPLE_PASSAGES } = {}) {
  const { editionSource, latestCapture, pickEdition } = await import(pathToFileURL(join(ROOT, "prototypes/shared/note-source.js")).href);
  const { MONTHS } = await import(pathToFileURL(join(ROOT, "prototypes/shared/citation.js")).href);
  const data = JSON.parse(read("prototypes/dashboard/data.json"));
  return passages.map((p, i) => {
    const dir = `${NOTES}/${p.country}/notes/${p.note}`;
    const index = JSON.parse(read(`${dir}/index.json`));
    const live = pickEdition(index);
    const edition = p.sha ? index.versions.find((v) => v.sha256.startsWith(p.sha)) : live;
    const html = read(`${dir}/${edition.sha256.slice(0, 16)}.html`);
    const c = data.countries.find((x) => x.slug === p.country);
    const n = c.notes.find((x) => x.id === p.note);

    const pm = new RegExp(`<p>${p.para.replace(/\./g, "\\.")} ([\\s\\S]*?)</p>`).exec(html);
    if (!pm) throw new Error(`${p.note}: no paragraph ${p.para}`);
    const text = textOf(html);
    const start = textOf(html.slice(0, pm.index + `<p>${p.para} `.length)).length;
    const quote = textOf(pm[1]);
    if (text.slice(start, start + quote.length) !== quote) throw new Error("offsets do not line up");
    const end = start + quote.length;
    const headings = [...html.slice(0, pm.index).matchAll(/<h([23])[^>]*>([\s\S]*?)<\/h\1>/g)];
    const sources = [...quote.matchAll(/\[footnote (\d+)\]/g)].map((m) => Number(m[1])).map((num) => {
      const li = new RegExp(`<li id="fn:${num}">([\\s\\S]*?)</li>`).exec(html)?.[1] || "";
      const body = li.replace(/<a [^>]*role="doc-backlink"[^>]*>[\s\S]*?<\/a>/g, "");
      return { n: num, text: collapse(textOf(body)) || `Footnote ${num}`, url: /<a [^>]*href="(https?:[^"]+)"/.exec(body)?.[1] || null };
    });

    const title = edition.title || index.title;
    // An older edition is dated by its own title ("…, May 2022"), as the dashboard dated it then.
    const named = edition === live ? null : /(\w+) (\d{4})\b[^,]*$/.exec(title);
    const month = named && MONTHS.includes(named[1]) ? `${named[2]}-${String(MONTHS.indexOf(named[1]) + 1).padStart(2, "0")}` : n.month;
    const src = p.savedWhileLive ? { url: n.govuk_url, archived: false, capturedAt: null } : editionSource(edition, { note: n, index });
    const rec = {
      id: `hsample${i + 1}`, country: p.country, countryName: c.name, iso: c.iso_a2 || null, note: p.note,
      title, kind: n.kind, topic: n.topic, version: edition.version_banner || null, editionSha: edition.sha256, month,
      url: src.url, archived: src.archived, capturedAt: src.capturedAt,
      quote, prefix: text.slice(Math.max(0, start - 32), start), suffix: text.slice(end, end + 32), pos: { start, end },
      para: p.para, section: headings.length ? collapse(textOf(headings.at(-1)[2])) : null, sources,
      comment: p.comment || "", check: "current", createdAt: p.createdAt,
    };
    if (edition !== live) {
      // What the saved page's staleness check records once it finds the words gone from the live edition.
      const cap = latestCapture(edition);
      Object.assign(rec, { check: "changed", current: { sha: live.sha256, version: live.version_banner || null },
        archivedCopy: cap ? { url: cap.archive_url, capturedAt: cap.captured_at } : null });
    }
    return rec;
  });
}

/* ------------------------------------------------------------------ 4. sample exports */

/** CPIN Explorer's mark (assets/cpin-explorer/mark-512.png) at 192 × 192, as the saved page scales it
 *  before export. macOS sips does the scaling; elsewhere the original is used. */
export function productMark() {
  const original = join(ROOT, "assets/cpin-explorer/mark-512.png");
  const dir = mkdtempSync(join(tmpdir(), "cpin-mark-"));
  try {
    execFileSync("sips", ["-z", "192", "192", original, "--out", join(dir, "mark.png")], { stdio: "ignore", timeout: 30_000 });
    return readBytes(join(dir, "mark.png"));
  } catch {
    return readBytes(original);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Font files, both marks and the dashboard's note details, read from disk (the browser fetches the same). */
export function docxAssets() {
  const fonts = Object.fromEntries(DOCX_FONT_FILES.map((f) => [f.file, readBytes(join(VENDOR, "fonts", f.file))]));
  const data = JSON.parse(read("prototypes/dashboard/data.json"));
  const noteInfo = (country, note) => data.countries.find((c) => c.slug === country)?.notes.find((n) => n.id === note) || null;
  return { fonts, logo: productMark(), rm: readBytes(join(ROOT, "assets/roberts-macros/derived/rm-mark-ink.png")), noteInfo };
}

async function writeSamples() {
  const out = join(ROOT, "prototypes/saved/samples");
  mkdirSync(out, { recursive: true });
  const docx = await import(pathToFileURL(join(VENDOR, "docx.js")).href);
  const { buildCitationsDocx } = await import(pathToFileURL(join(ROOT, "prototypes/shared/citations-docx.js")).href);
  const highlights = await sampleHighlights();
  const accessed = new Date(2026, 9, 2);
  writeFileSync(join(out, "sample-highlights.json"),
    JSON.stringify({ format: "cpin-highlights-v1", exported_at: "2026-10-02T12:00:00.000Z", highlights }, null, 2) + "\n");
  for (const [mode, name] of [["full", "CPIN-Explorer-citations-sample.docx"], ["citations", "CPIN-Explorer-citations-only-sample.docx"]]) {
    const bytes = await buildCitationsDocx(docx, highlights, { mode, style: "oscola", accessed, ...docxAssets(), output: "nodebuffer" });
    writeFileSync(join(out, name), bytes);
    console.log(`wrote prototypes/saved/samples/${name} (${bytes.length} bytes)`);
  }
}

/* ------------------------------------------------------------------ main */

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const version = await bundleDocx();
  console.log(`bundled docx ${version} into prototypes/vendor/docx.js`);
  prepareFonts();
  if (process.argv.includes("--samples")) await writeSamples();
}
