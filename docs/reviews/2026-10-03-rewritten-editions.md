# Review: editions that were rewritten rather than edited

*3 October 2026. All 209 pairs of consecutive editions held (live and Internet Archive copies).*

## Method

- **Similarity** = words the redline leaves unchanged ÷ words in the longer of the two editions (the redline engine, `prototypes/shared/redline-diff.js`, as used by the report page).
- **Cross-check:** the share of the newer edition's five-word phrases that already appear in the older one. It is independent of the engine's paragraph matching, so it shows whether a low score is a real rewrite or the engine failing to line paragraphs up.

## Findings

| Similarity | Pairs |
| --- | ---: |
| under 25% | 68 |
| 25–50% | 7 |
| 50–75% | 4 |
| 75–90% | 10 |
| 90% or more | 120 |

- The split is sharp: most pairs are either light edits (90%+) or near-total rewrites (under 25%); only 21 fall in between, so 25% is a natural line.
- **All 68 low pairs are real rewrites.** The phrase cross-check agrees within 10 points for 64 of them, and none has most of its phrases in common with the earlier edition. The redline engine is not at fault; a redline of these pairs simply marks almost everything.
- They are usually years apart (median 3 years between the two editions held), and 3 skip version numbers (e.g. v3.0 → v7.0), i.e. the editions in between were never captured by the Internet Archive.
- 3 pairs have numbering that restarts or repeats (e.g. Yemen v5.0 → v1.0, Ukraine v1.0 → v1.0): the Home Office relaunched the note under the same topic. They are correctly grouped as one report, but the version numbers alone would not show it.
- What the site now does: an edition below 25% is labelled “Rewritten · about N% of the earlier wording kept”, and Show changes offers the two editions side by side without marks instead of a redline (the redline is still one click away).

## The 68 rewritten pairs

| Similarity | Phrases shared | Country | Report | Editions | Dates |
| ---: | ---: | --- | --- | --- | --- |
| 3% | 2% | nigeria | healthcare-medical | v4.0 → v5.0 | 2021-12 → 2026-04 |
| 4% | 5% | brazil | actors-protection | v1.0 → v2.0 | 2020-11 → 2025-11 |
| 4% | 4% | syria | humanitarian-situation | v1.0 → v2.0 | 2022-06 → 2025-07 |
| 4% | 6% | ukraine | security-situation | v1.0 → v1.0 | 2022-06 → 2025-10 |
| 4% | 25% | algeria | gender-identity-orientation-sexual | v4.1 → v3 | 2025-05 → 2026-08 |
| 5% | 4% | sudan | humanitarian-situation | v1.0 → v3.0 | 2024-02 → 2026-09 |
| 5% | 12% | turkey | g-lenist-movement | v3.0 → v4.0 | 2022-02 → 2023-10 |
| 5% | 8% | namibia | based-fearing-gender-violence-women | v1.0 → v2.0 | 2021-09 → 2026-01 |
| 5% | 9% | syria | security-situation | v1.0 → v2.0 | 2022-06 → 2025-07 |
| 6% | 5% | uganda | gender-orientation-sexual | v5.0 → v6.0 | 2022-02 → 2025-03 |
| 6% | 5% | nigeria | east-groups-separatist-south | v3.0 → v7.0 | 2022-03 → 2026-04 |
| 6% | 7% | ukraine | military-service | v8.0 → v9.0 | 2022-06 → 2025-10 |
| 6% | 6% | yemen | security-situation | v5.0 → v1.0 | 2021-12 → 2025-03 |
| 6% | 5% | afghanistan | fear-taliban | v3.0 → v4.0 | 2022-04 → 2024-08 |
| 6% | 9% | algeria | actors-protection | v1.0 → v2.0 | 2020-08 → 2026-08 |
| 7% | 5% | iran | military-service | v3.0 → v4.0 | 2022-11 → 2026-08 |
| 7% | 6% | iran | christian-christians-converts | v7.0 → v8.0 | 2022-09 → 2026-08 |
| 8% | 8% | ethiopia | army-front-liberation-oromo-oromos | v1.0 → v2.0 | 2022-03 → 2026-03 |
| 8% | 9% | bangladesh | atheists-minorities-religious | v3.0 → v4.0 | 2022-03 → 2026-04 |
| 8% | 11% | namibia | expression-gender-identity-orientation-sexual | v2.0 → v3.0 | 2021-11 → 2026-01 |
| 9% | 10% | honduras | gangs | v1.0 → v2.0 | 2023-11 → 2026-03 |
| 9% | 10% | iran | early-forced-marriage-women | v4.0 → v5.0 | 2022-05 → 2026-08 |
| 9% | 12% | malaysia | expression-gender-identity-orientation-sexual | v1.0 → v2.0 | 2020-06 → 2024-07 |
| 10% | 9% | syria | humanitarian-situation | v2.0 → v3.0 | 2025-07 → 2026-07 |
| 10% | 10% | sri-lanka | separatism-tamil | v8.0 → v9.0 | 2022-08 → 2025-09 |
| 10% | 10% | afghanistan | humanitarian-situation | v2.0 → v3.0 | 2022-04 → 2024-08 |
| 10% | 12% | albania | actors-protection | v2.0 → v3.0 | 2022-12 → 2026-08 |
| 11% | 11% | china | muslims-uyghurs-xinjiang | v2.0 → v3.0 | 2022-07 → 2026-09 |
| 11% | 16% | pakistan | expression-gender-identity-orientation-sexual | v4.0 → v5.0 | 2022-04 → 2025-05 |
| 11% | 8% | pakistan | internal-relocation | v2.0 → v3.0 | 2024-07 → 2026-09 |
| 11% | 12% | india | based-fearing-gender-violence-women | v3.0 → v4.0 | 2022-11 → 2025-12 |
| 11% | 11% | iran | based-fearing-honour-violence-women | v3.0 → v4.0 | 2022-05 → 2026-08 |
| 11% | 11% | egypt | opposition-state | v4.0 → v5.0 | 2023-12 → 2026-08 |
| 12% | 11% | iran | adultery-marriage-outside-sex-zina | v4.0 → v5.0 | 2022-07 → 2026-08 |
| 12% | 36% | albania | blood-feuds | v4.0 → v5.0 | 2020-02 → 2022-09 |
| 12% | 15% | albania | gender-identity-orientation-sexual | v6.0 → v7.0 | 2019-12 → 2022-12 |
| 12% | 10% | sudan | security-situation | v2.0 → v3.0 | 2025-01 → 2026-09 |
| 12% | 22% | egypt | military-service | v2.1 → v3.0 | 2023-03 → 2026-08 |
| 12% | 10% | iran | expression-gender-identity-orientation-sexual | v4.0 → v5.0 | 2022-06 → 2026-08 |
| 12% | 19% | afghanistan | humanitarian-situation | v3.0 → v4.0 | 2024-08 → 2026-05 |
| 12% | 13% | india | castes-minorities-religious-scheduled-tribes | v3.0 → v4.0 | 2021-11 → 2025-12 |
| 12% | 12% | iran | smugglers | v4.0 → v5.0 | 2022-02 → 2025-09 |
| 13% | 15% | vietnam | ethnic-groups-religious | v3.0 → v4.0 | 2022-02 → 2024-12 |
| 13% | 12% | china | hong-kong-law-national-security | v3.0 → v4.0 | 2022-06 → 2026-09 |
| 14% | 18% | pakistan | christian-christians-converts | v5.0 → v6.0 | 2024-04 → 2026-09 |
| 14% | 12% | burma | bangladesh-rohingya | v3.0 → v4.0 | 2023-06 → 2026-01 |
| 14% | 12% | pakistan | affiliation-parties-political | v2.0 → v3.0 | 2023-05 → 2026-09 |
| 14% | 16% | albania | healthcare-mental | v1.0 → v2.0 | 2020-04 → 2022-12 |
| 14% | 17% | sri-lanka | gender-identity-orientation-sexual | v5.0 → v6.0 | 2021-11 → 2025-09 |
| 14% | 18% | albania | abuse-against-domestic-violence-women | v3.0 → v4.0 | 2018-12 → 2022-12 |
| 15% | 16% | iran | exit-illegal | v6.0 → v7.0 | 2022-05 → 2026-08 |
| 16% | 13% | bangladesh | gender-identity-orientation-sexual | v5.0 → v6.0 | 2023-09 → 2026-04 |
| 16% | 14% | vietnam | opposition-state | v4.0 → v5.0 | 2023-08 → 2026-03 |
| 16% | 16% | sudan | security-situation | v1.0 → v2.0 | 2023-06 → 2025-01 |
| 17% | 20% | egypt | christians | v5.0 → v6.0 | 2023-12 → 2026-08 |
| 17% | 17% | pakistan | based-fearing-gender-violence-women | v5.0 → v6.0 | 2022-11 → 2026-09 |
| 17% | 14% | nepal | affiliation-political | v1.0 → v2.0 | 2023-11 → 2026-05 |
| 17% | 16% | iran | groups-kurdish-kurds-political | v4.0 → v5.0 | 2022-05 → 2025-10 |
| 18% | 16% | india | expression-gender-identity-orientation-sexual | v5.0 → v6.0 | 2023-08 → 2025-12 |
| 19% | 17% | albania | gender-identity-orientation-sexual | v7.0 → v8.0 | 2022-12 → 2026-08 |
| 19% | 17% | afghanistan | fear-taliban | v5.0 → v6.0 | 2025-08 → 2026-05 |
| 20% | 19% | iran | activities-media-place-social-sur-surveillance | v1.0 → v2.0 | 2022-03 → 2026-08 |
| 20% | 19% | china | contravention-family-law-mothers-planning-population-single-unmarried | v4.0 → v5.0 | 2022-05 → 2026-09 |
| 20% | 20% | china | falun-gong | v3.0 → v4.0 | 2023-11 → 2026-09 |
| 21% | 21% | albania | blood-feuds | v5.0 → v7.0 | 2022-09 → 2026-08 |
| 22% | 23% | china | opposition-state | v4.0 → v5.0 | 2023-12 → 2026-09 |
| 23% | 28% | afghanistan | children-unaccompanied | v4.0 → v5.0 | 2024-11 → 2026-05 |
| 23% | 34% | burma | critics-military-regime | v4.0 → v5.0 | 2022-07 → 2026-01 |
