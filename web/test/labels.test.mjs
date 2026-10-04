// How many labels the globe may show (a calm handful on a phone, as before on a large globe), and when they are laid out again.
import assert from "node:assert/strict";
import { test } from "node:test";
import { LABELS_PER_ZOOM, LABEL_AREA_PX, LABEL_REACH_PX, LAYOUT_STEP_PX, globeAreaOnScreen, labelCap, viewShiftPx } from "../../prototypes/dashboard/labels.js";

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test("the globe's area on screen: its disc while it fits its box, the whole box once it fills it, and no jump between", () => {
  assert.ok(near(globeAreaOnScreen(500, 1), Math.PI * 200 * 200), "zoom 1: a disc of radius 0.8 × half the box");
  assert.ok(near(globeAreaOnScreen(500, 1.25), Math.PI * 250 * 250), "zoom 1.25: the disc touches the box's edges");
  assert.equal(globeAreaOnScreen(500, 2), 500 * 500, "zoomed past the corners: the whole box");
  assert.equal(globeAreaOnScreen(500, 3.2), 500 * 500);
  assert.ok(near(globeAreaOnScreen(500, 1, 50), Math.PI * 250 * 250), "a reach around the disc counts as globe");
  let prev = 0;
  for (let zoom = 1; zoom <= 3.2; zoom += 0.01) {
    const area = globeAreaOnScreen(360, zoom, LABEL_REACH_PX);
    assert.ok(area >= prev - 1e-6, `never shrinks as the zoom grows (${zoom.toFixed(2)})`);
    assert.ok(prev === 0 || area - prev < 360 * 360 * 0.03, `no jump at zoom ${zoom.toFixed(2)}`);
    assert.ok(area <= 360 * 360 + 1e-6);
    prev = area;
  }
});

test("a phone's globe shows a calm handful of labels with the whole globe in view, and more once zoomed in", () => {
  // A 390 px wide phone: the globe's box is 358 to 360 px.
  for (const size of [358, 360]) {
    assert.equal(labelCap(size, 1), 7);
    assert.equal(labelCap(size, 1.45), 10, "one step of the + button");
    assert.equal(labelCap(size, 2), 10);
    assert.equal(labelCap(size, 3), 10);
  }
  assert.deepEqual([1, 2, 3].map((zoom) => labelCap(390, zoom)), [8, 12, 12], "a 390 px globe");
  for (const size of [343, 360, 398]) {                    // phones 375 to 430 px wide
    assert.ok(labelCap(size, 1) >= 6 && labelCap(size, 1) <= 8, `${size} px at zoom 1: ${labelCap(size, 1)}`);
    assert.ok(labelCap(size, 3.2) > labelCap(size, 1) && labelCap(size, 3.2) <= 12, `${size} px zoomed in: ${labelCap(size, 3.2)}`);
  }
  assert.ok(labelCap(288, 1) >= 3, "the narrowest phone still names a few countries");
});

test("a large globe keeps the cap it had: 20 × the zoom while that fits, which is more than it ever has in view", () => {
  for (const size of [727, 800, 960]) {
    assert.equal(labelCap(size, 1), 20);
    assert.equal(labelCap(size, 2), 40);
    assert.ok(labelCap(size, 3) >= 41, "zoomed right in, at most 24 countries are in view");
  }
  assert.deepEqual([1, 2, 3].map((zoom) => labelCap(800, zoom)), [20, 40, 49], "an 800 px globe");
  assert.equal(labelCap(1600, 3), LABELS_PER_ZOOM * 3, "a very large globe: the old rule exactly");
});

test("the cap follows the size and the zoom smoothly: never fewer labels for a larger globe or a closer zoom", () => {
  for (const zoom of [1, 1.45, 2.1, 3.05]) {
    let prev = 0;
    for (let size = 240; size <= 1200; size += 4) {
      const cap = labelCap(size, zoom);
      assert.ok(cap >= prev, `${size} px at zoom ${zoom}`);
      assert.ok(cap - prev <= 2 || prev === 0, `no leap between ${size - 4} and ${size} px at zoom ${zoom}`);
      prev = cap;
    }
  }
  for (const size of [300, 360, 544, 727, 1000]) {
    let prev = 0;
    for (let zoom = 1; zoom <= 3.2; zoom += 0.05) { const cap = labelCap(size, zoom); assert.ok(cap >= prev, `${size} px at zoom ${zoom.toFixed(2)}`); prev = cap; }
  }
  assert.ok(near(LABEL_AREA_PX, 114 * 114, 100), "about 114 px square for each label");
});

test("labels are laid out again once the globe's surface has moved a few px on screen", () => {
  const view = { phi: 1, theta: 0.2, zoom: 1 };
  assert.equal(viewShiftPx(view, view, 360), 0);
  // The globe turning by itself (0.0014 rad a frame): a fifth of a px a frame on a phone, so every 15th frame or so.
  const frame = viewShiftPx(view, { ...view, phi: 1.0014 }, 360);
  assert.ok(near(frame, 0.0014 * 144, 1e-9));
  assert.ok(LAYOUT_STEP_PX / frame > 10 && LAYOUT_STEP_PX / frame < 20);
  assert.ok(near(viewShiftPx(view, { ...view, theta: 0.21 }, 360), 0.01 * 144, 1e-9), "tilting counts the same");
  assert.ok(near(viewShiftPx({ ...view, zoom: 2 }, { ...view, phi: 1.01, zoom: 2 }, 360), 0.01 * 288, 1e-9), "zoomed in, the same turn moves the surface further");
  assert.ok(near(viewShiftPx(view, { ...view, zoom: 1.1 }, 360), 0.1 * 144, 1e-9), "zooming moves it too");
  assert.equal(viewShiftPx({ phi: NaN, theta: NaN, zoom: NaN }, view, 360), Infinity, "nothing laid out yet: lay out now");
  assert.ok(viewShiftPx({ phi: NaN, theta: NaN, zoom: NaN }, view, 360) >= LAYOUT_STEP_PX);
});
