// The globe in miniature: the same dots in the same places as the start page's globe.
//
// COBE lays its dots on a spiral lattice (point j of n sits at height 1 − 2j/n, each a golden-ratio
// turn on from the last) and lights the ones on land, by its own 256 × 128 map. This does the same
// sums on a 2D canvas, so the header mark, and the stand-in shown while the real globe starts up, are
// the globe itself drawn small rather than a picture of one: turn them to a country and that country
// is where it is on the big globe.
import { LAND, MARKERS } from "../vendor/globe-mini-data.js";
import { focus, toVector } from "./globe-math.js";

export { MARKERS };
/** The start page's opening view: Africa and the Middle East. */
export const HOME = [24, 38];

const deg = (r) => (r * 180) / Math.PI;
const STRIDE = LAND.cols >> 3;
let bits = null;

/** Is [lat, lon] on land, by COBE's map? */
export function isLand(lat, lon) {
  bits ??= Uint8Array.from(atob(LAND.bits), (c) => c.charCodeAt(0));
  const x = Math.min(LAND.cols - 1, Math.floor((((lon + 180) % 360 + 360) % 360) / 360 * LAND.cols));
  const y = Math.min(LAND.rows - 1, Math.max(0, Math.floor(((90 - lat) / 180) * LAND.rows)));
  return ((bits[y * STRIDE + (x >> 3)] >> (7 - (x & 7))) & 1) === 1;
}

const lattices = new Map();
/** The land dots of COBE's n-point lattice: unit vectors (x, y, z, x, y, z, …) in the globe's own frame (globe-math.js). */
export function landDots(n) {
  if (!lattices.has(n)) {
    const out = [];
    for (let j = 0; j <= n; j++) {
      const y = 1 - (2 * j) / n, m = Math.sqrt(Math.max(0, 1 - y * y)), turn = 2 * Math.PI * ((j * 0.618034) % 1);
      const x = m * Math.cos(turn), z = m * Math.sin(turn);
      if (isLand(deg(Math.asin(y)), deg(Math.atan2(-z, x)))) out.push(x, y, z);
    }
    lattices.set(n, Float32Array.from(out));
  }
  return lattices.get(n);
}

/** phi and theta that bring [lat, lon] to the middle, within the tilt the big globe allows itself. */
export const viewOf = (latLon) => focus(latLon, { minTheta: -0.9, maxTheta: 1.0 });

/** The rotation of globe-math's project(), for many points: returns (v) => [across, up, depth], each −1..1. */
function turner({ phi, theta }) {
  const cp = Math.cos(phi), sp = Math.sin(phi), ct = Math.cos(theta), st = Math.sin(theta);
  return (x, y, z) => [cp * x + sp * z, sp * st * x + ct * y - cp * st * z, -sp * ct * x + st * y + cp * ct * z];
}

/** Dots in the mark's lattice: few enough to read as dots at the size of a header mark. */
export const MARK_DOTS = 520;

/**
 * The mark's geometry, in a square of `size`: the ring, the land dots that face the viewer (larger and
 * stronger towards the middle), and a solid dot on each marked country. One description, drawn on a
 * canvas by paintMark and written out as the static mark.svg by web/build-mark.mjs.
 *   view   { phi, theta }
 *   pins   countries to mark: [{ at: [lat, lon], level }], level 0..1 easing each in or out
 */
export function markShapes({ size, view, pins = [] }) {
  const c = size / 2, R = size * 0.414, turn = turner(view), land = landDots(MARK_DOTS);
  const rmax = R * Math.sqrt((4 * Math.PI) / MARK_DOTS) * 0.34;
  const dots = [];
  for (let i = 0; i < land.length; i += 3) {
    const [x, y, depth] = turn(land[i], land[i + 1], land[i + 2]);
    if (depth > 0.08) dots.push({ x: c + R * x, y: c - R * y, r: rmax * (0.38 + 0.62 * depth), alpha: 0.3 + 0.7 * depth });
  }
  const marks = [];
  for (const { at, level } of pins) {
    if (!(level > 0.01)) continue;
    const [x, y, depth] = turn(...toVector(at));
    if (depth > 0) marks.push({ x: c + R * x, y: c - R * y, r: Math.max(2, size * 0.085) * (0.5 + 0.5 * level), gap: Math.max(1, size * 0.035), alpha: level });
  }
  return { ring: { x: c, y: c, r: size * 0.455, width: Math.max(1, size * 0.017), alpha: 0.45 }, dots, marks };
}

/** Draw the mark in one colour. ctx: a 2D context already scaled so that one unit is one CSS px. */
export function paintMark(ctx, { size, view, colour, pins = [] }) {
  const { ring, dots, marks } = markShapes({ size, view, pins });
  const disc = (x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); };
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = ctx.strokeStyle = colour;
  ctx.globalAlpha = ring.alpha;
  ctx.lineWidth = ring.width;
  disc(ring.x, ring.y, ring.r);
  ctx.stroke();
  for (const d of dots) { ctx.globalAlpha = d.alpha; disc(d.x, d.y, d.r); ctx.fill(); }
  for (const m of marks) {
    ctx.globalAlpha = m.alpha;
    ctx.globalCompositeOperation = "destination-out";              // a clear margin, so the dot reads among the land
    disc(m.x, m.y, m.r + m.gap); ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    disc(m.x, m.y, m.r); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/**
 * The stand-in for the big globe while it starts: its land dots where COBE will draw them (the same
 * lattice, 16,000 points, on a globe 0.8 of the box across), in one colour, fainter towards the edge.
 */
export function paintStandIn(ctx, { size, view, colour, samples = 16000 }) {
  const c = size / 2, R = size * 0.4, turn = turner(view), dots = landDots(samples), r = Math.max(0.8, R * 0.0052);
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = colour;
  const bands = [[], [], [], []];                                  // by depth, so a frame is four fills
  for (let i = 0; i < dots.length; i += 3) {
    const [x, y, depth] = turn(dots[i], dots[i + 1], dots[i + 2]);
    if (depth > 0.04) bands[Math.min(3, Math.floor(depth * 4))].push(c + R * x, c - R * y);
  }
  bands.forEach((points, band) => {
    ctx.globalAlpha = Math.min(1, 1.1 * ((band + 0.5) / 4) ** 0.4) * 0.9;
    ctx.beginPath();
    for (let i = 0; i < points.length; i += 2) { ctx.moveTo(points[i] + r, points[i + 1]); ctx.arc(points[i], points[i + 1], r, 0, Math.PI * 2); }
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}
