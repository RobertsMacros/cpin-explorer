// Picking a country on the globe: the dots are the targets, borders only the fallback.
import assert from "node:assert/strict";
import { test } from "node:test";
import { AMBIGUOUS, MOUSE, TOUCH, dotRadius, dotsInReach, isAmbiguous, pickCountry, pickDot, placeChooser, reachOf } from "../../prototypes/dashboard/pick.js";

const dot = (slug, x, y, r = 8, visible = true) => ({ slug, x, y, r, visible });

test("the dot's drawn radius follows COBE's marker size, the canvas and the zoom", () => {
  assert.equal(dotRadius(0.04, 900), 9);                 // size × canvas ÷ 4
  assert.equal(dotRadius(0.04, 900, 2), 18);             // zoomed in: twice as large on screen
  assert.equal(dotRadius(0.064, 888), 0.064 * 888 / 4);
});

test("the whole dot and a margin around it is the target: centre, rim and just outside the rim", () => {
  const albania = dot("albania", 500, 400, 12.2);        // a dot larger than the country under it
  assert.equal(pickDot([albania], 500, 400), "albania", "centre");
  assert.equal(pickDot([albania], 500 + 12, 400), "albania", "on the rim");
  assert.equal(pickDot([albania], 500, 400 - 21), "albania", "just outside the rim, within the 10 px margin");
  assert.equal(pickDot([albania], 500 + 23, 400), null, "beyond the margin");
  assert.equal(reachOf(12.2), 22.2);
});

test("a small dot still has a comfortable target: at least 18 px for a mouse, 22 px (44 across) for a finger", () => {
  const chad = dot("chad", 100, 100, 6.9);
  assert.equal(reachOf(6.9), 18);
  assert.equal(pickDot([chad], 117, 100, MOUSE), "chad");
  assert.equal(pickDot([chad], 119, 100, MOUSE), null);
  assert.equal(pickDot([chad], 121, 100, TOUCH), "chad", "a fingertip reaches further");
  assert.equal(pickDot([chad], 123, 100, TOUCH), null);
  assert.ok(reachOf(0, TOUCH) * 2 >= 44);
});

test("in a cluster the nearest centre wins, whichever dot is larger or listed first", () => {
  // The Levant at the default zoom: Lebanon, Syria and Palestine within a few px of each other.
  const cluster = [dot("syria", 568, 458, 14), dot("lebanon", 552, 462, 8), dot("palestine", 550, 476, 8), dot("iraq", 596, 470, 12)];
  assert.equal(pickDot(cluster, 553, 461), "lebanon");
  assert.equal(pickDot(cluster, 549, 478), "palestine");
  assert.equal(pickDot(cluster, 566, 457), "syria");
  assert.equal(pickDot(cluster, 559, 460), "lebanon", "between Syria and Lebanon, a little nearer Lebanon's centre");
  assert.equal(pickDot([...cluster].reverse(), 559, 460), "lebanon", "order does not matter");
  assert.equal(pickDot(cluster, 561, 460), "syria", "a little nearer Syria's");
  assert.equal(pickDot(cluster, 551, 468), "lebanon", "between Lebanon and Palestine: whichever centre is nearer");
  assert.equal(pickDot(cluster, 551, 470), "palestine");
});

test("a dot on the far side of the globe, or off the canvas, is not a target", () => {
  const hidden = dot("brazil", 300, 300, 10, false);
  assert.equal(pickDot([hidden], 300, 300), null);
  assert.equal(pickDot([hidden, dot("ghana", 310, 300, 8)], 300, 300), "ghana");
});

test("a dot in reach beats the border of the larger neighbour under it; with no dot in reach the border decides", () => {
  const dots = [dot("gambia", 200, 300, 7.6), dot("kuwait", 640, 420, 7.6)];
  const border = (slug) => () => slug;
  // The Gambia's dot sits on Senegal (no notes: the border test says nothing) and Kuwait's by Iraq.
  assert.equal(pickCountry(dots, 205, 296, MOUSE, border(null)), "gambia");
  assert.equal(pickCountry(dots, 648, 428, MOUSE, border("iraq")), "kuwait", "Iraq's border is under the pointer, but Kuwait's dot is in reach");
  assert.equal(pickCountry(dots, 700, 380, MOUSE, border("iraq")), "iraq", "well inside Iraq, away from any dot");
  assert.equal(pickCountry(dots, 900, 900, MOUSE, border(null)), null, "open sea");
  let asked = 0;
  pickCountry(dots, 200, 300, MOUSE, () => { asked++; return "senegal"; });
  assert.equal(asked, 0, "the border is not even consulted when a dot is hit");
});

test("thresholds are screen pixels: zooming in grows the dot's own target, never shrinks the margin", () => {
  const size = 0.03, canvas = 900;
  const at = (zoom) => reachOf(dotRadius(size, canvas, zoom));
  assert.equal(at(1), 18);                               // 6.75 px dot: the minimum applies
  assert.equal(at(3), 6.75 * 3 + 10);                    // 20.25 px dot + margin
  assert.ok(at(3) > at(1));
});

// --- A fingertip among several dots: ask, don't guess -------------------------------------------------
// The dots as a 375 px phone draws them (radius about 3 px, so a fingertip's reach is the 22 px minimum).
const phone = (slug, x, y, visible = true) => dot(slug, x, y, 3, visible);
const levant = [phone("lebanon", 200, 200), phone("palestine", 199, 205), phone("syria", 205, 197), phone("iraq", 217, 199), phone("kuwait", 226, 207)];
const near = (points, x, y, reach = TOUCH) => dotsInReach(points, x, y, reach);
const slugsOf = (list) => list.map((d) => d.slug);

test("the dots in reach of a point come nearest first, with their distances", () => {
  const list = near(levant, 200, 200);
  assert.deepEqual(slugsOf(list), ["lebanon", "palestine", "syria", "iraq"], "Kuwait (27 px away) is out of a fingertip's reach");
  assert.equal(list[0].distance, 0);
  assert.ok(Math.abs(list[1].distance - Math.hypot(1, 5)) < 1e-9);
  assert.ok(list.every((d, i) => i === 0 || d.distance >= list[i - 1].distance), "sorted by distance");
  assert.deepEqual(slugsOf(near([...levant].reverse(), 200, 200)), slugsOf(list), "the order of the input does not matter");
  assert.deepEqual(near(levant, 400, 400), [], "open sea: nothing in reach");
});

test("the nearest in reach is the dot a direct pick takes; hidden dots are never candidates", () => {
  for (const [x, y] of [[200, 200], [203, 199], [210, 203], [224, 206], [190, 210]]) {
    assert.equal(near(levant, x, y)[0]?.slug ?? null, pickDot(levant, x, y, TOUCH));
  }
  const withHidden = [phone("brazil", 100, 100, false), phone("guyana", 106, 100)];
  assert.deepEqual(slugsOf(near(withHidden, 100, 100)), ["guyana"]);
});

test("reach follows the pointer: a mouse reaches 18 px, a fingertip 22, and a big dot its radius plus the margin", () => {
  const pts = [dot("a", 100, 100, 3), dot("b", 120, 100, 3)];
  assert.deepEqual(slugsOf(near(pts, 100, 100, MOUSE)), ["a"]);
  assert.deepEqual(slugsOf(near(pts, 100, 100, TOUCH)), ["a", "b"]);
  const zoomed = [dot("a", 100, 100, 17), dot("b", 126, 100, 17)];            // at full zoom: reach is 27 px
  assert.deepEqual(slugsOf(near(zoomed, 100, 100, TOUCH)), ["a", "b"]);
});

test("a tap is ambiguous when a second dot is as likely as the first", () => {
  assert.equal(isAmbiguous([]), false, "nothing in reach");
  assert.equal(isAmbiguous([{ slug: "brazil", distance: 4 }]), false, "one dot in reach: it is the one");
  // Lebanon, Palestine (5 px) and Syria (6 px): a tap on any of them could mean any of them.
  assert.equal(isAmbiguous(near(levant, 200, 200)), true);
  assert.equal(isAmbiguous(near(levant, 199, 205)), true);
  // Kuwait and Iraq are 12 px apart: a tap right on Kuwait's dot still has Iraq under the fingertip.
  assert.equal(isAmbiguous([{ slug: "kuwait", distance: 0 }, { slug: "iraq", distance: 12 }]), true);
  // Half way between two dots 30 px apart: no telling which.
  assert.equal(isAmbiguous([{ slug: "a", distance: 15 }, { slug: "b", distance: 15.5 }]), true);
});

test("the nearest dot is taken directly only when it is clearly the one: the next is 14 px further and beyond 20 px", () => {
  assert.deepEqual(AMBIGUOUS, { gap: 14, near: 20 });
  assert.equal(isAmbiguous([{ slug: "a", distance: 2 }, { slug: "b", distance: 21 }]), false, "on a's dot; b is at the edge of reach");
  assert.equal(isAmbiguous([{ slug: "a", distance: 7 }, { slug: "b", distance: 21.5 }]), false, "14.5 px further, and beyond 20 px");
  assert.equal(isAmbiguous([{ slug: "a", distance: 2 }, { slug: "b", distance: 20 }]), true, "within 20 px of the tap: under the fingertip");
  assert.equal(isAmbiguous([{ slug: "a", distance: 2 }, { slug: "b", distance: 17 }]), true, "15 px further, but still under the fingertip");
  assert.equal(isAmbiguous([{ slug: "a", distance: 9 }, { slug: "b", distance: 21.5 }]), true, "only 12.5 px further: no clear winner");
  assert.equal(isAmbiguous([{ slug: "a", distance: 10 }, { slug: "b", distance: 25 }]), false, "zoomed in (a longer reach): 15 px further and beyond 20 px");
  // Only the two nearest decide; a third further off changes nothing.
  assert.equal(isAmbiguous([{ slug: "a", distance: 2 }, { slug: "b", distance: 21 }, { slug: "c", distance: 22 }]), false);
});

test("an isolated dot on a phone is still picked directly, from anywhere in its 44 px target", () => {
  const brazil = [phone("brazil", 170, 170), phone("guyana", 150, 122)];      // 52 px apart
  for (const [x, y] of [[170, 170], [170, 150], [190, 172], [156, 184]]) {
    const list = near(brazil, x, y);
    assert.deepEqual(slugsOf(list), ["brazil"]);
    assert.equal(isAmbiguous(list), false);
  }
});

test("the list goes above the finger when there is room, else below, and always stays inside the box", () => {
  const box = { left: 0, top: 0, right: 343, bottom: 343 };
  const fits = (at, w, h, b = box) => at.left >= b.left && at.left + w <= b.right && at.top >= b.top && at.top + h <= b.bottom;
  const above = placeChooser({ x: 170, y: 250, w: 200, h: 170, box });
  assert.equal(above.side, "above");
  assert.equal(above.top, 250 - 20 - 170, "its bottom edge 20 px clear of the finger");
  assert.equal(above.left, 70, "centred on the finger");
  const below = placeChooser({ x: 170, y: 90, w: 200, h: 170, box });
  assert.equal(below.side, "below");
  assert.equal(below.top, 110);
  // Near an edge it slides along to stay inside (6 px from the edge).
  assert.equal(placeChooser({ x: 10, y: 250, w: 200, h: 120, box }).left, 6);
  assert.equal(placeChooser({ x: 340, y: 250, w: 200, h: 120, box }).left, 343 - 6 - 200);
  // Room on neither side (a long list, a tap in the middle): the roomier side, overlapping the finger rather than leaving the box.
  const tight = placeChooser({ x: 170, y: 150, w: 200, h: 250, box });
  assert.equal(tight.side, "below");
  assert.ok(fits(tight, 200, 250));
  const tightUp = placeChooser({ x: 170, y: 200, w: 200, h: 250, box });
  assert.equal(tightUp.side, "above");
  assert.ok(fits(tightUp, 200, 250));
  // Every tap point, several sizes: never outside the box.
  for (let x = 0; x <= 343; x += 49) for (let y = 0; y <= 343; y += 49) for (const h of [110, 160, 250]) {
    assert.ok(fits(placeChooser({ x, y, w: 200, h, box }), 200, h), `${x},${y} h${h}`);
  }
  // Part of the globe is under the sticky header (the box starts lower): the list keeps below it.
  const scrolled = { left: 0, top: 120, right: 343, bottom: 343 };
  const at = placeChooser({ x: 170, y: 200, w: 200, h: 160, box: scrolled });
  assert.ok(fits(at, 200, 160, scrolled));
});
