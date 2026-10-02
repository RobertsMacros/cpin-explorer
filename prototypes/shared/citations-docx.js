// CPIN Explorer · "Export to Word": saved highlights as a .docx in the app's look (white page, one
// electric blue, near-black text, square corners, thin rules, blue label tags with white pixel
// lettering, Geist and Geist Pixel embedded), in two forms from the same family:
//
//   full        header block, contents, then country → note → highlight: each highlight a card with
//               its quote, citation, the sources it cites, the private note and any staleness warning
//   citations   header block, contents, then country → note → a numbered list of citations
//
// Structure is Word's own: Heading 1 = country, Heading 2 = note, Heading 3 = highlight (full export),
// so the Navigation Pane shows country → note → highlight. Every heading carries a bookmark (for
// cross-references), and the contents is a real TOC field whose cached entries are internal links to
// those bookmarks: it works as soon as the file opens, and Word can still rebuild it (Update Table).
//
// No DOM: runs in the browser (prototypes/saved/saved.js) and in Node (web/build-docx.mjs and
// web/test/citations-docx.test.mjs). The docx library is passed in rather than imported, so the saved
// page loads prototypes/vendor/docx.js only when someone exports.
//
//   const bytes = await buildCitationsDocx(docx, records, { mode: "full" | "citations", style: "oscola",
//     fonts: { "Geist-Regular.ttf": Uint8Array, … }, logo: Uint8Array, flags: { iran: { data, width, height } },
//     noteInfo: (country, note) => dashboardNote, output: "blob" | "nodebuffer" | "uint8array" });
//
// Citations come from formatCitation (citation.js) and are not rewritten: its HTML (<i>, <a>) is turned
// into Word runs, so the .docx says exactly what "Copy citation" copies.
import { capFirst, cleanQuote, formatCitation, formatPinpoint, longDate, monthLabel, STYLE_NAMES } from "./citation.js";
import { citeContext, groupHighlights } from "./highlights.js";

export const APP_NAME = "CPIN Explorer";

/** COBE-site palette (prototypes/shared/theme.css, light theme) as Word hex colours. */
export const COLOURS = {
  blue: "2A3CF5", ink: "171D24", ink2: "66717C", ink3: "9AA3AD",
  line: "E4E7EB", lineStrong: "CFD4DA", sunken: "F6F7F9", white: "FFFFFF",
};

/** Families the document asks for when the fonts are embedded, and Office fonts when they are not. */
export const FONTS = { text: "Geist", strong: "Geist SemiBold", pixel: "Geist Pixel Square" };
export const FALLBACK_FONTS = { text: "Aptos", strong: "Aptos SemiBold", pixel: "Aptos Mono" };

/** TrueType files Word embeds (made by web/build-docx.mjs into prototypes/vendor/fonts/). */
export const FONT_FILES = [
  { file: "Geist-Regular.ttf", family: "Geist", face: "Regular" },
  { file: "Geist-Italic.ttf", family: "Geist", face: "Italic" },
  { file: "Geist-SemiBold.ttf", family: "Geist SemiBold", face: "Regular" },
  { file: "GeistPixel-Square.ttf", family: "Geist Pixel Square", face: "Regular" },
];
/** Both exports are set in the same four faces. */
export const fontFilesFor = () => FONT_FILES.slice();

export const EXPORT_MODES = {
  full: { label: "Highlights and citations", suffix: "citations" },
  citations: { label: "Citations only", suffix: "citations only" },
};

const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** "CPIN Explorer citations 2026-10-02.docx" / "CPIN Explorer citations only 2026-10-02.docx". */
export function docxFileName(mode = "full", when = new Date()) {
  return `${APP_NAME} ${(EXPORT_MODES[mode] || EXPORT_MODES.full).suffix} ${isoDay(when)}.docx`;
}

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const ATTRIBUTION = [
  { text: "Source: Home Office, " },
  { text: "GOV.UK", href: "https://www.gov.uk/government/collections/country-policy-and-information-notes" },
  { text: ". Contains public sector information licensed under the " },
  { text: "Open Government Licence v3.0", href: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/" },
  { text: `. ${APP_NAME} is an independent mirror, not affiliated with or endorsed by the Home Office.` },
];

/* ------------------------------------------------------------------ text helpers */

// XML 1.0 forbids most control characters; Word refuses a file that contains one.
const xmlSafe = (s) => String(s ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
  .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "�");
const collapse = (s) => xmlSafe(s).replace(/\s+/g, " ").trim();
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };
const unescapeHtml = (s) => String(s).replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (m, e) => ENTITIES[e.toLowerCase()]
  ?? (e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : m));
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const NBSP = " ";

/** formatCitation's HTML (only <i> and <a href>) as runs: [{ text, italic, href }]. */
export function htmlRuns(html) {
  const runs = [];
  let italic = false, href = null;
  for (const m of String(html ?? "").matchAll(/<(\/?)(i|a)\b(?:\s+href="([^"]*)")?[^>]*>|([^<]+)/gi)) {
    if (m[4] != null) { const text = xmlSafe(unescapeHtml(m[4])); if (text) runs.push({ text, italic, href }); }
    else if (m[2].toLowerCase() === "i") italic = !m[1];
    else href = m[1] ? null : unescapeHtml(m[3] || "") || null;
  }
  return runs;
}

/** What a highlight's Heading 3 says: "Para 9.1.1 — 9. Armed forces structure". */
export function highlightHeading(r) {
  const now = r.check === "still" && r.current ? r.current : r;
  const pin = now.para ? capFirst(formatPinpoint(now.para)) : "Passage";
  const section = now.section ? collapse(now.section) : "";
  return { pin, section, text: section ? `${pin} — ${section}` : pin };
}

/** Bookmark names Word accepts (and offers under Insert › Cross-reference): a letter first, then
 *  letters, digits and underscores, at most 40 characters, unique within the document. */
export function bookmarkNamer() {
  const used = new Set();
  return (...parts) => {
    let base = parts.filter(Boolean).join(" ").normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "Passage";
    if (!/^[A-Za-z]/.test(base)) base = `X_${base}`;
    base = base.slice(0, 40).replace(/_+$/, "");
    let name = base;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base.slice(0, 39 - String(i).length)}_${i}`;
    used.add(name.toLowerCase());
    return name;
  };
}

/* ------------------------------------------------------------------ the builder */

/**
 * Build the .docx. records: highlight records (prototypes/shared/highlights.js). Returns what
 * docx.Packer.pack gives for `output` (a Blob in the browser, a Buffer in Node by default).
 * logo: the RM mark (assets/roberts-macros/image.png, any scale: its padding is cropped here).
 */
export async function buildCitationsDocx(docx, records, {
  mode = "full", style = "oscola", accessed = new Date(), fonts = null, logo = null, flags = null,
  noteInfo = null, output = null,
} = {}) {
  const D = docx;
  const full = mode !== "citations";
  const files = fontFilesFor(mode);
  const embed = !!fonts && files.every((f) => byteLength(fonts[f.file]) > 0);
  const F = embed ? FONTS : FALLBACK_FONTS;
  const C = COLOURS;
  const styleName = STYLE_NAMES[style] || style;
  const info = (country, note) => (typeof noteInfo === "function" ? noteInfo(country, note) : null) || {};

  // The outline, with a bookmark for every country, note and highlight, before anything is drawn.
  const bookmark = bookmarkNamer();
  const CONTENTS = bookmark("Contents");
  const outline = groupHighlights(records || []).map((g) => ({
    ...g, anchor: bookmark(g.countryName),
    notes: g.notes.map((n) => {
      const heading = capFirst(n.topic || info(g.country, n.note).topic || n.title || "Note");
      return {
        ...n, heading, anchor: bookmark(g.countryName, n.topic || n.title),
        items: n.items.map((r) => ({ r, head: highlightHeading(r), anchor: bookmark(g.countryName, r.para ? `para ${r.para}` : "passage", n.topic) })),
      };
    }),
  }));
  const items = outline.flatMap((g) => g.notes.flatMap((n) => n.items));
  const nNotes = outline.reduce((k, g) => k + g.notes.length, 0);

  /* ---- run and paragraph helpers */
  const run = (text, o = {}) => new D.TextRun({ text: xmlSafe(text), ...o });
  const pixel = (text, o = {}) => run(text, { font: F.pixel, allCaps: true, characterSpacing: 14, size: 14, color: C.ink2, ...o });
  const tag = (text, o = {}) => pixel(`${NBSP}${text}${NBSP}`, { color: C.white, shading: { type: D.ShadingType.CLEAR, color: "auto", fill: C.blue }, ...o });
  const outlineTag = (text, o = {}) => pixel(`${NBSP}${text}${NBSP}`, { color: C.blue, border: { style: D.BorderStyle.SINGLE, size: 4, color: C.blue, space: 0 }, ...o });
  const link = (href, children) => new D.ExternalHyperlink({ link: href, children });
  const linkRun = (text, o = {}) => run(text, { style: "Hyperlink", ...o });
  /** Runs from [{ text, italic, href }], each link a real hyperlink. */
  const richRuns = (parts, o = {}) => {
    const { color, ...forLinks } = o;                                     // links keep the blue
    return parts.map((p) => p.href
      ? link(p.href, [linkRun(p.text, { italics: !!p.italic, ...forLinks })])
      : run(p.text, { italics: !!p.italic, ...o }));
  };
  const tab = () => new D.TextRun({ children: [new D.Tab()] });
  const spacer = (pt = 8) => new D.Paragraph({ spacing: { before: 0, after: 0, line: Math.round(pt * 20), lineRule: D.LineRuleType.EXACT }, children: [] });
  const label = (text, o = {}) => new D.Paragraph({ style: "CpinLabel", keepNext: true, ...o, children: [pixel(text)] });
  const el = (name, attrs = {}, children) => new D.BuilderElement({
    name, children,
    attributes: Object.keys(attrs).length ? Object.fromEntries(Object.entries(attrs).map(([k, v], i) => [`a${i}`, { key: k, value: v }])) : undefined,
  });
  const fieldChar = (type) => el("w:r", {}, [el("w:fldChar", { "w:fldCharType": type })]);
  const NONE = { style: D.BorderStyle.NONE, size: 0, color: "auto" };
  const RULE = { style: D.BorderStyle.SINGLE, size: 4, color: C.line };
  const noBorders = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };

  /* ---- page furniture */
  const PAGE = { width: 11906, height: 16838 };                          // A4, in twentieths of a point
  const MARGIN = { top: 1080, bottom: 1080, left: 1134, right: 1134, header: 567, footer: 482 };
  const TEXT_W = PAGE.width - MARGIN.left - MARGIN.right;                 // 9638
  const LIST_INDENT = 567;

  const footer = new D.Footer({
    children: [new D.Table({
      width: { size: TEXT_W, type: D.WidthType.DXA }, columnWidths: [TEXT_W - 2000, 2000], layout: D.TableLayoutType.FIXED,
      borders: { ...noBorders, top: RULE },
      rows: [new D.TableRow({ children: [
        new D.TableCell({
          width: { size: TEXT_W - 2000, type: D.WidthType.DXA }, margins: { top: 110, bottom: 0, left: 0, right: 240 },
          children: [new D.Paragraph({ style: "CpinFooter", children: richRuns(ATTRIBUTION, { size: 13, color: C.ink2 }) })],
        }),
        new D.TableCell({
          width: { size: 2000, type: D.WidthType.DXA }, margins: { top: 110, bottom: 0, left: 0, right: 0 },
          children: [new D.Paragraph({ style: "CpinFooter", alignment: D.AlignmentType.RIGHT, children: [
            new D.TextRun({ children: ["Page ", D.PageNumber.CURRENT, " of ", D.PageNumber.TOTAL_PAGES],
              font: F.pixel, allCaps: true, characterSpacing: 14, size: 13, color: C.ink2 }),
          ] })],
        }),
      ] })],
    })],
  });

  /* ---- header block: RM mark, CPIN EXPLORER, title, citation style (and, in full, the counts) */
  function headerBlock() {
    const cells = [];
    const widths = logo && byteLength(logo) ? [1000, 5000, TEXT_W - 6000] : [5000, TEXT_W - 5000];
    const cell = (w, children, align) => new D.TableCell({
      width: { size: w, type: D.WidthType.DXA }, verticalAlign: D.VerticalAlign.CENTER, margins: { top: 0, bottom: 90, left: 0, right: 0 },
      children: [new D.Paragraph({ alignment: align, children })],
    });
    if (widths.length === 3) {
      cells.push(cell(widths[0], [new D.ImageRun({
        type: "png", data: logo, transformation: { width: 52, height: 25 },
        crop: { left: 22, top: 21.5, right: 22.5, bottom: 38 },                // the RM mark without its padding
        altText: { name: "Roberts Macros", title: "Roberts Macros", description: "RM, the Roberts Macros mark" },
      })]));
    }
    cells.push(cell(widths.at(-2), [pixel(APP_NAME, { size: 21, color: C.ink, characterSpacing: 34 })]));
    cells.push(cell(widths.at(-1), [pixel(full ? "Saved highlights" : "Citations", { size: 14 })], D.AlignmentType.RIGHT));
    const counts = `${plural(items.length, full ? "highlight" : "citation")} · ${plural(nNotes, "note")} · ${outline.length} ${outline.length === 1 ? "country" : "countries"}`;
    const out = [
      new D.Table({
        width: { size: TEXT_W, type: D.WidthType.DXA }, columnWidths: widths, layout: D.TableLayoutType.FIXED,
        borders: { ...noBorders, bottom: RULE },
        rows: [new D.TableRow({ children: cells })],
      }),
      new D.Paragraph({ style: "CpinLabel", spacing: { before: 440, after: 100 }, children: [pixel(full ? "Country notes · your highlights" : "Country notes · your citations")] }),
      new D.Paragraph({ style: "Title", children: [run(`${full ? "Saved citations" : "Citations"} · ${longDate(accessed)}`)] }),
      new D.Paragraph({ style: "CpinBody", spacing: { before: 60, after: full ? 240 : 120 }, children: [
        tag(`${styleName} citations`), run("   "),
        run(full
          ? `Accessed ${longDate(accessed)}. Quotes are verbatim from the Home Office notes on GOV.UK; each link opens the note at the quoted words.`
          : `Accessed ${longDate(accessed)}. ${counts}. Each link opens the note at the quoted words.`, { color: C.ink2, size: 17 }),
      ] }),
    ];
    if (full) {
      const stat = (n, what) => new D.TableCell({
        width: { size: Math.floor(TEXT_W / 3), type: D.WidthType.DXA }, margins: { top: 150, bottom: 150, left: 200, right: 200 },
        children: [
          new D.Paragraph({ spacing: { after: 60 }, children: [pixel(String(n), { size: 44, color: C.blue, allCaps: false, characterSpacing: 0 })] }),
          new D.Paragraph({ children: [pixel(what, { size: 13 })] }),
        ],
      });
      out.push(new D.Table({
        width: { size: TEXT_W, type: D.WidthType.DXA }, columnWidths: [0, 1, 2].map(() => Math.floor(TEXT_W / 3)), layout: D.TableLayoutType.FIXED,
        borders: { top: RULE, bottom: RULE, left: RULE, right: RULE, insideVertical: RULE, insideHorizontal: NONE },
        rows: [new D.TableRow({ children: [
          stat(items.length, items.length === 1 ? "Highlight" : "Highlights"),
          stat(nNotes, nNotes === 1 ? "Note" : "Notes"),
          stat(outline.length, outline.length === 1 ? "Country" : "Countries"),
        ] })],
      }));
    }
    return out;
  }

  /* ---- contents: a TOC field whose cached result is the outline, each entry an internal link */
  function contents() {
    const entries = outline.flatMap((g) => [
      { level: 1, text: g.countryName, anchor: g.anchor },
      ...g.notes.flatMap((n) => [
        { level: 2, text: n.heading, anchor: n.anchor },
        ...(full ? n.items.map((x) => ({ level: 3, text: x.head.text, anchor: x.anchor })) : []),
      ]),
    ]);
    if (!entries.length) return [];
    const levels = full ? 3 : 2;
    // \o outline levels from the heading styles, \h hyperlinks, \z \u as Word writes them, \n no page
    // numbers (they cannot be known until Word lays the pages out; the links do the job).
    const instruction = el("w:r", {}, [el("w:instrText", { "xml:space": "preserve" }, [` TOC \\o "1-${levels}" \\h \\z \\u \\n `])]);
    const paragraphs = entries.map((e, i) => new D.Paragraph({ style: `TOC${e.level}`, children: [
      ...(i === 0 ? [fieldChar("begin"), instruction, fieldChar("separate")] : []),
      new D.InternalHyperlink({ anchor: e.anchor, children: [run(e.text)] }),
      ...(i === entries.length - 1 ? [fieldChar("end")] : []),
    ] }));
    return [
      new D.Paragraph({ style: "CpinLabel", spacing: { before: full ? 360 : 240, after: 100 }, border: { bottom: RULE }, children: [
        new D.Bookmark({ id: CONTENTS, children: [pixel("Contents")] }),
      ] }),
      el("w:sdt", {}, [
        el("w:sdtPr", {}, [el("w:docPartObj", {}, [el("w:docPartGallery", { "w:val": "Table of Contents" }), el("w:docPartUnique")])]),
        el("w:sdtContent", {}, paragraphs),
      ]),
      new D.Paragraph({ spacing: { before: 60, after: 0, line: 120, lineRule: D.LineRuleType.EXACT }, keepNext: false, border: { top: RULE }, children: [] }),
    ];
  }

  /* ---- a country: flag, eyebrow with a link back to the contents, Heading 1 */
  function countryHead(g, what) {
    const iso = g.notes[0]?.items[0]?.r.iso;
    const flag = flags?.[g.country] || (iso && flags?.[iso]);                // keyed by country slug or ISO code
    const eyebrow = [];
    if (flag && byteLength(flag.data)) {
      const h = 15, w = Math.round(h * (flag.width || 4) / (flag.height || 3));
      eyebrow.push(new D.ImageRun({ type: "png", data: flag.data, transformation: { width: w, height: h },
        altText: { name: `Flag of ${g.countryName}`, title: `Flag of ${g.countryName}`, description: `Flag of ${g.countryName}, drawn in dots` } }), run("  "));
    }
    eyebrow.push(pixel(what), tab(), new D.InternalHyperlink({ anchor: CONTENTS, children: [pixel("↑ Contents", { color: C.blue })] }));
    return [
      new D.Paragraph({ style: "CpinLabel", spacing: { before: full ? 520 : 400, after: 60 }, keepNext: true,
        tabStops: [{ type: D.TabStopType.RIGHT, position: TEXT_W }], children: eyebrow }),
      new D.Paragraph({ heading: D.HeadingLevel.HEADING_1, children: [new D.Bookmark({ id: g.anchor, children: [run(g.countryName)] })] }),
    ];
  }

  /** The kind tag and edition line above a note's Heading 2. */
  function noteFacts(g, n) {
    const first = n.items[0].r;
    const ni = info(g.country, n.note);
    const kind = ni.kind || first.kind || "Note";
    const version = ni.version || first.version;
    const month = monthLabel(ni.month || first.month);
    const when = [month?.short, version ? `v${version}` : ""].filter(Boolean).join(" · ");
    const gone = ni.status && ni.status !== "live";
    const url = (gone ? ni.archive_url : ni.govuk_url) || ni.govuk_url || String(first.url || "").replace(/#.*$/, "");
    return { kind, version, when, gone, status: ni.status, url, title: ni.title || n.title || first.title };
  }

  /* ---- full export: country → note → highlight cards */
  function fullBody() {
    return outline.flatMap((g) => [
      ...countryHead(g, `Country · ${items.filter((x) => x.r.country === g.country).length} saved`),
      ...g.notes.flatMap((n) => {
        const f = noteFacts(g, n);
        const meta = [];
        if (f.version) meta.push(run(`Version ${f.version}${f.gone ? (f.status === "removed" ? " · removed from GOV.UK" : " · archived copy only") : ""}`, { color: C.ink2 }));
        if (f.url) meta.push(run(meta.length ? "  ·  " : "", { color: C.ink3 }), link(f.url, [linkRun(f.url)]));
        return [
          new D.Paragraph({ spacing: { before: 360, after: 80 }, keepNext: true, children: [outlineTag(f.kind), run("  "), pixel(f.when)] }),
          new D.Paragraph({ heading: D.HeadingLevel.HEADING_2, children: [new D.Bookmark({ id: n.anchor, children: [run(n.heading)] })] }),
          new D.Paragraph({ style: "CpinVerbatim", keepNext: true, children: [run(f.title)] }),
          new D.Paragraph({ style: "CpinMeta", keepNext: true, children: meta }),
          ...n.items.flatMap((x, i) => [...(i ? [spacer(9)] : []), card(x)]),
        ];
      }),
    ]);
  }

  const citationRuns = (r) => richRuns(htmlRuns(formatCitation(citeContext(r, { accessed }), style).html));

  /** One highlight as a card (a one-cell table with a thin rule, like .sv-item), headed by Heading 3. */
  function card({ r, head, anchor }) {
    const changed = r.check === "changed";
    const sources = r.sources || [];
    const quote = cleanQuote(r.quote);
    const kids = [
      new D.Paragraph({ heading: D.HeadingLevel.HEADING_3, children: [new D.Bookmark({ id: anchor, children: [
        tag(head.pin), ...(head.section ? [run(" — "), run(head.section)] : []),
      ] })] }),
    ];
    const status = [];
    if (r.createdAt) status.push(run(`Saved ${longDate(r.createdAt)}`, { size: 14, color: C.ink2 }));
    if (r.check === "still" && r.current?.version) {
      status.push(run(`${status.length ? " · " : ""}Still in v${r.current.version}: the words are unchanged and the citation points to where they now sit.`, { size: 14, color: C.ink2 }));
    }
    if (status.length) kids.push(new D.Paragraph({ keepNext: true, spacing: { after: 140 }, children: status }));
    if (changed) {
      const from = r.version ? `v${r.version}` : "the edition you saved";
      const to = r.current?.version ? `v${r.current.version}` : "a newer edition";
      const where = r.archivedCopy?.url ? `The citation points to the archived copy of ${from}.` : "Check the current edition before relying on it.";
      kids.push(new D.Paragraph({ keepNext: true, spacing: { after: 160 }, children: [
        outlineTag("Changed since saved"), run("  "),
        run(`${from} → ${to}: these words are not in the edition now on GOV.UK. ${where}`, { size: 16, color: C.ink }),
      ] }));
    }
    kids.push(new D.Paragraph({ style: changed ? "CpinQuoteChanged" : "CpinQuote", children: [run(`“${quote}”`)] }));
    kids.push(new D.Paragraph({ style: "CpinCitation", children: citationRuns(r) }));
    if (sources.length) {
      kids.push(label(`Sources cited in this passage · ${sources.length}`, { spacing: { before: 200, after: 80 } }));
      for (const s of sources) {
        const text = collapse(s.text);
        kids.push(new D.Paragraph({ style: "CpinSource", tabStops: [{ type: D.TabStopType.LEFT, position: 454 }], children: [
          run(`[${s.n}]`, { color: C.blue }), tab(), ...(s.url ? [link(s.url, [linkRun(text)])] : [run(text)]),
        ] }));
      }
    }
    if (r.comment && r.comment.trim()) {
      kids.push(label("Private note", { spacing: { before: 200, after: 60 } }));
      const lines = xmlSafe(r.comment).replace(/\r\n?/g, "\n").trim().split("\n");
      kids.push(new D.Paragraph({ style: "CpinBody", children: lines.map((l, i) => run(l, { break: i ? 1 : 0 })) }));
    }
    const line = { ...RULE, color: changed ? C.lineStrong : C.line };
    const short = quote.length < 700 && sources.length <= 3 && (r.comment || "").length < 400;
    return new D.Table({
      width: { size: TEXT_W, type: D.WidthType.DXA }, columnWidths: [TEXT_W], layout: D.TableLayoutType.FIXED,
      borders: { top: line, bottom: line, left: line, right: line, insideHorizontal: NONE, insideVertical: NONE },
      rows: [new D.TableRow({ cantSplit: short, children: [new D.TableCell({
        width: { size: TEXT_W, type: D.WidthType.DXA }, margins: { top: 200, bottom: 220, left: 220, right: 220 },
        shading: changed ? { type: D.ShadingType.CLEAR, color: "auto", fill: C.sunken } : undefined,
        children: kids,
      })] })],
    });
  }

  /* ---- citations only: country → note → numbered citations, each under its paragraph tag */
  function citationsBody() {
    return outline.flatMap((g) => [
      ...countryHead(g, `Country · ${plural(items.filter((x) => x.r.country === g.country).length, "citation")}`),
      ...g.notes.flatMap((n) => {
        const f = noteFacts(g, n);
        return [
          new D.Paragraph({ heading: D.HeadingLevel.HEADING_2, spacing: { before: 280, after: 40 }, children: [new D.Bookmark({ id: n.anchor, children: [run(n.heading)] })] }),
          new D.Paragraph({ style: "CpinMeta", keepNext: true, spacing: { after: 60 }, children: [outlineTag(f.kind), run("  "), pixel(f.when)] }),
          ...n.items.flatMap((x) => [
            new D.Paragraph({ style: "CpinLabel", keepNext: true, indent: { left: LIST_INDENT }, spacing: { before: 140, after: 50 }, children: [
              new D.Bookmark({ id: x.anchor, children: [tag(x.head.pin), ...(x.head.section ? [run("  "), pixel(x.head.section, { size: 13 })] : [])] }),
              ...(x.r.check === "changed" ? [run("  "), outlineTag("Changed since saved", { size: 13 })] : []),
            ] }),
            new D.Paragraph({ style: "CpinListCitation", numbering: { reference: "cpin-citations", level: 0 }, children: citationRuns(x.r) }),
          ]),
        ];
      }),
    ]);
  }

  const children = [...headerBlock(), ...contents(), ...(full ? fullBody() : citationsBody())];
  if (!items.length) children.push(new D.Paragraph({ style: "CpinBody", spacing: { before: 240 }, children: [run("No highlights saved yet.", { color: C.ink2 })] }));

  /* ---- styles: the theme's tokens as Word styles (Heading 1–3 and TOC 1–3 are Word's own, restyled) */
  const LANG = { value: "en-GB" };
  const box = (color, space) => ["top", "bottom", "left", "right"].reduce((b, k) => ({ ...b, [k]: { style: D.BorderStyle.SINGLE, size: 4, color, space } }), {});
  const styles = {
    default: {
      document: {
        run: { font: F.text, size: 19, color: C.ink, language: LANG },
        paragraph: { spacing: { before: 0, after: 0, line: 300, lineRule: D.LineRuleType.AUTO } },
      },
      title: { run: { font: F.pixel, size: 44, color: C.blue, allCaps: true, characterSpacing: 20 }, paragraph: { spacing: { before: 0, after: 120, line: 240 } } },
      heading1: { run: { font: F.pixel, size: full ? 40 : 34, color: C.blue, allCaps: true, characterSpacing: 24, bold: false },
        paragraph: { keepNext: true, outlineLevel: 0, spacing: { before: 0, after: 120, line: 240 }, border: { bottom: { style: D.BorderStyle.SINGLE, size: 6, color: C.blue, space: 8 } } } },
      heading2: { run: { font: F.strong, size: full ? 27 : 24, color: C.ink, bold: false },
        paragraph: { keepNext: true, outlineLevel: 1, spacing: { before: 0, after: 60, line: 276 } } },
      heading3: { run: { font: F.pixel, size: 14, color: C.ink2, allCaps: true, characterSpacing: 14, bold: false },
        paragraph: { keepNext: true, outlineLevel: 2, spacing: { before: 0, after: 80, line: 276 } } },
      hyperlink: { run: { color: C.blue, underline: { type: D.UnderlineType.NONE } } },
    },
    paragraphStyles: [
      { id: "TOC1", name: "toc 1", basedOn: "Normal", next: "Normal", uiPriority: 39,
        run: { font: F.pixel, size: 15, color: C.blue, allCaps: true, characterSpacing: 14 }, paragraph: { spacing: { before: 150, after: 50 } } },
      { id: "TOC2", name: "toc 2", basedOn: "Normal", next: "Normal", uiPriority: 39,
        run: { size: 18, color: C.ink }, paragraph: { indent: { left: 284 }, spacing: { after: 30, line: 264 } } },
      { id: "TOC3", name: "toc 3", basedOn: "Normal", next: "Normal", uiPriority: 39,
        run: { size: 15, color: C.ink2 }, paragraph: { indent: { left: 568 }, spacing: { after: 20, line: 252 } } },
      { id: "CpinBody", name: "CPIN body", basedOn: "Normal", run: { size: 19 }, paragraph: { spacing: { line: 300 } } },
      { id: "CpinLabel", name: "CPIN label", basedOn: "Normal", run: { font: F.pixel, size: 14, color: C.ink2 }, paragraph: { keepNext: true } },
      { id: "CpinVerbatim", name: "CPIN GOV.UK title", basedOn: "Normal", run: { size: 15, color: C.ink2 }, paragraph: { spacing: { after: 40, line: 264 } } },
      { id: "CpinMeta", name: "CPIN note details", basedOn: "Normal", run: { size: 15, color: C.ink2 }, paragraph: { spacing: { after: 200, line: 264 } } },
      { id: "CpinQuote", name: "CPIN quote", basedOn: "Normal", run: { size: 21, color: C.ink },
        paragraph: { indent: { left: 240 }, spacing: { after: 200, line: 336 }, border: { left: { style: D.BorderStyle.SINGLE, size: 12, color: C.blue, space: 10 } } } },
      { id: "CpinQuoteChanged", name: "CPIN quote (changed)", basedOn: "CpinQuote", run: { color: C.ink2 },
        paragraph: { border: { left: { style: D.BorderStyle.SINGLE, size: 12, color: C.lineStrong, space: 10 } } } },
      { id: "CpinCitation", name: "CPIN citation", basedOn: "Normal", run: { size: 16, color: C.ink },
        paragraph: { indent: { left: 100, right: 100 }, spacing: { before: 0, after: 0, line: 276 },
          shading: { type: D.ShadingType.CLEAR, color: "auto", fill: C.sunken }, border: box(C.line, 5) } },
      { id: "CpinSource", name: "CPIN source", basedOn: "Normal", run: { size: 15, color: C.ink2 },
        paragraph: { indent: { left: 454, hanging: 454 }, spacing: { after: 60, line: 264 } } },
      { id: "CpinFooter", name: "CPIN footer", basedOn: "Normal", run: { size: 13, color: C.ink2 }, paragraph: { spacing: { line: 252 } } },
      { id: "CpinListCitation", name: "CPIN listed citation", basedOn: "Normal", run: { size: 18, color: C.ink }, paragraph: { spacing: { after: 60, line: 288 } } },
    ],
  };

  const numbering = { config: [{ reference: "cpin-citations", levels: [{
    level: 0, format: D.LevelFormat.DECIMAL, text: "%1.", alignment: D.AlignmentType.LEFT,
    style: { paragraph: { indent: { left: LIST_INDENT, hanging: LIST_INDENT } }, run: { font: F.pixel, color: C.blue, size: 16 } },
  }] }] };

  const fontOptions = embed ? files.map((f) => ({ name: f.family, data: toBytes(fonts[f.file]) })) : [];
  const doc = new D.Document({
    creator: APP_NAME, lastModifiedBy: APP_NAME,
    title: full ? `${APP_NAME} citations` : `${APP_NAME} citations only`,
    subject: "Passages saved from Home Office country policy and information notes",
    description: `${plural(items.length, full ? "highlight" : "citation")}, ${styleName} citations, exported ${longDate(accessed)}. Source: Home Office, GOV.UK (Open Government Licence v3.0).`,
    keywords: "CPIN, Home Office, country policy and information notes, citations",
    features: { updateFields: false },
    fonts: fontOptions,
    styles,
    numbering,
    sections: [{ properties: { page: { size: PAGE, margin: MARGIN } }, footers: { default: footer }, children }],
  });

  // docx gives every embedded file its own <w:font> as a regular face; Word wants one entry per family
  // with its faces (regular, italic), and embedTrueTypeFonts so the fonts survive a save in Word.
  const overrides = [];
  const keyed = doc.FontTable?.fontOptionsWithKey;
  if (embed && keyed?.length === files.length) {
    overrides.push({ path: "word/fontTable.xml", data: fontTableXml(files, keyed) }, { path: "word/settings.xml", data: SETTINGS_XML });
  }
  const type = output || (typeof Blob === "function" && typeof window === "object" ? "blob" : "nodebuffer");
  return D.Packer.pack(doc, type, false, overrides);
}

/* ------------------------------------------------------------------ package parts */

function byteLength(x) {
  if (!x) return 0;
  return x.byteLength ?? x.length ?? 0;
}
function toBytes(x) {
  if (x instanceof Uint8Array) return x;
  if (x instanceof ArrayBuffer) return new Uint8Array(x);
  if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
  return x;
}

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const escAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** word/fontTable.xml: one <w:font> per family, its faces pointing at word/fonts/font<i>.odttf. */
export function fontTableXml(files, keyed) {
  const families = new Map();
  files.forEach((f, i) => {
    if (!families.has(f.family)) families.set(f.family, {});
    families.get(f.family)[f.face] = { id: `rId${i + 1}`, key: `{${String(keyed[i].fontKey).toUpperCase()}}` };
  });
  const ORDER = [["Regular", "embedRegular"], ["Bold", "embedBold"], ["Italic", "embedItalic"], ["BoldItalic", "embedBoldItalic"]];
  const body = [...families].map(([family, faces]) =>
    `<w:font w:name="${escAttr(family)}"><w:charset w:val="00"/><w:family w:val="swiss"/><w:pitch w:val="variable"/>${
      ORDER.filter(([face]) => faces[face]).map(([face, tagName]) => `<w:${tagName} r:id="${faces[face].id}" w:fontKey="${faces[face].key}"/>`).join("")}</w:font>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:fonts ${W_NS}>${body}</w:fonts>`;
}

// docx's own settings (background shape, compatibility mode 15) plus embedTrueTypeFonts, in schema order.
// No updateFields: the contents is already filled in, so Word has nothing to ask about on opening.
const SETTINGS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:settings ${W_NS}>` +
  `<w:displayBackgroundShape/><w:embedTrueTypeFonts/><w:defaultTabStop w:val="720"/>` +
  `<w:characterSpacingControl w:val="doNotCompress"/>` +
  `<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>` +
  `<w:themeFontLang w:val="en-GB"/></w:settings>`;
