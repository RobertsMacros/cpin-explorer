# Optional approved accounts

## Activation checkpoint, 7 October 2026

The owner authorised activation and supplied the approval-owner address privately. The implementation was reconciled with main `2456d66` in the separate `feature/approved-accounts` worktree. All newer reader/review changes remain intact. Production D1 `cpin-explorer-accounts` has both migrations applied, and the authentication secret is stored only in Cloudflare. The owner still needs to register a password before operator promotion. Publication and live verification are in progress.

Reconciled checks: **413 Python tests, 355 JavaScript tests and 56 workerd/D1 checks passed**, including a repeat of the backend checks under Node 24. Retained body/PDF/image integrity and current-collection completeness passed with zero problems. The production deployment dry run includes the real D1 binding. All six main page footers now credit [COBE by Shu Ding](https://github.com/shuding/cobe); its licence notice remains intact.

The following records the local implementation prepared on 6 October, based on `71208f6`. Earlier undeployed statements below describe that dated validation run.

## Behaviour

Reading and searching stay public. A visitor can request an account with an email address and a password; new accounts start pending. Robert approves or pauses each account in the Account page. The HTTP API cannot grant ownership, and a submitted `approved` or `role` field cannot grant access. Approvals and pauses invalidate the affected user's sessions. The owner list is paginated so older requests remain reachable.

Approved users save highlights, country/report pins and private manual source reviews to their own account. Account records stay in device memory and are written to D1 per item. Signing in never uploads browser-only records automatically. An explicit **Copy browser saves to account** action retains the originals; **Download account saves** exports a private JSON copy.

Account saving works with browser-only saving switched off. Login uses an essential HttpOnly, Secure, SameSite=Lax session cookie on HTTPS; optional browser storage is separate. Blocking all cookies prevents login. Without an account, declining browser saving keeps new saves in memory for that page visit.

Saving status and failures are visible. Concurrent changes use revision checks and explicit conflict resolution. Deletions retain tombstones, so a stale device cannot restore a deleted item silently. A failed initial read cannot present an empty account as loaded, overwrite it or offer a misleading empty export. Failed writes stay in memory for retry or download; they are not an offline backup after the page closes.

The owner cannot read another user's private saved passages through the approval interface. Private reviews remain self-reported and edition-bound; account approval is not approval of their findings.

## Passwords and reset links

`web/accounts/auth.js` uses **Better Auth 1.7.7**, pinned in the lockfile, with its native D1 adapter, database sessions and rate limiter. Its installed licence is MIT. Passwords use its native asynchronous Node crypto scrypt; no custom password or session cryptography was added.

The custom plain-HTML password pages follow the Explorer's existing typography, square fields, miniature globe and RM footer. They include correct password-manager autocomplete, accessible labels, show/hide buttons, confirmation and a 12-character minimum for new passwords. The bounded design scan used [21st's documented form patterns](https://docs.21st.dev/blog/react-login-signup-components) as inspiration. No React component or unlicensed registry code was copied.

Password help records a request for the owner without revealing whether an email exists. The owner checks the person's identity and creates a private, single-use 30-minute reset link. The token is in the URL fragment, is removed from the address bar on opening, and is not included in referrers. Resets revoke existing sessions. Delivery is manual; no email service or automatic messages were configured. Owner administration requires a session created within the last 30 minutes.

Saved requests are bounded at 96 KiB, individual records at 64 KiB, and each account at 8 MiB and 10,000 retained records including tombstones. The API never alters canonical CPIN text or publishes private reviews.

## Checks completed

- **408 Python tests and 353 JavaScript tests passed.**
- **56 real workerd/D1 checks** passed against a fresh disposable local database: pending and injected privileges, HTTPS cookie attributes, origin checks, account isolation, cross-session reads, revisions and tombstones, payload bounds, approval and revocation, paginated administration, recent owner authentication, password reset expiry/single use and session invalidation. The separate operator bootstrap was also exercised against local D1 with exact readback.
- Chromium desktop and 390-pixel phone checks covered password labels/reveal, confirmation mismatch, owner approval, and a country pin, an actual selected highlight and a private review surviving reload with browser saving declined. The highlight and review never appeared in localStorage. A private fixture green tick appeared in the reopened footnote; it was not a public or verified source finding. The manual status selector now has an unambiguous accessible name. No console errors were recorded. Browser plugin was unavailable, so these used the regular Playwright CLI. These checks cover this feature branch; the other chat’s newer reader edits still need reconciliation. Native Edge and Safari/iPhone were not tested in this step.
- Grey, yellow, red and green fixture markers were rendered in both themes; their contrast was at least **4.97:1** in light and **7.76:1** in dark. A real Cameroon minor-error overlay opened correctly on mobile. Green remains a named private human check; an AI check cannot award it, and a green check cannot conceal an independent issue.
- A quick warm local dashboard sample showed roughly 469 ms DOM readiness and 352 ms LCP at the sampled point. This is not a live or throttled benchmark. The largest decoded request was the existing dashboard catalogue JSON, about 977 KiB. The shared account modules and CSS add about 8 KiB before compression; the authentication library runs only in the `/api/*` Worker, not in the public browser bundle.
- The assembled site and Wrangler deployment dry run passed. No production D1 binding, authentication secret, owner account or live login was created. These checks establish local behaviour, not sustained production operation.

The frozen research decision considered the existing QuarterlyPrep cloud-sync design and Better Auth documentation/incident evidence. The project borrows the separation of browser and account state; it does not port the React/Supabase implementation. Current local runtime checks resolve integration uncertainty, but do not establish sustained use of this version. See [Better Auth's D1 documentation](https://better-auth.com/docs/concepts/database) and [native crypto release explanation](https://better-auth.com/blog/1-6).

## Coverage checked separately

All **829 known catalogued editions** are held. The stored current collection covers 47 countries, **164/164 accessible web reports** and **175/175 current PDFs physically on disk**. Integrity checks passed for 406 stored bodies, 708 PDF manifest entries and 684 image entries.

One missing local Iraq PDF, *Opposition to the government in the Kurdistan Region of Iraq (KRI), September 2026*, was recovered from its original GOV.UK address. Its 773,038 bytes and SHA-256 match the existing manifest exactly. No manifest or canonical text was changed. All 32 retained failed-fetch occurrences concern editions now held; those historical failure receipts remain intact. This checks the known catalogue and stored GOV.UK snapshot, not discovery of every report ever published. It does not duplicate the other chat's source scrape.

Private evidence is retained under `data/source-evidence/accounts-2026-10-06/` in the authoritative Developer checkout. Screenshots are in the local Codex outputs directory, outside the public build.

## Activation when publishing is authorised

1. Reconcile the branch with the other chat's completed reader/review changes, then rerun checks. Keep its canonical/source work intact. Read the current handover before publishing.
2. Obtain Robert's chosen owner email; never infer ownership from the bug-report address or from someone registering that address.
3. From `web/`, create a dedicated Cloudflare D1 database and add the returned ID as an `ACCOUNTS` binding in `wrangler.jsonc`, with `migrations_dir: "migrations"`. Do not put a fake ID into production configuration. The current unconfigured API safely leaves public reading available.
4. Apply `npx wrangler d1 migrations apply ACCOUNTS --remote`. With existing operator access, set a fresh private `BETTER_AUTH_SECRET` through `wrangler secret put`; do not put its value in Git, a build, a report or chat. Keep `AUTH_ORIGIN` set to `https://cpin-explorer.co.uk`. Account links and the password page direct older public host addresses to that primary origin before a password is entered.
5. Publish the reviewed change only when authorised. Verify the real custom-domain signup, pending state and security headers before inviting users.
6. Robert registers his own password through the account page. Then the operator runs `node accounts/promote-owner.mjs --email 'CHOSEN_EMAIL' --remote`. This only promotes an existing exact account when there is no different owner, and verifies the resulting row. Robert can then approve subsequent accounts in the UI.
7. Verify genuine cross-device saving and revocation, plus the scheduled deployment preserving the D1 binding and secret. Live operation, runtime CPU limits and retention maintenance remain to be checked after activation; local tests are not a substitute.

To repeat the local checks from `web/`:

```sh
npm ci
npm test
npm run test:accounts
npm run site
npx wrangler deploy --dry-run
```

`test:accounts` uses fresh synthetic accounts, local workerd/D1 and temporary storage removed in `finally`. It neither retrieves sources nor contacts production. Do not hand-edit password hashes or authentication tables as a password-reset substitute. Keep D1 and its saved records when rolling back the UI/Worker; do not destroy user data.
