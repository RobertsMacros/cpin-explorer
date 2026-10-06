// The globe in miniature (header mark, the big globe's stand-in): COBE's own lattice and land map.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { focus, project } from "../../prototypes/shared/globe-math.js";
import { HOME, MARKERS, MARK_DOTS, isLand, landDots, markShapes, viewOf } from "../../prototypes/shared/mini-globe.js";

const here = (p) => new URL(p, import.meta.url);

test("the land map knows land from sea", () => {
  for (const [name, lat, lon] of [["the Sahara", 23, 10], ["central Brazil", -10, -52], ["Siberia", 62, 100], ["Australia", -25, 135], ["Afghanistan", 34.5, 66]]) {
    assert.ok(isLand(lat, lon), `${name} is land`);
  }
  for (const [name, lat, lon] of [["the mid-Atlantic", 0, -30], ["the Pacific", 0, -150], ["the Indian Ocean", -30, 80], ["the Southern Ocean", -55, 0]]) {
    assert.ok(!isLand(lat, lon), `${name} is sea`);
  }
  assert.equal(isLand(10, 190), isLand(10, -170), "longitude wraps");
  assert.equal(isLand(10, -540 + 20), isLand(10, 20 - 180), "however far round");
});

test("the dots are COBE's lattice, kept where there is land", () => {
  const dots = landDots(16000);
  const n = dots.length / 3;
  assert.ok(n > 16000 * 0.25 && n < 16000 * 0.4, `about a third of the globe is land (${n} of 16000)`);
  for (let i = 0; i < dots.length; i += 3) {
    const len = Math.hypot(dots[i], dots[i + 1], dots[i + 2]);
    assert.ok(Math.abs(len - 1) < 1e-5, "each is a point on the unit sphere");
  }
  assert.equal(landDots(16000), dots, "worked out once");
  // In the globe's own frame: a land dot sits where project() would put that latitude and longitude.
  const [x, y, z] = dots.subarray(300, 303);
  const lat = (Math.asin(y) * 180) / Math.PI, lon = (Math.atan2(-z, x) * 180) / Math.PI;
  assert.ok(isLand(lat, lon));
  const p = project([lat, lon], focus([lat, lon]));
  assert.ok(Math.abs(p.x - 0.5) < 1e-6 && Math.abs(p.y - 0.5) < 1e-6 && p.depth > 0.999, "turned to face it, it is in the middle");
});

test("the mark: a ring, the land that faces the viewer, and a dot on the country in hand", () => {
  const plain = markShapes({ size: 64, view: viewOf(HOME) });
  assert.ok(plain.dots.length > 60 && plain.dots.length < landDots(MARK_DOTS).length / 3, "only the near side");
  assert.equal(plain.marks.length, 0);
  for (const d of plain.dots) {
    assert.ok(Math.hypot(d.x - 32, d.y - 32) + d.r < plain.ring.r, "every dot is inside the ring");
    assert.ok(d.alpha > 0.3 && d.alpha <= 1 && d.r > 0);
  }
  const brazil = markShapes({ size: 64, view: viewOf(MARKERS.brazil), pins: [{ at: MARKERS.brazil, level: 1 }] });
  assert.equal(brazil.marks.length, 1);
  assert.ok(Math.abs(brazil.marks[0].x - 32) < 0.5 && Math.abs(brazil.marks[0].y - 32) < 0.5, "turned to the country, its dot is in the middle");
  const fading = markShapes({ size: 64, view: viewOf(MARKERS.brazil), pins: [{ at: MARKERS.brazil, level: 0.5 }, { at: MARKERS.iran, level: 1 }, { at: MARKERS.china, level: 0 }] });
  assert.equal(fading.marks.length, 1, "Iran is round the back, China has faded out");
  assert.ok(fading.marks[0].r < brazil.marks[0].r && fading.marks[0].alpha === 0.5, "a dot easing in is smaller and fainter");
});

test("the tilt keeps within what the big globe allows", () => {
  for (const at of Object.values(MARKERS)) {
    const { theta } = viewOf(at);
    assert.ok(theta >= -0.9 && theta <= 1.0);
  }
});

test("the globe markers are in step with their country configuration", () => {
  const config = JSON.parse(readFileSync(here("../../config/countries.json"), "utf8")).countries;
  assert.deepEqual(MARKERS, Object.fromEntries(Object.entries(config).map(([slug, c]) => [slug, c.marker])), "a marker for every country, as in config/countries.json");
});
