import assert from "node:assert/strict";
import { test } from "node:test";
import { bugMailto } from "../../prototypes/shared/report-bug.js";

const page = { href: "https://example.test/prototypes/reader/index.html?country=sudan&series=note:security-situation", title: "Security situation · Sudan", agent: "TestBrowser/1.0", size: "1920×1080" };

test("no address configured: no link, so the button stays hidden", () => {
  assert.equal(bugMailto({ user: "", domain: "" }, page), null);
  assert.equal(bugMailto(undefined, page), null);
});

test("the email is addressed, titled, and says where the problem was", () => {
  const url = new URL(bugMailto({ user: "someone", domain: "example.org" }, page));
  assert.equal(url.protocol, "mailto:");
  assert.equal(url.pathname, "someone@example.org");
  assert.equal(url.searchParams.get("subject"), "CPIN Explorer bug");
  const body = url.searchParams.get("body");
  assert.match(body, /Page: https:\/\/example\.test\/prototypes\/reader\/index\.html\?country=sudan&series=note:security-situation/);
  assert.match(body, /Browser: TestBrowser\/1\.0/);
  assert.match(body, /Window: 1920×1080/);
  assert.ok(body.includes("What happened:\r\n") && !/[^\r]\n/.test(body), "line breaks are CRLF");
});
