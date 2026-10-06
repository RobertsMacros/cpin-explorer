import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { anchorsFor, editionRecords, resolveAnchor, sameEdition } from "../../prototypes/shared/review-annotations.js";
import { reportPanelHtml, reviewStatus } from "../../prototypes/shared/source-reviews.js";
import { SITE_TAGS } from "../../prototypes/shared/highlights.js";

const edition = {country:"albania",series:"note:trafficking",editionId:"a".repeat(16),textSha:"b".repeat(64)};
test("review anchors cannot move between editions, body variants or countries", () => {
  const r={id:"one",kind:"external",targets:[{...edition,anchor:{type:"paragraph",paragraph:"6.1.3",quote:"Claims from males"}}]};
  assert.equal(editionRecords([r],edition).length,1);
  assert.equal(anchorsFor(r,edition).length,1);
  for(const k of Object.keys(edition)) {
    const other={...edition,[k]:"changed"};
    assert.equal(sameEdition(edition,other),false);
    assert.deepEqual(anchorsFor(r,other),[]);
    assert.deepEqual(editionRecords([r],other),[]);
  }
  assert.equal(sameEdition({...edition,textSha:"invalid"},{...edition,textSha:"invalid"}),false);
});
test("repeated paragraph numbers need a unique contextual match", () => {
  const candidates=[{type:"paragraph",paragraph:"6.1.3",section:"Certification",text:"Claims from males are likely to be certifiable."},
    {type:"paragraph",paragraph:"6.1.3",section:"Interview",text:"Another answer."}];
  assert.equal(resolveAnchor({type:"paragraph",paragraph:"6.1.3"},candidates),null);
  assert.equal(resolveAnchor({type:"paragraph",paragraph:"6.1.3",quote:"Claims from males"},candidates),candidates[0]);
  assert.equal(resolveAnchor({type:"paragraph",paragraph:"6.1.3",quote:"Claims from males"},[candidates[0],candidates[0]]),null);
  assert.equal(resolveAnchor({type:"paragraph",paragraph:"6.1.3",quote:"Claims from males",section:"Interview"},candidates),null);
});
test("link, footnote, sentence and section anchors retain their own scope", () => {
  const cs=[{type:"link",text:"Freedom in the World 2021",footnote:120,sourceUrls:["https://example.org/2023#page=1"]},
    {type:"footnote",text:"Original claim",paragraph:"2.1.1",section:"Risk",footnote:120,sourceUrls:["https://example.org/2023"]},
    {type:"sentence",text:"An unfootnoted sentence."},{type:"section",text:"6. Certification",section:"6. Certification"}];
  for (const [i,a] of [{type:"link",quote:"World 2021",sourceUrl:"https://example.org/2023#page=5",footnote:120},
    {type:"footnote",footnote:120,paragraph:"2.1.1",section:"Risk",sourceUrl:"https://example.org/2023"},
    {type:"sentence",quote:"unfootnoted sentence"},{type:"section",quote:"6. Certification"}].entries()) assert.equal(resolveAnchor(a,cs),cs[i]);
  assert.equal(resolveAnchor({type:"link",quote:"World 2021",sourceUrl:"https://example.org/2022"},cs),null);
  assert.equal(resolveAnchor({type:"footnote",footnote:120},cs),null);
});
test("published criticism is attributed; AI context and optional humans are separate", () => {
  const criticism={kind:"external",status:"criticism",severity:"major",summary:"Reviewer topic"};
  assert.match(reviewStatus([criticism]).label,/Major concern.*Published reviewer/);
  const panel=reportPanelHtml(edition,[criticism,{kind:"ai",status:"context",summary:"Scope comparison"}],[]);
  assert.match(panel,/Attributed to the published reviewer/);
  assert.match(panel,/data-review-kind="external"/);assert.match(panel,/data-review-kind="ai"/);
  assert.match(panel,/They are optional/);assert.doesNotMatch(panel,/awaiting human review/);
  assert.equal(reviewStatus([{kind:"ai",status:"context"}]).tone,"grey");
  assert.ok(SITE_TAGS.includes("review-marker"));
});
test("public passage records have stable IDs and contain no private evidence paths", async () => {
  const text=await readFile(new URL("../../prototypes/reviews/annotations.json",import.meta.url),"utf8"),data=JSON.parse(text);
  assert.equal(data.schema,1);assert.equal(new Set(data.records.map(r=>r.id)).size,data.records.length);
  assert.doesNotMatch(text,/\/Users\/|canonicalProof|canonicalPath|humanApproval|private-agent-review/);
  const quotes=new Map();
  for(const r of data.records) {
    assert.ok(r.targets.length);
    for(const t of r.targets) {assert.ok(sameEdition(t,t));for(const a of t.anchors||[])assert.ok(a.quote);}
    if(r.evidence) {
      assert.equal(r.kind,"external");assert.equal(r.evidence.publicDisplayApproved,true);assert.ok(r.evidence.rightsBasis);
      const url=r.evidence.url.split("#")[0];quotes.set(url,(quotes.get(url)||0)+r.evidence.quote.split(/\s+/).length);
    }
  }
  assert.ok([...quotes.values()].every(n=>n<=25));
  assert.equal(data.records.filter(r=>r.kind==="external").length,8);
  assert.equal(data.records.filter(r=>r.kind==="ai"&&r.status==="context").length,32);
  assert.equal(data.records.filter(r=>r.kind==="ai"&&r.status==="possible-issue").length,10);
});
