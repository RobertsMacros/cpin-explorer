// Which country is the pointer on? The dots decide, not the borders: a country's dot is often bigger
// than the country (Albania, The Gambia, Kuwait), so the whole dot and a margin around it is the
// target, and the nearest dot wins where several are close (the Gulf, West Africa, the Caribbean).
// Borders are only the fallback, so a big country can still be picked anywhere inside it.
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
