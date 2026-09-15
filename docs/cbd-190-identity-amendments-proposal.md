# CBD-190 — Identity ceremony and mapping contract amendments proposal

| Field | Value |
| --- | --- |
| Status | **Applied.** Applied to `docs/cbd-190-identity-ceremony-and-mapping-contract.md` v0.5 and to `apps/api/src/identity` under `EXEC-C190-RULINGS-001` (`C190-D01`-`D03`, all three as recommended) and `PROTO-CBD190-AMENDMENTS-IMPL-001`; a Security reading of the merged code follows before merge (the name claim is `DI-91-065` personal data) |
| Document version | 0.1 |
| Proposal identifiers | edits `C190-E01`–`C190-E04`; negative outcomes `C190-N01`–`C190-N05`; decisions `C190-D01`–`C190-D03`; findings `C190-F01`–`C190-F02` |
| Owner | Alexander Wohlford |
| Jira subtask | [CBD-190](https://cobudget.atlassian.net/browse/CBD-190) |
| Governing contract | `docs/cbd-190-identity-ceremony-and-mapping-contract.md` \| Document version **0.5** (this proposal's own amendments applied) — §3 (environment configuration, `post_result_destination_id`), §4.1/§4.1.1 (begin command, destination class), §4.3 (name claim mapping row), §4.4 (step-up begin), §5.2 (mapping transaction step 3), §5.4 (account switch), §7 (deterministic safe outcomes), §10.2 (credential-material inventory) |
| Governing rulings | `EXEC-P6-RULINGS-001` finding `P6-F01` (a first-sign-in write of `financial_profile.display_name` from the provider's name claim is wanted, as a separate identity packet); `PROTO-CONTRACTS-P6-SUBJECT-SELF-PROPOSAL-001-RESULT` r1 finding `P6-F01` (no production path calls `writeDisplayName` today); `PROTO-INVITATIONS-PK8-WEB-001-RESULT` r2 finding `PK8-F02` (the sessionStorage return marker substitutes for a server-bound return location); `PROTO-INVITATIONS-PK8-SEC-001-RESULT` r1 ruling `SEC-PK8-R2` (marker accepted for the prototype, conditional on `SEC-PK8-F1`, with a named condition for the identity packet that closes `PK8-F02`) |
| Amendment-proposal precedent | `docs/cbd-236-p6-subject-self-amendment-proposal.md` \| Document version **0.1** — the shape this document follows: gap as reported, exact amendment, negatives, decisions to the Executive, findings, nothing applied |
| Merged behaviour read | `apps/api/src/identity/token.ts` (`ValidatedIdentityClaims`, `validateIdToken`); `apps/api/src/identity/exchange.ts` (`runBoundedExchange`, the §10.1 bounded exchange that builds the canonical claims); `apps/api/src/identity/mapping.ts` (the §5.2 `SERIALIZABLE` mapping transaction, step 3 `insertSubjectWithProfileAndBinding`); `apps/api/src/identity/store.ts` (`insertSubjectWithProfileAndBinding`, the `financial_profile` row shape); `apps/api/src/identity/config.ts` (`POST_RESULT_DESTINATIONS`, `identityConfigFailures`); `apps/api/src/identity/ceremony.ts` (`begin`, the step-up `begin`, `#successNavigation`, the `destination_invalid` refusal); `apps/api/src/identity/http.ts` (the `PUT /v1/identity/me/display-name` route already delivered under CBD-236 `p6`; the `me` route's `displayName` projection); `packages/data-access/src/financial-profile.ts` (`writeDisplayName`, `MAX_DISPLAY_NAME_LENGTH = 80`); `apps/web/src/app/(app)/invitations-shared.tsx` (`leaveReturnMarker`, `takeReturnMarker`, `ResumeAfterCeremony`, `RETURN_KEY`); `apps/web/src/api/return-path.ts` (`sameOriginPath`); `apps/web/src/api/invitations.ts` (`beginSignIn`, `beginStepUp`, both currently pass `postResultDestinationId: "budgets"`); `apps/web/src/app/(public)/invitation/ceremony-view.tsx`, `apps/web/src/app/(app)/budgets/[id]/transfer/transfer-view.tsx` (the two pages that leave a return marker today); `docs/cbd-91-private-mvp-data-inventory.md` `DI-91-065` — all at `f0f3654` on `main` |
| Milestone | `PROTOTYPE-SLICE-001` and `PROVIDERS-LOCAL-001` (Executive, September 12, 2026) |
| Repository baseline | `f0f3654` on `main` |
| Written by | Architecture, assignment `PROTO-CBD190-AMENDMENTS-PROPOSAL-001`, September 15, 2026 |
| Last updated | September 15, 2026 |

> **Authority.** CBD-190 v0.4 is the approved contract and this document changes
> nothing in it. It proposes two amendments for the Product Owner and Security
> to approve before an implementation packet is cut, and puts the residual
> choices to the Executive. Where this document and the approved contract
> disagree, the contract wins and this document is wrong.

## 1. What is and is not merged at this baseline

`f0f3654` already carries a CBD-236 `p6` subject-editable display-name route
(`PUT /v1/identity/me/display-name`, `apps/api/src/identity/http.ts:205-234`,
`profile.set_display_name`, `packages/data-access/src/financial-profile.ts`'s
`writeDisplayName` with `MAX_DISPLAY_NAME_LENGTH = 80`) and the `me` route's
`displayName` projection (`P6-D03`/`P6-E06`). Neither amendment below touches
that route, its policy cell, or `writeDisplayName`'s signature. `P6-F01`
(`PROTO-CONTRACTS-P6-SUBJECT-SELF-PROPOSAL-001-RESULT` r1) is still true at
this baseline: no production code path calls `writeDisplayName` from the
sign-in ceremony, and `financial_profile.display_name` is `NULL` for every
subject who has not used the subject-editable route. `EXEC-P6-RULINGS-001`
ruled that a first-sign-in write is wanted **in addition to** that route, as a
separate identity packet — this document's amendment `C190-E01`–`C190-E02`
is that packet's design.

`apps/web/src/app/(app)/invitations-shared.tsx`'s `RETURN_KEY` marker and
`apps/api/src/identity/config.ts`'s `POST_RESULT_DESTINATIONS` (currently
`{ home: "/", budgets: "/budgets" }`) are both present and read directly.
`PK8-F02`/`SEC-PK8-R2` are read from the PK-8 result records because the
gap they report is a web-side design substitution, not a file this document's
scope edits (`apps/web` is excluded from this packet).

## 2. Amendment one — a bounded first-sign-in display-name write (`P6-F01`)

### 2.1 The claim admitted

`ValidatedIdentityClaims` (`apps/api/src/identity/token.ts:31-36`) gains one
field:

```ts
export interface ValidatedIdentityClaims {
  readonly issuer: string;
  readonly providerSubject: string;
  readonly authTime: Date;
  readonly issuedAt: Date;
  readonly name: string | undefined; // C190-E01: the OIDC `name` claim, trimmed and bounded, or undefined
}
```

`validateIdToken` (`token.ts`) reads the standard OIDC `name` claim from the
verified ID token payload — the same claim the design document's original
"first-sign-in from the provider's name claim" sentence names — and admits it
only in trimmed, bounded form. This is a mapping-contract change under §4.3's
own rule ("Email, phone, username, groups, roles, custom attributes, profile
fields, and budget metadata are not identity keys and are excluded from the
canonical result. The provider may return them, but the adapter discards them
before the mapping boundary."): `name` is not an identity key, is never used
for `sub` resolution, binding lookup, or any authorization decision, and every
other §4.3 exclusion is unchanged. It is admitted for exactly one downstream
purpose — the bounded display-name write in §2.3 below — and for no other.

### 2.2 Bounds

The claim is trimmed of leading/trailing whitespace and admitted only when the
trimmed value is 1 to 80 code points inclusive — the exact bound
`writeDisplayName` already enforces (`packages/data-access/src/financial-profile.ts`,
`MAX_DISPLAY_NAME_LENGTH = 80`), so the two paths that can ever populate
`financial_profile.display_name` (this ceremony write and the subject-editable
route) share one bound and one code-point-counting rule (`[...trimmed].length`,
not UTF-16 length, matching `writeDisplayName`'s own check). A claim that is
absent, not a string, empty after trim, or exceeds 80 code points after trim
is treated as **not present**: `ValidatedIdentityClaims.name` is `undefined`,
and no write of any kind is attempted from it. This is a silent skip, not a
rejection — an oversized or malformed `name` claim never fails the ceremony,
because the claim is not an identity key and the ceremony's success does not
depend on it.

The local Cognito-shaped adapter's synthetic chooser (`apps/api/src/identity/local-issuer.ts`)
gains a `name` field on its scenario fixtures so the local adapter can prove
both the present-claim and absent-claim branches; a scenario with no `name`
set (or one testing the 0/81-code-point boundary) proves the local-chooser
fallback in §2.3.

### 2.3 Where the write happens, and the local-chooser fallback

The write happens **inside the existing §5.2 mapping transaction**, in the
first-use branch only (`apps/api/src/identity/mapping.ts:121-126`, the
`insertSubjectWithProfileAndBinding` call — step 3 of §5.2's numbered
algorithm). It is not a second transaction and not a post-mapping side
effect: the candidate subject, its one active profile, and the binding are
already committed together in that step, and the display-name value — when
one is available — is passed into the same insert so the profile row is
created with its `display_name` populated (or `NULL`) in one write, never a
second `UPDATE` after the row exists. This keeps `CBD190-PROFILE-ATOMIC-001`
intact: no code path observes a subject with a profile that briefly lacks a
value the transaction was always going to give it.

**Source precedence**, stated exactly:

1. When `ValidatedIdentityClaims.name` is present (§2.2's bounds satisfied),
   that value is written.
2. When it is absent, the value the packet calls "the local chooser's
   subject-chosen value" is written instead — the local adapter's synthetic
   scenario already lets the chooser pick a display value for the fixture
   subject it is about to authenticate as; §8 of the contract already permits
   the local adapter to carry deterministic scenario data the production
   adapter cannot (it "may stub… fraud/risk decisions" and "accepts synthetic
   identities only", and nothing in §8.1's "must emulate exactly" list
   requires the production and local adapters to agree on non-identity
   display data). This fallback exists **only on the local adapter**: the
   production/Cognito adapter has no chooser, so an absent `name` claim on
   that adapter simply leaves the profile's `display_name` `NULL`, exactly
   as it is today.
3. When neither is available, `financial_profile.display_name` is written as
   `NULL` — the same value `insertSubjectWithProfileAndBinding` writes today,
   unchanged.

**Never overwriting a subject-set value.** The write in this amendment fires
only inside the `!binding` branch of `mapping.ts` (step 3, a brand-new
subject) — the existing-binding branch (the `else` at line 127) never calls
it, and never will: an existing subject already has a `financial_profile` row,
whether or not its `display_name` is set, and the write this amendment adds
has no code path that reaches that row. This is stronger than "check before
overwriting" — the write is structurally reachable only once, at the same
moment the subject itself is created, which is also the only moment
`display_name` is guaranteed `NULL` (a fresh `financial_profile` row has no
prior value to protect). A later change to the subject's display name — by
the subject, through `PUT /v1/identity/me/display-name` — is a separate write
path this amendment does not touch and cannot race, because the two writes
are separated by the subject's entire lifetime between them (the ceremony
write happens once, at row creation, inside the mapping transaction; the
subject-editable route's compare-and-set happens afterward, arbitrarily many
times, against a row that already exists).

### 2.4 Discard

The raw `name` claim value lives in three places, each bounded:

1. Inside `runBoundedExchange`'s (`exchange.ts`) token-free result buffer,
   until step 3 ("extract only the allowlisted canonical fields") — the same
   point every other canonical field is extracted today. `name` becomes part
   of `ValidatedIdentityClaims` there and nowhere else inside the exchange;
   the raw ID token buffer holding it is destroyed at the same step 6
   (`buffers_destroyed`) that destroys every other token buffer, unchanged.
2. Inside `ValidatedIdentityClaims` itself, from the exchange's return through
   `mapping.ts`'s call into `insertSubjectWithProfileAndBinding` — the same
   short-lived path `providerSubject` and `issuer` already travel.
3. Inside the one `INSERT` that creates the `financial_profile` row — after
   that statement returns, the local variable holding the trimmed claim value
   is not retained; nothing outside `mapping.ts`'s step-3 call ever sees it
   again. The durable value is the `financial_profile.display_name` column
   itself, which is already an approved, subject-visible column (read by
   `GET /v1/identity/me`, `packages/data-access/src/financial-profile.ts`'s
   `readDisplayIdentity`, and the budget-space members display).

There is no fourth location. The claim is discarded — meaning it exists in no
buffer, log, cache, or variable — the instant the mapping transaction's
`insertSubjectWithProfileAndBinding` call returns, which is also the instant
the durable `financial_profile.display_name` value it produced becomes the
only remaining copy.

### 2.5 Never logged

`name` never leaves `ValidatedIdentityClaims`/`mapping.ts`'s step-3 call
through any observability surface. `exchange.ts`'s `ExchangeEvidence` (the
only structured evidence the bounded exchange emits) carries step names,
timestamps, and a buffer-zeroed flag — no claim value, exactly as it does
today for every other claim. `mapping.ts`'s callback/handoff rows (§5.1's
`identity_callback`, `identity_session_handoff`) carry no raw claim value
today and gain none: the display name's only durable home is
`financial_profile.display_name`, an ordinary application-data column, not a
security-evidence or telemetry field. Ordinary telemetry stays coarse
operation/outcome/duration under `AN-92-003`, unchanged — this amendment adds
no telemetry field. §10.2's credential-material inventory table gains no row
for `name`, because it is not credential material; it is governed instead by
the DI-91-065 classification below.

### 2.6 `DI-91-065` classification

`docs/cbd-91-private-mvp-data-inventory.md` row `DI-91-065` ("Shared member
display identity") is the governing classification for
`financial_profile.display_name`, independent of which write path populates
it: sensitivity **S2**, "attribute readable shared activity without exposing
the private contact profile"; authorized audience "members only where the
person is relevant to content they may read"; prohibited disclosure includes
"email/phone, recovery identity, unrelated spaces, hidden membership,
cross-space identity correlation"; and it explicitly "never serves as
authentication/contact authority." The value this amendment writes is bound
by exactly that classification the instant it lands in the column — this
amendment does not create a new data class, and does not change `DI-91-065`'s
row. It only adds a second, bounded writer (the ceremony) alongside the
existing one (the subject-editable route), both already governed by the same
row and the same CBD-212 column (§13's §11 gap — CBD-212 §3 not yet listing
`display_name` — is `P6-F02` from the p6 proposal and is not this document's
gap to close; `C190-F02` below cross-references it so a reader of this
document is not left to rediscover it).

### 2.7 Negatives

| ID | Case | Expected |
| --- | --- | --- |
| `C190-N01` | `name` claim absent, local adapter chooser supplies a value | `financial_profile.display_name` is the chooser's value, not `NULL` |
| `C190-N02` | `name` claim absent, no chooser value (production/Cognito shape) | `financial_profile.display_name` is `NULL`, exactly as today |
| `C190-N03` | `name` claim present but 0 code points after trim, or over 80 | Treated as absent (§2.2); falls through to `C190-N01`/`C190-N02`'s rule, never a ceremony failure |
| `C190-N04` | Existing binding (returning subject) | No write attempted regardless of claim content; `mapping.ts`'s `else` branch is never reached by this amendment's code |
| `C190-N05` | Subject has already set a display name through `PUT /v1/identity/me/display-name`, then signs in again | Unreachable in practice (the write path is structurally first-use-only, `C190-N04`), but stated because it is the literal case "never overwriting a subject-set value" describes; the ceremony write cannot fire on a second sign-in because the subject's binding already exists |

## 3. Amendment two — a bounded destination class for identity `returnTo` (`PK8-F02`, `SEC-PK8-R2`)

### 3.1 The gap as reported

`SEC-PK8-R2` (`PROTO-INVITATIONS-PK8-SEC-001-RESULT` r1) accepted the web's
`sessionStorage` return marker (`RETURN_KEY`,
`apps/web/src/app/(app)/invitations-shared.tsx:84-99`) for the prototype,
conditionally on `SEC-PK8-F1` (a same-origin parsing defect, since fixed), and
named the exact condition for retiring it: "a bounded destination class for
the ceremony page and the transfer page (validated server-side against the
same closed map), after which the marker is deleted." Today both callers —
`beginSignIn` (`apps/web/src/api/invitations.ts:323`) and `beginStepUp`
(`apps/web/src/api/invitations.ts:343`) — pass
`postResultDestinationId: "budgets"` because `POST_RESULT_DESTINATIONS`
(`apps/api/src/identity/config.ts:39`) has no entry that names either the
invitation ceremony page or the transfer page; the browser then relies on the
client-side marker to reach the actual page the person was on before the
provider hop.

### 3.2 The destination entries

`POST_RESULT_DESTINATIONS` gains two entries, alongside the existing `home`
and `budgets`:

```ts
export const POST_RESULT_DESTINATIONS: Readonly<Record<string, string>> = Object.freeze({
  home: "/",
  budgets: "/budgets",
  invitation_ceremony: "/invitation", // C190-E03: the invitation ceremony page (apps/web/src/app/(public)/invitation)
  budget_transfer: "/budgets",        // C190-E04: see below — a space-scoped path is not a static map entry
});
```

`invitation_ceremony` is a direct static entry: the invitation ceremony page
(`apps/web/src/app/(public)/invitation/page.tsx`, and its
`ceremony/[ceremonyId]` route) resolves the ceremony to display from a link
fragment the browser already holds — the same pattern `beginSignIn` already
uses for the sign-in ceremony itself — so a fixed path is sufficient; no
per-invitation identifier needs to travel through the identity challenge.

The transfer page is space-scoped
(`/budgets/{budgetSpaceId}/transfer/{transferId}`) and a static map entry
cannot name it, because the map's values are fixed path strings
(§4.1: `post_result_destination_id` is "an opaque server-side allowlist key,
never an arbitrary URL" — the map itself is closed and static, by design).
`C190-D01` below states the fork and recommends binding the transfer
destination to the **step-up challenge's own bound budget-space identifier**
(§4.4 already requires one) rather than widening the map to a templated or
caller-supplied value.

### 3.3 Validation

Both destinations validate exactly the way `budgets` and `home` validate
today — `ceremony.ts`'s `begin` (line 279-288, the sign-in/general path) and
the step-up `begin` (line 607-615) both already do:

```ts
const destination = typeof input.postResultDestinationId === "string" ? input.postResultDestinationId : "home";
if (!Object.hasOwn(config.postResultDestinations, destination)) return { ok: false, reason: "destination_invalid" };
```

`invitation_ceremony` is accepted on the sign-in `begin` command
(§4.1's five admitted kinds) exactly as `budgets`/`home` are today — no new
validation branch, because `Object.hasOwn` against the closed map already
covers it. The transfer destination (`C190-D01`) is validated on the
**step-up begin** entry point only (§4.4): it is accepted there because
step-up begin already requires and binds a budget-space identifier before any
challenge exists (§4.4 "Binding": "the challenge issued for a `step_up`
carries, from server-side state only, … one budget space identifier"), so no
new value needs to enter the closed map — the destination is computed from
the already-bound space identifier at success time, not looked up by string
key. `#successNavigation` (`ceremony.ts:260-261`) gains one branch: when the
challenge's `postResultDestinationId` is the reserved value `budget_transfer`,
the navigation path is built from the challenge's own bound
`budgetSpaceId` (`/budgets/{budgetSpaceId}/transfer`) rather than looked up in
`POST_RESULT_DESTINATIONS` directly — the map entry above still exists so
`destination_invalid` continues to reject every other string, and so the
class is named and closed the same way every other destination is, but the
path itself is derived from bound state, consistent with §4.1's "no client
value can override a stored field."

### 3.4 What the challenge binds

No change to what the challenge already binds under §4.1 and §4.4: the
challenge's `postResultDestinationId` field (already present,
`challenge.ts:40,201,220`) simply gains two more accepted values in the
allowlist it is already checked against. For the transfer destination
specifically, the value that ultimately decides the navigation path is the
challenge's own `budgetSpaceId` — already bound at step-up begin time from
validated server-side state (§4.4 "Binding") — not a second, independently
supplied value. No client-controlled field is added to `BeginIdentityCeremonyV1`
or the step-up begin input; `destination_invalid` remains the closed refusal
for anything outside the map, unchanged.

### 3.5 Retiring the web's sessionStorage marker

Once both destinations exist and validate, `apps/web`'s `beginSignIn` call
from the invitation ceremony page passes `postResultDestinationId:
"invitation_ceremony"` instead of `"budgets"`, and `beginStepUp`'s call from
the transfer page passes `postResultDestinationId: "budget_transfer"` instead
of `"budgets"`; `#successNavigation` then returns the caller directly to the
page it started from, and `leaveReturnMarker`/`takeReturnMarker`/
`ResumeAfterCeremony`/`RETURN_KEY` (`invitations-shared.tsx`) become dead code
to be deleted in the implementation packet. This document does not make that
web-side edit — `apps/web` is outside this packet's scope — it states the
contract shape the web change will consume.

### 3.6 Negatives

| ID | Case | Expected |
| --- | --- | --- |
| `PK8N-01` (restates `C190-N06` numbering space, contract-level) | `postResultDestinationId: "invitation_ceremony"` on a `step_up` begin | Rejected: `invitation_ceremony` is not in the step-up-accepted subset (§3.3 scopes it to the sign-in/general `begin` path only, matching how `budgets`/`home` are already unrestricted but a future destination can be scoped) — this is a policy choice `C190-D02` below states explicitly rather than leaving implicit |
| `PK8N-02` | `postResultDestinationId: "budget_transfer"` on a plain `sign_in` begin (no bound budget space) | Rejected `destination_invalid`: the derived-path branch in `#successNavigation` requires a bound `budgetSpaceId`, which only a `step_up` challenge carries; a sign-in challenge has none, so this value is treated as unresolvable, not silently mapped to `/budgets/undefined/transfer` |
| `PK8N-03` | Unknown string, e.g. `"admin"` | `destination_invalid`, unchanged from today |
| `PK8N-04` | The transfer destination on a `step_up` challenge whose bound budget space the acting subject no longer holds active membership in by the time the callback resolves | §4.4's own membership check governs this, unaffected by this amendment — the destination class adds no new authority, only a navigation path computed after §4.4's existing checks already passed |

## 4. Decisions for the Executive

| ID | Decision | Recommendation | Why |
| --- | --- | --- | --- |
| `C190-D01` | Should the transfer destination be a static map entry (impossible, since the path is space-scoped) or a reserved map key whose path is derived from the step-up challenge's own bound `budgetSpaceId`? | **Derived from the bound `budgetSpaceId`** (§3.2–3.3) | The map's values are fixed strings by design (§4.1); a templated or caller-supplied path would reopen exactly the "never an arbitrary URL" problem §4.1 closes. Deriving from state the challenge already binds adds no new client-controlled input |
| `C190-D02` | Should `invitation_ceremony` be accepted on every ceremony kind that reaches `begin`, or scoped to `sign_in` only (matching today's actual caller)? | **Scoped to `sign_in` only** | `register`, `verify`, `enroll_factor`, and `account_switch` have no caller that leaves an invitation return marker today; admitting the destination everywhere widens the closed map's practical reach with no present use, and a narrower admission is easier to widen later than to narrow |
| `C190-D03` | Should the first-sign-in display-name write (§2) apply to `account_switch` as well as plain `sign_in`, given both resolve through the same `!binding` branch of `mapping.ts`? | **Yes, unchanged — both already share the same code path** | §5.4 states account switch "may resolve the same or a different subject" and, when different, that resolution runs through the identical `mapping.ts` first-use branch this amendment edits; carving out an exception would require a new branch this amendment does not otherwise need. Recommended as the simplest reading, but flagged because §5.4 is a materially different ceremony (an already-authenticated subject binding a new one) and the Executive may want the ceremony write scoped to `sign_in` only |

## 5. Findings

| ID | Level | Finding |
| --- | --- | --- |
| `C190-F01` | 2 | The transfer destination cannot be a plain map entry under the closed, static-string design `POST_RESULT_DESTINATIONS` already has (§4.1's own "opaque server-side allowlist key, never an arbitrary URL" reads naturally as "and never a template"). `C190-D01` records the fork this creates and recommends deriving the path from the step-up challenge's own bound state rather than widening the map's value shape; an implementation packet should treat `#successNavigation`'s branch (§3.3) as new logic, not a new map entry alone |
| `C190-F02` | 1 | `docs/cbd-212-financial-profile-persistence-contract.md` §3's column table still does not list `financial_profile.display_name` (first reported as `P6-F02` in `docs/cbd-236-p6-subject-self-amendment-proposal.md`, routed to CBD-212's owner and not yet applied as of this baseline). This amendment adds a second writer to that same unlisted column; it does not change the gap, but a reader implementing `C190-E01`–`E02` should not discover the missing CBD-212 row for the first time from this document — it is the same open item, restated so it is not lost between two proposals with different owners |

## 6. Revision history

| Version | Date | Author | Change | Status |
| --- | --- | --- | --- | --- |
| 0.1 (applied) | September 15, 2026 | Implementation, `PROTO-CBD190-AMENDMENTS-IMPL-001` | Applied under `EXEC-C190-RULINGS-001` (`C190-D01`-`D03`, all three as recommended): `apps/api/src/identity/{token,exchange,mapping,config,ceremony,local-issuer,store}.ts` implement §2 and §3; `docs/cbd-190-identity-ceremony-and-mapping-contract.md` bumped to v0.5 with the corresponding sections revised and a history row added. Status field only; the rest of this document is unchanged. | Applied; a Security reading of the merged code follows before merge (`DI-91-065`) |
| 0.1 | September 15, 2026 | Architecture, `PROTO-CBD190-AMENDMENTS-PROPOSAL-001` | Initial proposal: what is and is not merged at this baseline (§1); the first-sign-in display-name write — claim, bounds, mapping-transaction placement, local-chooser fallback, never-overwrite structure, discard points, no-logging rule, `DI-91-065` classification, and five negatives (§2); the bounded `returnTo` destination class — two destination entries, validation, what the challenge binds, the web-side retirement this document does not itself make, and four negatives (§3); three Executive decisions with recommendations (§4); two findings (§5). No code; no contract edit; no Jira or Confluence change | Proposed; Product Owner approval and a Security result required before an implementation packet is cut |
