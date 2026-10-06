// The product logo stays an SVG. This module prepares the dashboard globe before COBE loads.
import { HOME, MARKERS, paintStandIn, viewOf } from "./mini-globe.js";

const known = (slug) => !!slug && Object.hasOwn(MARKERS, slug);

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
const hint = brand?.dataset.mark;
const first = hint === "start" ? startCountry() : hint === "country-param" ? new URLSearchParams(location.search).get("country") : null;

// Retain the country-selection interface used by the dashboard; the product logo is fixed.
let country = known(first) ? first : null;
export const brandMark = {
  show(slug) { country = known(slug) ? slug : null; },
  get country() { return country; },
};
const ghost = document.querySelector("canvas.globe-ghost");
if (ghost) mountStandIn(ghost, hint === "start" ? first : null);
