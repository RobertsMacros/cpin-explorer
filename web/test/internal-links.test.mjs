import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveAnchor, slug } from "../../prototypes/shared/internal-links.js";

const headings = new Map([
  [slug("About the assessment"), "about-the-assessment"],
  [slug("Return and reception arrangements"), "return-and-reception-arrangements"],
  [slug("Role of non-governmental organisations (NGOs)"), "role-of-non-governmental-organisations-ngos"],
  [slug("Relocation"), "relocation"],
  [slug("Education"), "education"],
]);

test("Word bookmarks are matched to the heading they mean", () => {
  // Real broken links from the notes (Afghanistan, Albania).
  assert.equal(resolveAnchor("_About_the_assessment", "About the assessment", headings), "about-the-assessment");
  assert.equal(resolveAnchor("_Return_and_reception", "Return and reception arrangements", headings), "return-and-reception-arrangements");
  assert.equal(resolveAnchor("Relocation", "Relocation", headings), "relocation");
  assert.equal(resolveAnchor("_Education_1", "Education", headings), "education");
});

test("truncated bookmarks match the heading they start", () => {
  assert.equal(resolveAnchor("_Role_of_Non-governmental", "Role of Non-governmental organisations", headings),
    "role-of-non-governmental-organisations-ngos");
});

test("no confident match leaves the link alone", () => {
  assert.equal(resolveAnchor("bookmark30", "Correspondence", headings), null);
  assert.equal(resolveAnchor("LN", "ELN", headings), null);
});
