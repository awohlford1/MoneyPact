# Prototype web API integration

Assignment: PROTO-WEB-JOURNEY-001 revision 2, reconciled against the merged
API routes by PROTO-ACTIVATION-001 (PRs #318, #320, #321, #322, #323, #324 on
main 263c587). Every assumption below states whether it held, and what
changed. The wire shapes are typed in `src/api/client.ts` (`Wire*`) and the
development mock (`src/api/mock-server.ts`) speaks exactly those shapes, so
the production client runs unchanged against the mock and the real API.

## Transport and identity

- Held: production requests use same-origin `/v1`; the Next rewrite proxies
  `/v1/:path*` to the local API at `http://127.0.0.1:3001`. The development
  server uses the localhost-only mock at `/api/mock/v1` unless the untracked
  file `apps/web/.api-mode` contains `live`, in which case `npm run dev` uses
  the real API through the proxy (a file, not an environment variable,
  because the repository's environment guard reserves `process.env` for the
  shared loader). No new environment variable was introduced.
- Changed: the API's application origin must be the web origin
  (`COBUDGET_IDENTITY_APPLICATION_ORIGIN=http://localhost:3000`) and the
  callback URI lives on it; the ceremony origin is the API itself. Because the
  proxy replaces the Host header, the API honours `X-Forwarded-Host` only
  from a loopback peer (identity/http.ts `observedOrigin`).
- Changed: `POST /v1/identity/begin` sends
  `{ceremony:'sign_in', postResultDestinationId:'budgets'}`; the API's closed
  destination list gained `budgets` (`/budgets`) so the callback lands on the
  authenticated page. The browser navigates to the returned `navigateTo`
  (the API-owned hosted chooser on the ceremony origin), the chooser's GET
  callback commits the session and returns a 303 to `/budgets`.
- Changed: `GET /v1/identity/me` returns `{accountSubjectId, profileId,
  identityBindingId, sessionRef, sessionVersion, environmentId, assurance,
  csrfValue}` (200) or the uniform denial `{outcome:'deny', reason:'denied'}`
  (403). The client keeps `accountSubjectId`, `sessionRef`, `sessionVersion`
  as the `Session` and holds `csrfValue` in memory only (CBD-191 section
  5.1): no CSRF cookie exists and no cookie is read. Mutations send the value
  in `X-CoBudget-CSRF`. The value is returned on every bootstrap read of a
  live session (a reload bootstraps again; it is never stored), bounded by
  the session's absolute expiry and erased at logout.
- Changed: `POST /v1/identity/logout` returns 200 `{signedOut:true}` and
  deletes the HttpOnly session cookie; the client clears its held CSRF value.
  There is still no Authorization-header fallback; only non-authoritative
  `sessionRef`/`sessionVersion` hints and raw drafts are stored in
  `sessionStorage`.
- Held: 401 or 403 on `/identity/me` is treated as signed out.
- Changed (correction round): every non-safe request on a cookie-authenticated
  route is checked by the API boundary for the exact Origin, `Sec-Fetch-Site:
  same-origin` and `X-CoBudget-CSRF` before any replay, policy or effect; a
  failure is the uniform 403 denial. The client already sends all three.
  `GET /v1/identity/recovery` returns the same bootstrap body on the
  independent `surf-266-recovery` rate-limit pool; the client does not call it
  yet (a 403 from `/identity/me` is indistinguishable from exhaustion).

## Proposals and confirmation

- Held: request, response, field-error and preview shapes follow approved
  CBD-232 v0.2.1 (`proposal.create`/`proposal.read` under released p2).
  `POST` returns 201 for a new proposal and 200 for an exact idempotent
  replay; `GET .../{proposalId}` returns `{proposal, lifecycle}`; an unknown
  or foreign proposal is the uniform 403 denial, not a 404.
- Changed: the API stores the proposal as `jsonb`, so a re-read returns the
  same values with a different JSON key order. The controller compares
  proposals with a key-order-independent canonical form
  (`sameProposal`) instead of `JSON.stringify` equality.
- Held: confirmation follows CBD-233 v0.1.1: proposal id in the route, only
  `confirmationBinding` in the body, `Idempotency-Key` in the header; the
  response carries `budgetSpaceId` and `currentPeriodId`. Confirmation
  returns 201.
- Held: `expiresAt` is the server's earlier of expiry and budget-local
  midnight; the UI reads lifecycle every 15 seconds while reviewing,
  regenerates on focus/restore and rechecks before confirmation.

## Budget and plan shapes (reconciled)

- Changed: `GET /v1/budget-spaces` returns `{spaces:[{budgetSpaceId,
  membershipId, name, nameVersion, lifecycle, lifecycleVersion, currencyCode,
  timeZone}]}` (`membership.list_own`); the client maps it to
  `{id, name, currencyCode, timeZone}`.
- Changed: `GET /v1/budget-spaces/{id}` returns `{space, scheduleVersion,
  budgetDate, activePeriod, nextPeriods}` where `activePeriod` is the stored
  `budget_space_period` row `{periodId, scheduleVersionId, status, ordinal,
  relation, start, end, lengthInDays}`. The client maps `periodId` to
  `activePeriod.id`. There is no `freshness`, `completeness` or `updatedAt` on
  the wire: `freshness` is always `current` (the API has no staleness
  signal, so the stale shell state is not reachable from a response),
  `completeness` is `partial` when a required section is missing, and
  `updatedAt` is the server's `budgetDate`.
- Changed: `GET /v1/budget-spaces/{id}/plan?periodId=` returns the CBD-153
  plan `{budgetSpaceId, period:{periodId,...}, cadence, currencyCode,
  minorUnitPrecision, formulaVersion, categories:[{categoryId, label,
  position, baseTarget:{amountMinorUnits}|null, periodTarget:{amountMinorUnits,
  ...}}]}`. Amounts are integers in minor units; the client formats them into
  decimal major-unit strings using the plan's `minorUnitPrecision`
  (presentation only) and never computes a target. A category without a base
  target has no entry in `targets`.
- Changed: categories are created with `PUT /v1/budget-spaces/{id}/categories`
  `{categories:[{label}]}` (an upsert that returns the whole list); the
  client picks the created row by label. Targets are set with
  `PUT /v1/budget-spaces/{id}/targets` `{targets:[{categoryId,
  amountMinorUnits}]}` (whole-set semantics for the listed categories,
  append-only history on the server); there is no per-target
  `expectedVersion`, so a stale edit is not a 409 -- the UI reloads the
  complete recomputed plan after a successful save. Amount strings are
  parsed to minor units by precision; more fraction digits than the currency
  allows is a client-side `validation_failed` (`amount.invalid`).
- Held: 401/403 mean denied; 404/410 mean terminal missing/unavailable;
  transport/503 failures mean recoverable. A mismatched response identity
  fails closed as an invalid server response. The real API enforces
  authorization (CBD-236 p2 for the subject-scoped routes, p1 for the space
  routes) and commit-time version checks; UI visibility is not an
  authorization boundary.

## Development mock fidelity

`src/api/mock-server.ts` implements the wire shapes above (`MockWire`) and
`handleMockRequest` is the HTTP mapping shared by the Next route and the
in-memory client used by the unit tests. It runs only on the Next server
through a localhost-only development route, with synthetic sessions,
volatile maps, the existing schedule engine and full-period target
calculation. The mock profile is USD-only. The route is unavailable in
production and whenever `.api-mode` selects the live API.

The mock begin endpoint simulates successful sign-in directly instead of
rendering the API-owned chooser or performing a callback. It uses the same
POST body, response, HttpOnly cookie, bootstrap value and header transport
as the production client.

The mock is not evidence of PostgreSQL durability, real session revocation,
provider callback custody, policy decisions, canonical HMAC bindings,
complete clamp/holiday warning metadata, or atomic database writes. Real API
evidence is `scripts/prototype-e2e.mjs` (scripted, real HTTP) and
`scripts/prototype-browser-walkthrough.mjs` (headless Chrome through
`npm run dev` with the mock off).

## Verification entry points

- `node --test apps/web/src/api/journey.test.ts`: controller, transport, wire
  mappings, mock server, server identities, expiry, concurrency and
  cancellation checks.
- `node --test apps/web/tests/browser.test.mjs`: actual Next routes against the
  mock, request payload, category editing, reload, state matrix,
  accessibility with the existing axe-core tooling, keyboard focus and 320px
  reflow in headless Chrome.
- `node scripts/prototype-browser-walkthrough.mjs --db <scratch>`:
  the same journey in headless Chrome against the real API and a migrated
  scratch database.
