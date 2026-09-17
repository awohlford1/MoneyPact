# CBD-232 — Budget-creation proposal and schedule-preview contract

| Field | Value |
| --- | --- |
| Status | **Approved — Product Owner, September 15, 2026 (PO-CONTRACT-APPROVALS-003), applying the 0.3 consent amendment to the 0.2.1 approval of September 13, 2026 (PO-CONTRACT-APPROVALS-001); open questions and residuals stay recorded and open** |
| Document version | 0.3.2 |
| Jira subtask | [CBD-232](https://cobudget.atlassian.net/browse/CBD-232) |
| Parent | [CBD-23](https://cobudget.atlassian.net/browse/CBD-23) |
| Repository baseline | `8ac588f36ca61fde9ee77c5f4ff9f9cf25041344` |
| Last updated | September 12, 2026 |

## 1. Purpose and authority

This contract defines a server-owned, expiring budget-creation proposal. It lets
an authenticated person review the exact normalized budget inputs and generated
periods that a later confirmation may make authoritative. It does not create a
budget space, membership, schedule version, period, target, or audit success
record.

The governing product rules are the approved schedule decisions, especially
`SD-071-020` through `SD-071-025`, `SD-071-029`, `SD-071-030`, `SD-071-047`
through `SD-071-049`, and CBD-68 §§9–10 and §§14–16. The package-consumption
boundary is [`docs/cbd-168-budget-domain-consumption-contract.md`](./cbd-168-budget-domain-consumption-contract.md)
Approved v1.1.2, as recorded by `CBD168-APPROVAL-001`. That revision
promotes the v1.1.1 decision content without changing its contract. The Private-MVP
boundary remains CBD-76; this design neither narrows it nor activates an external
provider.

The related live Jira summaries read on September 12, 2026 are:

| Key | Summary | Relationship to this contract |
| --- | --- | --- |
| `CBD-23` | Create and manage scheduled budget spaces | Parent outcome. |
| `CBD-231` | Persist budget-space lifecycle and creation constraints | Related summary; its detailed contract is not a source for this document. |
| `CBD-233` | Confirm budget creation atomically and idempotently | Related summary; its detailed contract is not a source for this document. |

Only those Jira summaries are used here. This document does not infer acceptance
criteria or implementation detail for CBD-231 or CBD-233.

## 2. Scope and invariants

### 2.1 In scope

This contract fixes:

1. creation and read API shapes;
2. normalization and canonical field errors;
3. server-side period computation and preview contents;
4. proposal versioning, expiry, invalidation, isolation, and replay resistance;
5. application-module placement and persistence ports; and
6. the proposed handoff interfaces for CBD-231 and CBD-233.

### 2.2 Out of scope

This contract does not define database tables, create or confirm a budget,
replace the cadence algorithms, define session issuance, select a provider, or
change any approved schedule decision. CBD-246 is the assigned durable-persistence
consumer of the port in §9. Sections 4.4 and 10 propose interfaces for the
authors of CBD-231 and CBD-233 to accept or reconcile; they do not record a
decision by either sibling ticket.

### 2.3 Load-bearing invariants

| ID | Invariant |
| --- | --- |
| `BCP-01` | Proposal state is non-authoritative derived state. No proposal identifier is a budget-space identifier. |
| `BCP-02` | Only the server normalizes input, obtains the budget-local date, selects rule versions, invokes the CBD-26 period contract, and computes bindings. |
| `BCP-03` | A proposal is bound to one environment; to the authenticated subject and its account/profile context; and to the session generation, exact normalized input, rule-version set, budget-local date, and immutable preview. |
| `BCP-04` | The proposal core is immutable. A result-affecting edit or refresh creates a successor proposal and invalidates the predecessor. |
| `BCP-05` | Validation failure creates no proposal and invokes no authoritative budget-space write. |
| `BCP-06` | Read and confirmation authorization are deny-by-default. Identifier possession is never authority. |
| `BCP-07` | The complete current anchored period is returned even when its start precedes proposal creation, followed by at least three complete periods. |
| `BCP-08` | The first valid expiry condition wins: 30 minutes after issue or the next midnight in the normalized budget time zone. |
| `BCP-09` | A digest detects altered content; a server-authenticated confirmation binding prevents a client from minting a valid proposal or replaying it in another context. |
| `BCP-10` | The proposed confirmation seam requires current subject, session, lifecycle constraints, governing versions, local date, expiry, and binding to be rechecked inside the authoritative transaction; CBD-233 must accept or reconcile that seam. |

## 3. Ownership and module boundaries

### 3.1 Application package

Implementation belongs in a new private workspace package
`packages/budget-application` (`@cobudget/budget-application`), under the public
module `creation-proposals`. It owns normalization, validation composition,
preview assembly, proposal state transitions, canonical serialization, digests,
binding verification, and the ports in §9. It contains no NestJS decorator,
database client, provider SDK, or direct clock/randomness access.

The package declares `"@cobudget/budget-domain": "*"` and imports only:

```ts
import {
  FEDERAL_RESERVE_CALENDAR,
  SETUP_PREVIEW_PERIOD_COUNT,
  buildPaycheckSchedule,
  customBoundaries,
  describeCadence,
  parseCadenceDefinition,
  periodLengthInDays,
  setupPreview,
  weeklyMonthlyBoundaries,
} from "@cobudget/budget-domain/schedule";
import type {
  BusinessDayPolicy,
  CadenceDefinition,
  NonBusinessDayReason,
} from "@cobudget/budget-domain/schedule";
import type { ISODate } from "@cobudget/budget-domain/shared";
```

The exact import list may be narrowed by implementation, but it must not use the
package root, a deep subpath, or a relative reach into `packages/budget-domain`.
The consumer must meet `DC-168-009`: compatible TypeScript resolution,
`allowImportingTsExtensions`, workspace TypeScript compilation, and no
`--preserve-symlinks`.

`packages/budget-domain` remains pure calculation and owns cadence parsing,
validation, boundaries, business-day adjustments, and period generation. It
must not learn about subjects, sessions, idempotency, HTTP, proposal expiry, or
persistence.

### 3.2 API adapter

`apps/api/src/budget-creation/` is a thin transport and composition
adapter. It authenticates the request, maps HTTP fields into the application
command, supplies the ports, and maps application results into §4 responses.
It must not recalculate dates, normalize a second time, trust a client-supplied
subject, or import budget-domain internals.

No proposal DTO is added to `@cobudget/contracts`: that package's current public
surface is platform configuration, readiness, and reliability telemetry. If a
later approved cross-client DTO package is needed, it is a separate architecture
change; the JSON contract below remains the compatibility boundary.

### 3.3 Version identities

The implementation exposes immutable, deploy-time constants:

| Field | Initial identity | Meaning |
| --- | --- | --- |
| `proposalContractVersion` | `cbd-232/0.2` | Request, response, normalization, serialization, and lifecycle semantics in this document. |
| `periodContractVersion` | `cbd-26/@cobudget-budget-domain-0.1.0` | Public CBD-26 schedule contract and generators consumed from package version 0.1.0. |
| `calendarDataVersion` | Value from `FEDERAL_RESERVE_CALENDAR.datasetVersion`, or `null` when not applicable | Holiday rules used for paycheck adjustment. |
| `timeZoneDataVersion` | Deploy-time identity of the IANA time-zone rules | Canonical zone names, budget-local dates, and local-midnight instants used by the proposal. |
| `currencyCatalogVersion` | Version supplied by the currency-context port | Currency codes accepted and subject-context compatibility checked. |
| `bindingVersion` | `bcp-hmac-sha256/v1` | Canonical binding envelope and MAC algorithm. |

A behavior-changing engine or catalog release receives a new identity. A code
deployment that does not change a governing result does not invalidate proposals
merely because its build SHA changed.

## 4. HTTP and application contract

All timestamps are RFC 3339 UTC instants. All calendar dates are `YYYY-MM-DD`
date-only values interpreted in the normalized budget time zone. Unknown JSON
fields are rejected so an apparently accepted field cannot be omitted from the
binding.

### 4.1 Create or regenerate a proposal

`POST /v1/budget-creation-proposals` requires an authenticated session and an
`Idempotency-Key` header. The key is an opaque 16–128 character value containing
only visible ASCII characters `0x21` through `0x7E`. Its durable lookup includes
the key plus environment, subject, account/profile, session generation, and
operation; no lookup may omit one of those context dimensions. The body is:

```ts
interface CreateBudgetProposalRequest {
  readonly name: unknown;
  readonly timeZone: unknown;
  readonly currencyCode: unknown;
  readonly schedule: unknown;
  readonly supersedesProposalId?: string;
}
```

`supersedesProposalId` is permitted only when editing or refreshing a proposal
readable by the same current context. Its absence creates an independent draft.
The client never supplies `subjectId`, `accountId`, `profileId`, `environment`,
`budgetDate`, issue/expiry times, rule versions, a preview, or a binding.
The normalized-command digest is SHA-256 over RFC 8785 canonical JSON of the
object `{ normalizedInputs, supersedesProposalId }`; it therefore distinguishes
an independent draft from replacement of a particular predecessor.

Success is HTTP `201` for a newly issued proposal and `200` only for an exact,
still-current idempotent replay. The idempotency record captures the normalized-
command digest, the complete §7.3 dependency fingerprint, the proposal ID and
its lifecycle revision, and the original creation response. It is retained for
24 hours after `issuedAt`, including after the proposal becomes terminal; after
that interval an absent record makes the key eligible for a new operation.

Within the retention interval, the same key and normalized-command digest
returns the stored response only when the current dependency fingerprint still
matches and the proposal remains `previewed` with `now < expiresAt`. A different
normalized-command digest is HTTP `409 idempotency_key_reused`. A matching
command whose recorded proposal is `invalidated`, `expired`, or `confirmed`, or
whose current dependency fingerprint differs, is HTTP `409
idempotency_replay_unavailable` with the reason and literal recovery flags below;
it never returns the stale response. A retry requires a new key and, when
replacing a predecessor, `supersedesProposalId`. Validation errors are HTTP `400`
with the shape in §5. Authentication and context resolution precede idempotency
lookup.

```ts
type IdempotencyConflictResponse =
  | {
      readonly error: "idempotency_key_reused";
      readonly retryWithNewKey: true;
      readonly regenerateRequired: false;
    }
  | {
      readonly error: "idempotency_replay_unavailable";
      readonly reason: "invalidated" | "expired" | "dependency_changed";
      readonly retryWithNewKey: true;
      readonly regenerateRequired: true;
    }
  | {
      readonly error: "idempotency_replay_unavailable";
      readonly reason: "confirmed";
      readonly retryWithNewKey: true;
      readonly regenerateRequired: false;
    };
```

The discriminant and literal flags are canonical: a terminal or stale proposal
is never replayed, while a confirmed proposal does not tell the client to
regenerate a creation that already completed.

### 4.2 Success response

```ts
interface BudgetCreationProposalResponse {
  readonly proposalId: string;
  readonly proposalVersion: 1;
  readonly issuedStatus: "previewed";
  readonly draftRevision: number;
  readonly supersedesProposalId: string | null;
  readonly normalizedInputs: {
    readonly name: string;
    readonly timeZone: string;
    readonly currencyCode: string;
    readonly schedule: CadenceDefinition;
  };
  readonly governingVersions: {
    readonly proposalContractVersion: string;
    readonly periodContractVersion: string;
    readonly calendarDataVersion: string | null;
    readonly timeZoneDataVersion: string;
    readonly currencyCatalogVersion: string;
  };
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly preview: SchedulePreview;
  readonly previewDigest: string;
  readonly confirmationBinding: string;
  readonly bindingVersion: "bcp-hmac-sha256/v1";
  // Added at 0.3, resolving OQ-CF-004.
  readonly currentDisclosure: ConsentDisclosure;
}

// Added at 0.3: the approved consent disclosure, read server-side
// from the registry. `text` is presentation copy and is rendered verbatim.
interface ConsentDisclosure {
  readonly kind: string;
  readonly version: number;
  readonly digest: string;
  readonly text: {
    readonly heading: string;
    readonly items: readonly { readonly id: string; readonly text: string }[];
    readonly acknowledgement: string;
  };
}

type ProposalLifecycle =
  | {
      readonly status: "previewed";
      readonly reason: null;
      readonly regenerateRequired: false;
    }
  | {
      readonly status: "invalidated";
      readonly reason:
        | "superseded"
        | "dependency_changed"
        | "discarded"
        | "session_ended"
        | "context_changed";
      readonly regenerateRequired: true;
    }
  | {
      readonly status: "expired";
      readonly reason: "time_limit" | "local_midnight";
      readonly regenerateRequired: true;
    }
  | {
      readonly status: "confirmed";
      readonly reason: "confirmed";
      readonly regenerateRequired: false;
    };

interface BudgetCreationProposalReadResponse {
  readonly proposal: BudgetCreationProposalResponse;
  readonly lifecycle: ProposalLifecycle;
}
```

`BudgetCreationProposalResponse` is the immutable issued snapshot returned by a
successful POST; `issuedStatus` records that it was issued as `previewed` and
never changes. `proposalId` is a server-generated opaque identifier formatted as
`bcp_` plus 32 lowercase hexadecimal characters drawn from 128 random bits.
`draftRevision` is a server-assigned monotonic
revision within the predecessor chain; concurrent independent previews may each
start at 1. The response deliberately contains no budget-space ID.

**Amendment 0.3, approved by the Product Owner on September 15, 2026 under
`PO-CONTRACT-APPROVALS-003`; this is the resolution of `OQ-CF-004` in
`docs/cbd-236-consent-facts-proposal.md` §13, as an additive field rather than a
separate endpoint.** Every proposal response, on create, regenerate and read,
carries `currentDisclosure`: the approved consent disclosure for the
`primary_owner_self` kind, read server-side from the append-only, digest-pinned
`config/consent-disclosure-registry.json` and never from a request value
(`CBD236-CONSENT-SEMANTICS-001` item 3; CBD-236 consent-facts proposal §5). Four
properties are binding.

1. **Always current, never frozen.** The field is re-read from the registry on
   every response rather than stored in the proposal snapshot, so a proposal
   previewed against a since-superseded disclosure cannot be confirmed against
   it. It is consequently the one field of `BudgetCreationProposalResponse` that
   is not part of the immutable issued snapshot.
2. **Outside the digest and the binding.** `currentDisclosure` is not an input
   to `previewDigest` and not covered by the `confirmationBinding` envelope
   (§7.1). A new disclosure version therefore neither invalidates nor
   regenerates an outstanding proposal; it is enforced at confirmation instead,
   where CBD-233 §3.3 `stale_disclosure` denies a claim that is no longer
   current. A disclosure version change is not a §7.3 result-affecting
   dependency.
3. **Rendered verbatim.** The review surface presents `text.heading`, every
   entry of `text.items` in order and `text.acknowledgement` exactly as
   received. The client holds no copy of the disclosure text, so what the person
   reads is what the server approved and digest-pinned.
4. **Acknowledgement before confirm.** The review requires an explicit,
   **unticked-by-default** acknowledgement of `text.acknowledgement` before the
   confirm control is enabled. The acknowledgement is dropped, and the control
   disabled again, whenever the reviewed proposal is replaced — an edit, a
   regeneration, or a response whose `currentDisclosure` kind or version differs
   from the reviewed one. On confirm the surface sends the reviewed
   `{ kind, version }` as CBD-233's `acknowledgedDisclosure`. Consent is the
   explicit affirmative action taken *after* the complete current-version
   disclosure and nothing weaker (CBD-73 §6 rule 1;
   `CBD236-CONSENT-SEMANTICS-001` item 1). Exact copy, accessibility and
   comprehension evidence for the disclosure text remain gated by CBD-73
   `OI-73-004`, and the `primary_owner_self` version 1 content is approved for
   the prototype phase only.

### 4.3 Read

`GET /v1/budget-creation-proposals/{proposalId}` returns
`BudgetCreationProposalReadResponse`: the immutable issued snapshot under
`proposal` and independently mutable lifecycle metadata under `lifecycle`.
`regenerateRequired` is `true` for `invalidated` and `expired`, where another
proposal is needed to continue, and `false` for `previewed` and `confirmed`.
Only `previewed` is eligible for the proposed confirmation seam. The closed
reason vocabulary is safe recovery metadata and never discloses another
subject's existence or inputs.

Missing, guessed, cross-subject, cross-account/profile, cross-environment, and
stale-session identifiers all return the same HTTP `404 proposal_not_found`
shape. An unauthenticated request returns `401 unauthenticated` before lookup.
A current owner may explicitly discard a proposal; discard is an invalidation,
not deletion of an authoritative budget.

### 4.4 Proposed confirmation handoff

CBD-232 proposes the following request as a consumer interface for the authors
of CBD-233 to accept or reconcile:

```ts
interface ConfirmBudgetCreationRequest {
  readonly proposalId: string;
  readonly confirmationBinding: string;
  readonly confirmationIdempotencyKey: string;
  // Added at 0.3: reconciled with the CBD-233 0.2 amendment.
  readonly acknowledgedDisclosure?: {
    readonly kind: string;
    readonly version: number;
  };
}
```

Under this proposal, a consumer does not accept echoed `normalizedInputs`,
`preview`, `previewDigest`, rule versions, subject identifiers, or authoritative
budget fields. The proposed transaction-scoped integration loads the proposal,
recomputes and constant-time verifies the binding, runs every §7 freshness
check, applies constraints supplied through the proposed CBD-231 reader, creates
the budget space and exactly one Primary Owner, creates authoritative schedule
state, and marks the proposal confirmed in one transaction. It returns the
original result for a successful replay of the same confirmation identity and
does not allow a different confirmation identity to consume an already
confirmed proposal. These are CBD-232 consumer obligations, not recorded
decisions of CBD-231 or CBD-233.

**Amendment 0.3, approved by the Product Owner on September 15, 2026 under
`PO-CONTRACT-APPROVALS-003`.** CBD-233 accepted this shape and added the
optional `acknowledgedDisclosure` claim above; that field, its malformed-versus-
absent handling and the `stale_disclosure` outcome are decided by CBD-233 §§3.1
and 3.3 and are reproduced here only so the two request shapes agree. CBD-232
neither validates the claim nor records consent; the disclosure it publishes in
`currentDisclosure` is what the claim is compared against, server-side, inside
the CBD-233 transaction.

## 5. Normalization and canonical field errors

### 5.1 Error envelope and ordering

```ts
interface FieldError {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

interface ValidationErrorResponse {
  readonly error: "validation_failed";
  readonly fieldErrors: readonly FieldError[];
}
```

After authentication and context resolution, validation runs in this order:
`header.Idempotency-Key`; top-level unknown fields in lexical path order; then
request field order (`name`, `timeZone`, `currencyCode`, `schedule`,
`supersedesProposalId`). Unknown nested fields sort with their owning request
field. Within each field, errors use lexical path/code order. The application
returns all independently detectable errors except that a container shape error
suppresses errors for descendants that cannot be inspected. `code` and `path`
are machine contracts;
`message` is the canonical English default and may be localized at presentation.
Entered raw values remain client-side draft state and are not echoed in logs or
error responses.

### 5.2 Top-level catalog

| Code | Path | Condition | Canonical message |
| --- | --- | --- | --- |
| `idempotency-key.required` | `header.Idempotency-Key` | Header is absent or empty. An empty header returns this error only; the length rule below applies to non-empty values. | Provide an Idempotency-Key header. |
| `idempotency-key.invalid` | `header.Idempotency-Key` | Value is non-empty and not 16–128 visible ASCII characters `0x21` through `0x7E`. | Use 16 to 128 visible ASCII characters. |
| `input.unknown-field` | Exact path of the unknown member | Any request or nested object contains a member outside its declared schema. | Remove the unsupported field. |
| `name.expected-string` | `name` | Value is present but not text. | Enter a budget name. |
| `name.required` | `name` | Normalized value is empty. | Enter a budget name. |
| `name.control-characters` | `name` | Normalized value contains a Unicode control (`Cc`) or format (`Cf`) character, with two exceptions: U+200D ZERO WIDTH JOINER inside an emoji sequence (immediately preceded by an `Extended_Pictographic` or `Emoji_Modifier` character or U+FE0F, and immediately followed by an `Extended_Pictographic` character), and U+200C ZERO WIDTH NON-JOINER or U+200D immediately between two letters (`L`) or combining marks (`M`). Both exceptions read the original string, so a doubled joiner never qualifies through its twin; at a string edge, next to a space, or beside any other `Cc`/`Cf` character a joiner stays rejected. Evaluated after `name.required` and before `name.too-long`. | Remove control and invisible formatting characters. |
| `name.too-long` | `name` | Normalized value exceeds 100 Unicode code points. | Use 100 characters or fewer. |
| `time-zone.expected-string` | `timeZone` | Value is present but not text. | Enter a named IANA time zone. |
| `time-zone.required` | `timeZone` | Trimmed value is empty or missing. | Enter a named IANA time zone. |
| `time-zone.invalid` | `timeZone` | Value is an offset, abbreviation, unknown zone, or cannot be canonicalized. | Choose a valid named IANA time zone. |
| `currency.expected-string` | `currencyCode` | Value is present but not text. | Enter a currency code. |
| `currency.required` | `currencyCode` | Trimmed value is empty or missing. | Enter a currency code. |
| `currency.invalid` | `currencyCode` | Value is not a supported three-letter ISO 4217 code in the active catalog. | Choose a supported three-letter currency code. |
| `currency.context-mismatch` | `currencyCode` | Valid code is incompatible with the current subject's account/profile currency context. | Choose the currency used by this financial profile. |
| `input.expected-object` | `schedule` | Schedule is missing, null, an array, or not an object. | Enter a schedule definition. |
| `supersedes-proposal-id.expected-string` | `supersedesProposalId` | Optional value is present but not text. | Enter a valid proposal identifier. |
| `supersedes-proposal-id.invalid` | `supersedesProposalId` | Text does not match `^bcp_[0-9a-f]{32}$`. | Enter a valid proposal identifier. |

Name normalization applies Unicode NFC, trims leading/trailing Unicode
whitespace, and collapses each internal Unicode-whitespace run to one ASCII
space. The `name` checks then run in the order `name.expected-string`,
`name.required`, `name.control-characters`, `name.too-long`, and the first
failing check is the only `name` error returned. Time-zone normalization
trims, validates a named IANA zone against the runtime's pinned time-zone data,
and stores the runtime's canonical IANA name.
Fixed offsets and abbreviations are invalid. Currency normalization trims and
uppercases ASCII letters, then validates the result through the versioned
currency-context port. Normalization never silently substitutes a default.
Unknown-field detection walks the request shape before cadence parsing;
`parseCadenceDefinition` still supplies all recognized schedule-field errors.
A syntactically valid but unreadable `supersedesProposalId` follows the uniform
§4.3 `404 proposal_not_found` behavior rather than a validation response.

### 5.3 Schedule catalog

The application calls `parseCadenceDefinition(schedule)` exactly once. It
preserves each returned domain `code` and prefixes its `path` with `schedule.`;
the empty domain path becomes `schedule`. These existing public codes are the
canonical schedule catalog:

| Codes | Applicable paths / meaning |
| --- | --- |
| `field.expected-string`, `field.expected-number`, `field.expected-object`, `field.expected-pair`, `field.expected-calendar-date` | Shape/type failure at the prefixed domain path. |
| `cadence.unsupported` | `schedule.cadence`; cadence is not weekly, monthly, paycheck, or custom-fixed-length. |
| `weekday.unsupported` | An anchor or paycheck weekday is not one of the seven public `WEEKDAYS`. |
| `monthly-anchor.unsupported-kind`, `monthly-anchor.not-an-integer`, `monthly-anchor.out-of-range` | Monthly anchor is not `last-day` or an integer day 1–31. A valid 29–31 anchor is not rejected merely because a short month will clamp it. |
| `paycheck.unsupported-pattern`, `paycheck.duplicate-weekday`, `paycheck.duplicate-monthly-anchor`, `paycheck.origin-weekday-mismatch`, `paycheck.interval-out-of-range` | Paycheck pattern violates the six supported recurring shapes. |
| `recurrence-origin.invalid-date` | Recurrence origin is not a real `YYYY-MM-DD` date. |
| `business-day-policy.unsupported` | Policy is not previous-business-day, next-business-day, or keep-original-date. |
| `custom.invalid-start-boundary`, `custom.length-not-an-integer`, `custom.length-out-of-range` | Fixed-length custom input is not a real start date or an integer 1–366 days. |

The schedule parser's text is the canonical default message for these codes.
Schedule-version-only codes are not creation-input errors because the client
does not submit a `ScheduleVersion`.

### 5.4 Validation side effects

Validation and normalization complete before proposal ID generation, proposal
storage, successor invalidation, or any proposed sibling-consumer call. Failure returns the
catalog above, preserves only the non-authoritative client draft, and creates no
authoritative or proposal record. Authentication and subject-context resolution
may read current state but may not mutate it.

## 6. Server computation and preview

### 6.1 Computation sequence

For a valid request, the server:

1. obtains `environment`, immutable subject ID, current account/profile context,
   and session generation from trusted authentication context;
2. normalizes and validates §5 input;
3. reads the server clock and derives `budgetDate` in the normalized IANA zone;
4. captures the governing versions in §3.3;
5. constructs the cadence boundary functions from the validated definition;
6. calls the exported CBD-26 `setupPreview(boundaries, budgetDate)` and
   `periodLengthInDays` functions; and
7. assembles, canonicalizes, digests, binds, and stores the immutable proposal.

Weekly and monthly use `weeklyMonthlyBoundaries`. Fixed-length custom uses
`customBoundaries`. Paycheck uses `buildPaycheckSchedule` with a server-selected
horizon wide enough to contain the period at `budgetDate` and at least three
following periods, including the public adjustment reach; its returned
`boundaries` feed `setupPreview`, and its occurrences supply adjustment evidence.
Unsupported holiday coverage is a blocking calculation error, never a fallback
to weekday-only behavior.

The client may render the returned dates but must not calculate, repair, extend,
or reorder them. A client-computed preview is never accepted by confirmation.

### 6.2 Preview shape

```ts
interface SchedulePreview {
  readonly budgetDate: ISODate;
  readonly timeZone: string;
  readonly cadence: CadenceDefinition["cadence"];
  readonly cadenceDefinition: CadenceDefinition;
  readonly cadenceSummary: string;
  readonly periodCount: number; // initially 4
  readonly periods: readonly PreviewPeriod[];
  readonly adjustments: readonly PreviewAdjustment[];
  readonly warnings: readonly PreviewWarning[];
}

interface PreviewPeriod {
  readonly ordinal: 0 | 1 | 2 | 3;
  readonly relation: "current" | "following";
  readonly start: ISODate;
  readonly end: ISODate;
  readonly lengthInDays: number;
}

type PreviewAdjustment =
  | {
      readonly kind: "monthly-anchor-clamp";
      readonly unadjustedDay: number;
      readonly adjustedDate: ISODate;
    }
  | {
      readonly kind: "business-day";
      readonly unadjustedDate: ISODate;
      readonly adjustedDate: ISODate;
      readonly policy: BusinessDayPolicy;
      readonly reason: NonBusinessDayReason | null;
      readonly calendarDataVersion: string;
    };
```

`periods[0]` is the complete period containing `budgetDate`; ordinals 1–3 are
the next three complete, chronological, contiguous periods. Starts and ends are
inclusive. `lengthInDays` is the inclusive calendar-day count. The normalized
definition carries the exact cadence and anchor/pattern. `adjustments` exposes
every clamp or business-day adjustment affecting displayed boundaries or
paycheck occurrences in the preview horizon, including original and adjusted
dates and provenance. For cadences with no applicable adjustment it is empty.

Warnings are typed, nonblocking explanations such as a valid monthly day 29–31
clamping in a displayed short month. Warnings never replace field errors.

## 7. Digest, confirmation binding, expiry, and staleness

### 7.1 Canonical digest and binding

`previewDigest` is base64url SHA-256 over RFC 8785 canonical JSON of
`normalizedInputs + governingVersions + preview`. It is content evidence, not
authorization. **Amendment 0.3:** the §4.2 `currentDisclosure` field
is deliberately not an input to this digest and not covered by the binding
envelope below, for the reason given in §4.2.

`confirmationBinding` is an opaque, server-authenticated token using
HMAC-SHA-256 under a server-held versioned key. Its v1 envelope covers:

```text
bindingVersion, environment, subjectId, accountId/profileId,
sessionGeneration, proposalId, proposalVersion, draftRevision,
normalizedInputs, governingVersions, issuedAt, expiresAt,
previewDigest, budgetDate, predecessorProposalId
```

The key and raw internal identifiers are never returned in the token payload or
logs. Verification is constant-time. Key rotation retains verification keys
only through the maximum proposal lifetime; a missing/retired key invalidates
the proposal. Digest equality without a valid binding is insufficient.

### 7.2 Expiry

`expiresAt` is the earlier of `issuedAt + 30 minutes` and the next local midnight
in the normalized budget time zone, converted to an instant by a DST-aware time-
zone implementation. The interval is half-open: confirmation is allowed only
when `now < expiresAt`. Local midnight is derived from calendar rules, never by
adding 24 hours. This handles 23-hour and 25-hour days.

### 7.3 Result-affecting dependencies

The dependency fingerprint includes:

1. the exact normalized inputs;
2. all governing versions;
3. budget-local date and time-zone rules;
4. environment, subject, account/profile, and session generation;
5. current currency context; and
6. every lifecycle/creation-constraint version returned by the proposed
   `BudgetCreationConstraintReader` if that interface is accepted by CBD-231.

An edit to name, time zone, currency, cadence, anchor, cadence-specific input,
or any other bound value creates a successor and invalidates the predecessor.
A normalized no-op may be an idempotent replay only under the complete §4.1
replay test. Successor creation, its idempotency record, and predecessor
invalidation use the single `replaceCurrent` expected-revision operation in §9;
concurrent successor attempts cannot both replace the same preview.
A rule, currency catalog/context, holiday data, lifecycle constraint, session,
or budget-local-date change makes the proposal stale on the next read or
confirmation even if no eager invalidation job ran. Display-only UI state that
is absent from normalized input does not invalidate it.

### 7.4 State machine

```text
valid request -> PREVIEWED
PREVIEWED --result-affecting edit/refresh--> INVALIDATED + successor PREVIEWED
PREVIEWED --rule/context/session/local-date change--> INVALIDATED
PREVIEWED --now >= expiresAt--> EXPIRED
PREVIEWED --proposed confirmation transaction succeeds--> CONFIRMED
PREVIEWED --discard/logout/account switch--> INVALIDATED
INVALIDATED | EXPIRED --regenerate--> successor PREVIEWED
```

Invalidation and expiry are terminal for a proposal ID. Regeneration preserves
editable client input but creates a new ID, digest, binding, issue/expiry time,
and draft revision. A proposal is never made current again.

## 8. Isolation, session changes, and authoritative state

### 8.1 Subject and environment isolation

Every store operation is keyed internally by environment and subject before the
opaque proposal identifier is considered. Reads never perform an identifier-only
lookup followed by authorization. Cache keys include environment, subject, and
proposal ID. Lists, counts, timing, errors, and logs must not disclose another
subject's proposals.

Confirmation re-resolves the current authenticated context. A guessed ID,
another subject's proposal, another environment's proposal, a stale or revoked
session generation, or an altered token receives no proposal data and creates no
state. The generic failure behavior is §4.3.

### 8.2 Browser draft lifecycle

Raw form edits may remain ephemeral browser draft state. They are explicitly
non-authoritative, versioned locally, and expire no later than the proposal to
which they are bound. Values may remain visibly editable after expiry as CBD-68
requires, but they have no reusable server authority and must pass a new request
to become a new proposal. They must not be exposed through budget routes or
treated as saved budgets. On logout or account/profile switch, the web
client clears proposal IDs, bindings, previews, and raw draft state before
rendering the new context. The server invalidates proposals associated with the
ended session generation; lazy session-generation comparison is mandatory even
if eager cleanup fails.

A user may deliberately re-enter or rebind values only by creating a new
proposal under the new current context. A proposal is never silently transferred
between subjects or accounts.

### 8.3 Authority boundary

| Data | State | Authority |
| --- | --- | --- |
| Raw form values | Browser draft | Non-authoritative; cleared on context change. |
| Normalized inputs, preview, digest, binding | Server proposal | Non-authoritative, immutable, subject-scoped, versioned, expiring. |
| Proposal lifecycle marker | Server proposal metadata | Controls eligibility only; not a budget. |
| Budget space, Primary Owner membership, schedule version, confirmed periods/targets | Proposed confirmation transaction after proposed constraint-reader checks | Authoritative only after atomic commit; sibling authors must accept or reconcile the seam. |
| Future generated periods | Disposable derived data | Recomputed through the governing period contract; not authoritative merely because previewed. |

## 9. Persistence-independent ports and CBD-246 seam

`@cobudget/budget-application/creation-proposals` depends on interfaces, not a
database:

```ts
interface BudgetCreationProposalStore {
  createOrReplay(command: CreateProposalRecord): Promise<CreateOrReplayResult>;
  replaceCurrent(command: ReplaceProposalRecord): Promise<ReplaceProposalResult>;
  loadForContext(key: ProposalContextKey): Promise<ProposalRecord | null>;
  invalidate(key: ProposalContextKey, expectedRevision: number, reason: string): Promise<void>;
}

interface BudgetCreationConfirmationUnitOfWork {
  claimCurrentProposal(key: ProposalContextKey, binding: string): Promise<ProposalRecord>;
  recordConfirmed(proposalId: string, authoritativeBudgetSpaceId: string): Promise<void>;
}
```

`createOrReplay` handles requests without `supersedesProposalId` and atomically
creates the proposal plus its §4.1 idempotency record, or evaluates the complete
replay/conflict result against an existing record. `replaceCurrent` accepts the
predecessor context key and expected lifecycle revision, the successor record,
and the successor idempotency record. In one all-or-nothing commit it verifies
that the predecessor remains current, inserts the successor and idempotency
record, and marks the predecessor invalidated with the successor ID. A revision
or idempotency conflict writes nothing. Evaluation order inside that commit is
fixed: `replaceCurrent` first looks up the successor idempotency record by its
full §4.1 lookup scope, and if one exists it returns the §4.1 replay or conflict
outcome without consulting predecessor eligibility at all — so an exact retry
after a lost response returns `200` with the stored response even though the
predecessor is by then invalidated. Only when no idempotency record exists does
it evaluate the predecessor, which must be either current at the expected
revision or a terminal chain head — `EXPIRED`, or `INVALIDATED` by discard,
logout or account switch — that has no successor yet; a predecessor that already
has a successor, or that was `CONFIRMED`, is a conflict (§4.1). This is the one
path by which the terminal-to-successor regeneration in §7 happens. Requests
with `supersedesProposalId` must use `replaceCurrent`; neither `createOrReplay` followed by `invalidate` nor
two independent store calls satisfies this contract. `invalidate` remains for
discard and eager cleanup that create no successor.

The complete port set also includes `AuthenticatedSubjectContext`, `Clock`,
`OpaqueIdGenerator`, `BindingKeyring`, `CurrencyContextReader`, and
`BudgetCreationConstraintReader`. In-memory adapters may exercise the application
contract. No behavior depends on a SQL schema or ORM.

CBD-246 provides the durable tenant-scoped implementations of
`BudgetCreationProposalStore` and the transaction participation required by
`BudgetCreationConfirmationUnitOfWork`. The durable adapter must enforce the
full idempotency scope and retention rule, context-first lookup, optimistic
revision checks, expiry queries, atomic replacement, and atomic
claim/confirmation. CBD-246 does not decide proposal
semantics; it implements this port.

## 10. CBD-231 and CBD-233 consumption

### 10.1 Proposed CBD-231 interface

CBD-232 proposes that CBD-231 authors accept or reconcile a
`BudgetCreationConstraintReader` that returns current lifecycle and creation
constraints plus a stable result-affecting version. Under this proposed seam,
proposal creation records that version and read and confirmation compare it
again. The reader receives no authority from a proposal and does not expose
proposal state as a budget space.

Because only the live Jira summary is authoritative here, CBD-232 does not claim
that CBD-231 has selected this reader or any exact constraint fields. The
sibling authors must reconcile the proposed reader before implementation; once
accepted, every result-affecting constraint returned by it belongs in the
fingerprint.

### 10.2 Proposed CBD-233 interface

CBD-232 proposes that CBD-233 authors accept or reconcile the §4.4 request and
transaction-scoped port. Under this seam, a consumer treats the immutable
proposal as values proposed for writing, not as proof that the caller remains
authorized or constraints remain satisfied. It rechecks §7.3 and the accepted
constraint-reader interface in the same unit of work that creates authoritative
records. No partial space, membership, schedule, period, target, or success
audit event may remain after failure.

The proposed consumer owns the confirmation idempotency result. The pair
`environment + subject + confirmationIdempotencyKey` maps either to the original
successful result or to a conflict when reused for a different proposal. A
proposal may produce at most one authoritative budget space.

## 11. Verification contract

The implementation packet must include deterministic fixtures and tests for:

| Group | Required evidence |
| --- | --- |
| Every cadence | Weekly with each weekday boundary class; monthly numbered/last-day; all six paycheck patterns and all three business-day policies; custom lengths 1 and 366 plus representative interior values. |
| Calendar boundaries | Current complete period plus three following; inclusive lengths; January/year rollover; day 29/30/31 clamping; February in common and leap years. |
| Time zones and DST | Named-zone validation; canonical aliases; fixed-offset rejection; budget date near UTC/local-day boundaries; 23-hour and 25-hour days; expiry at local midnight. |
| Normalization | Unicode NFC and whitespace name cases; case/whitespace time-zone and currency cases; raw variants that normalize identically produce the same normalized-input digest. |
| Validation | Every §5 code/path, top-level and nested unknown fields, malformed `supersedesProposalId`, missing/invalid `Idempotency-Key`, multiple simultaneous errors, stable ordering, no proposal write, and no authoritative write. |
| Edit and rule change | Every bound field; predecessor invalidation; calendar, time-zone-data, currency, period-contract, constraint, and binding-key version changes; display-only change does not invalidate. |
| Expiry and replay | Exact expiry boundary; 30-minute cap; local-midnight cap; create-key same/different command, dependency change, terminal lifecycle, and post-retention reuse; confirmation-key same/different proposal; already-confirmed proposal. |
| Concurrency | Two independent previews; simultaneous `replaceCurrent` attempts; atomic successor/idempotency/predecessor mutation; confirm versus edit/expiry/rule change; exactly one successful confirmation. |
| Isolation | Guessed ID, cross-subject, cross-account/profile, cross-environment, logout, account switch, revoked/stale session, cache-key isolation, altered digest/preview/token, and uniform not-found behavior. |
| Failure atomicity | Holiday coverage error, port failure, binding failure, and proposed confirmation-transaction failure leave no partial authoritative state. |

Property tests should additionally assert period chronology, contiguity,
non-overlap, containment of `budgetDate`, inclusive length, and exactly four
periods for every valid generated preview. Tests use injected clocks, IDs,
keyrings, and ports; no live provider or wall clock is required.

## 12. Compatibility, migration, and tradeoffs

### 12.1 Compatibility

Proposal responses are immutable snapshots. Additive optional response fields
may remain within proposal version 1 only when they do not affect calculation,
binding, or confirmation. A change to normalization, required input, canonical
serialization, period meaning, invalidation, or binding increments
`proposalVersion` and `proposalContractVersion`; old proposals become stale.
Version 0.2 remains pre-implementation, so no v0.1 proposal exists to migrate;
the initial wire `proposalVersion` remains 1 while `proposalContractVersion`
identifies the corrected `cbd-232/0.2` semantics.

No data migration is required for the first implementation. CBD-246 may store
the canonical envelope as structured columns, canonical JSON, or both, provided
context-first access, uniqueness, version comparison, expiry, and proposed
confirmation-transaction participation remain enforceable.

### 12.2 Alternatives considered

| Alternative | Disposition | Tradeoff |
| --- | --- | --- |
| Put proposal orchestration in `budget-domain` | Rejected | Would mix subjects, sessions, time, keys, and persistence ports into a deliberately pure calculation package. |
| Put all behavior directly in NestJS controllers | Rejected | Couples rules to HTTP/framework code and makes deterministic application tests and worker reuse harder. |
| Let the client submit periods at confirmation | Rejected | Violates server computation and permits alteration; confirmation accepts only proposal identity and binding. |
| Stateless signed proposal only | Rejected | A MAC can prevent alteration but cannot by itself enforce single consumption, successor invalidation, session cleanup, or idempotent confirmation. |
| Persist future periods as authoritative during preview | Rejected | Contradicts non-authoritative proposal state and the domain rule that future projections are disposable derived data. |
| Extend an existing proposal in place | Rejected | Makes the reviewed snapshot mutable and obscures which preview a user confirmed. Successors preserve the chain. |

## 13. Acceptance-criteria traceability

| Acceptance criterion | Contract evidence | Implementation evidence required |
| --- | --- | --- |
| `CBD-232-AC01` | §§5.1–5.4 define normalized creation fields, canonical codes/paths including unknown fields, malformed predecessor IDs and idempotency headers, complete error collection, and the no-write rule. | Every catalog entry and simultaneous-error ordering; spies prove no proposal or authoritative write. |
| `CBD-232-AC02` | §§2.3, 3, and 6 require trusted subject context, server normalization/date/rule selection, public CBD-26 imports, and server-only computation. | Tests reject client authority fields and compare API output with direct domain-engine fixtures. |
| `CBD-232-AC03` | §6.2 fixes the complete current period plus three following, inclusive dates/lengths, cadence definition/summary, time zone, and adjustments. | Cadence, clamp, holiday, leap-year, and boundary fixtures in §11. |
| `CBD-232-AC04` | §§3.3, 4.2, and 7.1 fix immutable input/rule versions, issue/expiry, digest, and subject/session/environment MAC binding. | Mutation, token forgery, replay, version-change, and constant-time verification tests. |
| `CBD-232-AC05` | §§4.1 and 7.2–7.4 define context-complete replay, retained terminal records, 30-minute/local-midnight expiry, result-affecting dependencies, terminal invalidation, and atomic successor regeneration. | Injected-clock, every-field edit, rule-version, dependency-change, terminal/post-retention replay, DST, and local-midnight tests. |
| `CBD-232-AC06` | §§4.2–4.3 and 8 distinguish the immutable issued snapshot from lifecycle metadata and budgets, scope/version/expire drafts, and define logout/account-switch clearing and rebinding. | Read-lifecycle schema, budget-route denial, client clear, server lazy invalidation, and deliberate re-entry tests. |
| `CBD-232-AC07` | §§4.1, 4.3, 7.1, and 8.1 define context-complete idempotency and lookup, uniform non-disclosure, current-session checks, digest/MAC verification, and cross-environment denial. | Guessed/cross-context/stale-session/altered-payload and cross-context key cases in §11. |
| `CBD-232-AC08` | §11 enumerates every required cadence, DST/local-midnight, short-month/leap-year, normalization, edit, expiry, replay, concurrency, and cross-subject suite. | Passing implementation test report at the exact candidate revision. |
| `CBD-232-AC03` (0.3 consent amendment) | §4.2 `currentDisclosure` is read from the approved registry on every response and rendered verbatim. | Response-shape fixtures for create, regenerate and read; a test that the field tracks the registry rather than the stored snapshot. |
| `CBD-232-AC06` (0.3 consent amendment) | §4.2 acknowledgement rule: unticked by default, dropped on any replacement of the reviewed proposal, echoed as CBD-233 `acknowledgedDisclosure`. | Review-surface tests that confirm is disabled until ticked and disabled again on edit, regeneration or a disclosure-version change, and that the confirm payload carries the reviewed kind and version. |

## 14. Findings, assumptions, and dependencies

1. The schedule package already exports the required validated generators and
   setup-preview helper, but it does not export a single all-cadence factory.
   The application composition described in §6.1 is therefore intentional.
2. The rebased repository baseline contains CBD-168 Approved v1.1.2, as recorded
   by `CBD168-APPROVAL-001`; §1 pins that exact approved source. This assignment
   does not edit the approved document.
3. CBD-231 and CBD-233 were available to this assignment by live summary only.
   Their detailed fields must be reconciled when their approved contracts exist;
   §§4.4 and 10 explicitly propose seams for their authors to accept or
   reconcile; they do not attribute those details to the sibling tickets.
4. The currency catalog and account/profile context are required inputs but no
   authoritative implementation was in this packet. `CurrencyContextReader`
   makes the dependency explicit and versioned rather than selecting a source.
5. The application package and port names are architectural proposals. Creating
   its manifest, exports, or code belongs to the follow-on implementation packet.
6. **Amendment 0.3.** `OQ-CF-004` of
   `docs/cbd-236-consent-facts-proposal.md` §13 asked whether the preview
   response should carry the disclosure as an additive field or through a
   separate endpoint. It is resolved here by reference: an additive field on the
   existing response, specified in §4.2. `OQ-CF-002` (whether a later
   `primary_owner_self` version obliges an existing owner to re-consent) and
   `OQ-CF-003` (audit correlation of the consent evidence) are **not** resolved
   by this amendment and remain open with their named owners; nothing in §4.2
   depends on either answer. The port set of §9 gains a read-only
   server-side disclosure source; it reads the registry and never a request
   value.

## 15. Revision history

| Version | Date | Author | Change | Disposition |
| --- | --- | --- | --- | --- |
| 0.3.2 | September 17, 2026 | Documentation specialist, dispatched under `DOC-CBD232-NAME-CATALOG-001` | §5.2 gains the `name.control-characters` row and the `name` evaluation order, describing what PR #397 (merge commit `8697762`) implements in `packages/budget-application/src/creation-proposals/normalize.ts` (`REV-NS-3`, `PROTO-NAME-SANITIZE-REVIEW-001`). No other text, cell, or decision identifier changed. | Approved — user consent, September 17, 2026, to this out-of-scope approved-document change as its own focused pull request (AGENTS.md rule); disposition stays `unpublished`. |
| 0.3.1 | September 15, 2026 | Documentation specialist, dispatched under `PROTO-DOC-SWEEP-003` | §3.2 corrected: the implementation directory is `apps/api/src/budget-creation/`, not `apps/api/src/budget-creation-proposals/` (`GUARD-F03`), verified against the merged tree. No other text, cell, or decision identifier changed. | Approved — Executive, September 15, 2026 (`EXEC-FOLLOWUPS-003`). |
| 0.3 | September 15, 2026 | Specification specialist, dispatched by Manager (`PROTO-CONSENT-AMENDMENTS-001`) | The amendment `CBD236-CONSENT-SEMANTICS-001` item 6 deferred to this package, describing what PR #337 merged: §4.2 adds the `currentDisclosure` preview field with its always-current, outside-the-digest, rendered-verbatim and unticked-by-default acknowledgement rules; §4.4 reconciles the confirmation request with the CBD-233 0.2 `acknowledgedDisclosure` claim; §7.1 records the digest exclusion; §13 gains two traceability rows; §14 records `OQ-CF-004` resolved by reference and `OQ-CF-002`/`OQ-CF-003` left open. | **Approved — Product Owner, September 15, 2026 (`PO-CONTRACT-APPROVALS-003`).** Status and document version bumped in the same change; `OQ-CF-002`, `OQ-CF-003` and `OQ-CF-005` stay open. |
| 0.2.1 (approval) | September 13, 2026 | Manager, in the merge lane | Product Owner approval recorded (PO-CONTRACT-APPROVALS-001). Status Proposed → Approved at the same version; no decision, identifier or contract text changed. | Approved. |
| 0.2.1 | September 12, 2026 | Manager, in the merge lane | Re-review closures: `replaceCurrent` evaluation order and terminal-head regeneration defined (re-review finding 1, §11 seam paragraph); empty `Idempotency-Key` now yields `idempotency-key.required` only (finding 2, §5 catalog). No other text changed. | Proposed; re-review findings 1 and 2 closed in the lane. |
| 0.2 | September 12, 2026 | Architecture specialist, dispatched by Manager | Independent-review corrections: F1 → lines 161–226, 541–561, 627–651, and 710–711; F2 → lines 228–314; F3 → lines 554–558, 627–651, and 711; F4 → lines 34–38, 57–60, 316–339, 619, 666–696, 735–736, and 770–773; F5 → lines 343–401 and 708; F6 → lines 9, 20–26, and 767–769; F7 → lines 88–108. | Proposed; corrected candidate requires independent re-review and implementation evidence. |
| 0.1 | September 12, 2026 | Architecture specialist, dispatched by Manager | Initial request/response, validation, computation, preview, binding, invalidation, package, persistence-seam, sibling-consumption, test, and AC traceability contract. | Proposed; independent architecture/review and implementation evidence pending. |
