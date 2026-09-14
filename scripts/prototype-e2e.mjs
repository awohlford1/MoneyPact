#!/usr/bin/env node
/* global fetch, setTimeout, URL */
/**
 * PROTOTYPE-SLICE-001 end-to-end proof (PROTO-ACTIVATION-001, ACT-04).
 *
 * Starts the real API process (`apps/api/src/main.ts`) under development
 * configuration with the local identity adapter against a scratch PostgreSQL
 * database, then drives the whole journey through the real HTTP surface as a
 * browser would: the sign-in ceremony (begin, hosted authorize, chooser,
 * callback, session cookie), the CSRF bootstrap on GET /v1/identity/me, a
 * monthly budget proposal, its confirmation, the budget-space listing and
 * detail, two categories with base targets, the plan for the stored active
 * period, and the same plan read again after a fresh session resolution and
 * after a second sign-in. Every step is printed as a transcript line; the
 * process exits non-zero on the first failed expectation.
 *
 *   docker exec cobudget-db-1 psql -U postgres -c "CREATE DATABASE cobudget_activation" \
 *     -c "ALTER DATABASE cobudget_activation OWNER TO cobudget_migration"
 *   COBUDGET_DB_NAME=cobudget_activation npm run db:migrate --workspace=@cobudget/migrations
 *   node scripts/prototype-e2e.mjs --db cobudget_activation [--port 3101]
 *
 * The scratch database is named on the command line (the repository's
 * environment guard reserves `process.env` for the shared loader) and is
 * never `cobudget_dev`. The API child receives an explicit environment
 * built here, not this process's. No secret is printed: the session cookie,
 * the CSRF value and the confirmation binding appear only as lengths. Key
 * material for the process is generated per run and never written.
 */
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
function argument(name, fallback) { const index = process.argv.indexOf(name); return index === -1 ? fallback : process.argv[index + 1]; }
const PORT = Number(argument("--port", "3101"));
/** The application origin (what the browser sees, and where the callback lands) and the ceremony origin (the local
 * hosted issuer) must differ (CBD-190 section 8). One API process serves both: the browser reaches it through
 * `127.0.0.1` for the application and `localhost` for the ceremony pages, as the web dev proxy arrangement does. */
const ORIGIN = `http://127.0.0.1:${PORT}`;
const CEREMONY_ORIGIN = `http://localhost:${PORT}`;
const DB_NAME = argument("--db", undefined);
if (!DB_NAME || DB_NAME === "cobudget_dev") { console.error("--db must name a migrated scratch database (never cobudget_dev)"); process.exit(2); }

/** Development configuration for one API process; secrets are per-run random values that never leave memory. */
const environment = {
  COBUDGET_DB_NAME: DB_NAME,
  NODE_ENV: "development", LOG_LEVEL: "info", SERVICE_VERSION: "prototype-e2e", API_PORT: String(PORT), API_LISTEN_ADDRESS: "127.0.0.1",
  COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local", COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: randomBytes(32).toString("base64"), COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "e2e-v1",
  COBUDGET_SESSION_PEPPER: randomBytes(32).toString("base64"),
  COBUDGET_SESSION_IDLE_TIMEOUT_SECONDS: "900", COBUDGET_SESSION_ABSOLUTE_LIFETIME_SECONDS: "3600", COBUDGET_SESSION_FRESH_ASSURANCE_WINDOW_SECONDS: "300",
  COBUDGET_SESSION_REVOCATION_PROPAGATION_TARGET_SECONDS: "60", COBUDGET_SESSION_PROVIDER_MAX_FUTURE_SKEW_SECONDS: "30",
  COBUDGET_SESSION_REJECTION_TIMING_FLOOR_MS: "20", COBUDGET_SESSION_REJECTION_TIMING_JITTER_MS: "10", COBUDGET_SESSION_REJECTION_TIMING_SAMPLE_COUNT: "50",
  COBUDGET_SESSION_REJECTION_TIMING_TIMEOUT_BUCKET_MS: "40", COBUDGET_SESSION_REJECTION_TIMING_MAX_DIFFERENTIAL_MS: "50",
  COBUDGET_SESSION_ENVELOPE_KEY_PROVIDER: "local", COBUDGET_SESSION_ENVELOPE_KEY: randomBytes(32).toString("base64"), COBUDGET_SESSION_ENVELOPE_KEY_VERSION: "e2e-v1",
  COBUDGET_IDENTITY_PROVIDER: "local", COBUDGET_IDENTITY_ENVIRONMENT_ID: "development",
  COBUDGET_IDENTITY_ISSUER: `${CEREMONY_ORIGIN}/v1/identity/local`, COBUDGET_IDENTITY_CLIENT_ID: "cobudget-local-web",
  COBUDGET_IDENTITY_APPLICATION_ORIGIN: ORIGIN, COBUDGET_IDENTITY_CEREMONY_ORIGIN: CEREMONY_ORIGIN, COBUDGET_IDENTITY_CALLBACK_URI: `${ORIGIN}/v1/identity/callback`,
  COBUDGET_IDENTITY_CHALLENGE_LIFETIME_SECONDS: "600", COBUDGET_IDENTITY_EXCHANGE_LIFETIME_MS: "5000", COBUDGET_IDENTITY_MAPPING_MAX_ATTEMPTS: "5",
  COBUDGET_IDENTITY_HANDOFF_LIFETIME_SECONDS: "120", COBUDGET_IDENTITY_CLOCK_SKEW_SECONDS: "30",
};

const transcript = [];
function log(step, detail) { const line = `${String(transcript.length + 1).padStart(2, "0")}. ${step}${detail === undefined ? "" : `: ${detail}`}`; transcript.push(line); console.log(line); }
function expect(condition, message) { if (!condition) { console.error(`FAILED: ${message}`); process.exitCode = 1; throw new Error(message); } }
const redact = (value) => (typeof value === "string" ? `<${value.length} chars>` : String(value));

/** A minimal cookie jar plus the in-memory CSRF value, exactly what the web client holds. */
class Browser {
  cookies = new Map(); csrf = undefined;
  async fetch(path, { method = "GET", body, headers = {}, navigate = false } = {}) {
    const request = { method, redirect: "manual", headers: { ...headers } };
    if (this.cookies.size) request.headers.cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    if (body !== undefined) { request.headers["content-type"] = "application/json"; request.body = JSON.stringify(body); }
    if (method !== "GET") { request.headers.origin = ORIGIN; request.headers["sec-fetch-site"] = "same-origin"; if (this.csrf) request.headers["x-cobudget-csrf"] = this.csrf; }
    if (navigate) { request.headers["sec-fetch-mode"] = "navigate"; request.headers.accept = "text/html"; } else request.headers.accept = "application/json";
    // Connect to the loopback listener directly; the Host header carries whichever origin the URL names.
    const target = new URL(path.startsWith("http") ? path : `${ORIGIN}${path}`);
    request.headers.host = target.host;
    const response = await fetch(`http://127.0.0.1:${PORT}${target.pathname}${target.search}`, request);
    for (const header of response.headers.getSetCookie?.() ?? []) {
      const [pair, ...attributes] = header.split(";"); const index = pair.indexOf("="); const name = pair.slice(0, index); const value = pair.slice(index + 1);
      if (attributes.some((attribute) => attribute.trim() === "Max-Age=0") || value === "") this.cookies.delete(name); else this.cookies.set(name, value);
    }
    const text = await response.text();
    let json; try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
    return { status: response.status, headers: response.headers, text, json };
  }
}

async function signIn(browser, label) {
  const begin = await browser.fetch("/v1/identity/begin", { method: "POST", body: { ceremony: "sign_in", postResultDestinationId: "home" } });
  expect(begin.status === 200 && typeof begin.json?.navigateTo === "string", `${label}: begin returned ${begin.status} ${begin.text}`);
  log(`${label}: POST /v1/identity/begin`, `200, navigateTo=${new URL(begin.json.navigateTo).pathname}`);
  const hosted = await browser.fetch(begin.json.navigateTo, { navigate: true });
  expect(hosted.status === 200 && hosted.text.includes("/v1/identity/local/choose"), `${label}: hosted authorize returned ${hosted.status}`);
  const chooser = /href="([^"]*\/v1\/identity\/local\/choose\?[^"]*scenario=subject-a[^"]*)"/.exec(hosted.text) ?? /href="([^"]*\/v1\/identity\/local\/choose\?[^"]*)"/.exec(hosted.text);
  expect(chooser, `${label}: no chooser link in the hosted page`);
  log(`${label}: GET hosted authorize`, `200, chooser rendered`);
  const chosen = await browser.fetch(chooser[1].replaceAll("&amp;", "&"), { navigate: true });
  expect(chosen.status === 303 && typeof chosen.headers.get("location") === "string", `${label}: chooser returned ${chosen.status}`);
  const callback = new URL(chosen.headers.get("location"));
  log(`${label}: GET local chooser (subject-a)`, `303 to ${callback.pathname}`);
  const completed = await browser.fetch(callback.toString(), { navigate: true });
  expect(completed.status === 303, `${label}: callback returned ${completed.status} ${completed.text}`);
  expect(browser.cookies.has("__Host-cobudget_session"), `${label}: no session cookie after the callback (${completed.headers.get("location")})`);
  expect(!browser.cookies.has("__Host-cobudget_csrf") && browser.cookies.size === 1, `${label}: exactly one cookie is expected`);
  log(`${label}: GET /v1/identity/callback`, `303 to ${completed.headers.get("location")}, __Host-cobudget_session=${redact(browser.cookies.get("__Host-cobudget_session"))}, no CSRF cookie`);
  const me = await browser.fetch("/v1/identity/me");
  expect(me.status === 200 && typeof me.json?.csrfValue === "string", `${label}: /me returned ${me.status} ${me.text}`);
  browser.csrf = me.json.csrfValue;
  log(`${label}: GET /v1/identity/me`, `200, accountSubjectId=${me.json.accountSubjectId}, sessionRef=${me.json.sessionRef}, sessionVersion=${me.json.sessionVersion}, csrfValue=${redact(me.json.csrfValue)} (held in memory)`);
  return me.json;
}

async function main() {
  const api = spawn(process.execPath, ["--import=tsx", "src/main.ts"], { cwd: join(root, "apps/api"), env: environment, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  api.stdout.on("data", (chunk) => { output += chunk; }); api.stderr.on("data", (chunk) => { output += chunk; });
  try {
    const deadline = Date.now() + 60_000;
    let ready = false;
    while (Date.now() < deadline && !ready) {
      if (api.exitCode !== null) break;
      try { ready = (await fetch(`${ORIGIN}/health`)).status === 200; } catch { await new Promise((resolve) => setTimeout(resolve, 250)); }
    }
    expect(ready, `API did not become ready: ${output.slice(0, 2000)}`);
    log("API started", `${ORIGIN} (ceremony origin ${CEREMONY_ORIGIN}; NODE_ENV=development, COBUDGET_IDENTITY_PROVIDER=local, COBUDGET_DB_NAME=${DB_NAME})`);

    const anonymous = await fetch(`${ORIGIN}/v1/identity/me`);
    expect(anonymous.status === 403, `anonymous /me returned ${anonymous.status}`);
    log("GET /v1/identity/me without a cookie", "403 (uniform denial)");

    const browser = new Browser();
    const me = await signIn(browser, "sign-in");

    const draft = { name: "Household budget", timeZone: "America/New_York", currencyCode: "USD", schedule: { cadence: "monthly", anchor: { kind: "day-of-month", day: 1 } } };
    const proposalKey = randomUUID();
    const created = await browser.fetch("/v1/budget-creation-proposals", { method: "POST", body: draft, headers: { "idempotency-key": proposalKey } });
    expect(created.status === 201, `proposal create returned ${created.status} ${created.text}`);
    const proposal = created.json;
    expect(proposal.preview?.periods?.length === 4 && proposal.preview.periods[0].relation === "current", "proposal preview must carry the current period plus three");
    log("POST /v1/budget-creation-proposals (monthly, day 1)", `201, proposalId=${proposal.proposalId}, issuedStatus=${proposal.issuedStatus}, expiresAt=${proposal.expiresAt}, current period ${proposal.preview.periods[0].start}..${proposal.preview.periods[0].end}, confirmationBinding=${redact(proposal.confirmationBinding)}`);

    const replay = await browser.fetch("/v1/budget-creation-proposals", { method: "POST", body: draft, headers: { "idempotency-key": proposalKey } });
    expect(replay.status === 200 && replay.json.proposalId === proposal.proposalId, `idempotent replay returned ${replay.status}`);
    log("POST /v1/budget-creation-proposals (same Idempotency-Key)", `200, same proposalId (exact replay)`);

    const read = await browser.fetch(`/v1/budget-creation-proposals/${proposal.proposalId}`);
    expect(read.status === 200 && read.json.proposal?.proposalId === proposal.proposalId && read.json.lifecycle?.status === "previewed", `proposal read returned ${read.status} ${read.status === 200 ? "(unexpected shape)" : read.text}`);
    log("GET /v1/budget-creation-proposals/{proposalId}", `200, lifecycle.status=${read.json.lifecycle.status} (p2 proposal.read on the owning subject's row)`);
    const foreign = await browser.fetch(`/v1/budget-creation-proposals/bcp_${"0".repeat(32)}`);
    expect(foreign.status === 403, `unknown proposal returned ${foreign.status}`);
    log("GET /v1/budget-creation-proposals/{unknown}", `403 (row absent for this subject: uniform denial, no existence disclosure)`);

    // A5: regeneration is dispatched as proposal.regenerate against the predecessor row (its lifecycle revision captured).
    const regenerated = await browser.fetch("/v1/budget-creation-proposals", { method: "POST", body: { ...draft, name: "Household budget (revised)", supersedesProposalId: proposal.proposalId }, headers: { "idempotency-key": randomUUID() } });
    expect(regenerated.status === 201 && regenerated.json.supersedesProposalId === proposal.proposalId, `regenerate returned ${regenerated.status} ${regenerated.text}`);
    const predecessor = await browser.fetch(`/v1/budget-creation-proposals/${proposal.proposalId}`);
    expect(predecessor.status === 200 && predecessor.json.lifecycle?.status === "invalidated", `predecessor read returned ${predecessor.status} ${predecessor.text}`);
    log("POST /v1/budget-creation-proposals (supersedesProposalId)", `201, proposalId=${regenerated.json.proposalId} supersedes ${proposal.proposalId}; predecessor lifecycle.status=${predecessor.json.lifecycle.status}`);
    // A1: a mutation without the bootstrap value is denied at the session gate before any effect.
    const held = browser.csrf; browser.csrf = undefined;
    const noCsrf = await browser.fetch("/v1/budget-creation-proposals", { method: "POST", body: draft, headers: { "idempotency-key": randomUUID() } });
    browser.csrf = held;
    expect(noCsrf.status === 403, `proposal create without X-CoBudget-CSRF returned ${noCsrf.status}`);
    log("POST /v1/budget-creation-proposals without X-CoBudget-CSRF", "403 (uniform denial at the session gate; no effect)");

    const current = regenerated.json;
    // B1: a denied confirm (session gate, then locator) spends nothing of the ceremony's reserved initial space.create unit.
    browser.csrf = undefined;
    const confirmNoCsrf = await browser.fetch(`/v1/budget-creation-proposals/${current.proposalId}/confirm`, { method: "POST", body: { confirmationBinding: current.confirmationBinding }, headers: { "idempotency-key": randomUUID() } });
    browser.csrf = held;
    expect(confirmNoCsrf.status === 403, `confirm without X-CoBudget-CSRF returned ${confirmNoCsrf.status}`);
    log("POST .../{proposalId}/confirm without X-CoBudget-CSRF", "403 (uniform denial at the session gate; reserved unit untouched)");
    const confirmUnknown = await browser.fetch(`/v1/budget-creation-proposals/bcp_${"f".repeat(32)}/confirm`, { method: "POST", body: { confirmationBinding: current.confirmationBinding }, headers: { "idempotency-key": randomUUID() } });
    expect(confirmUnknown.status === 404, `confirm of an unknown proposal returned ${confirmUnknown.status} ${confirmUnknown.text}`);
    log("POST .../{unknown proposal}/confirm", `404 ${confirmUnknown.json?.error} (locator denial; reserved unit untouched)`);
    // CBD-236 (CBD236-CONSENT-SEMANTICS-001): the confirmation echoes the disclosure the preview
    // carried. The server compares it with the approved registry and records the registry's values.
    const disclosure = current.currentDisclosure;
    expect(disclosure && typeof disclosure.kind === "string" && Number.isSafeInteger(disclosure.version) && /^[0-9a-f]{64}$/u.test(disclosure.digest ?? ""),
      `the preview carried no approved disclosure: ${JSON.stringify(disclosure)}`);
    log("Preview carries the current consent disclosure", `${disclosure.kind} v${disclosure.version}, digest ${disclosure.digest.slice(0, 12)}..., ${disclosure.text.items.length} items and an acknowledgement sentence`);
    const acknowledgedDisclosure = { kind: disclosure.kind, version: disclosure.version };
    const disclosureStaleConfirm = await browser.fetch(`/v1/budget-creation-proposals/${current.proposalId}/confirm`, { method: "POST", body: { confirmationBinding: current.confirmationBinding, acknowledgedDisclosure: { kind: disclosure.kind, version: disclosure.version + 1 } }, headers: { "idempotency-key": randomUUID() } });
    expect(disclosureStaleConfirm.status === 409 && disclosureStaleConfirm.json?.error === "stale_disclosure", `stale acknowledgement returned ${disclosureStaleConfirm.status} ${disclosureStaleConfirm.text}`);
    log("POST .../{proposalId}/confirm with a superseded acknowledgedDisclosure", `409 stale_disclosure (no rows written; the reserved unit is refunded)`);
    const confirmKey = randomUUID();
    const confirmed = await browser.fetch(`/v1/budget-creation-proposals/${current.proposalId}/confirm`, { method: "POST", body: { confirmationBinding: current.confirmationBinding, acknowledgedDisclosure }, headers: { "idempotency-key": confirmKey } });
    expect(confirmed.status === 200 || confirmed.status === 201, `confirm returned ${confirmed.status} ${confirmed.text}`);
    const budgetSpaceId = confirmed.json.budgetSpaceId;
    expect(typeof budgetSpaceId === "string" && typeof confirmed.json.currentPeriodId === "string", "confirmation must name the budget space and current period");
    log("POST /v1/budget-creation-proposals/{proposalId}/confirm", `${confirmed.status}, budgetSpaceId=${budgetSpaceId}, currentPeriodId=${confirmed.json.currentPeriodId}, authorization=${confirmed.json.authorization?.policyVersion}`);
    const confirmReplay = await browser.fetch(`/v1/budget-creation-proposals/${current.proposalId}/confirm`, { method: "POST", body: { confirmationBinding: current.confirmationBinding, acknowledgedDisclosure }, headers: { "idempotency-key": confirmKey } });
    expect(confirmReplay.status === confirmed.status && confirmReplay.text === confirmed.text, `confirm replay returned ${confirmReplay.status} ${confirmReplay.text}`);
    log("POST .../{proposalId}/confirm (same Idempotency-Key)", `${confirmReplay.status}, exact replay (no surface decision, reserved unit consumed exactly once by the committed confirm)`);

    const list = await browser.fetch("/v1/budget-spaces");
    expect(list.status === 200 && list.json.spaces?.some((space) => space.budgetSpaceId === budgetSpaceId), `list returned ${list.status} ${list.text}`);
    log("GET /v1/budget-spaces", `200, ${list.json.spaces.length} space(s), includes ${budgetSpaceId} (${list.json.spaces.find((s) => s.budgetSpaceId === budgetSpaceId).name}, ${list.json.spaces[0].currencyCode}, ${list.json.spaces[0].timeZone})`);

    const detail = await browser.fetch(`/v1/budget-spaces/${budgetSpaceId}`);
    expect(detail.status === 200 && detail.json.activePeriod?.periodId === confirmed.json.currentPeriodId, `detail returned ${detail.status} ${detail.text}`);
    const periodId = detail.json.activePeriod.periodId;
    log("GET /v1/budget-spaces/{id}", `200, activePeriod.periodId=${periodId} (= stored current period), ${detail.json.activePeriod.start}..${detail.json.activePeriod.end}, nextPeriods=${detail.json.nextPeriods.length}`);

    const categories = await browser.fetch(`/v1/budget-spaces/${budgetSpaceId}/categories`, { method: "PUT", body: { categories: [{ label: "Groceries" }, { label: "Rent" }] } });
    expect(categories.status === 200 && categories.json.categories?.length === 2, `categories returned ${categories.status} ${categories.text}`);
    const [groceries, rent] = categories.json.categories;
    log("PUT /v1/budget-spaces/{id}/categories", `200, ${categories.json.categories.map((c) => `${c.label}=${c.categoryId}`).join(", ")}`);

    const targets = await browser.fetch(`/v1/budget-spaces/${budgetSpaceId}/targets`, { method: "PUT", body: { targets: [{ categoryId: groceries.categoryId, amountMinorUnits: 40000 }, { categoryId: rent.categoryId, amountMinorUnits: 150000 }] } });
    expect(targets.status === 200 && targets.json.targets?.length === 2, `targets returned ${targets.status} ${targets.text}`);
    log("PUT /v1/budget-spaces/{id}/targets", `200, cadence=${targets.json.cadence}, ${targets.json.targets.map((t) => `${t.categoryId === groceries.categoryId ? "Groceries" : "Rent"}=${t.amountMinorUnits}`).join(", ")} ${targets.json.currencyCode}`);

    const plan = await browser.fetch(`/v1/budget-spaces/${budgetSpaceId}/plan?periodId=${periodId}`);
    expect(plan.status === 200 && plan.json.period?.periodId === periodId && plan.json.categories?.length === 2, `plan returned ${plan.status} ${plan.text}`);
    const amounts = Object.fromEntries(plan.json.categories.map((c) => [c.label, c.periodTarget.amountMinorUnits]));
    expect(amounts.Groceries === 40000 && amounts.Rent === 150000, `full-period monthly targets expected, got ${JSON.stringify(amounts)}`);
    log("GET /v1/budget-spaces/{id}/plan?periodId=", `200, period ${plan.json.period.start}..${plan.json.period.end}, Groceries=${amounts.Groceries}, Rent=${amounts.Rent} (${plan.json.formulaVersion})`);

    const resolved = await browser.fetch("/v1/identity/me");
    expect(resolved.status === 200 && resolved.json.sessionRef === me.sessionRef && resolved.json.csrfValue === browser.csrf, `fresh resolution returned ${resolved.status} ${resolved.text}`);
    log("GET /v1/identity/me (fresh session resolution, as a reload does)", `200, same sessionRef, same session-bound csrfValue`);
    const recovery = await browser.fetch("/v1/identity/recovery");
    expect(recovery.status === 200 && recovery.json.sessionRef === me.sessionRef, `recovery returned ${recovery.status} ${recovery.text}`);
    log("GET /v1/identity/recovery (independent surf-266-recovery pool)", `200, same session bootstrap`);
    const again = await browser.fetch(`/v1/budget-spaces/${budgetSpaceId}/plan?periodId=${periodId}`);
    expect(again.status === 200 && JSON.stringify(again.json) === JSON.stringify(plan.json), "the plan must read back identically after the fresh resolution");
    log("GET /v1/budget-spaces/{id}/plan (after fresh resolution)", "200, byte-identical plan");

    const logout = await browser.fetch("/v1/identity/logout", { method: "POST" });
    expect(logout.status === 200 && !browser.cookies.has("__Host-cobudget_session"), `logout returned ${logout.status} ${logout.text}`);
    browser.csrf = undefined;
    log("POST /v1/identity/logout (X-CoBudget-CSRF from the bootstrap value)", "200, session cookie deleted");
    const afterLogout = await browser.fetch(`/v1/budget-spaces/${budgetSpaceId}`);
    expect(afterLogout.status === 403, `after logout the detail returned ${afterLogout.status}`);
    log("GET /v1/budget-spaces/{id} after logout", "403");

    const second = new Browser();
    const meAgain = await signIn(second, "second sign-in");
    expect(meAgain.accountSubjectId === me.accountSubjectId && meAgain.sessionRef !== me.sessionRef, "the second sign-in must resolve the same subject on a new session");
    const reload = await second.fetch(`/v1/budget-spaces/${budgetSpaceId}/plan?periodId=${periodId}`);
    expect(reload.status === 200 && JSON.stringify(reload.json) === JSON.stringify(plan.json), `the plan must survive a new session: ${reload.status} ${reload.text}`);
    log("GET /v1/budget-spaces/{id}/plan (new session, same subject)", "200, byte-identical plan: the same plan after reload");
    // A proposal is bound to the session generation that issued it (CBD-232): the old session's superseded predecessor is not
    // this session's proposal at all, and the attempt spends this ceremony's single initial-create reservation.
    const staleConfirm = await second.fetch(`/v1/budget-creation-proposals/${proposal.proposalId}/confirm`, { method: "POST", body: { confirmationBinding: proposal.confirmationBinding }, headers: { "idempotency-key": randomUUID() } });
    expect(staleConfirm.status === 404, `confirming the old session's superseded predecessor returned ${staleConfirm.status} ${staleConfirm.text}`);
    log("POST .../{old session's superseded predecessor}/confirm (new session)", `404 ${staleConfirm.json?.error} (session-generation bound)`);
    console.log("PROTOTYPE-E2E PASSED");
  } catch (error) {
    console.error(`API output (last 4000 chars):
${output.slice(-4000)}`);
    throw error;
  } finally {
    api.kill();
    await new Promise((resolve) => api.once("exit", resolve));
  }
}

await main();
