// The globe's labels: how many may show at once, and when they need laying out again. A label is the
// same size on every screen, so a small globe (a phone) has room for far fewer than a large one.
// Pure: tested in web/test/labels.test.mjs.
import { RADIUS } from "../shared/globe-math.js";

/** The room one label needs to sit calmly, in px² of globe on screen (about 114 × 114 px). */
export const LABEL_AREA_PX = 13000;
/** How far beyond the globe's edge the labels of the countries at its rim reach, in px. */
export const LABEL_REACH_PX = 28;
/** The most labels for the zoom alone, whatever the screen: all a large globe is held to. */
export const LABELS_PER_ZOOM = 20;

/**
 * How much of the globe is on screen, in px²: its disc (COBE draws it at 0.8 of the half-box, times
 * the zoom, and `reach` px are added all round) less what lies beyond its square box of `size` px.
 */
export function globeAreaOnScreen(size, zoom = 1, reach = 0) {
  const half = size / 2, r = RADIUS * half * zoom + reach;
  if (r <= half) return Math.PI * r * r;
  if (r >= half * Math.SQRT2) return size * size;
  return Math.PI * r * r - 4 * (r * r * Math.acos(half / r) - half * Math.sqrt(r * r - half * half));
}

/**
 * How many labels may show at once on a globe `size` px across at this zoom: one per LABEL_AREA_PX of
 * globe on screen (with the labels' reach around it), and never more than LABELS_PER_ZOOM × zoom.
 * A phone's globe (360 px) gets 7 with the whole globe in view and 10 from the first step of zoom; a
 * desktop's (660 px and up) 20, then 40 at zoom 2, as before: more than it ever has in view.
 */
export function labelCap(size, zoom = 1) {
  const room = globeAreaOnScreen(size, zoom, LABEL_REACH_PX) / LABEL_AREA_PX;
  return Math.max(3, Math.round(Math.min(LABELS_PER_ZOOM * zoom, room)));
}

/** Labels are laid out again once the globe's surface has moved this far on screen (px). */
export const LAYOUT_STEP_PX = 3;
/**
 * How far the globe's surface has moved on screen between two views ({ phi, theta, zoom }), in px, at
 * its centre, where it moves most. Infinity when either view is not a view yet.
 */
export function viewShiftPx(from, to, size) {
  const r = RADIUS * (size / 2);
  const shift = (Math.abs(to.phi - from.phi) + Math.abs(to.theta - from.theta)) * r * to.zoom + Math.abs(to.zoom - from.zoom) * r;
  return Number.isFinite(shift) ? shift : Infinity;
}
