# Published-review search and 2026 follow-ups, 5 October 2026

The £0 review-first pass expands the curated directory from 44 to 60 publications across nine publishers. It records 16 scoped AI comparisons for eight held 2026 report editions. Publication identity, review arguments, Home Office replies and our assessments stay separate. This is not an exhaustive analysis of all publications or all 2026 citations.

## Search coverage and conclusion

A thorough bounded search was performed. **An exhaustive web search cannot honestly be claimed**, and this run found omissions in the previous directory. Expertise and directory inclusion do not establish that a reviewer is correct. The reviewed source and report wording must support each finding.

The collector followed every explicit next-page link it discovered in the configured indexes, raising the old three-extra-page limit to 100. It reached seven Asylos news pages, twenty Helen Bamber resource pages and two Garden Court CPIN search pages. MiCLU’s toolkit, Asylos projects, Rainbow Migration news, both GOV.UK review collections and publisher discovery pages were checked. None ended at the pagination cap. This describes linked pagination only: unlinked, JavaScript-only, removed and unpublished material is outside the claim. Cached responses fetched on 5 October were reused, with retrieval dates and hashes preserved.

The standing collector previously missed WordPress arrow-prefixed “Older Entries” and Drupal next links. These are now recognised, and index traversal explicitly reports access and pagination gaps.

The following configured indexes remain inaccessible to the polite local collector:
- <https://asylumresearchcentre.org/publications/>
- <https://www.refworld.org/policy/countrypos/unhcr/2026/en/151369>
- <https://www.networkmyanmar.org/>
- <https://www.networkmyanmar.org/blogs>

ARC fails the robots/TLS check; Refworld’s robots cannot be read; Network Myanmar does not resolve in local DNS. These are recorded gaps, not permission to bypass a refusal. Some publications were inspected through web-indexed primary text or named ecoi.net repository copies. Network Myanmar’s PDF cannot be hash-checked locally or checked with an independent PDF reader; the supported finding below comes from comparing the original CPIN web paragraphs, rather than asserting a PDF-versus-web wording difference.

Additional primary-source searches used combinations of “country policy and information” / “CPIN” with review, commentary, critique, audit, statistical risk, Albania, Syria, Myanmar/Rohingya, 2026, healthcare and trafficking, plus publisher-specific searches. EIN, ILPA and ecoi.net were used for discovery, followed back to named original publications. Courts, news notices, commercial expert services and general country reports were not automatically classified as independent CPIN audits. The exact queries from the final search rounds are recorded below; the earlier exploratory query list was not retained as a standalone export.

```text
site.gov.uk "country of origin information" "healthcare" "2026" inspection
site.gov.uk "country of origin information" "trafficking" "2026" review report
"CPIN" "2026" "commentary" review -site:gov.uk -site:assets.publishing.service.gov.uk
site.unhcr.org "Albania" "2026" "Guidance Note"
"country policy and information" "2026" review commentary criticism
"country policy and information" "2026" "critique"
"CPIN" "2026" "review" "Rohingya"
```

Fourteen historical/thematic publications were added before the last two 2026 discoveries: three ARC works, a MiCLU methodological paper, three Asylos works and seven legacy IAGCI country review packages. The packages contain several attachments and replies, counted together rather than as separate corroboration. The Pakistan page’s main review attachment incorrectly contains the India review: its raw cover was checked with PyMuPDF and `pdftotext`. Pakistan’s response package is labelled context, with the missing original critique recorded, rather than inventing a separate verified review. The final two additions are UNHCR’s Albania guidance and Derek Tonkin’s annotated Rohingya commentary. UNHCR guidance is country context; Tonkin is identified as an individual commentator, with no institutional peer review established. Publication dates were also checked against the GOV.UK collection; meeting dates are not publication dates.

The [Syria/Bangladesh May 2026 tender](https://www.gov.uk/government/news/iagci-invites-tenders-to-evaluate-home-office-country-information-products-on-syria-and-bangladesh) commissions future reviews. No published result was found in the checked official collections/searches on 5 October. The 2025 healthcare and trafficking tenders likewise do not establish a completed, available report. Asylos’s 2026 trafficking principles describe an **unpublished** rapid review; its underlying arguments cannot be treated as publicly audited CPIN findings.

## Findings applied

| Held report | Scoped comparisons | Outcome |
| --- | ---: | --- |
| Afghanistan: fear of the Taliban, February 2026 | 6 | Four narrow omissions/wording criticisms superseded; revised risk presentation partly addresses criticism; legal/statistical threshold argument unresolved |
| Afghanistan: unaccompanied children, May 2026 | 1 | Reporting-limits guidance now explicit |
| Afghanistan: humanitarian situation, April 2026 | 1 | Reporting-limits guidance now explicit |
| Colombia: internal relocation, March 2026 | 2 | Questioned older social-support and healthcare sources replaced |
| Colombia: actors of protection, March 2026 | 1 | Previously omitted case update now included |
| Colombia: armed groups and criminal gangs, March 2026 | 3 | Named map limits, regional group example and distinct sexual-violence measures added |
| Vietnam: Hoa Hao Buddhism, March 2026 | 1 | Disputed neutral category and 400-follower estimate removed |
| Myanmar: Rohingya, January 2026 | 1 | Supported internal inconsistency: assessment says ICC issued a warrant; country information describes an application. Major AI flag, awaiting human review |

The first fifteen comparisons read selected arguments/replies in the original review PDFs and compared the current canonical web passages. PyMuPDF and independent `pdftotext` were used on the cited physical pages; the token overlap receipt is a reading check, not a truth or completeness score. Both programmes read the UNAMA counts underpinning the Afghanistan source-summary check. No PDF extractor or canonical body was changed.

The Myanmar finding is deliberately narrow. Paragraph 3.1.4 says an ICC warrant was issued, whereas 9.6.2 describes the prosecutor’s application. The [ICC situation summary](https://www.icc-cpi.int/bangladesh-myanmar) likewise describes an application. It does not establish whether a later or confidential warrant exists, and does not endorse Tonkin’s other conclusions. The report-level flag appears in the AI follow-up panel; it is not put against an unrelated footnote.

Two additional AI citation checks record the older Afghanistan UNAMA misdescription and its corrected February 2026 counterpart. The old statement that UNAMA gave no types/counts conflicts with printed pages 5–9 of the original source; exact profession-specific counts are a separate issue. The correction gets a grey AI mark, never a green human tick. One additional attributed external citation finding records Robert Karl’s criticism of a February 2025 Colombia source. A tracking query parameter alone does not establish AI generation. The source was replaced in March 2026; the historical criticism remains tied to February 2025.

The citation file now contains three external records covering two distinct criticisms and nine scoped AI checks, including the existing seven Syria checks. Sixteen report-level follow-ups are separate records. Exact country, report key, edition identity and text hash are required. A later edition never inherits a flag automatically. Reviewers’ positive remarks, disagreements and Home Office responses are retained where relevant; entire publications remain unassessed.

## 2026 inventory and remaining work

The held collection published since 1 January 2026 contains **48 editions, 47 report series, 10,162 footnotes, 14,336 extracted claim uses and 5,497 distinct primary URLs**. It includes silent snapshots and bulletins; it is not a promise of every edition ever published. Reusing existing private evidence made zero new source requests and zero model/API calls. There are 6,058 reused primary/download receipts and 4,358 distinct hash-checked source files, with zero integrity problems.

For the current primary-link retrieval measure, 6,834 footnotes have text from every linked source, 2,926 have no linked source text and 402 have no HTTP link. That is 67.25% fully readable primary-link coverage. It is **retrieval coverage, not review coverage**. Nine unreferenced footnotes and one malformed/boundary link still need checking. Refused addresses, scans, unsupported formats and absent links remain gaps.

The table below closes the inventory pass for every held 2026 edition. “No applied finding” means no completed scoped comparison is recorded, not that the report is correct or that no review exists. Country background can be read in the overlay; applicability and merits must still be assessed. The remaining published-review arguments, full Myanmar commentary, broader legal questions and the 10,162-footnote semantic review remain outstanding. Start subsequent work with the newest held edition; reuse prior source captures and recheck only changed passages/sources.

| Publication date | Country / held report | Edition identity | Scoped comparisons completed |
| --- | --- | --- | ---: |
| 2026-09-29 | palestine: note:gaza-humanitarian-situation | `c769bfa4982ca24f` | 0 |
| 2026-09-21 | pakistan: note:protection-sufficiency | `f57f6c1c6073bf71` | 0 |
| 2026-09-21 | pakistan: note:internal-relocation | `2e2623153c6939ac` | 0 |
| 2026-09-03 | sudan: note:humanitarian-situation | `15bde6c11e69a8b6` | 0 |
| 2026-08-26 | china: note:modern-slavery | `c7418b01eeac368d` | 0 |
| 2026-08-25 | iran: note:military-service | `83755408bda958a3` | 0 |
| 2026-08-19 | algeria: note:gender-identity-orientation-sexual | `dcaa67979fd20ad8` | 0 |
| 2026-08-19 | albania: bulletin:human-trafficking | `0080324dd153929c` | 0 |
| 2026-08-12 | egypt: note:christians | `92cc19ca04d6e563` | 0 |
| 2026-08-10 | russia: note:military-service | `9f2f77721fd078ab` | 0 |
| 2026-07-23 | kenya: note:actors-protection | `711dd96b8354681f` | 0 |
| 2026-07-23 | iraq: bulletin:aside-civil-country-documentation-following-guidance-internal-relocation-returns-setting-update | `047b9c46997a9f08` | 0 |
| 2026-07-22 | sudan: note:security-situation | `37c3fc359832b7d5` | 0 |
| 2026-07-15 | pakistan: note:christian-christians-converts | `eeb2106c6b69a57d` | 0 |
| 2026-06-30 | china: note:christians | `a018af0f067fef43` | 0 |
| 2026-06-29 | syria: note:humanitarian-situation | `fc683672349c2dc8` | 0 |
| 2026-06-26 | iran: note:christian-christians-converts | `f27eb7ba3e4a67d8` | 0 |
| 2026-06-19 | palestine: bulletin:gaza-security-situation | `7baca9ef06fb3c9c` | 0 |
| 2026-06-03 | trinidad-and-tobago: note:gangs | `496027d55641dc07` | 0 |
| 2026-05-28 | iran: bulletin:groups-kurdish-kurds-political | `f9f5b5ec999a577e` | 0 |
| 2026-05-19 | nepal: note:affiliation-political | `ef53c16b518fe29b` | 0 |
| 2026-05-11 | afghanistan: note:children-unaccompanied | `0032f789b9347dea` | 1 |
| 2026-05-08 | lebanon: bulletin:security-situation | `33b15bcb292e3c90` | 0 |
| 2026-05-05 | iraq: bulletin:civil-documentation-internal-relocation-returns | `d46282b8f8829cbb` | 0 |
| 2026-04-30 | iran: note:adultery-marriage-outside-sex-zina | `5ee0c8a70385343f` | 0 |
| 2026-04-28 | bangladesh: note:gender-identity-orientation-sexual | `01a3ae1bc68789fc` | 0 |
| 2026-04-15 | afghanistan: note:humanitarian-situation | `537945e737aed705` | 1 |
| 2026-04-08 | syria: note:criticism-government | `b5cc4efde5c551c9` | 0 |
| 2026-04-08 | syria: note:criticism-government | `55297befb75b682b` | 0 |
| 2026-04-08 | nigeria: note:east-groups-separatist-south | `0da0fd71cde21d1f` | 0 |
| 2026-04-01 | albania: note:based-gender-violence | `03c3f3bf9f6bfa33` | 0 |
| 2026-03-26 | iran: bulletin:security-situation | `fb73c381946fc95a` | 0 |
| 2026-03-25 | syria: note:children | `a0faac83350dc012` | 0 |
| 2026-03-12 | colombia: note:internal-relocation | `3db3bc2badbeb094` | 2 |
| 2026-03-12 | colombia: note:armed-criminal-gangs-groups | `be0dd5f4b636ec3f` | 3 |
| 2026-03-12 | colombia: note:actors-protection | `21bb81b53787f515` | 1 |
| 2026-03-11 | ethiopia: note:army-front-liberation-oromo-oromos | `5dfa39aeb43e4414` | 0 |
| 2026-03-10 | vietnam: note:buddhism-hao-hoa | `423b36e054f6512e` | 1 |
| 2026-03-03 | egypt: note:opposition-state | `9fc4c2033f4c534a` | 0 |
| 2026-02-27 | honduras: note:gangs | `f47b04adf127e939` | 0 |
| 2026-02-24 | france: note:country-safe-third | `9ecb0e2f041301d6` | 0 |
| 2026-02-24 | afghanistan: note:fear-taliban | `2c5e35429f512dbf` | 6 |
| 2026-02-11 | syria: note:alawites-excluding-minorities-religious | `28254b3cba0230d6` | 0 |
| 2026-02-04 | iran: bulletin:2025-2026-december-january-protests | `3f0d7fad6abb34a3` | 0 |
| 2026-02-02 | pakistan: note:affiliation-parties-political | `06852a069ee66da4` | 0 |
| 2026-02-01 | botswana: note:based-fearing-gender-violence-women | `342f1807301b2efe` | 0 |
| 2026-01-27 | china: note:opposition-state | `c3fd8dce9ecb854a` | 0 |
| 2026-01-06 | burma: note:bangladesh-rohingya | `9af70f7edeb2e0f5` | 1 |

## Verification and publication

Local verification: 324 Python tests and 339 JavaScript tests pass; canonical verification checks 405 bodies, 707 PDFs and 682 images with zero problems. Private caches stay excluded from Git and the public build. Local Chromium checks pass at 1280×900 and 390×844 touch: old Afghanistan/Colombia red flags remain with old editions, corrected editions stay grey, Vietnam shows its scoped follow-up, and Myanmar shows its report-level major AI flag without mislabelling footnote 70. No console errors or green ticks. Native Edge/Safari/iPhone have not been checked in this run. Browser plugin not available; the bundled Playwright runtime was used. Build succeeds with 7,910 files (452 MB). Deployment receipts are added after publication. No paid service, API or recurring monitor was configured. Existing global source collection remains a separate slow one-off job.
