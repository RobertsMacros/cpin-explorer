// Account controls load independently of the miniature globe.
if (typeof document !== "undefined") void import("./account-ui.js");
// The header mark, and the globe's stand-in on the start page: both the globe in miniature (mini-globe.js).
//
// The mark shows the globe's opening view until a country is in hand (one open on the start page, a
// report being read); then it turns to that country and marks it with a dot. It remembers where it
// was from page to page, so going from the globe to a report it is already there, and arriving at a
// report from anywhere else it turns to it.
//
// Loaded in the <head> of every page with blocking="render", so both are drawn in the first frame:
//   <a class="brand" data-mark="start">          the start page: the country it opens on (startCountry)
//   <a class="brand" data-mark="country-param">  a report: the country in the address (?country=)
//   <canvas class="globe-ghost">                 the stand-in, where the real globe will be
import { shortestTurn } from "./globe-math.js";
import { HOME, MARKERS, paintMark, paintStandIn, viewOf } from "./mini-globe.js";

const STORE = "cpin-mark";                     // sessionStorage: the country the mark was last turned to ("" = none)
const TURN_MS = 620;
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const known = (slug) => !!slug && Object.hasOwn(MARKERS, slug);
const read = () => { try { return sessionStorage.getItem(STORE) || ""; } catch { return ""; } };
const write = (slug) => { try { sessionStorage.setItem(STORE, slug || ""); } catch {} };

/**
 * The country the start page opens on: the one in the address (#slug), else, unless the address
 * carries a search, the one last looked at; null for the opening view. `has` narrows it to the
 * countries the page really has.
 */
export function startCountry(has = known) {
  let slug = location.hash.slice(1);
  if (!has(slug) && !(new URLSearchParams(location.search).get("q") || "").trim()) {
    try { slug = localStorage.getItem("cpin-last-country") || ""; } catch { slug = ""; }
  }
  return has(slug) ? slug : null;
}
/** The globe's view of a country (or the opening view): the big globe starts here, and so does its stand-in. */
export const startView = (slug) => viewOf(known(slug) ? MARKERS[slug] : HOME);

function fit(canvas, cap = Infinity) {
  const size = canvas.getBoundingClientRect().width || canvas.offsetWidth;
  const dpr = Math.max(1, Math.min(cap, window.devicePixelRatio || 1));
  const px = Math.round(size * dpr);
  if (canvas.width !== px) canvas.width = canvas.height = px;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, size };
}

function mountMark(old) {
  const canvas = document.createElement("canvas");
  canvas.setAttribute("class", old.getAttribute("class"));
  canvas.setAttribute("aria-hidden", "true");
  old.replaceWith(canvas);

  // What is drawn: the view, and each country's dot at its own strength (one fades as the next grows).
  let slug = known(read()) ? read() : null;
  let view = startView(slug), pins = new Map(slug ? [[slug, 1]] : []);
  let anim = null, raf = 0;

  function draw() {
    if (!canvas.isConnected) return;
    const { ctx, size } = fit(canvas);
    if (!size) return;
    paintMark(ctx, { size, view, colour: getComputedStyle(canvas).color, pins: [...pins].map(([s, level]) => ({ at: MARKERS[s], level })) });
  }
  function step(now) {
    raf = 0;
    if (!anim) return;
    const t = Math.min(1, (now - anim.t0) / TURN_MS), e = ease(t);
    view = { phi: anim.from.phi + anim.dPhi * e, theta: anim.from.theta + anim.dTheta * e };
    for (const [s, from] of anim.pins) pins.set(s, from + ((s === slug ? 1 : 0) - from) * e);
    if (t >= 1) { anim = null; settle(); }
    draw();
    if (anim) raf = requestAnimationFrame(step);
  }
  function settle() {
    view = startView(slug);
    pins = new Map(slug ? [[slug, 1]] : []);
  }

  /** Turn to a country (a slug), or back to the opening view (null). */
  function show(next, { instant = false } = {}) {
    next = known(next) ? next : null;
    write(next);
    if (next === slug) return;
    slug = next;
    // Nobody is watching (a page being made ready in the background), or motion is not wanted: just be there.
    if (instant || reduced.matches || document.visibilityState !== "visible") {
      cancelAnimationFrame(raf); raf = 0; anim = null;
      settle();
      return draw();
    }
    const to = startView(slug);
    if (slug && !pins.has(slug)) pins.set(slug, 0);
    anim = { t0: performance.now(), from: view, dPhi: shortestTurn(view.phi, to.phi), dTheta: to.theta - view.theta, pins: new Map(pins) };
    if (!raf) raf = requestAnimationFrame(step);
  }

  draw();
  // The colour follows the theme, the sharpness follows the screen.
  new MutationObserver(draw).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", draw);
  new ResizeObserver(draw).observe(canvas);
  // A page brought back by Back or Forward kept its own idea of where the mark was: say so again for the next page.
  addEventListener("pageshow", (e) => { if (e.persisted) write(slug); });
  return { show, get country() { return slug; } };
}

function mountStandIn(canvas, slug) {
  const draw = () => {
    if (!canvas.isConnected || !canvas.offsetWidth) return;
    const { ctx, size } = fit(canvas, 1.5);
    paintStandIn(ctx, { size, view: startView(slug), colour: getComputedStyle(canvas).color });
  };
  draw();
  new MutationObserver(draw).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}

const brand = document.querySelector(".brand");
const markEl = brand?.querySelector(".brand-mark");
const hint = brand?.dataset.mark;
const first = hint === "start" ? startCountry() : hint === "country-param" ? new URLSearchParams(location.search).get("country") : null;

/** The header mark: brandMark.show(slug | null). On a page without one, it does nothing. */
export const brandMark = markEl ? mountMark(markEl) : { show() {}, country: null };
// Arriving with the mark already there (from the globe), nothing moves; from elsewhere, it turns.
brandMark.show(first);
const ghost = document.querySelector("canvas.globe-ghost");
if (ghost) mountStandIn(ghost, hint === "start" ? first : null);
