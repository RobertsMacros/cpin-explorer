# Albanian mental-health expenditure subgroup, 8 October 2026

The original PLOS supplements to Gabrani, Schindler and Wyss (2022) provide a
bounded answer to the earlier mental-health subgroup gap. S1 contains the same
898 observations as the paper. S2 identifies `v4127` as a mental-disorder
indicator, `v57` as consultation expenditure and `v59a` as drug expenditure.

| Self-reported subgroup | Respondents | Positive drug cost | Positive consultation cost |
| --- | ---: | ---: | ---: |
| Mental disorder, with or without another listed condition | 38 | 32 | 20 |
| Mental disorder and no other listed condition | 23 | 18 | 13 |

These are new unweighted descriptive calculations, not percentages reported by
the authors or estimates for Albania as a whole. Costs relate to chronic-condition
care. The released data do not identify the medicines, specific mental diagnoses,
provider sector or reimbursement entitlement of these respondents. Multiple
conditions prevent attributing the first group's spending solely to mental-health
care. The second group removes reported comorbidity on the released indicators,
but does not establish named treatment, entitlement or independent clinical diagnosis.

The survey took place in December 2018 in Fier and Diber. The article describes
an eight-week recall; S2 says 4/8 weeks. The paper's limitations prevent national
generalisation. These results support a limited concern about reported payments
among respondents with mental disorders, but do not alone disprove WHO's
majority-based national profile or establish 2020 coverage.

## Sources and checks

- [Original article](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0272221).
- [Original S1 data](https://journals.plos.org/plosone/article/file?type=supplementary&id=10.1371/journal.pone.0272221.s001): SHA-256 `a2c9cc64e3577b4e39db88774379512e7faf861f66af66e9ac741674c79ce6dd`.
- [Original S2 dictionary](https://journals.plos.org/plosone/article/file?type=supplementary&id=10.1371/journal.pone.0272221.s002): SHA-256 `643ab62c42d752a20584f1fe6bd71208ccf8107fdea0662e8f79633d58636c48`.

Both original files were retrieved through the guarded collector. The combined
size is 84,984 bytes. SHA-256 checks pass. Pandas and an independent standard-library
CSV reading agree. The full-sample counts reproduce 898 respondents, 786 insured,
and the rounded 36% consultation / 88% drug-payment figures. Condition flags are
binary, all rows have 24 columns, and the four cost columns contain no missing or
negative values. The dictionary has a diabetes-variable spelling discrepancy:
`v3122` versus CSV `v4122`. No column was renamed. The mental-disorder marker
matches exactly. The original files remain intact; no individual rows are republished.

One separate AI context record, `ai-review-albania-gabrani-mental-subgroup-20261008`,
is prepared for the two exact January 2025 edition bodies, paragraph 7.1.1 and
footnote 74. All 568 earlier annotation objects are retained, including the human
review and earlier AI assessments. No new error flag, canonical change or paid call.
Publication is pending validation and live verification.

The WHO national return, original chronic/medicine attachments, named-condition
and named-medicine payment evidence, and a specific Home Office reply remain
unlocated. Bounded publisher and official-site searches are search limits, not
proof of absence. Current supplement retrieval does not establish historical
byte identity. The regional subgroup recovery narrows the implementation gap
without completing the wider missing-evidence milestone.

Private receipts and calculations are retained under
`data/source-evidence/coordination-implement-2026-10-08/`.
