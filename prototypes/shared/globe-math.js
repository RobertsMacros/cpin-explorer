// COBE v2's projection and its inverse.
//
// Mirrors cobe/dist/index.esm.js (functions U, O and W in 2.0.1): a point [lat, lon] sits at
// (cos lat · cos lon, sin lat, −cos lat · sin lon) on a sphere of radius 0.8, which is rotated by
// phi (about the vertical axis) and theta (tilt) and drawn orthographically. Inverting it lets a
// click anywhere on the globe be turned back into latitude/longitude, then into a country.

export const RADIUS = 0.8;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function toVector([lat, lon]) {
  const a = rad(lat), b = rad(lon);
  return [Math.cos(a) * Math.cos(b), Math.sin(a), -Math.cos(a) * Math.sin(b)];
}

/** [lat, lon] -> {x, y} in 0..1 of the canvas box, plus whether it faces the viewer. */
export function project(latLon, { phi, theta, aspect = 1, scale = 1, elevation = 0 }) {
  const r = RADIUS + elevation;
  const [x, y, z] = toVector(latLon).map((v) => v * r);
  const cp = Math.cos(phi), sp = Math.sin(phi), ct = Math.cos(theta), st = Math.sin(theta);
  const c = cp * x + sp * z;
  const s = sp * st * x + ct * y - cp * st * z;
  const depth = -sp * ct * x + st * y + cp * ct * z;
  return {
    x: ((c / aspect) * scale + 1) / 2,
    y: (-s * scale + 1) / 2,
    depth: depth / r,                       // 1 = facing the viewer, 0 = on the horizon
    visible: depth >= 0 || c * c + s * s >= RADIUS * RADIUS,
  };
}

/** {x, y} in 0..1 of the canvas box -> [lat, lon], or null when the point misses the globe. */
export function unproject(x, y, { phi, theta, aspect = 1, scale = 1 }) {
  const c = ((2 * x - 1) * aspect) / scale;
  const s = -(2 * y - 1) / scale;
  const r2 = c * c + s * s;
  if (r2 > RADIUS * RADIUS) return null;
  const d = Math.sqrt(RADIUS * RADIUS - r2);
  const cp = Math.cos(phi), sp = Math.sin(phi), ct = Math.cos(theta), st = Math.sin(theta);
  // The rotation is orthonormal, so its inverse is its transpose.
  const tx = cp * c + sp * st * s - sp * ct * d;
  const ty = ct * s + st * d;
  const tz = sp * c - cp * st * s + cp * ct * d;
  return [deg(Math.asin(clamp(ty / RADIUS, -1, 1))), deg(Math.atan2(-tz, tx))];
}

/** The phi/theta that put [lat, lon] in the middle of the globe, facing the viewer. */
export function focus([lat, lon], { minTheta = -Math.PI / 2, maxTheta = Math.PI / 2 } = {}) {
  return { phi: -Math.PI / 2 - rad(lon), theta: clamp(rad(lat), minTheta, maxTheta) };
}

/** The signed angle from a to b, the short way round (−π..π). */
export function shortestTurn(a, b) {
  const turn = (((b - a) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
  return turn;
}

/** Point-in-polygon on a lon/lat ring. Used only for small patches, where planar is accurate. */
export function inRing([lon, lat], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
