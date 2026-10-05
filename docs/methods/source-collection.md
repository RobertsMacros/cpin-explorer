# Footnotes and privately held source evidence

The owner requested the catalogue-wide scrape on 5 October 2026. This command collects
evidence for later source-use review. It does not call a model, make contradiction
judgements, import published-review findings, or publish third-party text.

Install the optional extractor: `.venv/bin/pip install -e '.[sources]'`.

```sh
./cpin sources --all-editions --inventory-only
./cpin sources --all-editions --max-gb 10
./cpin sources --country syria --all-editions --since 2023-01-01 --out data/source-evidence/syria-since-2023
```

The default is current held editions; `--all-editions` includes every readable edition
in the existing report export. Run `./cpin export` first if that export is stale.
`--since` selects editions by their publication date, including the boundary date;
unknown dates are reported and excluded. It does not select sources by their own date,
or editions by their archive capture date. An active index manifest keeps narrowed
coverage and CSV exports from accidentally including earlier runs' retained indexes.
The current collection has 856 editions across 435 reports. Original CPIN bodies,
PDFs, hashes, citations and histories are not modified.

Outputs are in `data/source-evidence/`, excluded from Git and the site build:

- `inventory.json`: edition, footnote, claim and URL counts, with mapping diagnostics.
- `index/<country>/<report>/<edition>.json`: all footnotes, each link in each footnote,
  cited claims, direct links and printed URL candidates. Unclear trailing punctuation is
  retained and marked; it is not silently repaired. Section context is preserved when paragraph numbers repeat.
- `urls.jsonl` and `urls.txt`: deduplicated addresses and their edition/footnote uses.
- `documents/<sha256>`: immutable downloaded response bodies, deduplicated by hash.
- `text/<sha256>.json`: derived HTML text or raw PDF text by physical page, with extractor
  version. These readings are explicitly unverified; there is no OCR or LLM rewriting.
- `attempts.jsonl`: append-only URL, redirects, fetch time, hash and failure records.
- `progress.json`, `summary.json`, `failures.jsonl`, `audit.json`: progress, outcomes and
  a final check of files and hashes. `footnote-coverage.json` separates footnotes with
  all/some/no linked-source text, per country and for current/historical editions.
  This measures retrieval, not whether the source supports the CPIN. A saved response with no readable text is distinct
  from usable extraction. `sources.csv` and `footnotes.csv` provide spreadsheet lists.
- `linked-documents.jsonl`: at most two explicit PDF links from a short source landing
  page. Each keeps its parent URL and hash; being linked does not establish that its
  wording is what the CPIN cited. It is a separate captured document.

A repeat command resumes without re-fetching settled URLs. `--retry-failures` retries
unsuccessful outcomes but retains successful snapshots. `--country`, `--limit` and
`--workers` support a representative pilot. The cache byte limit is explicit, each
response is bounded to 25 MiB and the run stops before exhausting disk space. A byte
limit or interruption leaves pending URLs, not a false completion record.
The explicit cache budget accepts 1–16 GiB (default 6); the owner-requested full run
was extended to 16 GiB to retain its additional PDFs, with the 2 GiB free-space guard.
Up to 32 workers can serve different hosts. Long queues progress alongside smaller
ones; one source request per host is in flight at a time. A declared long delay can
make a queue an overnight job. Receipts retain recent request times across restarts.

The existing honest HTTP client enforces robots rules, crawl delays and host spacing.
Refusals pause the remaining URLs for that host for the run; those URLs are labelled
`host-refused` with no request, not broken. Every redirect destination gets its own
robots check and the same per-host lock. A previously refusing redirect destination
is not contacted again on resume unless failures are explicitly retried. National Archives requests remain manual-only.
Invalid URLs, credentials, non-standard ports and addresses resolving to private IPs
are not requested. Missing/duplicated footnote markers and dubious PDF-extracted links
are retained for manual inspection, never guessed into a claim or contradiction.
Explicit AWS WAF or Cloudflare challenge headers also pause a host, including a
challenge returned with HTTP 202; the original status and header remain in receipts.

A retrieval on 5 October does not establish what the source said when an earlier CPIN
was published. Provenance records say this explicitly. Historical-version selection,
PDF reading-order verification and evidence-excerpt validation belong to the later
review process. Full cache contents are not approved for public display or model input;
rights assessments remain separate from reachability and extraction.

The bounded reuse assessment is in
[the research record](../research/source-collection/REPORT.md). The implementation
reuses `PoliteClient`, atomic writes and the installed PyMuPDF rather than introducing
another scraper or changing the CPIN PDF extractor. Trafilatura 2.3.0 is used only on
already-downloaded HTML; its fetching/crawling helpers are not used. Tests demonstrate
mapping, storage, redirects, refusals, bounded downloads and extraction. Sustained
operation of this new collector is not established by its first run.
