# Decision: Collect edition-bound CPIN footnotes and retrieve deduplicated cited HTML and PDF sources with robots and resumable provenance

Evidence assessed by the research agent. Structural checks confirm required records; they do not independently certify source truth or operational reliability.

## Choice

Reuse CPIN PoliteClient and installed PyMuPDF; add Trafilatura for HTML extraction and implement only source/claim indexing plus resumable coordination.

## Rationale

Direct custom HTML extraction would save a dependency but add boilerplate heuristics and maintenance. Existing scraper removes most network infrastructure work. No new browser scraper, RAG framework or AI provider is needed for retrieval.

## Own work checked

Current CPIN HTTP/linkcheck/PDF code and installed versions inspected. Bounded local catalogue found no extra match; owned GitHub list screened and unrelated macro/music/conversion repos rejected before deep inspection.

## Stop reason

Stopped after roughly seven minutes; enough evidence to choose existing retrieval plus contained extraction, and further repository hunting is unlikely to save work.

## Next check

Install recorded extraction version, run fixture tests and a representative real-source pilot before the full run.

## Limitations

Public discovery returned no matching external repository; official library sources inspected separately. No candidate promoted to sustained operational status. Public HTML/PDF extraction is fallible, some linked addresses are malformed, robots/auth/refusals prevent complete retrieval. Private source cache is excluded from site builds and model inputs.

## existing-cpin-client-and-pdf-tooling

Evidence state: **tested**

**Fit:** Reuse existing robots, host delays, refusal handling, hashes and page text extraction.

**Scope:** Local CPIN retrieval and PDF text, not evidence interpretation.

**Limits:** Existing client has no streaming size bound or cross-host coordinator; existing PDF method is CPIN-specific and must not be rewritten for external sources. Sustained use of new collection workflow is unknown.

**Licence:** Owner-owned CPIN code; already-installed httpx/lxml/PyMuPDF licensing unchanged. PyMuPDF is an existing dependency.

**Maintenance:** Current main 4147628; maintained locally; tests/test_http.py covers refusals and robots failures.

**Adaptation:** Add optional bounded streaming and URL guard, leaving old callers unchanged. Keep external-source PDF extraction separate, with PyMuPDF used only from the main thread.

**Transfer:** Preserve immutable documents and failed attempts; never treat retrieval failures as contradictory evidence.

**Recommendation:** Reuse client and installed PDF library; directly implement catalogue and a resumable, bounded scheduler.

- [source inspection](/Users/robertnew/Developer/cpin-explorer/src/cpin/http.py) (read 2026-10-05): Robots refusals, read failures and per-host delays are already handled.

- [source inspection](/Users/robertnew/Developer/cpin-explorer/tests/test_http.py) (read 2026-10-05): Repeatable mock checks cover refused/unreadable robots and National Archives stop rule.

- [maintainer documentation](https://pymupdf.readthedocs.io/en/latest/recipes-text.html) (read 2026-10-05): Page text extraction preserves a page-level source location; layout is not semantic evidence.

## trafilatura

Evidence state: **unknown**

**Fit:** Contained HTML text extractor removes article boilerplate more cheaply than a new heuristic subsystem.

**Scope:** Extraction only; use CPIN client for all network activity.

**Limits:** Main text can be omitted or flattened, as operator issue 883 reports. Sustained production evidence not established within this short scan; retain original bytes and mark extraction as unverified.

**Licence:** Apache-2.0 for versions from 1.8; official repository licence inspected.

**Maintenance:** Active official documentation and maintainer repository; candidate version will be recorded after install.

**Adaptation:** One bounded optional source-collection dependency. Pin major version; retain raw HTML so extraction can be replaced without another scrape.

**Transfer:** Use extraction with tables and no comments; retain provenance and test representative HTML/PDF. Do not use crawler or fetching helpers.

**Recommendation:** Adopt extraction as a tested pilot component, without calling it operational.

- [maintainer documentation](https://github.com/adbar/trafilatura) (read 2026-10-05): Repository confirms modular extraction and Apache-2.0 licence.

- [maintainer documentation](https://trafilatura.readthedocs.io/en/latest/usage-python.html) (read 2026-10-05): Extract accepts raw HTML; precision/recall choices and possible omissions documented.

- [operator report](https://github.com/adbar/trafilatura/issues/883) (read 2026-10-05): Operator reports flattened document structure; this is a limitation rather than proof of sustained reliability.

- [maintainer documentation](https://trafilatura.readthedocs.io/en/latest/used-by.html) (read 2026-10-05): Use inventory lists integrations but does not independently prove their sustained operation.
