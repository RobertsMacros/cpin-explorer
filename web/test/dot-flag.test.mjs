import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SCATTER, SCATTER_KEY, loadScatterSettings, scatterSettings, scatterStep } from "../../prototypes/shared/dot-flag.js";

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

// --- the owner's tuning: "stronger, less reach, more bounce" (3 Oct 2026) ------------------------
const displaced = (s) => s.dots.filter((d) => Math.hypot(d.ox, d.oy) > 0.5);

test("the defaults are a sharp, very local push: dots by the pointer are shoved clear, the rest of the flag is untouched", () => {
  assert.deepEqual(DEFAULT_SCATTER, { strength: 1.7, reach: 0.09, bounce: 0.8 });
  assert.deepEqual({ ...scatterSettings }, DEFAULT_SCATTER, "nothing saved: the defaults apply");
  // The country page's flag: 24 dots across.
  const dots = [];
  for (let r = 0; r < 18; r++) for (let c = 0; c < 24; c++) dots.push({ x: 5 + c * 10, y: 5 + r * 10, ox: 0, oy: 0, vx: 0, vy: 0 });
  const s = { dots, flagW: 240, pitch: 10, mouse: { x: 120, y: 90 }, ripple: null };
  run(s, 1.5);
  const reachPx = s.flagW * DEFAULT_SCATTER.reach;                    // 21.6 px: about two dots either side
  const moved = displaced(s);
  assert.ok(moved.length >= 8 && moved.length <= 24, `only the dots round the pointer move: ${moved.length} of ${dots.length}`);
  assert.ok(moved.every((d) => Math.hypot(d.x - 120, d.y - 90) < reachPx), "none beyond the reach");
  const nearest = dots.find((d) => d.x === 125 && d.y === 95);
  const shove = Math.hypot(nearest.ox, nearest.oy);
  assert.ok(shove > s.pitch, `the nearest dots are pushed more than a dot's spacing (${shove.toFixed(1)} px)`);
  assert.ok(Math.hypot(nearest.x + nearest.ox - 120, nearest.y + nearest.oy - 90) > reachPx * 0.9, "clear out to the edge of the reach: a sharp hole");
  assert.ok(dots.every((d) => Math.hypot(d.ox, d.oy) < s.flagW * 0.22), "nothing is thrown past the flag's margin");
});

test("at the defaults everything settles within about a second of the pointer leaving, without jitter", () => {
  const s = grid();
  s.mouse = { x: 60, y: 45 };
  s.ripple = { x: 60, y: 45, t0: 0 };
  let now = run(s, 0.8);
  s.mouse = null;
  let peak = 0, crossings = 0, last = 0;
  const nearest = s.dots.find((d) => d.x === 65 && d.y === 45);
  for (let i = 0; i < 60; i++) {                                       // the second after leaving
    now += 1000 / 60; scatterStep(s, 1 / 60, now);
    if (i > 0 && Math.sign(nearest.ox) !== Math.sign(last) && Math.abs(nearest.ox) > 0.01) crossings++;
    last = nearest.ox;
    if (i >= 54) peak = Math.max(peak, ...s.dots.map((d) => Math.hypot(d.ox, d.oy)));
  }
  assert.ok(crossings >= 1, "a lively spring-back: it overshoots");
  assert.ok(crossings <= 6, `but it does not ring on and on (${crossings} crossings)`);
  assert.ok(peak < 0.6, `within a second every dot is within ${peak.toFixed(2)} px of home`);
  run(s, 1, now);
  assert.ok(s.dots.every((d) => Math.hypot(d.ox, d.oy) < 0.02 && Math.hypot(d.vx, d.vy) < 0.5), "and then it is still");
});

test("the ripple on entering is local too: it dies away within a few reaches of the entry point", () => {
  const s = grid();
  s.ripple = { x: 5, y: 45, t0: 0 };
  let now = 0, farPeak = 0, nearPeak = 0;
  for (let i = 0; i < 72; i++) {
    now += 1000 / 60; scatterStep(s, 1 / 60, now);
    for (const d of s.dots) {
      const dist = Math.hypot(d.x - 5, d.y - 45), off = Math.hypot(d.ox, d.oy);
      if (dist > 70) farPeak = Math.max(farPeak, off); else if (dist < 25) nearPeak = Math.max(nearPeak, off);
    }
  }
  assert.ok(nearPeak > 2, `a real kick near the entry point (${nearPeak.toFixed(1)} px)`);
  assert.ok(farPeak < nearPeak / 8, `the far side of the flag barely stirs (${farPeak.toFixed(2)} px)`);
});

test("settings saved under earlier defaults are dropped; only this version's key is read, within the sliders' ranges", () => {
  const store = (init) => { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), m }; };
  assert.equal(SCATTER_KEY, "cpin-flag-scatter-v3");
  const old = store({ "cpin-flag-scatter": JSON.stringify({ strength: 0.8, reach: 0.22, bounce: 0.6 }), "cpin-flag-scatter-v2": JSON.stringify({ strength: 1.2, reach: 0.14, bounce: 0.6 }) });
  assert.deepEqual(loadScatterSettings(old), DEFAULT_SCATTER, "the old feel does not linger");
  assert.equal(old.m.size, 0, "and the stale keys are cleared");
  const tuned = store({ [SCATTER_KEY]: JSON.stringify({ strength: 2.1, reach: 0.07 }) });
  assert.deepEqual(loadScatterSettings(tuned), { strength: 2.1, reach: 0.07, bounce: 0.8 }, "the owner's own tuning is kept");
  assert.deepEqual(loadScatterSettings(store({ [SCATTER_KEY]: JSON.stringify({ strength: 99, reach: -1, bounce: "x" }) })), { strength: 3, reach: 0.02, bounce: 0.8 });
  assert.deepEqual(loadScatterSettings(store({ [SCATTER_KEY]: "not json" })), DEFAULT_SCATTER);
  assert.deepEqual(loadScatterSettings(null), DEFAULT_SCATTER);
});
