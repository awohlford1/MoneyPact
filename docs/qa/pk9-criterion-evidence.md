# PK-9 criterion-to-evidence table

PROTO-INVITATIONS-PK9-QA-001: independent behavioural validation of the invitations and Primary-ownership-transfer
track as merged on main (PK-2..PK-8, the PK-8 API gaps, PRs 355..376) against the live Jira acceptance criteria of
CBD-41, CBD-73, CBD-120, CBD-277, CBD-280 and CBD-287, read 2026-09-13 from `customfield_10066` (ADF) and the
description body of each issue through the credential loader in `scripts/audit-jira-links.py`.

Run with `node scripts/prototype-qa-pk9-criteria.mjs --api-db <db> --web-db <db>` on two fresh scratch databases,
serialized. That script runs the suites named below for real and prints a PASS/FAIL/BLOCKED line per criterion; this
table adds the file:line evidence within each suite. A criterion mapped to more than one suite is evidence-complete
when every mapped suite passes.

Candidate revision for this run: `0d2a6189088fa643c33c050cd98ae606e1ce2de0` (branch `qa/invitations-pk9`, base
`origin/main` at `0d2a618`, PR #376 merged).

## CBD-41 -- Implement the invitation and membership lifecycle

| AC | Text (short) | Status | Evidence |
| --- | --- | --- | --- |
| AC01 | Authorized creation; denial leaves counts unchanged, one safe denial event | PASS | `packages/budget-application/src/invitations/application.test.ts` (authorization matrix cases); `apps/api/src/invitations` HTTP-boundary suite |
| AC02 | Disclosure binding on the invitation record; stale/mismatched version fails without membership | PASS | `apps/api/src/primary-transfer/http.test.ts` stale-disclosure cases (same disclosure-binding mechanism as the transfer legs, PK8-F03); invitation record fields asserted in `ceremony.live.test.ts` |
| AC03 | Channel proof required before commit; auth to a different-primary-contact account neither bypasses proof nor exposes other data | PASS | `apps/api/src/invitations/ceremony.live.test.ts` -- wrong-code-then-correct-code proof, then attach to an existing account of a differing primary contact |
| AC04 | Atomic acceptance: exactly one membership/consent/version/events/notification; injected failure commits none | PASS | `ceremony.live.test.ts` commit assertions; `packages/budget-application/src/invitations/acceptance.test.ts` (boundary failure rollback cases) |
| AC05 | Single use and replay: first use consumes; later/concurrent use is idempotent/uniform, no duplicate | PASS | `packages/budget-application/src/invitations/transitions.test.ts` replay cases; `ceremony.live.test.ts` link-replay case |
| AC06 | State machine: every allowed/prohibited transition covered | PASS | `packages/budget-application/src/invitations/transitions.test.ts` (full transition matrix) |
| AC07 | Resend/replacement per TR-73-05: one successor, predecessor invalidated first, at most one acceptance in a race | PASS | `packages/budget-application/src/invitations/transitions.test.ts`, `application.test.ts` |
| AC08 | Decline-once vs decline-and-block; block is recipient-controlled, cross-space, non-disclosing | PASS | `packages/budget-application/src/invitations/application.test.ts` |
| AC09 | Revocation/removal: old sessions/links fail current checks; delivered copies outside server recall | PASS | `ceremony.live.test.ts` (post-commit old-link/session checks); `apps/api/src/invitations` HTTP-boundary suite |
| AC10 | Ownership safety: sole Primary cannot leave/self-revoke; transfer/removal/archival never leave zero Primary Owners | PASS | `packages/budget-application/src/primary-transfer` unit suite (transitions/commit); `invitations.live.journey.mjs` (former Primary refused at propose after transfer; R-04 role binding) |
| AC11 | Enumeration/abuse controls: uniform outcomes, pair-scoped limits don't block unrelated parties | PASS | `apps/api/src/invitations` HTTP-boundary suite (uniform-outcome cases) |
| AC12 | Accessibility/copy: keyboard, focus, label, announcement, non-color; CBD-75 constraints | PASS | `invitations.live.journey.mjs` (`accessibility()` axe pass at every step: ceremony, disclosure, transfer, members) |

## CBD-73 -- Document invitation consent and revocation flows (behavioural proof of the documented lifecycle)

| AC | Text (short) | Status | Evidence |
| --- | --- | --- | --- |
| AC01 | State model incl. awaiting-confirmation and restricted-failure observation | PASS | `packages/budget-application/src/invitations/transitions.test.ts` |
| AC02 | Creation records space/inviter/channel/destination/role/scope/issue/expiry/version | PASS | `apps/api/src/invitations` HTTP-boundary suite (create-response field assertions) |
| AC03 | Pre-acceptance disclosure: identity, inviter, role, resources, actions, restrictions, alerts, revocation | PASS | `invitations.live.journey.mjs` ("Before you accept" text assertions); `apps/api/src/primary-transfer/transfer.live.test.ts` (disclosure text equals registry, see AC-below) |
| AC04 | Explicit affirmative acceptance separate from link-open/verify; awaiting-confirmation until creating-permission holder confirms | PASS | `invitations.live.journey.mjs` (separate accept checkbox + owner confirm step); `packages/budget-application/src/invitations/acceptance.test.ts` |
| AC05 | Resend/replace invalidates superseded codes; uniform recovery; restricted-failure code stays valid | PASS | `packages/budget-application/src/invitations/transitions.test.ts` |
| AC06 | Role/scope expansion requires new disclosure/consent before expanded access | PASS | `packages/budget-application/src/invitations/application.test.ts` |
| AC07 | Reduction takes effect immediately, notifies, no consent required | PASS | `packages/budget-application/src/invitations/application.test.ts` |
| AC08 | Self-revocation and authorized removal via confirmation flows | PASS | `apps/api/src/primary-transfer/http.test.ts`; `packages/budget-application` invitations suite |
| AC09 | Immediate stop of authorization/alerts; queued suppression; session-scoped removal | PASS | `apps/api/src/invitations` HTTP-boundary suite |
| AC10 | No cross-space effect; old codes cannot restore access | PASS | `packages/budget-application/src/invitations/transitions.test.ts` |
| AC11 | Lifecycle events notify, are space-scoped/auditable; prior contributed work stays attributed | PASS | `apps/api/src/primary-transfer/transfer.live.test.ts` MSG-73-040/042 notice rows |
| AC12 | Each state: actor, preconditions, resulting state, message, notifications, audit, recovery | PASS | `packages/budget-application/src/invitations/transitions.test.ts` |
| AC13 | Copy is voluntary, accessible, nonjudgmental, safe decline/leave path | PASS | `invitations.live.journey.mjs` axe accessibility pass at the disclosure and decline surfaces |
| AC14 | Test inventory: wrong recipient/channel/space, invalid/expired/reused code, revoked consent, stale session, queued alert, unauthorized role change, cross-space isolation | PASS | `apps/api/src/invitations` HTTP-boundary suite + `ceremony.live.test.ts` (wrong-code, cross-account attach cases) |
| AC15 | Recipient must verify control of the exact invited channel; forwarded link alone insufficient | PASS | `ceremony.live.test.ts` (verify-channel step gates attach) |
| AC16 | Link exposes only an opaque single-use code; state loaded from server record | PASS | `ceremony.live.test.ts` |
| AC17 | Attachment to an existing account with a differing primary contact, after channel verification | PASS | `ceremony.live.test.ts` |
| (R-03) | A proved ceremony opened in a second tab / no sessionStorage reaches the same disclosure step, not re-asked for the code | **FINDING (open)** | `apps/web/tests/invitations-r03-storage-loss.live.journey.mjs`: observed sentence in the second, storage-isolated context is "Prove you received this invitation..." -- the code-entry step, not "Sign in or create your MoneyPact account" (the step the first context had reached). Matches PROTO-INVITATIONS-PK8-REVIEW-001-RESULT.r1 finding R-03 exactly; level 1, not required for approval, product fix (`ceremony-view.tsx` `advance()`) is out of this packet's scope. Reported, not fixed. |

## CBD-120 -- Deploy to hosted environments and manage runtime secrets

| AC | Status | Reason |
| --- | --- | --- |
| AC01 - AC17 | **BLOCKED** | This prototype checkout has no hosted environment: no Terraform state, no provider account/project, no secret manager, no deployed container image, no edge/TLS termination, no IAM to read back. Every criterion names infrastructure that provisioning (CBD-108/CBD-120 implementation, not this QA packet) has not yet stood up in a form this QA assignment can observe. Standing one up is infrastructure/deployment work outside "behavioural validation of the merged invitations track" and outside this packet's write scope and excluded-files list. No case was fabricated to force a pass. |

## CBD-277 -- Revoke membership and invalidate residual access

| AC | Text (short) | Status | Evidence |
| --- | --- | --- | --- |
| AC01 | Authorized revocation advances authorization version atomically; unauthorized/stale changes nothing | PASS | `apps/api/src/primary-transfer/transfer.live.test.ts` (boundary-denied confirm leaves the row untouched, rollback returns the grant) |
| AC02 | Sole Primary cannot leave/self-revoke; concurrent owner-lifecycle tests preserve exactly one active Primary | PASS | `packages/budget-application/src/primary-transfer` unit suite; `apps/api/src/primary-transfer/concurrent-double-confirm.live.test.ts` (new, PK7B-F03: exactly one commit reaches `committed`, `state_version` advances once) |
| AC03 | Old sessions/links fail protected checks post-commit; no existence leak beyond caller's entitlement | PASS | `apps/api/src/primary-transfer/http.test.ts` (`transfer_not_found` uniform denial to non-parties, malformed ids, no-live-workflow) |
| AC04 | Queued deliveries/jobs suppressed; cache/search/report/subscription reject old versions within SLO | PASS | `apps/api/src/primary-transfer/http.test.ts`, `transfer.live.test.ts` (notice-once, stale-version rejection) |
| AC05 | Imported financial records/provenance remain; sync through a removed authorizer's connection stops, authority never transfers | PASS | `packages/budget-application/src/primary-transfer/commit.test.ts` (bank-connection authority never transferred, CBD-280-AC02's own assertion) |
| AC06 | Customer copy: future access ended, no claim of recalling delivered copies | PASS | `invitations.live.journey.mjs` / `apps/web` copy assertions ("Only the Primary Owner can propose a transfer" etc.); UI copy inventory in `docs/cbd-73-invitation-consent-lifecycle-specification.md` section 13 |

## CBD-280 -- Implement ownership and membership protected actions

| AC | Text (short) | Status | Evidence |
| --- | --- | --- | --- |
| AC01 | Transfer accepts only another active eligible member; rejects self/invited-only/inactive/expired/revoked/stale | PASS | `apps/api/src/primary-transfer/http.test.ts`; `packages/budget-application/src/primary-transfer/application.test.ts` |
| AC02 | Commit atomically: recipient sole Primary, outgoing Co-owner, other Co-owners unchanged, bank-connection authority never transfers | PASS | `invitations.live.journey.mjs` **R-04**: roles bound by membership id (former Primary's own row = Co-owner, recipient's own row = Primary Owner), not by role-label position; `packages/budget-application/src/primary-transfer/commit.test.ts` |
| AC03 | Primary-initiated Co-owner removal requires fresh reauth + current-version confirmation, affects only the named Co-owner | PASS | `apps/api/src/primary-transfer/http.test.ts` |
| AC04 | Sole Primary cannot leave/self-revoke; archive Primary-only, preserves records, stops active use, notifies, never deletes | PASS | `packages/budget-application/src/primary-transfer` unit suite |
| AC05 | Concurrent transfer/removal/archive/role-change tests always end with exactly one active Primary and deterministic outcomes | PASS | **`apps/api/src/primary-transfer/concurrent-double-confirm.live.test.ts` (new, PK7B-F03)**: two independent sessions of the same Primary Owner, each holding its own fresh-assurance grant, POST `/confirm` concurrently on the same live transfer. Observed twice on fresh databases: one winner (200, `committed`, `state_version` 4) and one loser **429 `{outcome:"retry",reason:"in_flight"}`** both times. Row lands on exactly one commit (`state_version` 4, not 8). Per PROTO-INVITATIONS-PK7B-TRANSFER-API-001-RESULT.r3 (PK7B-F03) and PROTO-CBD266-429-SEC-001-RESULT.r1 (SEC-G429-F2), the uniform 403 is the other legitimate outcome (when the winner's effect transaction has already reached its session write before the loser's request reaches the gate); this run's two observations both landed on 429, which the case accepts as either. |
| AC06 | Every attempt/outcome audited; notices enqueued, not a commit dependency | PASS | `apps/api/src/primary-transfer/transfer.live.test.ts` (MSG-73-040 proposal notice, MSG-73-042 commit notice; notice-mark-as-read is set-once, asserted at line ~232) |

## CBD-287 -- Persist versioned sharing disclosures and consent evidence

| AC | Text (short) | Status | Evidence |
| --- | --- | --- | --- |
| AC01 | Consent record: subject/space/membership/role/profile-groups/version-hash/source/time/predecessor link | PASS | `packages/budget-application/src/primary-transfer/commit.test.ts`; `transfer.live.test.ts` consent-row assertions |
| AC02 | Confirmation begins unselected; shows role/scope/prohibited authority/revocation/irreversible-copy caveat | PASS | `invitations.live.journey.mjs` (`#choice-accept`/`#choice-decline` both start unchecked; disclosure text assertions) |
| AC03 | Commit rejects stale membership/role/scope/disclosure/resource versions; writes neither widened access nor partial evidence | PASS | `apps/api/src/primary-transfer/transfer.live.test.ts`: a differing claim on accept is `409 stale_disclosure`, row untouched (`state_version` unchanged); confirm with the recipient's claim (not the outgoing one) is `409 stale_disclosure, freshAssurance: unspent`, nothing written |
| AC04 | Widening requires current disclosure confirmed first; narrowing takes effect at commit without waiting for notice delivery | PASS | `apps/api/src/primary-transfer/transfer.live.test.ts` (disclosure texts served at the captured kind/version/digest; role changes covered in `packages/budget-application/src/invitations/application.test.ts` AC06/AC07 cases) |
| AC05 | History distinguishes acceptance/role-change/profile-group-change/partner-selection/transfer/export/revocation | PASS | `packages/budget-application/src/primary-transfer/commit.test.ts` (distinct consent `source` values) |
| AC06 | Copy states the record proves an explicit action, not free/voluntary agreement | PASS | `apps/api/src/primary-transfer/http.test.ts` disclosure-text inventory; `docs/cbd-73-invitation-consent-lifecycle-specification.md` section 12 |

## PK-9 packet items carried from PK-8 reviews and security readings

| Item | Disposition | Evidence |
| --- | --- | --- |
| **R-03** | Observed, open finding (level 1, not fixed -- out of QA scope) | See CBD-73 table row above. `apps/web/tests/invitations-r03-storage-loss.live.journey.mjs` |
| **R-04** | Closed | `apps/web/tests/invitations.live.journey.mjs`: roles now bound to captured membership ids (former Primary's own row -> Co-owner, recipient's own row -> Primary Owner); the requests array is now asserted (`.includes` on every named mutation path: resolve, verify-channel, attach, accept, confirm, primary-transfers (propose/accept/confirm), step-up/begin) rather than only logged. Deviation from the review's literal "deepEqual on a sorted unique list" suggestion: an inclusion assertion was used instead of a full-set `deepEqual`, because the full observed set also carries every `GET` read the journey happens to make, which is not stable membership to pin; the review's suggestion is satisfied in substance (pathnames are asserted, not merely logged). |
| **PK8-FIX-F01** | Closed | `apps/web/tests/invitations.live.journey.mjs`: a warm-up `fetch` of `/sign-in` runs after the readiness wait and before the first Puppeteer wait, forcing the cold Turbopack compile to finish first. Verified by two consecutive fresh runs (8/8 both times) immediately after a fresh `npm ci`-equivalent state. |
| **PK7B-F03** | Observed, closed with the change named | `apps/api/src/primary-transfer/concurrent-double-confirm.live.test.ts` (new). See CBD-280-AC05 row. |
| Notices: MSG-73-050/MSG-73-040 for the right person, Mark as read once-only | PASS | `invitations.live.journey.mjs` (MSG-73-050 to the owner only, not the invitee); `apps/api/src/primary-transfer/transfer.live.test.ts` lines ~223-232 (MSG-73-040 to the recipient only, not the Primary; a foreign mark-as-read is `404 notice_not_found`; a repeated mark-as-read on the recipient's own notice returns the identical already-stamped row -- "set-once") |
| Transfer disclosure texts equal registry texts; stale claim is 409 stale_disclosure with the grant unspent | PASS | `apps/api/src/primary-transfer/transfer.live.test.ts`: `view.json().disclosures.recipient.{kind,version,digest}` equals the registry's `current()` entry; a differing digest on accept is `409 stale_disclosure`; a differing claim on confirm is `409 stale_disclosure, freshAssurance: "unspent"`, and `usable()` (a fresh-assurance re-check) confirms the grant is still spendable afterward |
| A non-party reading `/live` is `404 transfer_not_found` | PASS | `apps/api/src/primary-transfer/http.test.ts` PK8-F04 case (unit, mocked persistence: non-party, non-member and no-live-workflow all answer `404 transfer_not_found`); `transfer.live.test.ts` line ~201 covers the live malformed-id case on real PostgreSQL. The specifically-live non-party `/live` case rests on the unit-level HTTP-boundary suite rather than a fresh live-database case of its own; this is the one item in this table whose evidence is unit-level rather than live-PostgreSQL-level, noted here rather than silently upgraded. |

## PK9-F01 (new finding, not a PK-9 acceptance criterion)

`apps/api/src/primary-transfer/ownership-version.live.test.ts` (POV-N09, CBD-236 captured-version consistency) fails
on this same candidate revision (`0d2a618`), reproduced twice on fresh scratch databases with only this one file
run and no other suite in the process: the Primary's `confirm` now returns `409 stale_disclosure` instead of `200`,
because the file's `accept` and `confirm` calls still send an empty body `{}` and PK8-F03 (API-GAPS work, merged in
PR #376) made `acknowledgedDisclosure` binding load-bearing on those two routes. This file is pre-existing (not new
in this packet) and outside this QA packet's write scope (`apps/api/src/primary-transfer/*.live.test.ts` new files
only) -- reported, not fixed. It is not evidence against any CBD-41/73/277/280/287/120 criterion above (POV-N09 is a
CBD-236 authorization-versioning proof, not one of the six issues' acceptance criteria), but it is a real defect in
the merged track's own test suite and should be corrected (add `ACCEPT_BODY`/`CONFIRM_BODY`-shaped claims exactly as
`transfer.live.test.ts` already does) before that file is relied on again.

## How to reproduce this table

```bash
docker exec cobudget-db-1 psql -U postgres -c "CREATE DATABASE cobudget_pk9api" -c "ALTER DATABASE cobudget_pk9api OWNER TO cobudget_migration"
docker exec cobudget-db-1 psql -U postgres -d cobudget_pk9api -c "REVOKE CREATE ON SCHEMA public FROM PUBLIC"
docker exec cobudget-db-1 psql -U postgres -c "CREATE DATABASE cobudget_pk9web" -c "ALTER DATABASE cobudget_pk9web OWNER TO cobudget_migration"
docker exec cobudget-db-1 psql -U postgres -d cobudget_pk9web -c "REVOKE CREATE ON SCHEMA public FROM PUBLIC"
COBUDGET_DB_NAME=cobudget_pk9api npm run db:migrate --workspace=@cobudget/migrations
COBUDGET_DB_NAME=cobudget_pk9web npm run db:migrate --workspace=@cobudget/migrations
echo cobudget_pk9web > apps/web/.verification/live-db
node scripts/prototype-qa-pk9-criteria.mjs --api-db cobudget_pk9api --web-db cobudget_pk9web --json /tmp/pk9-criteria.json
```
