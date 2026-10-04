// The history timeline: which stop a pointer is on.
import assert from "node:assert/strict";
import { test } from "node:test";
import { STOP_REACH, stopInReach } from "../../prototypes/shared/timeline.js";

const stops = [{ x: 0.1 }, { x: 0.5 }, { x: 0.53 }, { x: 0.95 }];

test("the stop nearest the pointer is the one it is on, however small its mark", () => {
  assert.equal(stopInReach(stops, 100, 1000), 0, "dead on");
  assert.equal(stopInReach(stops, 100 + STOP_REACH, 1000), 0, "at the edge of its reach");
  assert.equal(stopInReach(stops, 100 + STOP_REACH + 1, 1000), -1, "just beyond: on nothing");
  assert.equal(stopInReach(stops, 300, 1000), -1, "open track");
});

test("between two close stops, the nearer wins", () => {
  assert.equal(stopInReach(stops, 512, 1000), 1);
  assert.equal(stopInReach(stops, 518, 1000), 2);
  assert.equal(stopInReach(stops, 940, 1000), 3);
});

test("reach is in pixels, so it holds on a narrow (phone) track", () => {
  assert.equal(stopInReach(stops, 30 + 20, 300), 0);
  assert.equal(stopInReach(stops, 30 + 40, 300), -1);
  assert.equal(stopInReach([], 10, 300), -1);
  assert.ok(STOP_REACH >= 22, "at least a 44px target");
});
