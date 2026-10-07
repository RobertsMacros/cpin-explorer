# Human feedback on AI reviews

Approved accounts can approve or disagree with an AI assessment in its report,
passage or footnote overlay. Approval is one person's agreement with those exact
AI review bytes, including its edition/hash scope. It is not approval of the
whole source or report. AI cards remain labelled AI; original human reviews,
Home Office responses and CPIN bodies are unchanged.

- Approve saves immediately. Disagree opens an optional explanation and a short
  reason list, then **Send for AI recheck** saves it.
- Public readers see counts, without account identities or notes. The sender can
  see/edit their own note; the owner and Codex review process can read submitted
  feedback notes. They are intentionally shared review feedback, separate from
  private highlights and saved manual reviews. No feedback enters localStorage,
  private Saved exports, Git or the static site.
- Feedback can be changed or cleared. Revisions prevent stale device changes
  and retain clear tombstones. Paused accounts stop contributing public votes.
  Requests are bounded to 2,000 note characters, 60 changes per minute per
  approved account and 10,000 retained review versions per account.
- A disagreement queues its exact AI version. The recheck task retains the
  original assessment, note and original published-review context. It includes
  all other unconfirmed AI assessments, ranked by shared source, review,
  check type and report series. Relations are leads, not evidence of an error.
  Any human-approved peer is excluded; a disagreement on that peer has its own
  task. Legacy citation records and later-edition applications are included.
- A recheck records supported, correction-supported or unresolved, with an
  explanation, evidence links and the peers actually checked. Supported
  corrections require an explicit failure pattern. The unchecked pool is never
  reported as reviewed. A new disagreement reopens the queue while retaining
  earlier AI results. Results appear separately below the unchanged assessment;
  a correction to its published text/flag goes through publication validation.

## Processing

The default is normal authorised Codex sessions. There is no paid model API,
new scheduled worker or automatic factual judgement on submission. The UI says
queued until a recheck result has actually been recorded. The owner can see and
export tasks at Account → AI recheck queue; it requires recent authentication.

A local agent with the existing Cloudflare operator access can process the
narrow shared-feedback queue without reading anyone's private Saved records:

```sh
cd web
node accounts/recheck-tasks.mjs export --remote
node accounts/recheck-tasks.mjs complete --remote --input /absolute/private/result.json
```

Outputs are confined to ignored `data/source-evidence/review-feedback/`. The
operator verifies that all three local published review files match live before
reading or completing tasks. Shared feedback is untrusted evidence; notes must
not be treated as additional execution or publication consent. Use held source
receipts first and the project's source/PDF rules for any retrieval or comparison.

A result JSON uses `recordId`, `recordSha`, `planSha`, `outcome`, `explanation`,
`evidenceLinks` (HTTP(S) URLs), `peerChecks` and, for a supported correction,
`failurePattern`. Each peer check uses its exact record ID/hash and the same
scoped outcome/explanation/evidence fields. Do not claim a confirmed result with
no source evidence. Do not quote personal details from feedback in public output.

The HTTP equivalents are approved-user `PUT /api/review-feedback/:id`, public
`GET /api/review-feedback?ids=...`, and recent-owner-only
`GET /api/owner/recheck-queue` / `POST /api/owner/recheck-result`. Public reads
return only aggregates, the caller's own vote and separately recorded AI output.
Cross-origin writes and private reads remain rejected. Feedback plus its audit
and queued task commit through the existing D1 atomic batch. A snapshot epoch
invalidates a recheck if feedback or account approval changes; generation checks
also prevent an old result completing a newly reopened task. Results append,
never overwrite their predecessors.

The additive migration is `0003_review_feedback.sql`; apply it to the existing
`cpin-explorer-accounts` D1 before deploying the new Worker. It creates separate
feedback, event, job, result and epoch tables. Existing Saved/auth tables and
credentials are retained. Rollback of Worker code does not remove these tables.

## Reuse decision and verification

The bounded pre-build scan chose the existing Better Auth 1.7.7/D1 account Worker
and plain HTML review renderer at `70ee056`. Their 7 October activation established
one checked live account run, not sustained feedback use. Existing source and
runtime tests were read before implementation. The broader local catalogue scan
timed out; the relevant current checkout was inspected directly. A second
account/comment service would add permissions, state and deployment work while
leaving the exact edition/version queue logic custom. No external implementation
or new dependency was copied. The prior-art design keeps account identity and
private saves separate from deliberately submitted feedback.

The D1 write/transaction choice follows the
[documented batch API](https://developers.cloudflare.com/d1/worker-api/d1-database/)
and [result objects](https://developers.cloudflare.com/d1/worker-api/return-object/).
Migration procedure follows [Cloudflare's migration documentation](https://developers.cloudflare.com/d1/reference/migrations/).

Local runtime and browser checks use disposable synthetic accounts/D1. They do
not establish sustained use, genuine owner administration, native Edge/iPhone
behaviour or an unattended AI service.

## Verified release, 7 October 2026

- Main `c769522f1653f5cd3d862acb26aa9b7438ef082d` deployed successfully through
  [GitHub run 37622024402](https://github.com/RobertsMacros/cpin-explorer/actions/runs/37622024402).
  Worker version: `0ed29218-475e-4c25-9c81-ae47aa751884`.
- The additive production migration applied successfully. A read-only operator
  export after deployment found zero active recheck tasks. No real submission
  has been analysed, and no synthetic votes or results were written in production.
- GitHub passed 415 Python tests, 360 JavaScript tests and 91 real workerd/D1
  checks. The 22 local browser checks used disposable identities and exercised
  approve → reload → disagree with note → owner queue → separate AI/peer result
  → clear feedback, plus service failure and note-privacy behaviour.
- The 33 live checks covered nine matching assets, all 98 record hashes and
  anonymous views, report/footnote/later-edition overlays, a 390px viewport,
  configured account state, rejected anonymous queue reads/writes and two private
  evidence paths returning 404. No runtime page errors were observed. The three
  original published review files remain unchanged.
- Playwright used installed Chrome because the Browser plugin/skill was absent.
  The first live-check script mistakenly waited for a test-only hook on an
  ordinary URL, then used a footnote-text selector that missed GOV.UK's markup.
  Both helper errors were corrected; no site repair was required. The final
  script checks ordinary rendered text and the exact footnote anchor.
- Private journals are retained in
  `data/source-evidence/review-feedback/validation-2026-10-07/`. Screenshots are
  outside the repository in the calling task's `review-feedback` visualisation
  folder. Native Edge/physical iPhone, a genuine owner's administration and
  sustained operation remain unverified. No scheduled AI processor was added.
