// Which country is the pointer on? The dots decide, not the borders: a country's dot is often bigger
// than the country (Albania, The Gambia, Kuwait), so the whole dot and a margin around it is the
// target, and the nearest dot wins where several are close (the Gulf, West Africa, the Caribbean).
// Borders are only the fallback, so a big country can still be picked anywhere inside it.
// A fingertip that lands among several dots is asked which it meant (dotsInReach, isAmbiguous).
// Everything here is in screen pixels, so it holds at any zoom. Pure: tested in web/test/pick.test.mjs.

export const MOUSE = { margin: 10, min: 18 };          // px: the dot's radius + margin, at least `min`
export const TOUCH = { margin: 10, min: 22 };          // a fingertip: at least a 44px target

/** The radius, in CSS px, at which COBE draws a marker of this `size` (its shader: size × scale × canvas ÷ 4). */
export const dotRadius = (markerSize, canvasSize, zoom = 1) => (markerSize * zoom * canvasSize) / 4;

/** How far from a dot's centre the pointer still counts as on it. */
export const reachOf = (radius, { margin = MOUSE.margin, min = MOUSE.min } = {}) => Math.max((radius || 0) + margin, min);

/**
 * The dot under the pointer, or null. points: [{ slug, x, y, r, visible }] (centre and drawn radius
 * in px; visible: on the near side of the globe and on the canvas). Of the dots whose reach covers
 * the pointer, the one whose centre is nearest wins.
 */
export function pickDot(points, x, y, reach = MOUSE) {
  let best = null, bestDist = Infinity;
  for (const p of points) {
    if (!p.visible) continue;
    const dist = Math.hypot(p.x - x, p.y - y);
    if (dist <= reachOf(p.r, reach) && dist < bestDist) { best = p; bestDist = dist; }
  }
  return best ? best.slug : null;
}

/** Dots first; only when no dot is in reach, the country whose border contains the point (`byBorder()`). */
export function pickCountry(points, x, y, reach, byBorder) {
  return pickDot(points, x, y, reach) ?? byBorder?.() ?? null;
}

// A fingertip is wider than the gaps between many dots on a phone (Lebanon and Palestine are 5 px
// apart there, and still only 16 px at full zoom), so a tap among them cannot say which was meant.
// The page then asks (a short list by the finger) instead of guessing.

/** Every dot whose reach covers the point, nearest first: [{ slug, distance }] (distance to its centre, px). */
export function dotsInReach(points, x, y, reach = MOUSE) {
  const near = [];
  for (const p of points) {
    if (!p.visible) continue;
    const distance = Math.hypot(p.x - x, p.y - y);
    if (distance <= reachOf(p.r, reach)) near.push({ slug: p.slug, distance });
  }
  return near.sort((a, b) => a.distance - b.distance);
}

// A second dot counts as "as likely as the first" when it is within `near` px of the tap (under the
// fingertip too), or less than `gap` px further away than the first (no clear winner).
export const AMBIGUOUS = { gap: 14, near: 20 };

/**
 * Is a tap among these dots (dotsInReach) a guess? No with none or one in reach, or when the nearest
 * is clearly the one: the second is at least `gap` px further from the tap and more than `near` px from it.
 */
export function isAmbiguous(inReach, { gap = AMBIGUOUS.gap, near = AMBIGUOUS.near } = {}) {
  if (inReach.length < 2) return false;
  const [first, second] = inReach;
  return second.distance - first.distance < gap || second.distance <= near;
}

/**
 * Where a list of `w` × `h` px goes for a tap at (x, y), inside `box` { left, top, right, bottom }
 * (the part of the globe's stage that is on screen): `gap` px clear of the finger, above it if there
 * is room, else below, else on the roomier side and as clear of the finger as the box allows. It is
 * centred on the finger, slid along to stay `pad` px inside the box, and always wholly inside it
 * (when it fits at all). Returns { left, top, side: "above" | "below" }.
 */
export function placeChooser({ x, y, w, h, box, gap = 20, pad = 6 }) {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lo = box.top + pad, hi = box.bottom - pad;
  const roomAbove = y - gap - lo, roomBelow = hi - (y + gap);
  const side = roomAbove >= h ? "above" : roomBelow >= h ? "below" : roomAbove >= roomBelow ? "above" : "below";
  const top = clamp(side === "above" ? y - gap - h : y + gap, lo, Math.max(lo, hi - h));
  const left = clamp(x - w / 2, box.left + pad, Math.max(box.left + pad, box.right - pad - w));
  return { left, top, side };
}
