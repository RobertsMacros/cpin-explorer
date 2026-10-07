import test from 'node:test';
import assert from 'node:assert/strict';
import { relatedUnconfirmed, reviewFingerprint } from '../../prototypes/shared/review-feedback-core.js';
import { recordHtml } from '../../prototypes/shared/source-reviews.js';
import {readFile} from 'node:fs/promises';
import {aiReviewCatalogue} from '../../prototypes/shared/review-feedback-core.js';

const record={id:'ai-a',kind:'ai',summary:'A quotation wording check.',targets:[{country:'syria',series:'note:a',editionId:'a'.repeat(16),textSha:'a'.repeat(64)}],sourceCopyUrl:'https://source.example/a#page=3'};
test('feedback fingerprints bind exact assessment words and edition scope',async()=>{
  const sha=await reviewFingerprint(record);
  assert.equal(sha,await reviewFingerprint(JSON.parse(JSON.stringify(record))));
  assert.notEqual(sha,await reviewFingerprint({...record,summary:'A different assessment.'}));
  assert.notEqual(sha,await reviewFingerprint({...record,targets:[{...record.targets[0],textSha:'b'.repeat(64)}]}));
});
test('wider recheck keeps all unconfirmed peers, ranks actual relations and excludes human-approved records',()=>{
  const exact={...record,id:'exact',sourceCopyUrl:'https://source.example/a#page=9'};
  const sameType={...record,id:'type',sourceCopyUrl:'https://other.example/a',targets:[]};
  const unrelated={...record,id:'unrelated',summary:'Bibliography identity only.',sourceCopyUrl:'https://unrelated.example/a',targets:[]};
  const approved={...record,id:'approved'};
  const human={...record,id:'human',kind:'external'};
  const peers=relatedUnconfirmed(record,[record,exact,sameType,unrelated,approved,human],new Map([['approved',{approvals:1}]]),'quotation');
  assert.deepEqual(peers.map(p=>p.id),['exact','type','unrelated']);
  assert(peers[0].reasons.includes('same source'));
  assert(peers[1].reasons.includes('similar check type'));
  assert.equal(peers[2].reasons.length,0); // Absence of a relation does not certify it.
});
test('feedback controls belong only to AI cards, leaving human reviews and responses intact',()=>{
  assert.match(recordHtml(record),/data-ai-feedback="ai-a"/);
  const external={...record,kind:'external',response:'Exact Home Office response.'};
  assert.doesNotMatch(recordHtml(external),/data-ai-feedback/);
  assert.match(recordHtml(external),/Exact Home Office response\./);
});
test('all visible AI summaries have catalogue identities, including legacy citations and later-edition applications',async()=>{
  const load=async file=>JSON.parse(await readFile(new URL('../../prototypes/reviews/'+file,import.meta.url),'utf8'));
  const [annotations,published,directory]=await Promise.all(['annotations.json','published.json','directory.json'].map(load));
  const catalogue=aiReviewCatalogue(annotations.records,published.records,directory.reviews);
  const expected=annotations.records.filter(r=>r.kind==='ai').length+published.records.filter(r=>r.kind==='ai').length+directory.reviews.flatMap(r=>r.applications||[]).filter(r=>r.kind==='ai').length;
  assert.equal(catalogue.length,expected);assert.equal(new Set(catalogue.map(r=>r.id)).size,expected);
  assert(catalogue.every(r=>r.target?.textSha||r.targets?.every(t=>t.textSha)));
});
