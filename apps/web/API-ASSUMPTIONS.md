# Prototype web API integration

Assignment: PROTO-WEB-JOURNEY-001 revision 2. These are implementation assumptions
for Manager reconciliation with the parallel API branches, not API design approvals.

## Transport and identity

- Production requests use same-origin `/v1`. The development default uses
  `/api/mock/v1`. Next config selects an explicit module alias by build phase;
  no new environment variables are introduced. Integration can switch that alias
  to `runtime-mode.ts`. The Next rewrite proxies `/v1/:path*` to the local API
  at `http://127.0.0.1:3001/v1/:path*`. API origin checks must allow the exact
  application origin; browser requests and callbacks remain on that origin.
  Port 3001 is the repository local API default; hosted routing is outside scope.
- `POST /identity/begin` sends `{ceremony:'sign_in',postResultDestinationId:'home'}`
  and navigates to the returned `navigateTo`. The API owns its authorize page,
  chooser and GET callback. `/identity/result?outcome=...` renders generic safe
  recovery copy without echoing untrusted query text. Successful session bootstrap
  sends the user to `/budgets`.
- `GET /identity/me` returns `{accountSubjectId, sessionRef, sessionVersion}`,
  or 403 (401 is also treated as signed out). Mutations read the separate
  `__Host-cobudget_csrf` cookie at request time and send `x-csrf-token`.
  No CSRF token is needed to begin the unauthenticated ceremony.
  The browser never reads the HttpOnly session cookie. Revision 2 explicitly
  supersedes CBD-191 section 5.1's bootstrap-value/header transport for this
  integration; Manager must reconcile the contract with identity PR #320.
- `POST /identity/logout` returns 204 and deletes the server cookie. There is no
  Authorization-header fallback. Only non-authoritative sessionRef/version hints
  and raw drafts may be stored in sessionStorage; bindings and CSRF values are not.

## Proposals and confirmation

- Request, response, field-error and preview shapes follow approved CBD-232
  v0.2.1. PO-CONTRACT-APPROVALS-001 explicitly approves that version; the packet's
  v0.2 pin is stale. The versioned HTTP contract identity remains `cbd-232/0.2`.
- Confirmation follows CBD-233 v0.1.1: proposal ID in the route, only
  `confirmationBinding` in the JSON body, and `Idempotency-Key` in the header.
  The packet's CBD-242-AC02 verification method incorrectly says digest. The live
  Jira criterion read during implementation does not require a digest, and
  CBD-233 expressly rejects it. No Jira or approved document was edited.
- The server's `expiresAt` is the earlier of expiry and budget-local midnight.
  The UI uses that timestamp, reads lifecycle every 15 seconds while reviewing,
  regenerates on focus/restore, and rechecks immediately before confirmation.
  There is no client calculation of dates or targets.
- An uncertain confirmation result directs the user to check budgets. Durable
  uncertain-result recovery across page reloads is outside CBD-242's live scope.

## Budget and plan shapes awaiting API reconciliation

- `GET /budget-spaces` returns an array of `{id,name,currencyCode,timeZone}`.
- `GET /budget-spaces/{id}` adds `activePeriod` (nullable), `freshness`
  (`current|stale`), `completeness` (`complete|partial`), and `updatedAt`.
  The active period carries `id,start,end,lengthInDays,scheduleVersionId`.
- `GET /budget-spaces/{id}/plan?periodId=...` returns
  `{budgetSpaceId,periodId,currencyCode,categories,targets}`. Categories carry
  `{id,name}`; targets carry `{categoryId,baseAmount,periodAmount,version}`.
  Amounts are decimal strings in currency major units; the client displays them
  without currency precision conversion or financial calculation.
- `POST /budget-spaces/{id}/categories` accepts `{name}` and returns the category.
- `PUT /budget-spaces/{id}/targets/{categoryId}` accepts
  `{baseAmount,expectedVersion}` and returns 204. A conflict requires reloading
  the plan. The UI retrieves the complete recomputed plan after a successful save.
- HTTP 401/403 mean denied; 404/410 mean terminal missing/unavailable;
  transport/503 failures mean recoverable. A mismatched response identity fails
  closed as an invalid server response. The real API must enforce authorization
  and commit-time version checks; UI visibility is not an authorization boundary.

## Development mock fidelity

`src/api/mock-server.ts` implements the same client interface and runs only on
the Next server through a localhost-only development route. It uses synthetic
sessions, volatile maps, the existing schedule engine, and full-period target
calculation. Browser refresh preserves data while that process lives. The mock
profile is USD-only. The route is unavailable in production.

The mock begin endpoint simulates successful sign-in directly instead of rendering
the API-owned provider chooser or performing a callback. It uses the same POST
body, response and cookie/header transport as the production client.

The mock is not evidence of PostgreSQL durability, real session revocation,
provider callback custody, policy decisions, canonical HMAC bindings, complete
clamp/holiday warning metadata, or atomic database writes. Its binding is an
opaque random fixture compared with the stored proposal. Real API integration,
independent review and Security validation remain Manager-owned prerequisites.

## Verification entry points

- `node --test apps/web/src/api/journey.test.ts`: controller, transport, mock
  server, server identities, expiry, version, concurrency and cancellation checks.
- `node --test apps/web/tests/browser.test.mjs`: actual Next routes, request
  payload, category editing, reload, state matrix, accessibility with the existing
  axe-core tooling, keyboard focus and 320px reflow in headless Chrome.
- Both are discovered by the workspace's existing `node --test` command.
  Browser tests use the repository's installed Puppeteer/axe-core tools. On a
  Windows machine, the tests use installed Chrome or Edge; otherwise they use
  Puppeteer's bundled browser. No new UI or test dependency was added.
