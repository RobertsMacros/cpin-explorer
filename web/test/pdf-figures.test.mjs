// Pictures from the PDF are set beside GOV.UK's web text by a place worked out when the data is built
// (src/cpin/pdftext.py). These tests cover how the page confirms that place before showing a picture.
import assert from "node:assert/strict";
import { test } from "node:test";
import { anchorIndex, figureKey } from "../../prototypes/shared/pdf-figures.js";

const blocks = [
  "1.1.1 The map below shows the areas held by each group in March 2026.",
  "1.1.2 Sources reported fighting in the north.",
  "1.1.3 The chart below shows incidents recorded each month, by province.",
  "Back to Contents",
].map(figureKey);
const keyAt = (i) => blocks[i] ?? "";

test("a key is the text in lower case with only its letters and digits, as the builder makes it", () => {
  assert.equal(figureKey("1.1.1 The map below shows it."), "111themapbelowshowsit");
  assert.equal(figureKey("‘Quoted’ – and dashed text"), "quotedanddashedtext");
  assert.equal(figureKey(null), "");
});

test("a picture goes after the recorded block when that block's text opens with the key", () => {
  assert.equal(anchorIndex(keyAt, blocks.length, { index: 0, key: "111themapbelowshowstheareas" }), 0);
  assert.equal(anchorIndex(keyAt, blocks.length, { index: 3, key: "backtocontents" }), 3, "a short key is fine at its own place");
});

test("when the browser counts the blocks differently, the nearest block that opens with the key is used", () => {
  assert.equal(anchorIndex(keyAt, blocks.length, { index: 1, key: "113thechartbelowshowsincidents" }), 2);
  assert.equal(anchorIndex(keyAt, blocks.length, { index: 3, key: "111themapbelowshowstheareas" }), 0);
});

test("a picture whose place cannot be confirmed is not shown", () => {
  assert.equal(anchorIndex(keyAt, blocks.length, { index: 1, key: "amapofthecountrynotinthistext" }), -1, "no block opens with it");
  assert.equal(anchorIndex(keyAt, blocks.length, { index: 0, key: "backtocontents" }), -1, "too short a key to trust away from its place");
  assert.equal(anchorIndex(keyAt, blocks.length, { index: 0, key: "" }), -1);
  assert.equal(anchorIndex(keyAt, blocks.length, { index: undefined, key: "111themapbelowshowstheareas" }), -1);
});
