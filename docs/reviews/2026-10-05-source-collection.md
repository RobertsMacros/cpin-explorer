# Source collection, 5 October 2026

The footnote inventory is complete; the last source requests are still running locally.
A one-off background job is collecting the remaining sources and explicit PDF downloads,
then writing the final lists, coverage report and integrity/test results here automatically.
This is not a recurring automation or a deployment.

## Checked snapshot

Snapshot: 2026-10-05T14:29:59Z.

- 47 countries, 435 reports, 856 held editions and 116,458 indexed footnotes.
- 45,002 source addresses plus 2,293 explicit PDF/download addresses discovered so far.
- 26,938 responses saved; 25,935 with extracted text before quality exclusions.
- 25,476 distinct source files checked against their hashes; 0 problems.
- 103 addresses still pending at this snapshot. Further PDFs may be discovered on the last source pages.
- Python: 307 tests pass. JavaScript: 332 tests pass. Site build succeeds; private source cache excluded.
- Original CPIN integrity and completeness: 0 problems (405 bodies, 707 PDFs, 682 images; all 47 countries complete for the current catalogue).

The slow tail includes a host with 500 seconds between requests. Its queue will take overnight.
Explicit bot-challenge headers pause a host without workarounds. Robots and declared delays
remain in force; National Archives requests remain manual-only.

## Files and interpretation

Private outputs are in `data/source-evidence/`. `footnotes.csv` has the citation text,
country, report, edition, section/paragraph and source addresses. `sources.csv` has each
address, retrieval outcome and content hash. `linked-documents.jsonl` records PDF parent
pages. These lists are snapshots; receipts and progress continue to update during the run.

`footnote-coverage.json` separates all/some/no linked-source text, and footnotes with no HTTP
address. This measures retrieval, not whether sources support the CPIN. Source versions,
PDF reading order and wording remain unverified. Historical applicability is not inferred
from a source retrieved today. Invalid links, repeated IDs, missing markers and uncertain
printed URL boundaries are retained for checking, not silently repaired.

No model calls or contradiction judgements have run. Published, AI and manual reviews
remain separate. Full external source text stays private, excluded from Git and website
builds, and unapproved for public display or model ingestion. No CPIN body, PDF, citation or
history was rewritten. The live site is unchanged.

The running job records its PID/state in `data/source-evidence/job.json` and progress in
`data/source-evidence/overnight-run.log`. It will replace this interim note with the final
results after collecting and checking the remaining queue. A resource stop is reported as
pending work, rather than completion. The collector retains successful snapshots on resume:

```sh
./cpin sources --all-editions --workers 32 --max-gb 16
```

See [the method and limits](../methods/source-collection.md).
