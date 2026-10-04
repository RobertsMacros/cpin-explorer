// The calm hover: crossfade timing, hover intent, and the fast dot grid against the real borders.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { geoBounds, geoContains } from "d3-geo";
import { feature } from "topojson-client";
import { FADE_IN_MS, FADE_OUT_MS, FLAGS_FROM_ZOOM, FLAGS_FULL_ZOOM, FLAGS_STRENGTH, OUTLINE_FULL_PX, OUTLINE_GONE_PX, ambientLevel, createCountryGlow, createHoverIntent, easeFade, fadeAt, gridInPolygon, outlineLevel, retarget } from "../../prototypes/dashboard/country-glow.js";

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

test("a fade runs on the clock, not on frames: same opacity at the same time however often it is asked", () => {
  const fade = { from: 0, to: 1, t0: 1000, dur: 400 };
  assert.equal(fadeAt(fade, 900), 0, "before it starts");
  assert.equal(fadeAt(fade, 1000), 0);
  assert.ok(near(fadeAt(fade, 1200), 0.5), "half way in time is half way in opacity (the ease is symmetric)");
  assert.equal(fadeAt(fade, 1400), 1);
  assert.equal(fadeAt(fade, 99999), 1, "and it stays there");
  // Drawn at 30, 60 or 120 frames a second, the opacity at a given moment is the same.
  for (const fps of [30, 60, 120]) {
    let v = 0;
    for (let frame = 0; frame * (1000 / fps) <= 300; frame++) v = fadeAt(fade, 1000 + frame * (1000 / fps));
    assert.ok(near(v, fadeAt(fade, 1300), 1e-9), `${fps} fps`);
  }
});

test("the fade is eased: it starts and ends gently and never runs backwards", () => {
  assert.equal(easeFade(0), 0);
  assert.equal(easeFade(1), 1);
  assert.ok(easeFade(0.1) < 0.1 && easeFade(0.9) > 0.9, "slow at both ends");
  let prev = -1;
  for (let i = 0; i <= 100; i++) { const v = easeFade(i / 100); assert.ok(v >= prev, "monotonic"); prev = v; }
  assert.equal(easeFade(-3), 0);
  assert.equal(easeFade(7), 1);
});

test("a crossfade: the outgoing country fades out from where it is while the incoming fades in, 350 to 450 ms", () => {
  assert.ok(FADE_IN_MS >= 350 && FADE_IN_MS <= 450 && FADE_OUT_MS >= 350 && FADE_OUT_MS <= 450);
  const iran = retarget(null, 1, 0, FADE_IN_MS);                          // lit from nothing
  assert.deepEqual([iran.from, iran.to, iran.dur], [0, 1, FADE_IN_MS]);
  // 2 s later the pointer settles on Iraq: Iran goes out, Iraq comes in, both from the same moment.
  const out = retarget(iran, 0, 2000, FADE_OUT_MS), incoming = retarget(null, 1, 2000, FADE_IN_MS);
  assert.equal(out.from, 1);
  const mid = 2000 + 190;
  assert.ok(fadeAt(out, mid) > 0.3 && fadeAt(out, mid) < 0.7 && fadeAt(incoming, mid) > 0.3 && fadeAt(incoming, mid) < 0.7, "both part-lit mid-way: no swap");
  assert.equal(fadeAt(out, 2000 + FADE_OUT_MS), 0);
  assert.equal(fadeAt(incoming, 2000 + FADE_IN_MS), 1);
});

test("changing course mid-fade carries on from the current opacity: no jump, and a shorter trip takes less time", () => {
  const fadingIn = retarget(null, 1, 0, 400);
  const before = fadeAt(fadingIn, 120);
  const back = retarget(fadingIn, 0, 120, 400);
  assert.ok(near(back.from, before), "starts where it was");
  assert.ok(near(fadeAt(back, 120), before));
  assert.ok(back.dur < 400 && back.dur >= 0.35 * 400);
  const returning = retarget(back, 1, 130, 400);
  assert.ok(Math.abs(fadeAt(returning, 130) - fadeAt(back, 130)) < 1e-9, "and back again without a flicker");
  assert.equal(fadeAt({ from: 0.4, to: 1, t0: 0, dur: 0 }, 0), 1, "reduced motion (no duration): straight to the end");
});

/** A hover intent on a hand-wound clock. */
function intent(opts = {}) {
  const seen = [], timers = new Map();
  let clock = 0, ids = 0;
  const h = createHoverIntent({ delay: 100, leaveDelay: 180, slop: 9, ...opts, onChange: (slug) => seen.push([clock, slug]),
    setTimer: (fn, ms) => { timers.set(++ids, { at: clock + ms, fn }); return ids; }, clearTimer: (id) => timers.delete(id) });
  const tick = (ms) => {
    const end = clock + ms;
    for (;;) {
      const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]); clock = due[1].at; due[1].fn();
    }
    clock = end;
  };
  return { h, seen, tick };
}

test("hover intent: a country lights only after the pointer has rested on it for the delay", () => {
  const { h, seen, tick } = intent();
  h.point("iran", 100, 100);
  tick(99);
  assert.deepEqual(seen, [], "not yet");
  tick(1);
  assert.deepEqual(seen, [[100, "iran"]]);
  assert.equal(h.current, "iran");
});

test("hover intent: sweeping across the globe lights nothing", () => {
  const { h, seen, tick } = intent();
  let x = 0;
  for (const slug of ["turkey", "turkey", "syria", "iraq", "iraq", "iran", "iran", "afghanistan", "pakistan", "india"]) {
    h.point(slug, x += 40, 200);                       // 40 px every 30 ms: never at rest
    tick(30);
  }
  assert.deepEqual(seen, []);
  h.point("india", x + 2, 201);                         // now it rests
  tick(100);
  assert.deepEqual(seen.map(([, s]) => s), ["india"]);
});

test("hover intent: moving within one country still counts as travelling until the pointer slows", () => {
  const { h, seen, tick } = intent();
  for (let i = 0; i < 12; i++) { h.point("russia", i * 25, 50); tick(40); }      // crossing Russia at speed
  assert.deepEqual(seen, []);
  for (let i = 0; i < 6; i++) { h.point("russia", 300 + i, 50); tick(30); }      // slowing to a rest
  assert.deepEqual(seen.map(([, s]) => s), ["russia"]);
});

test("hover intent: neighbours hand over without going dark; a strait or a border crossing does not blink", () => {
  const { h, seen, tick } = intent();
  h.now("iran");
  h.point(null, 300, 300);                              // over the Gulf for 80 ms
  tick(80);
  h.point("kuwait", 310, 305);                          // then settles on Kuwait
  tick(100);
  assert.deepEqual(seen.map(([, s]) => s), ["iran", "kuwait"], "never reported 'nothing' in between");
  h.point(null, 320, 320); tick(60);
  h.point("kuwait", 311, 306); tick(500);               // out over the sea and straight back
  assert.deepEqual(seen.map(([, s]) => s), ["iran", "kuwait"], "still Kuwait: no blink");
});

test("hover intent: leaving the lit country goes dark after the leave delay, not at once", () => {
  const { h, seen, tick } = intent();
  h.now("iran");
  h.point(null, 0, 0);
  tick(179);
  assert.equal(h.current, "iran");
  tick(1);
  assert.deepEqual(seen.at(-1), [180, null]);
  h.now("iraq");
  h.leave();                                            // the pointer leaves the globe
  tick(180);
  assert.equal(h.current, null);
});

test("hover intent: a click commits at once, and cancels whatever was pending", () => {
  const { h, seen, tick } = intent();
  h.point("iraq", 10, 10);
  tick(40);
  h.now("iran");                                         // clicked Iran before Iraq had settled
  assert.deepEqual(seen, [[40, "iran"]]);
  tick(500);
  assert.deepEqual(seen, [[40, "iran"]], "the pending Iraq never fires");
});

test("hover intent: results in the panel (no position) light after the delay; a candidate is announced once", () => {
  const warmed = [];
  const { h, seen, tick } = intent({ onCandidate: (slug) => warmed.push(slug) });
  h.point("kenya"); h.point("kenya"); h.point("kenya");
  assert.deepEqual(warmed, ["kenya"], "so its dots can be built before it lights");
  tick(100);
  assert.deepEqual(seen.map(([, s]) => s), ["kenya"]);
});

// --- the dot grid, against the real borders ---------------------------------------------------
const topo = JSON.parse(readFileSync(new URL("../../prototypes/vendor/countries-gbr.json", import.meta.url), "utf8"));
const features = feature(topo, topo.objects.countries).features;
const polygonsOf = (f) => (f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [f.geometry.coordinates]);
const spacingFor = ([[w, s], [e, n]]) => Math.max(0.22, Math.min(1.6, Math.max(w > e ? e + 360 - w : e - w, n - s) / 30));
/** The grid the slow way: every point tested against the polygon on the sphere (what the page used to do). */
function slowGrid(coordinates, [[w, s], [e, n]], spacing) {
  const poly = { type: "Polygon", coordinates }, width = w > e ? e + 360 - w : e - w, out = [];
  for (let lat = s + spacing / 2; lat < n; lat += spacing) {
    const lonStep = spacing / Math.max(0.3, Math.cos((lat * Math.PI) / 180));
    for (let x = lonStep / 2; x < width; x += lonStep) {
      let lon = w + x;
      if (lon > 180) lon -= 360;
      if (geoContains(poly, [lon, lat])) out.push({ lat, lon });
    }
  }
  return out;
}

test("the scanline grid gives the same dots as testing every point against the border", () => {
  const key = (d) => `${d.lat.toFixed(4)},${d.lon.toFixed(4)}`;
  let total = 0, differ = 0;
  for (const name of ["Russia", "Iran", "Brazil", "France", "Albania", "Philippines", "Somalia", "India"]) {
    const f = features.find((x) => x.properties.NAME === name);
    assert.ok(f, name);
    for (const coordinates of polygonsOf(f)) {
      const bounds = geoBounds({ type: "Polygon", coordinates }), spacing = spacingFor(bounds);
      const fast = new Set(gridInPolygon(coordinates, bounds, spacing).map(key));
      const slow = new Set(slowGrid(coordinates, bounds, spacing).map(key));
      total += slow.size;
      for (const k of slow) if (!fast.has(k)) differ++;
      for (const k of fast) if (!slow.has(k)) differ++;
    }
  }
  assert.ok(total > 1500, `a real test: ${total} dots`);
  // The page's edges are straight lines in longitude/latitude, the sphere's are great circles: a point
  // within a whisker of a border may fall either side.
  assert.ok(differ / total < 0.01, `${differ} of ${total} dots differ`);
});

test("the grid is quick enough to build during a click (Russia in a few milliseconds)", () => {
  const russia = features.find((x) => x.properties.NAME === "Russia");
  const parts = polygonsOf(russia).map((coordinates) => { const bounds = geoBounds({ type: "Polygon", coordinates }); return [coordinates, bounds, spacingFor(bounds)]; });
  const t0 = performance.now();
  let dots = 0;
  for (let i = 0; i < 20; i++) for (const [coordinates, bounds, spacing] of parts) dots += gridInPolygon(coordinates, bounds, spacing).length;
  const each = (performance.now() - t0) / 20;
  assert.ok(dots / 20 > 300, "Russia has a few hundred dots");
  assert.ok(each < 25, `one build took ${each.toFixed(2)} ms`);
});

test("holes are left empty and a polygon across the antimeridian is filled on both sides", () => {
  const square = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], hole = [[4, 4], [4, 6], [6, 6], [6, 4], [4, 4]];
  const dots = gridInPolygon([square, hole], [[0, 0], [10, 10]], 1);
  assert.ok(dots.length > 80 && dots.length < 100);
  assert.ok(!dots.some((d) => d.lon > 4 && d.lon < 6 && d.lat > 4 && d.lat < 6), "nothing in the hole");
  const across = [[170, 60], [-170, 60], [-170, 70], [170, 70], [170, 60]];
  const wrapped = gridInPolygon([across], [[170, 60], [-170, 70]], 2);
  assert.ok(wrapped.some((d) => d.lon > 170) && wrapped.some((d) => d.lon < -170), "dots either side of 180°");
  assert.ok(wrapped.every((d) => d.lon >= -180 && d.lon <= 180 && (d.lon >= 170 || d.lon <= -170)));
});

test("the outline is for countries too small on screen for their flag to read, and melts away as they grow", () => {
  assert.equal(outlineLevel(6), 1, "Lebanon on the whole globe: a few pixels across");
  assert.equal(outlineLevel(OUTLINE_FULL_PX), 1);
  assert.equal(outlineLevel(OUTLINE_GONE_PX), 0);
  assert.equal(outlineLevel(400), 0, "Brazil: no outline");
  let prev = 2;
  for (let px = 0; px <= 60; px += 0.5) { const v = outlineLevel(px); assert.ok(v <= prev && v >= 0 && v <= 1, "never steps up, never jumps"); assert.ok(prev === 2 || prev - v < 0.05); prev = v; }
});

test("zoomed in, the flags of the countries in view come up with the zoom", () => {
  assert.equal(ambientLevel(1), 0, "the whole globe: only the country pointed at");
  assert.equal(ambientLevel(FLAGS_FROM_ZOOM), 0);
  assert.equal(ambientLevel(FLAGS_FULL_ZOOM), FLAGS_STRENGTH);
  assert.equal(ambientLevel(3.2), FLAGS_STRENGTH, "as close as it goes");
  assert.ok(FLAGS_STRENGTH > 0 && FLAGS_STRENGTH <= 1 && FLAGS_FROM_ZOOM > 1 && FLAGS_FULL_ZOOM > FLAGS_FROM_ZOOM);
  let prev = 0;
  for (let z = 1; z <= 3.2; z += 0.01) { const v = ambientLevel(z); assert.ok(v >= prev - 1e-12 && v - prev < 0.05, "eased: no step"); prev = v; }
});

// The glow itself, with a stand-in for the canvas: which countries it builds, and when.
function glowFor(slugs) {
  const square = (x) => ({ type: "Feature", geometry: { type: "Polygon", coordinates: [[[x, 0], [x, 8], [x + 8, 8], [x + 8, 0], [x, 0]]] } });
  const built = [], calls = [];
  const ctx = new Proxy({}, { get: (_, name) => (...args) => { calls.push(name); } });
  const canvas = { getContext: () => ctx, dataset: {}, width: 0, height: 0 };
  const glow = createCountryGlow({ canvas, shapes: new Map(slugs.map((slug, i) => [slug, [square(i * 10)]])), codeOf: (slug) => slug,
    sampleFlag: async (code) => { built.push(code); return null; }, geoBounds, isDark: () => false, reducedMotion: () => true });
  return { glow, built, calls, canvas };
}
/** Wait until `done()` holds (the builds take their turns on timers), or a second at most; then one turn more. */
async function settle(done = () => true) {
  for (let i = 0; i < 100 && !done(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  await new Promise((resolve) => setTimeout(resolve, 20));
}

test("zoomed in, the countries in view are built one at a time, in the order asked; the one pointed at never waits", async () => {
  const { glow, built } = glowFor(["a", "b", "c", "d", "e"]);
  glow.ambient(new Set(["a", "b", "c", "d", "e"]), 0.9);
  assert.deepEqual(built, ["a"], "one country at once, not the whole view");
  glow.set("d");                                           // pointed at while it waits its turn: now
  assert.deepEqual(built, ["a", "d"]);
  glow.warm("e");                                          // the pointer is heading for it: now, too
  assert.deepEqual(built, ["a", "d", "e"]);
  await settle(() => Object.keys(glow.levels).length === 5);
  assert.deepEqual(built, ["a", "d", "e", "b", "c"], "the rest in their turn, and nothing built twice");
  assert.deepEqual(Object.keys(glow.levels).sort(), ["a", "b", "c", "d", "e"], "all of them lit");
  glow.ambient(new Set(["a", "b", "c", "d", "e"]), 0.9);   // asked again every frame: nothing more to build
  await settle();
  assert.equal(built.length, 5);
});

test("a country pointed at is built at once, and one no longer wanted by the time it is built is not lit", async () => {
  const { glow, built } = glowFor(["a", "b", "c"]);
  glow.set("b");
  assert.deepEqual(built, ["b"], "no waiting for the pointed-at country");
  glow.ambient(new Set(["a", "c"]), 0.9);
  glow.ambient(new Set(), 0);                              // zoomed out again before they were built
  await settle(() => built.length === 3);
  assert.deepEqual(Object.keys(glow.levels), ["b"]);
});

test("with nothing lit the overlay is left alone: a turning globe wipes and draws nothing", async () => {
  const { glow, calls } = glowFor(["a"]);
  const view = { phi: -Math.PI / 2, theta: 0, scale: 1 }, size = 2000;   // facing the country, large enough to need no outline
  for (let i = 0; i < 5; i++) glow.draw({ ...view, phi: view.phi + i * 0.01 }, size, 1, true);
  assert.deepEqual(calls, [], "blank from the start: not even cleared");
  glow.set("a");
  await settle(() => "a" in glow.levels);
  glow.draw(view, size, 1, true);
  assert.ok(calls.includes("clearRect") && calls.includes("arc"), "lit: drawn");
  glow.set(null);
  await settle();
  glow.draw(view, size, 1, true);                          // faded out (reduced motion: at once): wiped, the layer dropped
  assert.equal(calls.at(-1), "clearRect", "wiped once");
  calls.length = 0;
  for (let i = 0; i < 5; i++) glow.draw({ ...view, phi: view.phi + i * 0.01 }, size, 1, true);
  assert.deepEqual(calls, [], "blank again: left alone");
});
