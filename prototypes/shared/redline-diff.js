/* CPIN Explorer · redline diff engine.
   Compares two verbatim GOV.UK "govspeak" note bodies and emits a redline.
   ES module, no dependencies, no DOM: runs in a browser, in a module Web Worker and in Node.

   Pipeline
     1. parseHTML       a small, forgiving HTML parser (govspeak is well formed).
     2. prepareBody     leaf blocks (p, li, h1–h6, table rows, figures, footnote items, loose text)
                        with their container chain, normalised text and a word bag.
     3. seqDiff         block alignment over normalised text: common prefix/suffix, unique-line
                        (patience) anchors, LCS dynamic programming inside the gaps.
     4. pairGap         unmatched removed/added blocks that are similar (word Dice >= 0.5) become
                        "modified" pairs (order preserving, best total similarity).
        groupGap        reworked list items (split, merged, gaining or losing inner <p>s, text moved
                        into or out of a sub-list): one block matching a run of blocks on the other
                        side becomes one change, compared as a unit (diffGroup).
     5. diffTokens      word-level diff inside modified blocks, keeping inline markup (links,
                        footnote references, bold/italic) so links stay clickable.
     6. render          inline redline HTML (chunked for content-visibility) and side-by-side rows,
                        plus change records, a contents list with per-section counts and totals.
                        The inline view follows the new edition's structure: deleted words take the
                        paragraph of the new words beside them, and removed list items are placed
                        inside the new lists around them (placeDel), so lists are not torn apart.

   The source text is never altered. Normalisation (whitespace, curly quotes, footnote and
   paragraph renumbering, attributes) only decides what counts as "the same"; what is shown is
   always the edition's own text. Image sources are rewritten through `opts.images` at render
   time only. */

/* ------------------------------------------------------------------ HTML parsing */

const ENT = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„',
  hellip: '…', bull: '•', middot: '·', copy: '©', reg: '®', trade: '™',
  pound: '£', euro: '€', shy: '­', times: '×', divide: '÷', deg: '°',
  sect: '§', para: '¶', laquo: '«', raquo: '»', thinsp: ' ', ensp: ' ',
  emsp: ' ', zwnj: '‌', zwj: '‍', lrm: '‎', rlm: '‏', minus: '−',
  frac12: '½', frac14: '¼', frac34: '¾', eacute: 'é', egrave: 'è',
  aacute: 'á', agrave: 'à', iacute: 'í', oacute: 'ó', uacute: 'ú',
  uuml: 'ü', ouml: 'ö', auml: 'ä', ccedil: 'ç', ntilde: 'ñ'
};
const hasOwn = Object.prototype.hasOwnProperty;

export function decodeEntities(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : m;
    }
    return hasOwn.call(ENT, e) ? ENT[e] : m; // unknown names stay literal, as a browser shows them
  });
}
export const escText = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const escAttr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAWTEXT = new Set(['script', 'style', 'textarea', 'title']);
const CLOSES_P = new Set(['address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'fieldset', 'figcaption', 'figure',
  'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul']);
const P_SCOPE = ['div', 'li', 'td', 'th', 'blockquote', 'table', 'ul', 'ol', 'figure', 'section', 'article', 'dd', 'dt', '#root'];

const ATTR_RE = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
function parseAttrs(s) {
  const out = [];
  if (!s) return out;
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(s))) {
    const v = m[2] != null ? m[2] : m[3] != null ? m[3] : m[4] != null ? m[4] : null;
    out.push([m[1].toLowerCase(), v == null ? null : decodeEntities(v)]);
  }
  return out;
}

/** Parse HTML into a light tree: elements {t:1, tag, attrs:[[name,value]], kids} and text {t:3, v}. */
export function parseHTML(html) {
  html = String(html || '');
  const root = { t: 1, tag: '#root', attrs: [], kids: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\?[^>]*>|<\/([a-zA-Z][^\s\/>]*)[^>]*>|<([a-zA-Z][^\s\/>]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let last = 0, m;
  const top = () => stack[stack.length - 1];
  const text = s => {
    if (!s) return;
    const kids = top().kids, prev = kids[kids.length - 1], v = decodeEntities(s);
    if (prev && prev.t === 3) prev.v += v; else kids.push({ t: 3, v });
  };
  const closeTag = tag => { for (let k = stack.length - 1; k > 0; k--) if (stack[k].tag === tag) { stack.length = k; return; } };
  const closeIfOpen = (tag, boundary) => {
    for (let k = stack.length - 1; k > 0; k--) {
      const t = stack[k].tag;
      if (t === tag) { stack.length = k; return; }
      if (boundary.includes(t)) return;
    }
  };
  while ((m = re.exec(html))) {
    if (m.index > last) text(html.slice(last, m.index));
    last = re.lastIndex;
    if (m[1]) { closeTag(m[1].toLowerCase()); continue; }
    if (!m[2]) continue; // comment, doctype, processing instruction
    const tag = m[2].toLowerCase();
    let rest = m[3] || '';
    const selfClose = /\/\s*$/.test(rest);
    if (selfClose) rest = rest.replace(/\/\s*$/, '');
    if (CLOSES_P.has(tag)) closeIfOpen('p', P_SCOPE);
    if (tag === 'li') closeIfOpen('li', ['ul', 'ol']);
    else if (tag === 'dt' || tag === 'dd') { closeIfOpen('dt', ['dl']); closeIfOpen('dd', ['dl']); }
    else if (tag === 'tr') closeIfOpen('tr', ['table', 'thead', 'tbody', 'tfoot']);
    else if (tag === 'td' || tag === 'th') { closeIfOpen('td', ['tr', 'table']); closeIfOpen('th', ['tr', 'table']); }
    else if (tag === 'thead' || tag === 'tbody' || tag === 'tfoot') { for (const t of ['thead', 'tbody', 'tfoot']) closeIfOpen(t, ['table']); }
    const el = { t: 1, tag, attrs: parseAttrs(rest), kids: [] };
    top().kids.push(el);
    if (VOID.has(tag) || selfClose) continue;
    if (RAWTEXT.has(tag)) {
      const endRe = new RegExp('</' + tag + '\\s*>', 'ig');
      endRe.lastIndex = last;
      const em = endRe.exec(html), end = em ? em.index : html.length;
      if (end > last) el.kids.push({ t: 3, v: html.slice(last, end) });
      last = re.lastIndex = em ? endRe.lastIndex : html.length;
      continue;
    }
    stack.push(el);
  }
  if (last < html.length) text(html.slice(last));
  return root;
}

export const getAttr = (el, name) => { if (el && el.attrs) for (const [n, v] of el.attrs) if (n === name) return v; return null; };
const hasClass = (el, c) => (' ' + (getAttr(el, 'class') || '') + ' ').replace(/\s+/g, ' ').includes(' ' + c + ' ');

/* ------------------------------------------------------------------ Normalisation */

/** Text normalisation used only to decide sameness: quotes, hyphens, invisible characters, whitespace. */
export function normText(s) {
  return String(s)
    .replace(/[‘’‚‛′`´]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐‑‒]/g, '-')
    .replace(/[­​‌‍⁠﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
const normHref = h => decodeURI_safe(String(h || '').trim()).replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
function decodeURI_safe(s) { try { return decodeURI(s); } catch (e) { return s; } }
// Images are identified by file name: GOV.UK moved assets from /government/uploads/… to /media/<id>/…
// without changing the file, so the full URL is not a reliable identity.
const normSrc = s => { const p = String(s || '').trim().split(/[?#]/)[0].split('/'); return decodeURI_safe(p[p.length - 1] || '').toLowerCase(); };
const isNoteRef = el => {
  if (!el || el.tag !== 'a') return false;
  const role = getAttr(el, 'role') || '', rel = getAttr(el, 'rel') || '', href = getAttr(el, 'href') || '';
  return role === 'doc-noteref' || /\bfootnote\b/.test(rel) || /^#fn[:\-_]?\d/i.test(href);
};
const isAutoNumber = el => el.tag === 'span' && hasClass(el, 'number');
const textOf = n => n.t === 3 ? n.v : n.kids.map(textOf).join('');
const isExternal = href => /^(https?:|mailto:|\/\/)/i.test(String(href || '').trim());

/* ------------------------------------------------------------------ Blocks */

const BLOCK = new Set(['address', 'article', 'aside', 'blockquote', 'caption', 'dd', 'details', 'dialog', 'div', 'dl', 'dt', 'fieldset',
  'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'li', 'main', 'nav', 'ol', 'p',
  'pre', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul']);
const ALWAYS_LEAF = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'figure', 'pre', 'hr', 'caption', 'summary']);
const ALWAYS_CONTAINER = new Set(['ul', 'ol', 'dl', 'table', 'thead', 'tbody', 'tfoot']);
const INDENT = { ul: 1.4, ol: 1.4, blockquote: 1.325, dd: 1.4 }; // rem; must match the page CSS
const BOXED = ['application-notice', 'call-to-action', 'address', 'help-notice'];   // padded boxes (0.9rem + 1px)
const indentOf = c => INDENT[c.tag] || (c.tag === 'div' && BOXED.some(k => hasClass(c, k)) ? 0.96 : 0);

function isLeaf(el) {
  if (ALWAYS_LEAF.has(el.tag)) return true;
  if (ALWAYS_CONTAINER.has(el.tag)) return false;
  // li, div, blockquote, td, dd, section…: a leaf unless it holds block content
  // (an li with a single <p> is still one leaf, so "<li>x</li>" and "<li><p>x</p></li>" align).
  let blocks = 0, onlyOneP = true;
  const scan = (n, depth) => {
    for (const k of n.kids) {
      if (k.t !== 1) continue;
      if (BLOCK.has(k.tag)) { blocks++; if (k.tag !== 'p' || depth > 0) onlyOneP = false; }
      if (blocks > 1) return;
      scan(k, depth + 1);
    }
  };
  scan(el, 0);
  return blocks === 0 || (el.tag === 'li' && blocks === 1 && onlyOneP);
}
const hasContent = n => n.t === 3 ? /\S/.test(n.v) : (n.tag === 'img' || n.tag === 'hr' || n.kids.some(hasContent));

function findGovspeak(n) {
  if (n.t !== 1) return null;
  if (n.tag !== '#root' && hasClass(n, 'govspeak')) return n;
  for (const k of n.kids) { const f = findGovspeak(k); if (f) return f; }
  return null;
}

function interner() { const m = new Map(); return s => { let v = m.get(s); if (v === undefined) m.set(s, (v = m.size)); return v; }; }
const WORD_RE = /[\p{L}\p{N}]+/gu;
const LEAD_NUM_P = /^(\d+(?:\.\d+)+)(?=\s|$)/;          // 10.5.14
const LEAD_NUM_H = /^(\d+(?:\.\d+)*)\.?(?=\s|$)/;       // 1.  /  1.1

/** Parse a body and split it into leaf blocks. The result can be reused across comparisons. */
export function prepareBody(html, shared) {
  const t0 = now();
  const root = parseHTML(html);
  const start = findGovspeak(root) || root;
  const words = (shared && shared.words) || interner();
  if (shared && !shared.words) shared.words = words;
  const blocks = [];
  let uid = 0;
  const walk = (node, path) => {
    let run = [], liIndex = 0;
    const isOl = node.tag === 'ol', olStart = isOl ? (parseInt(getAttr(node, 'start'), 10) || 1) : 1;
    // Each container remembers its first leaf (a list item's own text, its "head"), so the renderer can tell
    // a container opened for its own content from one reopened only to hold nested content.
    const add = blk => { blocks.push(blk); for (const c of path) if (!c.first) c.first = blk; };
    const flush = () => { if (run.length && run.some(hasContent)) add(makeLeaf(null, run, path, 0)); run = []; };
    for (const k of node.kids) {
      if (k.t === 3 || !BLOCK.has(k.tag)) { run.push(k); continue; }
      flush();
      let ord = 0;
      if (k.tag === 'li') ord = isOl ? olStart + liIndex++ : ++liIndex;
      if (isLeaf(k)) add(makeLeaf(k, k.kids, path, isOl ? ord : 0));
      else walk(k, path.concat({ tag: k.tag, attrs: k.attrs, uid: ++uid, ord: isOl ? ord : 0, first: null }));
    }
    flush();
  };
  const makeLeaf = (el, kids, path, ord) => {
    const tag = el ? el.tag : '';
    const kind = /^h[1-6]$/.test(tag) ? 'h' : tag === 'tr' ? 'tr' : tag === 'figure' ? 'fig' : tag === 'hr' ? 'hr' : 't';
    let plain = '', keyText = '';
    const hrefs = [], imgs = [];
    const txt = (nodes, noteref) => {
      for (const n of nodes) {
        if (n.t === 3) { plain += n.v; keyText += noteref ? n.v.replace(/\d+/g, '#') : n.v; continue; }
        if (n.tag === 'br') { plain += ' '; keyText += ' '; continue; }
        if (n.tag === 'img') { const f = normSrc(getAttr(n, 'src')); imgs.push(f.replace(/^s\d+_/, '')); keyText += ' \u0001img:' + f + ' '; continue; }
        if (n.tag === 'td' || n.tag === 'th') { plain += ' '; keyText += ' \u0003 '; }
        if (isAutoNumber(n)) { plain += textOf(n); keyText += ' '; continue; } // GOV.UK heading auto-numbering
        let nr = noteref;
        if (n.tag === 'a') {
          if (isNoteRef(n)) nr = true;
          else { const h = getAttr(n, 'href'); if (h && isExternal(h)) hrefs.push(normHref(h)); }
        }
        txt(n.kids, nr);
        if (BLOCK.has(n.tag)) { plain += ' '; keyText += ' '; }
      }
    };
    txt(kids, false);
    plain = plain.replace(/\s+/g, ' ').trim();
    const full = normText(keyText);
    const numRe = kind === 'h' ? LEAD_NUM_H : kind === 't' && tag !== 'li' ? LEAD_NUM_P : null;
    const nm = numRe && full.match(numRe);
    const num = nm ? nm[1] : '';
    const body = nm ? full.slice(nm[0].length).trim() : full;
    const bag = [];
    for (const w of body.toLowerCase().match(WORD_RE) || []) bag.push(words(w));
    bag.sort((x, y) => x - y);
    const ind = Math.round(path.reduce((s, c) => s + indentOf(c), 0) * 1000) / 1000;
    const inNotes = path.some(c => hasClass(c, 'footnotes'));
    return {
      el, kids, tag, kind, path, ord, plain, full, num, key: kind + '\u0002' + body, hrefSig: hrefs.join('\u0001'),
      bag: Int32Array.from(bag), imgs, ind, inNotes, level: kind === 'h' ? +tag[1] : 0, id: el ? getAttr(el, 'id') : null
    };
  };
  walk(start, []);
  return { blocks, ms: now() - t0, words };
}

/* ------------------------------------------------------------------ Sequence diff */

const DP_SMALL = 2.5e5;  // plain LCS below this many cells; above it, unique-line anchors first
const DP_LIMIT = 6e6;   // largest anchor-free gap solved exactly; beyond it, the gap is reported as replaced
/** Diff two integer sequences. Returns [op, i, j] with op 'eq' | 'del' | 'ins', in order. */
export function seqDiff(a, b) {
  const ops = [];
  const rec = (a0, a1, b0, b1) => {
    let s = 0;
    while (a0 + s < a1 && b0 + s < b1 && a[a0 + s] === b[b0 + s]) s++;
    let e = 0;
    while (a1 - e > a0 + s && b1 - e > b0 + s && a[a1 - 1 - e] === b[b1 - 1 - e]) e++;
    for (let k = 0; k < s; k++) ops.push(['eq', a0 + k, b0 + k]);
    const x0 = a0 + s, x1 = a1 - e, y0 = b0 + s, y1 = b1 - e, n = x1 - x0, m = y1 - y0;
    if (!n || !m) {
      for (let i = x0; i < x1; i++) ops.push(['del', i, -1]);
      for (let j = y0; j < y1; j++) ops.push(['ins', -1, j]);
    } else if (n * m <= DP_SMALL) {
      dp(x0, x1, y0, y1);
    } else {
      const anchors = patience(x0, x1, y0, y1);
      if (!anchors.length && n * m <= DP_LIMIT) dp(x0, x1, y0, y1);
      else if (!anchors.length) {
        for (let i = x0; i < x1; i++) ops.push(['del', i, -1]);
        for (let j = y0; j < y1; j++) ops.push(['ins', -1, j]);
      } else {
        let pi = x0, pj = y0;
        for (const [i, j] of anchors) { rec(pi, i, pj, j); ops.push(['eq', i, j]); pi = i + 1; pj = j + 1; }
        rec(pi, x1, pj, y1);
      }
    }
    for (let k = 0; k < e; k++) ops.push(['eq', a1 - e + k, b1 - e + k]);
  };
  const dp = (x0, x1, y0, y1) => {
    const n = x1 - x0, m = y1 - y0, W = m + 1;
    const L = Math.min(n, m) < 65535 ? new Uint16Array((n + 1) * W) : new Uint32Array((n + 1) * W);
    for (let i = n - 1; i >= 0; i--) {
      const ai = a[x0 + i], row = i * W, nrow = row + W;
      for (let j = m - 1; j >= 0; j--) {
        L[row + j] = ai === b[y0 + j] ? L[nrow + j + 1] + 1 : (L[nrow + j] >= L[row + j + 1] ? L[nrow + j] : L[row + j + 1]);
      }
    }
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[x0 + i] === b[y0 + j]) { ops.push(['eq', x0 + i, y0 + j]); i++; j++; }
      else if (L[(i + 1) * W + j] >= L[i * W + j + 1]) { ops.push(['del', x0 + i, -1]); i++; }
      else { ops.push(['ins', -1, y0 + j]); j++; }
    }
    while (i < n) ops.push(['del', x0 + i++, -1]);
    while (j < m) ops.push(['ins', -1, y0 + j++]);
  };
  // Patience anchors: values unique on both sides, longest increasing run of positions.
  const patience = (x0, x1, y0, y1) => {
    const ca = new Map(), cb = new Map();
    for (let i = x0; i < x1; i++) { const v = a[i], c = ca.get(v); ca.set(v, c ? [c[0] + 1, i] : [1, i]); }
    for (let j = y0; j < y1; j++) { const v = b[j], c = cb.get(v); cb.set(v, c ? [c[0] + 1, j] : [1, j]); }
    const pairs = [];
    for (const [v, [c, i]] of ca) { if (c !== 1) continue; const d = cb.get(v); if (d && d[0] === 1) pairs.push([i, d[1]]); }
    pairs.sort((p, q) => p[0] - q[0]);
    const tails = [], prev = new Int32Array(pairs.length).fill(-1), tailIdx = [];
    for (let k = 0; k < pairs.length; k++) {
      const y = pairs[k][1];
      let lo = 0, hi = tails.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (tails[mid] < y) lo = mid + 1; else hi = mid; }
      tails[lo] = y; tailIdx[lo] = k; prev[k] = lo ? tailIdx[lo - 1] : -1;
    }
    const out = [];
    for (let k = tailIdx[tails.length - 1]; k != null && k >= 0; k = prev[k]) out.push(pairs[k]);
    return out.reverse();
  };
  rec(0, a.length, 0, b.length);
  return ops;
}

/* ------------------------------------------------------------------ Pairing removed/added blocks */

function dice(x, y) {
  const nx = x.length, ny = y.length;
  if (!nx && !ny) return 1;
  if (!nx || !ny) return 0;
  let i = 0, j = 0, c = 0;
  while (i < nx && j < ny) { if (x[i] === y[j]) { c++; i++; j++; } else if (x[i] < y[j]) i++; else j++; }
  return (2 * c) / (nx + ny);
}
const compatible = (p, q) => p.kind === q.kind;

/** Order-preserving pairing of removed (D) and added (I) blocks, maximising total similarity. */
export function pairGap(D, I, threshold = 0.5) {
  const n = D.length, m = I.length;
  if (!n || !m) return [...D.map(d => [d, null]), ...I.map(x => [null, x])];
  const W = m + 1, S = new Float32Array((n + 1) * W), band = n * m > 1.2e6 ? 400 : Infinity;
  const sim = new Float32Array(n * m);
  for (let i = 0; i < n; i++) {
    const di = D[i], la = di.bag.length, center = (i * m) / n;
    for (let j = 0; j < m; j++) {
      if (Math.abs(j - center) > band) continue;
      const ij = I[j];
      if (!compatible(di, ij)) continue;
      const lb = ij.bag.length;
      if (di.kind !== 'fig' && la + lb && (2 * Math.min(la, lb)) / (la + lb) < threshold) continue; // bound: cannot reach threshold
      let s = dice(di.bag, ij.bag);
      if (!la && !lb) s = di.full === ij.full ? 1 : di.kind !== 't' ? 0.6 : 0;
      // Figures in the same place pair up ("figure changed"); the same image file pairs strongly.
      if (di.kind === 'fig') s = Math.max(s, di.imgs.some(f => ij.imgs.includes(f)) ? 0.9 : 0.55);
      if (s >= threshold) sim[i * m + j] = s;
    }
  }
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    const s = sim[i * m + j];
    let best = Math.max(S[(i + 1) * W + j], S[i * W + j + 1]);
    if (s > 0) best = Math.max(best, S[(i + 1) * W + j + 1] + s);
    S[i * W + j] = best;
  }
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    const s = sim[i * m + j];
    if (s > 0 && Math.abs(S[i * W + j] - (S[(i + 1) * W + j + 1] + s)) < 1e-6) { out.push([D[i], I[j]]); i++; j++; }
    else if (S[(i + 1) * W + j] >= S[i * W + j + 1]) { out.push([D[i], null]); i++; }
    else { out.push([null, I[j]]); j++; }
  }
  while (i < n) out.push([D[i++], null]);
  while (j < m) out.push([null, I[j++]]);
  return out;
}

/* ------------------------------------------------------------------ Word-level diff with inline markup */

const TOK = /[\p{L}\p{N}’'‐‑\-.]*[\p{L}\p{N}]|\s+|[^\s]/gu;
const SEM = { a: 'a', strong: 'b', b: 'b', em: 'i', i: 'i', sup: 'sup', sub: 'sub', code: 'code', u: 'u', s: 's', del: 's', ins: 'u', mark: 'mark', abbr: 'abbr', q: 'q', cite: 'cite', small: 'small' };
const isWS = s => /^\s+$/.test(s);
const isWordTok = s => /[\p{L}\p{N}]/u.test(s);

function tokenize(kids, side) {
  const raw = [];
  const walk = (nodes, ctx, noteref) => {
    for (const n of nodes) {
      if (n.t === 3) { for (const p of n.v.match(TOK) || []) raw.push({ text: p, ctx, noteref, ws: isWS(p), autonum: ctx.autonum }); continue; }
      if (n.tag === 'br' || n.tag === 'wbr') { raw.push({ text: '', atom: n, ctx, ws: true }); continue; }
      if (VOID.has(n.tag)) { raw.push({ text: '', atom: n, ctx, vis: true, akey: '\u0001' + n.tag + ':' + normSrc(getAttr(n, 'src')) }); continue; }
      const w = { tag: n.tag, attrs: n.attrs, href: n.tag === 'a' ? getAttr(n, 'href') : null, noteref: isNoteRef(n), old: side === 'a' };
      const ctx2 = ctx.concat(w), before = raw.length;
      if (ctx.autonum || isAutoNumber(n)) ctx2.autonum = true;
      if (n.tag === 'td' || n.tag === 'th') raw.push({ text: '', ctx: ctx2, marker: true, akey: '\u0003' + n.tag });
      walk(n.kids, ctx2, noteref || w.noteref);
      if (raw.length === before) raw.push({ text: '', ctx: ctx2, marker: true, akey: '\u0004' + n.tag });
    }
  };
  walk(kids, [], false);
  // Whitespace (and <br>) is never diffed: it rides along with the token that follows it.
  const toks = [];
  let pre = [];
  for (const t of raw) {
    if (t.ws) { pre.push(t); continue; }
    const sem = t.ctx.map(w => SEM[w.tag] || '').filter(Boolean).join('>');
    const txt = t.akey || (t.noteref ? normText(t.text).replace(/\d+/g, '#') : normText(t.text));
    t.key = sem + '|' + txt;
    t.word = !t.noteref && !t.marker && !t.autonum && isWordTok(t.text);
    if (t.autonum) { t.num = true; t.key = 'NUM|' + t.text; }
    t.vis = t.vis || (!t.marker && t.text !== '');
    t.pre = pre; pre = [];
    toks.push(t);
  }
  toks.tail = pre;
  return toks;
}
/* Flag a leading paragraph/heading number ("10.5.14", "1.1", "1.") so renumbering is not counted as prose. */
function flagNumber(toks, kind) {
  let k = 0;
  while (k < toks.length && (toks[k].marker || toks[k].num)) k++;
  const t = toks[k];
  if (!t || t.ctx.some(w => SEM[w.tag])) return;
  const re = kind === 'h' ? /^\d+(\.\d+)*$/ : /^\d+(\.\d+)+$/;
  if (!re.test(t.text)) return;
  t.num = true; t.word = false; t.key = 'NUM|' + t.text;
  const d = toks[k + 1];
  if (kind === 'h' && d && d.text === '.' && !d.pre.length) { d.num = true; d.key = 'NUM|.'; }
}
const trivialEq = toks => toks.every(t => !isWordTok(t.text)) ||
  (toks.length <= 2 && toks.filter(t => t.word).length === 1 && toks.find(t => t.word).text.length <= 3);

const tokensOf = (blk, side) => { const toks = tokenize(blk.kids, side); flagNumber(toks, blk.kind); return toks; };

/* Pair the wrappers of two equal tokens: links, emphasis… in order (equal tokens have the same sequence of
   these), anything else (p, span, td…) by tag in order. Pairing by depth would match an old <p> with a new
   <a> when only one edition wraps the text in a paragraph (archived <li><p>…</p></li> vs live <li>…</li>). */
function pairWrappers(ca, cb, res) {
  const sa = [], sb = [], oa = [], ob = [], pairs = [];
  for (const w of ca) (SEM[w.tag] ? sa : oa).push(w);
  for (const w of cb) (SEM[w.tag] ? sb : ob).push(w);
  for (let k = 0; k < Math.min(sa.length, sb.length); k++) pairs.push([sa[k], sb[k]]);
  let j = 0;
  for (const wa of oa) {
    let q = j;
    while (q < ob.length && ob[q].tag !== wa.tag) q++;
    if (q < ob.length) { pairs.push([wa, ob[q]]); j = q + 1; }
  }
  let links = null;
  for (const [wa, wb] of pairs) {
    if (!res.wmap.has(wa)) res.wmap.set(wa, wb);
    if (wa.tag === 'a' && !wa.noteref && isExternal(wa.href) && normHref(wa.href) !== normHref(wb.href) && !wb.changedFrom) {
      wb.changedFrom = wa.href; (links ||= []).push([wa.href, wb.href]);
    }
  }
  return links;
}

/** Word diff between two leaf blocks. Items carry the token text and their wrapper contexts. */
export function diffTokens(a, b) { return diffStreams(tokensOf(a, 'a'), tokensOf(b, 'b')); }

/** Word diff between two token streams (each one block, or several blocks of a list item that was reworked). */
function diffStreams(A, B) {
  const intern = interner();
  const ops = seqDiff(A.map(t => intern(t.key)), B.map(t => intern(t.key)));
  const runs = [];
  for (const [op, i, j] of ops) {
    const eq = op === 'eq';
    let r = runs[runs.length - 1];
    if (!r || r.eq !== eq) runs.push((r = { eq, a: [], b: [] }));
    if (op !== 'ins') r.a.push(A[i]);
    if (op !== 'del') r.b.push(B[j]);
  }
  // Absorb punctuation or a tiny word stranded between two changes (reads better).
  for (let k = 1; k < runs.length - 1; k++) {
    if (runs[k].eq && !runs[k - 1].eq && !runs[k + 1].eq && !runs[k].b.some(t => t.num || t.marker || t.atom) && trivialEq(runs[k].b)) runs[k].eq = false;
  }
  const merged = [];
  for (const r of runs) { const p = merged[merged.length - 1]; if (p && !p.eq && !r.eq) { p.a.push(...r.a); p.b.push(...r.b); } else merged.push(r); }
  const res = { items: [], ins: 0, del: 0, links: [], numChanged: false, textChanged: false, wmap: new Map() };
  for (const r of merged) {
    if (r.eq) {
      r.b.forEach((tb, x) => {
        const ta = r.a[x], it = { t: tb, ta, st: 'eq' };
        const links = pairWrappers(ta.ctx, tb.ctx, res);
        if (links) { res.links.push(...links); it.links = links; }
        res.items.push(it);
      });
      continue;
    }
    r.a.forEach((t, x) => {
      res.items.push({ t, st: 'del', first: x === 0 });
      if (t.word) res.del++;
      if (t.num) res.numChanged = true; else if (t.vis) res.textChanged = true;
    });
    r.b.forEach((t, x) => {
      res.items.push({ t, st: 'ins', first: x === 0 });
      if (t.word) res.ins++;
      if (t.num) res.numChanged = true; else if (t.vis) res.textChanged = true;
    });
  }
  return res;
}

/* ------------------------------------------------------------------ Reworked list items */

/* A list item that was split, merged, re-paragraphed (an <li> gaining or losing inner <p>s) or whose text
   moved into or out of a sub-list is one block on one side and a run of consecutive blocks on the other.
   Block alignment pairs at most one of them, which left the rest as stray additions and deletions of words
   that had not changed. Such a run is compared as one unit ("group"): one word diff over all its blocks,
   split back into a view per block so each edition keeps its own structure. */
const GROUP_MIN = 0.75;   // word similarity (Dice) of the single block with the whole run
const GROUP_GAIN = 0.1;   // … and better than with any one member by this much
const MEMBER_MIN = 0.6;   // share of each member's words found in the single block
const GROUP_MAX = 16;     // longest run
const GROUP_WIN = 12;     // candidates either side of where a block's counterpart would be
const inItem = b => b.tag === 'li' || b.path.some(c => c.tag === 'li');
const groupable = b => !!b && b.kind === 't' && !b.inNotes && b.bag.length > 0;

/** Replace runs of pairGap entries that form a group by { grp: { olds, news } }, placed at its first new block. */
function groupGap(seq) {
  const n = seq.length;
  if (n < 2) return seq;
  const li = [new Uint8Array(n), new Uint8Array(n)];
  let any = false;
  for (let e = 0; e < n; e++) for (const side of [0, 1]) if (seq[e][side] && inItem(seq[e][side])) li[side][e] = any = 1;
  if (!any) return seq;
  // Order is kept: a block's counterparts lie between the pairs around it. Stretches between pairs, with the
  // unpaired entries of each side in order (a pair has the stretch before it and the one after it).
  const segs = [{ s: [[], []] }], segOf = new Int32Array(n), rank = new Int32Array(n);
  for (let e = 0; e < n; e++) {
    segOf[e] = segs.length - 1;
    if (seq[e][0] && seq[e][1]) { segs.push({ s: [[], []] }); continue; }
    const list = segs[segs.length - 1].s[seq[e][0] ? 0 : 1];
    rank[e] = list.length; list.push(e);
  }
  const candidates = (k, side) => {
    const other = 1 - side, g = segs[segOf[k]];
    if (seq[k][other]) return g.s[other].slice(-GROUP_WIN).concat(k, segs[segOf[k] + 1].s[other].slice(0, GROUP_WIN));
    const mine = g.s[side], theirs = g.s[other];
    const c = Math.floor(((rank[k] + 0.5) * theirs.length) / mine.length);
    return theirs.slice(Math.max(0, c - GROUP_WIN), c + GROUP_WIN + 1);
  };
  const claimed = new Array(n).fill(null), at = new Map();
  for (let k = 0; k < n; k++) {
    if (claimed[k]) continue;
    for (const side of [0, 1]) {
      const s = seq[k][side];
      if (!groupable(s)) continue;
      const cand = candidates(k, side);
      if (cand.length < 2 || !(li[side][k] || cand.some(e => li[1 - side][e]))) continue;
      const run = bestRun(seq, k, side, s, claimed, cand);
      if (!run) continue;
      const other = run.map(e => seq[e][1 - side]);
      const G = side === 0 ? { olds: [s], news: other } : { olds: other, news: [s] };
      claimed[k] = G;
      for (const e of run) claimed[e] = G;
      at.set(side === 0 ? run[0] : k, G);
      break;
    }
  }
  if (!at.size) return seq;
  const out = [];
  for (let k = 0; k < n; k++) {
    if (at.has(k)) out.push({ grp: at.get(k) });
    else if (!claimed[k]) out.push(seq[k]);
  }
  return out;
}

/** The best run of consecutive candidate blocks (other side: unpaired, or s's own partner) that s matches as a whole. */
function bestRun(seq, k, side, s, claimed, cand) {
  const other = 1 - side, partner = seq[k][other];
  if (partner && dice(s.bag, partner.bag) > 1 - GROUP_GAIN) return null;   // already as good as a group could be
  const maxLen = s.bag.length * (2 / GROUP_MIN - 1);                       // longer members cannot reach GROUP_MIN
  const cs = new Map();
  for (const w of s.bag) cs.set(w, (cs.get(w) || 0) + 1);
  const okMemo = new Map(), sim = new Map();   // member test and similarity with s, per entry
  const ok = e => {
    if (okMemo.has(e)) return okMemo.get(e);
    const y = seq[e][other], b = y && y.bag;
    let v = !claimed[e] && (e === k || !seq[e][side]) && groupable(y) && b.length <= maxLen;
    if (v) {   // share of y's words found in s (bags are sorted, so repeats are adjacent); stop once it cannot pass
      const allow = (1 - MEMBER_MIN) * b.length;
      let c = 0, miss = 0;
      for (let i = 0; i < b.length && miss <= allow;) {
        let m = 1;
        while (i + m < b.length && b[i + m] === b[i]) m++;
        const h = Math.min(m, cs.get(b[i]) || 0);
        c += h; miss += m - h; i += m;
      }
      v = miss <= allow;
      if (v) sim.set(e, (2 * c) / (s.bag.length + b.length));   // = dice(s, y)
    }
    okMemo.set(e, v);
    return v;
  };
  let best = null;
  for (let p = 0; p < cand.length; p++) {
    if (!ok(cand[p])) continue;
    const cr = new Map();
    let com = 0, tot = 0, s1 = 0, hasPartner = false, listy = inItem(s);
    for (let q = p; q < cand.length && q - p < GROUP_MAX && ok(cand[q]); q++) {
      const e = cand[q], y = seq[e][other];
      for (const w of y.bag) { const c = cr.get(w) || 0; if (c < (cs.get(w) || 0)) com++; cr.set(w, c + 1); }
      tot += y.bag.length;
      s1 = Math.max(s1, sim.get(e));
      if (e === k) hasPartner = true;
      if (inItem(y)) listy = true;
      if (q === p || (partner && !hasPartner) || !listy) continue;
      const s2 = (2 * com) / (s.bag.length + tot);
      if (s2 >= GROUP_MIN && s2 >= s1 + GROUP_GAIN && (!best || s2 > best.s2)) best = { s2, p, q };
    }
  }
  return best ? cand.slice(best.p, best.q + 1) : null;
}

/** Word diff of a group, as views per new block (inline and new column) and per old block (old column).
    A deletion is shown in the new block holding the last new word before it (or the first, at the start). */
function diffGroup(G) {
  const A = [], B = [];
  for (const x of G.olds) for (const t of tokensOf(x, 'a')) { t.blk = x; A.push(t); }
  for (const y of G.news) for (const t of tokensOf(y, 'b')) { t.blk = y; B.push(t); }
  const res = diffStreams(A, B);
  const view = () => ({ items: [], ins: 0, del: 0, links: [], numChanged: false, textChanged: false, wmap: res.wmap });
  const nv = new Map(G.news.map(y => [y, view()])), ov = new Map(G.olds.map(x => [x, view()]));
  const put = (v, it, count) => {
    const last = v.items[v.items.length - 1];
    v.items.push(it.st === 'eq' ? it : { ...it, first: !last || last.st !== it.st });
    if (!count) return;
    if (it.links) v.links.push(...it.links);
    if (it.st === 'eq') return;
    if (it.t.word) v[it.st]++;
    if (it.t.num) v.numChanged = true; else if (it.t.vis) v.textChanged = true;
  };
  const fn = res.items.find(it => it.st !== 'del'), fo = res.items.find(it => it.st !== 'ins');
  let curN = fn ? fn.t.blk : G.news[0], curO = fo ? (fo.ta || fo.t).blk : G.olds[0];
  for (const it of res.items) {
    if (it.st !== 'del') curN = it.t.blk;
    put(nv.get(curN), it, true);
    if (it.st === 'ins') continue;
    curO = (it.ta || it.t).blk;
    put(ov.get(curO), it, false);
  }
  G.views = nv; G.oldViews = ov;
}

/* ------------------------------------------------------------------ Comparison */

const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

/**
 * Compare two bodies (HTML strings, or results of prepareBody).
 * opts: { images: {src: localUrl}, render: true, onProgress(phase, fraction), threshold: 0.5 }
 */
export function diffBodies(oldBody, newBody, opts = {}) {
  const t0 = now();
  const progress = opts.onProgress || (() => {});
  const shared = { words: interner() };
  progress('Parsing', 0);
  const A = typeof oldBody === 'string' ? prepareBody(oldBody, shared) : oldBody;
  progress('Parsing', 0.5);
  const B = typeof newBody === 'string' ? prepareBody(newBody, shared) : newBody;
  if (A.words !== B.words) { // prepared with different word tables: ids are not comparable, rebuild B's bags
    for (const blk of B.blocks) {
      const body = blk.key.slice(blk.key.indexOf('\u0002') + 1), bag = [];
      for (const w of body.toLowerCase().match(WORD_RE) || []) bag.push(A.words(w));
      blk.bag = Int32Array.from(bag.sort((x, y) => x - y));
    }
    B.words = A.words;
  }
  const tParse = now();
  progress('Aligning', 0);
  const intern = interner();
  const ka = A.blocks.map(x => intern(x.key)), kb = B.blocks.map(x => intern(x.key));
  const ops = seqDiff(ka, kb);
  const rows = [];
  let gapD = [], gapI = [];
  const flushGap = () => {
    if (!gapD.length && !gapI.length) return;
    for (const e of groupGap(pairGap(gapD, gapI, opts.threshold || 0.5))) {
      if (e.grp) { for (const y of e.grp.news) rows.push({ st: 'mod', a: e.grp.olds[0], b: y, grp: e.grp }); continue; }
      const [x, y] = e;
      rows.push(x && y ? { st: 'mod', a: x, b: y } : x ? { st: 'del', a: x, b: null } : { st: 'add', a: null, b: y });
    }
    gapD = []; gapI = [];
  };
  for (const [op, i, j] of ops) {
    if (op === 'eq') {
      flushGap();
      const a = A.blocks[i], b = B.blocks[j];
      rows.push({ st: a.full !== b.full || a.hrefSig !== b.hrefSig ? 'mod' : 'eq', a, b });
    } else if (op === 'del') gapD.push(A.blocks[i]);
    else gapI.push(B.blocks[j]);
  }
  flushGap();
  rows.forEach((r, i) => { r.i = i; });
  const tAlign = now();
  // Container mapping old -> new (innermost first), so removed blocks render inside the new structure.
  const cmap = new Map();
  for (const r of rows) {
    if (!r.a || !r.b || r.grp) continue;
    const pa = r.a.path, pb = r.b.path;
    for (let k = 1; k <= Math.min(pa.length, pb.length); k++) {
      const ca = pa[pa.length - k], cb = pb[pb.length - k];
      if (ca.tag !== cb.tag) break;
      if (!cmap.has(ca)) cmap.set(ca, cb);
    }
  }
  // Word-level diffs for modified pairs.
  const mods = rows.filter(r => r.st === 'mod');
  let done = 0, lastTick = now();
  for (const r of mods) {
    if (r.grp) { if (!r.grp.views) diffGroup(r.grp); r.d = r.grp.views.get(r.b); }
    else r.d = diffTokens(r.a, r.b);
    if (!r.d.textChanged && !r.d.links.length) r.st = r.d.numChanged ? 'renum' : 'eq';
    if (++done % 64 === 0 && now() - lastTick > 40) { lastTick = now(); progress('Comparing words', done / mods.length); }
  }
  const tWords = now();
  // Word counts for whole-block additions and removals.
  for (const r of rows) {
    if (r.st === 'mod') { r.ins = r.d.ins; r.del = r.d.del; }
    else if (r.st === 'add') { r.ins = countWords(r.b); r.del = 0; }
    else if (r.st === 'del') { r.del = countWords(r.a); r.ins = 0; }
    else { r.ins = 0; r.del = 0; }
  }
  // Sections (h2/h3 headings) and hunks.
  let sec = null, hunk = -1, prev = null, secN = 0;
  const toc = [], secById = new Map();
  for (const r of rows) {
    const blk = r.b || r.a;
    if (blk.kind === 'h' && blk.level <= 3) {
      r.secId = (r.b && r.b.id) || 'rl-sec-' + ++secN;
      r.anchorId = r.b && !r.b.id ? r.secId : null;  // headings without an id get one, for the contents
      sec = { id: r.secId, level: blk.level, text: blk.plain, st: r.st, count: 0, hunks: new Set() };
      toc.push(sec); secById.set(sec.id, sec);
    }
    r.sec = sec && !blk.inNotes ? sec.id : null;   // footnotes belong to no section
    if (r.st === 'eq' || r.st === 'renum') { prev = null; r.hunk = -1; continue; }
    const structural = r.st !== 'mod';
    if (r.grp && r.grp.hunk != null) r.hunk = r.grp.hunk;   // a reworked list item is one change
    else {
      if (!(prev && prev.structural && structural && prev.notes === blk.inNotes)) hunk++;
      r.hunk = hunk;
      if (r.grp) r.grp.hunk = hunk;
    }
    r.structural = structural; r.notes = blk.inNotes; prev = r;
    if (r.sec) sec.hunks.add(r.hunk);
  }
  for (const s of toc) { s.count = s.hunks.size; delete s.hunks; }
  const changes = [];
  for (const r of rows) {
    if (r.hunk < 0) continue;
    let c = changes[r.hunk];
    if (!c) c = changes[r.hunk] = { i: r.hunk, types: new Set(), sec: r.sec, notes: !!(r.b || r.a).inNotes, ins: 0, del: 0, n: 0, first: r, links: 0, grps: new Set() };
    c.types.add(r.st); c.ins += r.ins; c.del += r.del;
    if (!r.grp || !c.grps.has(r.grp)) c.n++;   // a reworked item counts once, however many blocks it now has
    if (r.grp) c.grps.add(r.grp);
    if (r.d) c.links += r.d.links.length;
  }
  for (const c of changes) {
    const t = [...c.types].filter(x => x !== 'mod');
    c.type = c.types.size === 1 ? [...c.types][0] : t.length === 1 ? t[0] : 'mixed';
    c.label = changeLabel(c);
    delete c.types; delete c.first; delete c.grps;
  }
  for (const r of rows) if (r.hunk >= 0) r.label = changes[r.hunk].label;
  const stats = {
    ins: rows.reduce((s, r) => s + r.ins, 0), del: rows.reduce((s, r) => s + r.del, 0), changes: changes.length,
    renumbered: rows.filter(r => r.st === 'renum').length, noteChanges: changes.filter(c => c.notes).length, blocksOld: A.blocks.length, blocksNew: B.blocks.length,
    modified: rows.filter(r => r.st === 'mod').length, added: rows.filter(r => r.st === 'add').length, removed: rows.filter(r => r.st === 'del').length,
    ms: { parse: Math.round(tParse - t0), align: Math.round(tAlign - tParse), words: Math.round(tWords - tAlign), render: 0, total: 0 }
  };
  const result = { rows, changes, toc, stats, cmap };
  if (opts.render !== false) {
    progress('Rendering', 0);
    const tr0 = now();
    const r = renderResult(result, opts);
    result.inlineHtml = r.inline; result.sbsHtml = r.sbs;
    stats.ms.render = Math.round(now() - tr0);
  }
  stats.ms.total = Math.round(now() - t0);
  progress('Done', 1);
  return result;
}

function countWords(blk) {
  let n = 0;
  const toks = tokenize(blk.kids);
  flagNumber(toks, blk.kind);
  for (const t of toks) if (t.word) n++;
  return n;
}
function blockName(blk) {
  if (!blk) return 'Block';
  if (blk.kind === 'h') return 'Heading';
  if (blk.kind === 'tr') return 'Table row';
  if (blk.kind === 'fig') return 'Figure';
  if (blk.kind === 'hr') return 'Rule';
  if (blk.inNotes) return blk.ord ? `Footnote ${blk.ord}` : 'Footnote';
  if (blk.num) return `Paragraph ${blk.num}`;
  if (blk.tag === 'li' || blk.path.some(c => c.tag === 'li')) return 'List item';
  return 'Paragraph';
}
function changeLabel(c) {
  const verb = { mod: 'changed', add: 'added', del: 'removed', mixed: 'added and removed' }[c.type] || 'changed';
  const r = c.first, blk = r.st === 'del' ? r.a : r.b;
  if (c.n === 1) return c.type === 'mod' && !r.d.textChanged && r.d.links.length ? `${blockName(blk)}: link target changed` : `${blockName(blk)} ${verb}`;
  const from = blk.num ? `, from paragraph ${blk.num}` : blk.kind === 'h' ? `, from “${blk.plain.slice(0, 60)}”` : '';
  return `${c.n} blocks ${verb}${from}`;
}

/* ------------------------------------------------------------------ Rendering */

function makeX(opts) {
  const images = opts.images || {};
  /** Attribute transform at render time: image sources through the mirror map, external links open
      in a new tab, ids dropped where they would be duplicated (old-side copies). */
  return (tag, attrs, stripId, extra) => {
    // Attribute order is preserved; class/rel are extended in place.
    const xcls = extra && extra.cls;
    let ext = false, hasTarget = false, hasClass_ = false, hasRel = false;
    if (tag === 'a') {
      const href = getAttr({ attrs }, 'href');
      ext = !!href && /^(https?:)?\/\//i.test(href.trim());
      hasTarget = attrs.some(a => a[0] === 'target');
    }
    let out = '';
    for (const [n, v] of attrs) {
      if (n === 'id' && stripId) continue;
      if (/^on/i.test(n) || (n === 'href' && /^\s*javascript:/i.test(v || ''))) continue; // never render handlers
      if (n === 'class') { hasClass_ = true; const c = xcls ? ((v || '') + ' ' + xcls).trim() : v; if (c) out += ` class="${escAttr(c)}"`; continue; }
      if (n === 'rel' && ext && !hasTarget) { hasRel = true; out += ` rel="${escAttr(((v || '') + ' noopener').trim())}"`; continue; }
      if (n === 'src' && tag === 'img' && v != null && hasOwn.call(images, v)) { out += ` src="${escAttr(images[v])}" data-govuk-src="${escAttr(v)}"`; continue; }
      out += v == null ? ` ${n}` : ` ${n}="${escAttr(v)}"`;
    }
    if (!hasClass_ && xcls) out = ` class="${escAttr(xcls)}"` + out;
    if (ext && !hasTarget) out += hasRel ? ' target="_blank"' : ' target="_blank" rel="noopener"';
    if (tag === 'img') out += ' loading="lazy" decoding="async"';
    if (extra && extra.more) out += extra.more;
    return out;
  };
}

const LINK_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 0 1 4.5 9l1-1" stroke-linecap="round"/></svg>';
const shortUrl = u => String(u || '').replace(/^https?:\/\//, '').replace(/^www\./, '');
const linkMarker = (from, to) =>
  `<span class="lc tag tag--outline" tabindex="0" aria-label="Link target changed from ${escAttr(shortUrl(from))} to ${escAttr(shortUrl(to))}">${LINK_ICON}link changed` +
  `<span class="lc-tip" role="tooltip" aria-hidden="true"><b>Link target changed</b><del>${escText(shortUrl(from))}</del><span class="arrow">→</span><ins>${escText(shortUrl(to))}</ins></span></span>`;

/* Wrappers that make a paragraph. One edition can have them where the other does not (archived <li><p>…</p></li>
   vs live <li>…</li>), so in the inline view a deleted word takes the paragraph of the new words beside it. */
const PARA = new Set(['p', 'div']);
const paraPrefix = ctx => { let e = 0; ctx.forEach((w, k) => { if (PARA.has(w.tag)) e = k + 1; }); return ctx.slice(0, e); };
function delCtx(c, near, wmap) {
  const m = c.map(w => wmap.get(w) || w);
  if (!near) return m;
  const pre = paraPrefix(near), rest = m.filter(w => !PARA.has(w.tag) && !pre.includes(w));
  // Other structure (a table cell): keep it, and only drop a paragraph the new edition does not have.
  if (rest.some(w => BLOCK.has(w.tag))) return m.filter(w => !(w.old && PARA.has(w.tag)));
  return pre.concat(rest);
}

/** Render diff items. mode: 'inline' (both sides), 'old' (eq + del), 'new' (eq + ins).
    <ins>/<del> always sit innermost, so the HTML stays balanced. */
function renderItems(d, mode, X, hangNum) {
  const marked = new Set();
  const visible = d.items.filter(it => !(mode === 'old' && it.st === 'ins') && !(mode === 'new' && it.st === 'del'));
  // Token as shown on this side: eq tokens keep each edition's own text (e.g. its own footnote number).
  const tokOf = it => (mode === 'old' && it.ta ? it.ta : it.t);
  // Inline, deleted words sit in the new edition's structure: next to the new word before them (else after).
  const near = new Map();
  if (mode === 'inline') {
    let cur = null;
    for (const it of visible) { if (it.st !== 'del') cur = it.t.ctx; else near.set(it, cur); }
    cur = null;
    for (let k = visible.length - 1; k >= 0; k--) { const it = visible[k]; if (it.st !== 'del') cur = it.t.ctx; else if (!near.get(it)) near.set(it, cur); }
  }
  const mapCtx = (c, it) => (mode === 'inline' && it.st === 'del' ? delCtx(c, near.get(it), d.wmap) : c);
  const renderList = list => {
    let html = '', run = null;
    const open = [];
    const closeRun = () => { if (run) { html += `</${run}>`; run = null; } };
    const closeTo = n => {
      closeRun();
      while (open.length > n) {
        const w = open.pop();
        html += `</${w.tag}>`;
        if (mode !== 'old' && w.changedFrom && !marked.has(w)) { marked.add(w); html += linkMarker(w.changedFrom, w.href); }
      }
    };
    const put = (t, ctx, want, oldSide) => {
      let k = 0;
      while (k < open.length && k < ctx.length && open[k] === ctx[k]) k++;
      if (k < open.length) closeTo(k);
      if (open.length < ctx.length) {
        closeRun();
        for (let i = open.length; i < ctx.length; i++) { const w = ctx[i]; html += `<${w.tag}${X(w.tag, w.attrs, w.old)}>`; open.push(w); }
      }
      if (want !== run) { closeRun(); if (want) { html += `<${want}>`; run = want; } }
      html += t.atom ? `<${t.atom.tag}${X(t.atom.tag, t.atom.attrs, oldSide)}>` : escText(t.text);
    };
    for (const it of list) {
      const t = tokOf(it), oldSide = mode === 'old' || it.st === 'del', tctx = mapCtx(t.ctx, it);
      const want = it.st === 'eq' || t.marker ? null : it.st === 'ins' ? (mode === 'old' ? null : 'ins') : (mode === 'new' ? null : 'del');
      // Spacing before a change stays outside the mark; spacing inside a run of changed words stays in.
      for (const w of t.pre) {
        let wc = mapCtx(w.ctx, it);
        // Spacing outside wrappers that are already open around its word (a deleted word placed in the new
        // paragraph before it) stays inside them rather than closing and reopening them.
        if (wc.length < tctx.length && wc.every((x, k) => tctx[k] === x)) {
          let k = 0;
          while (k < open.length && k < tctx.length && open[k] === tctx[k]) k++;
          if (k > wc.length) wc = tctx.slice(0, k);
        }
        put(w, wc, it.first ? null : want, oldSide);
      }
      put(t, tctx, want, oldSide);
    }
    closeTo(0);
    return html;
  };
  if (hangNum) {
    let e = 0;
    while (e < visible.length && tokOf(visible[e]).num && !tokOf(visible[e]).ctx.length) e++;
    if (e > 0) return `<span class="pn">${renderList(visible.slice(0, e))}</span>` + renderList(visible.slice(e));
  }
  return renderList(visible);
}

/** Serialise nodes, optionally wrapping visible text in <ins>/<del>; hangNum wraps a leading number. */
function serNodes(nodes, X, stripId, wrap, hangNum) {
  let html = '', first = true;
  const ser = (list, depth) => {
    for (const n of list) {
      if (n.t === 3) {
        let v = n.v;
        if (hangNum && first && depth === 0) {
          const m = v.match(/^(\s*)(\d+(?:\.\d+)+)(?=\s|$)/);
          if (m) { html += `<span class="pn">${wrap ? `<${wrap}>` : ''}${escText(m[2])}${wrap ? `</${wrap}>` : ''}</span>`; v = v.slice(m[0].length); }
        }
        if (/\S/.test(v)) first = false;
        if (wrap && /\S/.test(v)) {
          const m = v.match(/^(\s*)([\s\S]*?)(\s*)$/);
          html += escText(m[1]) + `<${wrap}>${escText(m[2])}</${wrap}>` + escText(m[3]);
        } else html += escText(v);
        continue;
      }
      first = false;
      if (VOID.has(n.tag)) {
        const tagHtml = `<${n.tag}${X(n.tag, n.attrs, stripId)}>`;
        html += wrap && n.tag === 'img' ? `<${wrap}>${tagHtml}</${wrap}>` : tagHtml;
        continue;
      }
      html += `<${n.tag}${X(n.tag, n.attrs, stripId)}>`;
      ser(n.kids, depth + 1);
      html += `</${n.tag}>`;
    }
  };
  ser(nodes, 0);
  return html;
}

const BADGE = { add: '<span class="badge tag tag--ins">Added</span>', del: '<span class="badge tag tag--del">Removed</span>' };

function renderResult(res, opts) {
  const X = makeX(opts);
  const rows = res.rows, cmap = res.cmap;
  const firstOfHunk = new Set();
  { let h = -2; for (const r of rows) { if (r.hunk >= 0 && r.hunk !== h) firstOfHunk.add(r); h = r.hunk; } }
  const chgClass = r => r.st === 'mod' ? 'chg is-mod' : r.st === 'add' ? 'chg is-added' : r.st === 'del' ? 'chg is-removed' : r.st === 'renum' ? 'renum' : '';
  const chgData = r => r.hunk >= 0 ? ` data-chg="${r.hunk}" data-label="${escAttr(r.label || '')}"` : '';
  const hang = blk => !!(blk && blk.num && blk.kind === 't' && blk.tag !== 'li' && blk.path.length === 0);

  /* One leaf, for a mode: 'inline' | 'old' | 'new'. */
  const leafHtml = (r, mode, opt = {}) => {
    const useOld = mode === 'old' || (mode === 'inline' && r.st === 'del');
    const blk = useOld ? r.a : r.b;
    const stripId = useOld;
    const hangNum = hang(blk);
    let inner;
    if (r.st === 'eq') inner = serNodes(blk.kids, X, stripId, null, hangNum);
    else if (r.st === 'add') inner = serNodes(blk.kids, X, stripId, 'ins', hangNum);
    else if (r.st === 'del') inner = serNodes(blk.kids, X, true, 'del', hangNum);
    else inner = renderItems(r.d, mode, X, hangNum);
    if (firstOfHunk.has(r) && (r.st === 'add' || r.st === 'del') && blk.kind !== 'tr' && blk.kind !== 'fig' && !opt.noBadge) {
      // Inside an item's own paragraph (archived <li><p>…</p></li>), so the badge does not drop to a line of its own.
      const m = /<\/p>(\s*)$/.exec(inner);
      inner = m ? inner.slice(0, m.index) + BADGE[r.st] + inner.slice(m.index) : inner + BADGE[r.st];
    }
    const classes = [chgClass(r), hangNum ? 'np' : ''].filter(Boolean).join(' ');
    let more = (opt.noRow ? '' : ` data-r="${r.i}"`) + (opt.noChg ? '' : chgData(r));
    if (r.hunk >= 0 && blk.ind && !opt.noChg) more += ` style="--ind:${blk.ind}rem"`;
    if (blk.tag === 'li' && blk.ord) more += ` value="${blk.ord}"`;
    if (r.anchorId && !useOld) more += ` id="${r.anchorId}"`;
    const extra = { cls: opt.noChg ? (hangNum ? 'np' : '') : classes, more };
    if (!blk.el) return `<div${X('div', [], false, { cls: ('rl-anon ' + extra.cls).trim(), more: extra.more })}>${inner}</div>`;
    return `<${blk.tag}${X(blk.tag, blk.el.attrs, stripId, extra)}>${inner}</${blk.tag}>`;
  };
  /* A container; `blk` is the leaf it is opened for. A list item opened only to hold a nested list (its own text,
     its first leaf, is elsewhere) gets no bullet of its own, so a nested item shows one bullet, not two. */
  const openC = (c, stripId, blk) => {
    let more = '';
    if (c.tag === 'li' && c.ord) more = ` value="${c.ord}"`;
    if (c.tag === 'li' && blk && c.first && c.first !== blk && getAttr(c, 'style') == null) more += ' style="list-style-type:none"';
    const tag = `<${c.tag}${X(c.tag, c.attrs, stripId, { more })}>`;
    return c.tag === 'table' ? `<div class="tbl-scroll" tabindex="0" role="region" aria-label="Table">${tag}` : tag;
  };
  const closeC = c => c.tag === 'table' ? '</table></div>' : `</${c.tag}>`;

  /* ---- Where a removed block goes in the inline view (which follows the new edition's structure). */
  const ancNew = new Map();    // new container -> its path from the root
  for (const r of rows) if (r.b) { const p = r.b.path; for (let k = 0; k < p.length; k++) if (!ancNew.has(p[k])) ancNew.set(p[k], p.slice(0, k + 1)); }
  // An old list item whose text now forms a single new item: that item stays open, so its removed
  // sub-items are shown inside it rather than under an empty bullet of their own.
  const intoLeaf = new Map();
  for (const r of rows) {
    if (!r.a || !r.b || r.grp || r.b.tag !== 'li' || !r.b.el || r.a.tag === 'li') continue;
    const li = r.a.path[r.a.path.length - 1];
    if (li && li.tag === 'li' && !intoLeaf.has(li)) intoLeaf.set(li, (r.keep = { tag: 'li', keep: r }));
  }
  const isList = c => !!c && (c.tag === 'ul' || c.tag === 'ol');
  const common = (p, q) => { let k = 0; while (k < p.length && k < q.length && p[k] === q[k]) k++; return p.slice(0, k); };
  // Outside lists: under the new counterpart of its deepest container that has one.
  const mapDeep = pa => {
    for (let k = pa.length - 1; k >= 0; k--) { const m = cmap.get(pa[k]); if (m && ancNew.has(m)) return ancNew.get(m).concat(pa.slice(k + 1)); }
    return pa;
  };
  /* In lists: under what is open (Pp) when one of its old containers is open or has its counterpart open there,
     otherwise inside whatever the next new block also needs (C), so a reworked list is never torn into pieces. */
  const placeDel = (blk, Pp, Pn) => {
    const pa = blk.path;
    if (blk.tag !== 'li' && !pa.some(c => c.tag === 'li' || isList(c))) return mapDeep(pa);
    const C = common(Pp, Pn), at = new Map(Pp.map((c, k) => [c, k]));
    for (let k = pa.length - 1; k >= 0; k--) {
      let j = at.has(pa[k]) ? at.get(pa[k]) : -1;
      if (j < 0) { const m = intoLeaf.get(pa[k]) || cmap.get(pa[k]); if (m && at.has(m)) j = at.get(m); }
      if (j < 0) continue;
      if (j + 1 < C.length) break;
      // Below that, use the new containers the next new block opens anyway (its counterpart, or a list of the
      // same kind with none), rather than opening old ones beside them.
      const base = Pp.slice(0, j + 1), tail = pa.slice(k + 1);
      let q = 0;
      if (base.every((c, x) => Pn[x] === c)) {
        for (; q < tail.length; q++) {
          const nb = Pn[base.length + q];
          if (!nb || !(cmap.get(tail[q]) === nb || (isList(tail[q]) && nb.tag === tail[q].tag))) break;
        }
      }
      return base.concat(Pn.slice(base.length, base.length + q), tail.slice(q));
    }
    const own = pa[pa.length - 1];
    if (blk.tag === 'li' || (own && own.tag === 'li')) {          // a list item, or the text of one
      const unit = blk.tag === 'li' ? [] : [own];
      if (isList(C[C.length - 1])) return C.concat(unit);
      const list = pa[pa.length - 1 - unit.length];
      if (!isList(list)) return C.concat(unit);
      // Right after or before a new list of the same kind (the list was rewritten): join it, not start one beside it.
      const pl = Pp[C.length], nl = Pn[C.length];
      if (pl && pl.tag === list.tag) return C.concat(pl, unit);
      if (nl && nl.tag === list.tag) return C.concat(nl, unit);
      if (C.length) return C.concat(list, unit);
    }
    return mapDeep(pa);
  };
  const paths = new Array(rows.length);
  {
    const nextNew = new Array(rows.length);
    let nx = [];
    for (let i = rows.length - 1; i >= 0; i--) { nextNew[i] = nx; if (rows[i].b) nx = rows[i].b.path; }
    let open = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i], p = r.st === 'del' ? placeDel(r.a, open, nextNew[i]) : r.b.path;
      paths[i] = p;
      open = r.keep ? p.concat(r.keep) : p;
    }
  }

  /* ---- Inline document, in content-visibility chunks at the top level. */
  let inline = '', chunk = '', chunkChars = 0, chunkBlocks = 0;
  const flushChunk = () => {
    if (!chunk) return;
    const est = Math.round(chunkChars / 68 * 27 + chunkBlocks * 17);
    inline += `<div class="cv" style="contain-intrinsic-size:auto ${Math.max(40, est)}px">${chunk}</div>\n`;
    chunk = ''; chunkChars = 0; chunkBlocks = 0;
  };
  {
    const open = [], opened = new Set();
    for (const r of rows) {
      const path = paths[r.i], blk = r.st === 'del' ? r.a : r.b;
      let k = 0;
      while (k < open.length && k < path.length && open[k] === path[k]) k++;
      while (open.length > k) chunk += closeC(open.pop());
      if (!open.length && (chunkBlocks >= 28 || chunkChars >= 9000)) flushChunk();
      while (open.length < path.length) {
        const c = path[open.length];
        chunk += openC(c, opened.has(c) || !ancNew.has(c), blk);   // old containers lose their ids
        opened.add(c); open.push(c);
      }
      const html = leafHtml(r, 'inline');
      if (r.keep) { chunk += html.slice(0, -'</li>'.length); open.push(r.keep); }   // closed by the next block that is not inside it
      else chunk += html + '\n';
      chunkBlocks++; chunkChars += blk.plain.length + (r.st === 'mod' && r.a ? r.a.plain.length * 0.3 : 0);
    }
    while (open.length) chunk += closeC(open.pop());
    flushChunk();
  }

  /* ---- Side by side: one row per block; table rows grouped per table. */
  let sbs = '';
  const cellSeq = (list, side) => {
    let html = '';
    const open = [];
    for (const r of list) {
      const blk = side === 'old' ? r.a : r.b;
      if (!blk) continue;
      const path = side === 'old' ? r.a.path : r.b.path;
      let k = 0;
      while (k < open.length && k < path.length && open[k] === path[k]) k++;
      while (open.length > k) html += closeC(open.pop());
      while (open.length < path.length) { const c = path[open.length]; html += openC(c, true, blk); open.push(c); }
      html += leafHtml(r, side, { noChg: !list.isTable, noRow: !list.isTable });
    }
    while (open.length) html += closeC(open.pop());
    return html;
  };
  const tableOf = r => { const p = paths[r.i]; for (let k = p.length - 1; k >= 0; k--) if (p[k].tag === 'table') return p[k]; return null; };
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], blk = r.b || r.a;
    if (r.grp) {   // a reworked list item: one row, its old blocks on the left and its new blocks on the right
      const G = r.grp, group = [r];
      while (i + 1 < rows.length && rows[i + 1].grp === G) group.push(rows[++i]);
      const lead = group.find(x => x.hunk >= 0) || r;
      const olds = G.olds.map(a => ({ st: lead.hunk >= 0 ? 'mod' : 'eq', a, b: null, d: G.oldViews.get(a) }));
      const len = Math.max(G.olds.reduce((s, x) => s + x.plain.length, 0), group.reduce((s, x) => s + x.b.plain.length, 0));
      const est = Math.round(len / 34 * 26 + 18 * Math.max(olds.length, group.length));
      const cls = ['sbs-row', chgClass(lead)].filter(Boolean).join(' ');
      sbs += `<div class="${cls}" data-r="${r.i}"${chgData(lead)} style="contain-intrinsic-size:auto ${Math.max(28, est)}px"><div class="sbs-cell old">${cellSeq(olds, 'old')}</div><div class="sbs-cell new">${cellSeq(group, 'new')}</div></div>\n`;
      continue;
    }
    if (blk.kind === 'tr' && tableOf(r)) {
      const t = tableOf(r), group = [r];
      while (i + 1 < rows.length && (rows[i + 1].b || rows[i + 1].a).kind === 'tr' && tableOf(rows[i + 1]) === t) group.push(rows[++i]);
      group.isTable = true;
      const est = Math.round(group.length * 34 + 40);
      sbs += `<div class="sbs-row sbs-tbl" style="contain-intrinsic-size:auto ${est}px"><div class="sbs-cell old">${cellSeq(group, 'old')}</div><div class="sbs-cell new">${cellSeq(group, 'new')}</div></div>\n`;
      continue;
    }
    const one = [r];
    const cell = side => {
      if ((side === 'old' && !r.a) || (side === 'new' && !r.b)) return '<div class="sbs-cell empty"></div>';
      return `<div class="sbs-cell ${side}">${cellSeq(one, side)}</div>`;
    };
    const len = Math.max(r.a ? r.a.plain.length : 0, r.b ? r.b.plain.length : 0);
    const est = Math.round(len / 34 * 26 + 18);
    const cls = ['sbs-row', chgClass(r)].filter(Boolean).join(' ');
    const lvl = blk.kind === 'h' ? ` data-h="${blk.level}"` : '';
    sbs += `<div class="${cls}" data-r="${r.i}"${chgData(r)}${lvl} style="contain-intrinsic-size:auto ${Math.max(28, est)}px">${cell('old')}${cell('new')}</div>\n`;
  }
  return { inline, sbs };
}

/* ------------------------------------------------------------------ Convenience for workers and tests */

/** Serialisable summary of a result (drops the block trees). */
export function summarise(res) {
  return {
    inlineHtml: res.inlineHtml, sbsHtml: res.sbsHtml, changes: res.changes, toc: res.toc, stats: res.stats,
    rows: res.rows.map(r => ({ st: r.st, hunk: r.hunk, sec: r.sec, ins: r.ins, del: r.del, kind: (r.b || r.a).kind }))
  };
}
