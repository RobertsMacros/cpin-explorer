import assert from "node:assert/strict";
import { test } from "node:test";
import { scatterStep } from "../../prototypes/shared/dot-flag.js";

const grid = () => {
  const dots = [];
  for (let r = 0; r < 9; r++) for (let c = 0; c < 12; c++) dots.push({ x: 5 + c * 10, y: 5 + r * 10, ox: 0, oy: 0, vx: 0, vy: 0 });
  return { dots, flagW: 120, pitch: 10, mouse: null, ripple: null };
};
const run = (state, seconds, t0 = 0) => {
  let now = t0;
  for (let i = 0; i < seconds * 60; i++) { now += 1000 / 60; scatterStep(state, 1 / 60, now); }
  return now;
};

test("dots near the pointer move away from it; distant dots stay put", () => {
  const s = grid();
  s.mouse = { x: 60, y: 45 };
  run(s, 0.6);
  const near = s.dots.find((d) => d.x === 65 && d.y === 45);      // just right of the pointer
  const far = s.dots.find((d) => d.x === 115 && d.y === 85);
  assert.ok(near.ox > 2, `near dot should move right, moved ${near.ox}`);
  assert.ok(Math.hypot(far.ox, far.oy) < 0.01, "far dot should not move");
});

test("when the pointer leaves, dots spring back (overshooting slightly) and settle", () => {
  const s = grid();
  s.mouse = { x: 60, y: 45 };
  const t = run(s, 0.6);
  s.mouse = null;
  const near = s.dots.find((d) => d.x === 65 && d.y === 45);
  let crossed = false;
  let now = t;
  for (let i = 0; i < 120; i++) { now += 1000 / 60; scatterStep(s, 1 / 60, now); if (near.ox < 0) crossed = true; }
  assert.ok(crossed, "springs past its rest position: the 'pop' back");
  const energy = run(s, 2, now) && s.dots.reduce((e, d) => e + Math.hypot(d.ox, d.oy), 0);
  assert.ok(energy < 0.05, `everything settles, residual ${energy}`);
});

test("entering sends a ripple outwards that fades", () => {
  const s = grid();
  s.ripple = { x: 5, y: 45, t0: 0 };
  run(s, 0.25);
  const moved = s.dots.filter((d) => Math.hypot(d.ox, d.oy) > 0.3).length;
  assert.ok(moved > 5, "ripple moves a band of dots");
  run(s, 3, 250);
  assert.equal(s.ripple, null);
});
