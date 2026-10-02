import assert from "node:assert/strict";
import { test } from "node:test";
import { focus, inRing, project, shortestTurn, unproject } from "../../prototypes/shared/globe-math.js";

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const places = { kabul: [34.53, 69.17], lima: [-12.05, -77.04], suva: [-18.14, 178.44], london: [51.5, -0.12] };

test("focus puts a place in the centre, facing the viewer", () => {
  for (const p of Object.values(places)) {
    const r = project(p, focus(p));
    close(r.x, 0.5); close(r.y, 0.5); close(r.depth, 1);
    assert.equal(r.visible, true);
  }
});

test("unproject inverts project for any rotation", () => {
  const views = [{ phi: 0, theta: 0 }, { phi: 1.3, theta: 0.4 }, { phi: -2.9, theta: -0.3 }, { phi: 5.5, theta: 0.9 }];
  for (const view of views) {
    for (const p of Object.values(places)) {
      const r = project(p, view);
      if (r.depth <= 0.05) continue;            // behind the globe: no pixel to click
      const [lat, lon] = unproject(r.x, r.y, view);
      close(lat, p[0], 1e-6);
      close(((lon - p[1] + 540) % 360) - 180, 0, 1e-6);
    }
  }
});

test("north is up and east is right when facing a place", () => {
  const view = focus(places.london);
  assert.ok(project([60, -0.12], view).y < 0.5);
  assert.ok(project([51.5, 10], view).x > 0.5);
});

test("a click outside the disc misses", () => {
  assert.equal(unproject(0.02, 0.02, { phi: 0, theta: 0 }), null);
});

test("shortest turn goes the short way round", () => {
  close(shortestTurn(0.1, 2 * Math.PI - 0.1), -0.2);
  close(shortestTurn(3, -3), 2 * Math.PI - 6);
});

test("inRing on a small lon/lat polygon", () => {
  const gaza = [[34.22, 31.32], [34.27, 31.22], [34.38, 31.3], [34.56, 31.54], [34.49, 31.6], [34.22, 31.32]];
  assert.equal(inRing([34.45, 31.45], gaza), true);
  assert.equal(inRing([34.8, 31.45], gaza), false);
});
