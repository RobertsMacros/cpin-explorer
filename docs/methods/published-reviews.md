# Published country-report reviews

The curated directory is `config/review-sources.json`. Its public metadata copy is
`prototypes/reviews/directory.json`. It includes specialist legal organisations,
COI researchers and the IAGCI inspection process. Inclusion records identifiable
authorship, relevant expertise and primary publication provenance; it does not
certify that a finding is correct. Review publishers can be added internationally.

## Publishers and discovery pages

| Publisher | Why included | Where to check |
| --- | --- | --- |
| MiCLU | Specialist legal unit at Islington Law Centre; named Albania papers with references | [Albanian asylum toolkit](https://miclu.org/projects/breaking-the-chains/albanian-asylum-claims-toolkit) |
| Garden Court Chambers | Original practitioner analyses, including David Neale’s CPIN papers | [CPIN search](https://gardencourtchambers.co.uk/?s=CPIN) |
| ARC | Specialist COI research and explicit critiques of UK, European and US country reports | [Publications](https://asylumresearchcentre.org/publications/) |
| Asylos | International COI research with referenced methodology and original commentaries | [Projects](https://asylos.org/category/projects/) |
| Rainbow Migration | Specialist LGBTQI+ asylum organisation; joint Georgia commentary with Asylos | [Publications and news](https://www.rainbowmigration.org.uk/news/) |
| IAGCI / ICIBI | Independent expert reviews through the statutory inspection process, with Home Office responses | [Review collection](https://www.gov.uk/government/collections/the-independent-advisory-group-on-country-information-iagci) |
| Helen Bamber Foundation | Survivor casework and sourced Albania briefing | [Resources](https://www.helenbamber.org/resources) |

ILPA, EIN and ecoi.net can help discover reviews, but a republished copy is not a
second independent review. General UNHCR, Amnesty or Human Rights Watch country
evidence is not labelled a CPIN audit merely because it discusses the country.
Add a direct critique when one is found and its identity and scope are checked.

## Collection and refresh

From the repository root:

```sh
./cpin reviews                         # metadata and analysis contexts; no network
./cpin reviews --refresh               # check addresses older than seven days
./cpin reviews --refresh --max-age 0    # force a fresh, polite check
```

The existing `PoliteClient`, redirect guards and raw PDF/HTML extraction are reused.
No new crawler library is introduced. The collector checks the configured indexes,
curated publications and previously discovered candidates. It follows likely
review links, up to three extra index pages per publisher and two levels of document
links, within the explicit publisher host allowlist. Traversal is bounded, so it
does not establish exhaustive coverage of a publisher’s archives. The default run
has a 100-address limit, 25 MiB per response, a 512 MiB private document cache and a
2 GiB free-disk floor. Robots requests and redirect hops are additional bounded
network requests. HTTP/robots/bot/TLS refusals are recorded without workarounds.

Raw bytes, derived text, retrieval timestamps, redirects and content hashes are
kept in `data/review-evidence/`, excluded from Git and the public site. Physical PDF
page numbers are retained; there is no OCR. Snapshots and receipts are append-only.
Changed documents enter the recheck queue; prior bytes remain available. A recent
failed address is not retried until its refresh interval expires, unless forced.
No private third-party text is automatically approved for public display or model
use. New discoveries stay private in `candidates.json`; no automatic finding or
quotation is published. `summary.json` records gaps, limits and changed URLs.

This command is repeatable. A scheduler is a separate configuration; the seven-day
cache interval alone does not cause it to run automatically. The GitHub daily sync
has not been changed to fetch reviews. The owner prefers daily checks eventually,
but on 5 October asked to focus on backfilling first. No recurring task was enabled.
A future daily run should check small discovery indexes daily and reuse unchanged
review documents, rather than download every PDF daily. The present collector uses
one configurable age threshold; separate index/document intervals and conditional
requests remain future work. Collection makes no paid API or model calls.

The command returns 1 when it records an inaccessible address, unreadable result or
resource stop, while retaining successes. It returns 2 if the optional HTML extractor
is missing. A complete traversal with recorded gaps is not complete source coverage.

## How analysis uses reviews

`analysis-context/<country>/<report>.json` supplies each held edition with exact
edition reviews and separately labelled background reviews, together with the
assessment rules. These are inputs for future review work, not completed AI checks.
The current footnote overlay links report-level reviews only when country, report
key, edition identity and text hash match an editorially checked edition declaration.
Their presence never assigns a red flag or green tick to a citation. Findings about
individual source uses still require paragraph, section, footnote and source anchors.

The overlay also exposes every curated country-associated publication under
“Other reviews found for this country”. Exact edition reviews are excluded from
that background list to avoid duplication. Background reviews may concern another
report, older edition or another publisher's product; their applicability and
arguments remain unassessed. Related publication, corrigendum, repository and
response addresses remain linked. This makes the directory available to readers
without importing its arguments as findings or moving them between editions.

For every argument, compare the CPIN passage, the review’s reasoning and the original
source with surrounding context. Assess dates, population and geographical scope,
and the information available at the CPIN cut-off. Record evidence for and against,
including the Home Office response when published. Distinguish factual contradiction,
omitted qualification, unsupported inference, policy/legal argument and later
country developments. Record our assessment separately as unassessed, supported,
partly supported, disputed, unresolved or superseded, with reasons and evidence.
The present curated records all have **unassessed** merits.

Joint reviews and mirrors share a work identity. Keep corrigenda and revisions
linked to the original; do not treat them as independent corroboration. In particular,
David Neale’s review of the December 2022 Albania trafficking CPIN has a September
2023 correction. Its February 2023 addendum is a different scoped publication that
must be read alongside the earlier paper. Asylos/Rainbow Migration’s September 2024
Georgia commentary reviews the December 2023 CPIN and includes later country evidence.
ARC’s EASO and US State Department critiques are reviews of those products, not
direct findings about a UK CPIN citing them.

The [MiCLU blood-feud review](https://miclu.org/assets/uploads/2023/02/Albania-blood-feud-CPIN-review-February-2023.pdf)
is dated February 2023 but names the **January 2023** CPIN. The
[IAGCI Albania/Pakistan review](https://www.gov.uk/government/publications/inspection-report-on-home-office-country-of-origin-information-albania-and-pakistan-october-2023)
addresses that blood-feud edition and February 2023 trafficking edition, records
strengths and criticisms, and includes Home Office responses. These perspectives
remain separate; neither is adopted automatically or attached to July 2024 editions.

## Verification and operating limits

The local collector is covered by network-free fixtures for edition separation,
candidate isolation, document-change retention, hash identity, request limits,
host allowlists and HTTP-200 challenge refusals. The review renderer is checked
for edition/text-hash matching and absence of automatic source-status flags.
One successful run is evidence of that run; it is not sustained monitoring.
Actual results and inaccessible publishers are recorded in the dated review log.
