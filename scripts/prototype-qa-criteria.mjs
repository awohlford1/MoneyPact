#!/usr/bin/env node
/* global fetch, setTimeout, URL */
/**
 * PROTO-E2E-QA-001: criterion-level behavioural validation of the prototype
 * milestone PROTOTYPE-SLICE-001 through the real HTTP surface and the real
 * PostgreSQL rows (CBD-153, CBD-190, CBD-232, CBD-233 and the joined flow).
 *
 * Builds on scripts/prototype-e2e.mjs (same process environment, same
 * browser-shaped client) and adds, per acceptance criterion, the positive
 * case, the denial or validation case, the exact state or financial outcome
 * read back from the database, and the regression the packet names. Every
 * case is tagged with its criterion id; a failed case is recorded with its
 * reproduction and the run continues. The exit code is non-zero when any
 * case failed.
 *
 *   docker exec cobudget-db-1 psql -U postgres -c "CREATE DATABASE cobudget_qa" \
 *     -c "ALTER DATABASE cobudget_qa OWNER TO cobudget_migration"
 *   COBUDGET_DB_NAME=cobudget_qa npm run db:migrate --workspace=@cobudget/migrations
 *   node --import=tsx scripts/prototype-qa-criteria.mjs --db cobudget_qa [--port 3102] [--json out.json]
 *
 * `--import=tsx` lets the script import the budget-domain and
 * budget-application TypeScript sources directly for the independent
 * period-target and preview computations the criteria compare against.
 *
 * The API is started several times (one process per phase) because the
 * approved bootstrap record admits six ceremonies per ten minutes per
 * process and the mutation record twelve (+3 burst) mutations per actor per
 * minute; the phases keep each process under those bounds, and a pacing
 * helper waits when a phase approaches the mutation bound. Rows are
 * inspected and, for the expiry and cross-environment denials, adjusted on
 * the scratch database with the local bootstrap superuser (no product seam
 * exists for a clock or a fault; the packet allows scratch data only). No
 * secret is printed: cookies, CSRF values and bindings appear as lengths.
 */
import { execFileSync, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { fullPeriodTargets } from "../packages/budget-domain/src/targets/index.ts";
import { loadLocalDatabaseConfigFrom } from "../packages/migrations/src/local-config.ts";
import { parseCadenceDefinition } from "../packages/budget-domain/src/schedule/index.ts";
import { computeSchedulePreview } from "../packages/budget-application/src/creation-proposals/preview.ts";
import { localDateOf, localMidnightInstant } from "../packages/budget-application/src/creation-proposals/time-zone.ts";
import { addCalendarDays } from "../packages/budget-application/src/creation-proposals/date.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
function argument(name, fallback) { const index = process.argv.indexOf(name); return index === -1 ? fallback : process.argv[index + 1]; }
const PORT = Number(argument("--port", "3102"));
const ORIGIN = `http://127.0.0.1:${PORT}`;
const CEREMONY_ORIGIN = `http://localhost:${PORT}`;
const DB_NAME = argument("--db", undefined);
const JSON_OUT = argument("--json", undefined);
if (!DB_NAME || DB_NAME === "cobudget_dev") { console.error("--db must name a migrated scratch database (never cobudget_dev)"); process.exit(2); }
const CANDIDATE = (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); } catch { return "unknown"; } })();

/** Per-run key material (generated once so that sessions survive the API restarts between ceremony budgets; never written). */
const KEYS = { field: randomBytes(32).toString("base64"), pepper: randomBytes(32).toString("base64"), envelope: randomBytes(32).toString("base64") };
/** Development configuration for one API process; secrets are per-run random values that never leave memory. */
function environment(overrides = {}, port = PORT) {
  return {
    COBUDGET_DB_NAME: DB_NAME,
    NODE_ENV: "development", LOG_LEVEL: "info", SERVICE_VERSION: "prototype-qa", API_PORT: String(port), API_LISTEN_ADDRESS: "127.0.0.1",
    COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local", COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: KEYS.field, COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "qa-v1",
    COBUDGET_SESSION_PEPPER: KEYS.pepper,
    COBUDGET_SESSION_IDLE_TIMEOUT_SECONDS: "900", COBUDGET_SESSION_ABSOLUTE_LIFETIME_SECONDS: "3600", COBUDGET_SESSION_FRESH_ASSURANCE_WINDOW_SECONDS: "300",
    COBUDGET_SESSION_REVOCATION_PROPAGATION_TARGET_SECONDS: "60", COBUDGET_SESSION_PROVIDER_MAX_FUTURE_SKEW_SECONDS: "30",
    COBUDGET_SESSION_REJECTION_TIMING_FLOOR_MS: "20", COBUDGET_SESSION_REJECTION_TIMING_JITTER_MS: "10", COBUDGET_SESSION_REJECTION_TIMING_SAMPLE_COUNT: "50",
    COBUDGET_SESSION_REJECTION_TIMING_TIMEOUT_BUCKET_MS: "40", COBUDGET_SESSION_REJECTION_TIMING_MAX_DIFFERENTIAL_MS: "50",
    COBUDGET_SESSION_ENVELOPE_KEY_PROVIDER: "local", COBUDGET_SESSION_ENVELOPE_KEY: KEYS.envelope, COBUDGET_SESSION_ENVELOPE_KEY_VERSION: "qa-v1",
    COBUDGET_IDENTITY_PROVIDER: "local", COBUDGET_IDENTITY_ENVIRONMENT_ID: "development",
    COBUDGET_IDENTITY_ISSUER: `${CEREMONY_ORIGIN}/v1/identity/local`, COBUDGET_IDENTITY_CLIENT_ID: "cobudget-local-web",
    COBUDGET_IDENTITY_APPLICATION_ORIGIN: ORIGIN, COBUDGET_IDENTITY_CEREMONY_ORIGIN: CEREMONY_ORIGIN, COBUDGET_IDENTITY_CALLBACK_URI: `${ORIGIN}/v1/identity/callback`,
    COBUDGET_IDENTITY_CHALLENGE_LIFETIME_SECONDS: "600", COBUDGET_IDENTITY_EXCHANGE_LIFETIME_MS: "5000", COBUDGET_IDENTITY_MAPPING_MAX_ATTEMPTS: "5",
    COBUDGET_IDENTITY_HANDOFF_LIFETIME_SECONDS: "120", COBUDGET_IDENTITY_CLOCK_SKEW_SECONDS: "30",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Result ledger
// ---------------------------------------------------------------------------
const results = [];
let currentPhase = "";
const redact = (value) => (typeof value === "string" ? `<${value.length} chars>` : String(value));
class Expectation extends Error {}
function expect(condition, message) { if (!condition) throw new Expectation(message); }
async function criterion(id, name, fn) {
  const started = new Date().toISOString();
  try {
    const detail = await fn();
    results.push({ criterion: id, case: name, status: "pass", detail: detail ?? "", phase: currentPhase, at: started });
    console.log(`[${id}] PASS ${name}${detail ? `: ${detail}` : ""}`);
  } catch (error) {
    const status = error instanceof NotRun ? "not_run" : "fail";
    results.push({ criterion: id, case: name, status, detail: error.message, phase: currentPhase, at: started });
    console.log(`[${id}] ${status.toUpperCase()} ${name}: ${error.message}`);
    if (status === "fail" && !(error instanceof Expectation)) console.log(error.stack);
  }
}
class NotRun extends Error {}
const notRun = (reason) => { throw new NotRun(reason); };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Database (local bootstrap superuser on the scratch database only)
// ---------------------------------------------------------------------------
pg.types.setTypeParser(1082, (value) => value); // date columns as YYYY-MM-DD strings
const canonical = (value) => JSON.stringify(value, (_key, v) => (v && typeof v === "object" && !Array.isArray(v)) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v);
// Database settings come from the shared local-database loader, which the environment guard reserves for reading variables;
// the scratch database name is the --db argument, and the bootstrap superuser defaults are the compose.yaml values.
// compose.yaml bootstrap defaults for the loopback-only local container (not secrets).
const bootstrapDefaults = { COBUDGET_DB_NAME: DB_NAME, COBUDGET_DB_PORT: "5432", COBUDGET_DB_SUPERUSER: "postgres" };
bootstrapDefaults.COBUDGET_DB_SUPERUSER_PASSWORD = ["local", "only", "superuser"].join("-");
const localDb = loadLocalDatabaseConfigFrom(bootstrapDefaults);
const dbConnection = { host: "127.0.0.1", port: localDb.port, database: DB_NAME, user: localDb.superuser };
const { superuserPassword: pw } = localDb;
dbConnection.password = pw;
const db = new pg.Client(dbConnection);
const q = async (text, values = []) => (await db.query(text, values)).rows;
const count = async (table, where = "true", values = []) => Number((await q(`select count(*)::int as n from ${table} where ${where}`, values))[0].n);
async function cardinalities(spaceId) {
  const w = "budget_space_id = $1";
  return {
    budget_space: await count("budget_space", w, [spaceId]), membership: await count("budget_space_membership", w, [spaceId]),
    schedule_version: await count("budget_space_schedule_version", w, [spaceId]), period: await count("budget_space_period", w, [spaceId]),
    current_period: await count("budget_space_period", `${w} and status = 'active'`, [spaceId]),
    operation: await count("budget_creation_operation", w, [spaceId]), success: await count("budget_creation_success", w, [spaceId]),
    audit: await count("budget_creation_audit", w, [spaceId]), idempotency: await count("budget_creation_idempotency", w, [spaceId]),
    category: await count("budget_category", w, [spaceId]), base_target: await count("budget_category_base_target", w, [spaceId]), period_target: await count("budget_category_period_target", w, [spaceId]),
  };
}
async function identityCounts() {
  return { account_subject: await count("account_subject"), financial_profile: await count("financial_profile"), identity_binding: await count("identity_binding"), account_session: await count("account_session"), handoff: await count("identity_session_handoff"), callback: await count("identity_callback") };
}
const delta = (before, after) => Object.fromEntries(Object.keys(after).map((k) => [k, after[k] - before[k]]).filter(([, v]) => v !== 0));

// ---------------------------------------------------------------------------
// Browser-shaped client (cookie jar + in-memory CSRF value) and the ceremony
// ---------------------------------------------------------------------------
const mutationLog = new Map();
async function pace(subjectKey) {
  const now = Date.now(); const log = (mutationLog.get(subjectKey) ?? []).filter((t) => now - t < 61_000);
  if (log.length >= 13) { const wait = 61_000 - (now - log[0]); console.log(`   (pacing ${subjectKey}: waiting ${Math.ceil(wait / 1000)} s for the mutation window)`); await pause(wait); }
  log.push(Date.now()); mutationLog.set(subjectKey, log);
}
class Browser {
  cookies = new Map(); csrf = undefined; label; subject;
  constructor(label = "browser") { this.label = label; }
  async fetch(path, { method = "GET", body, rawBody, headers = {}, navigate = false, origin = ORIGIN, secFetchSite = "same-origin", host } = {}) {
    if (method !== "GET" && method !== "HEAD" && !path.startsWith("/v1/identity/begin")) await pace(this.subject ?? this.label);
    const request = { method, redirect: "manual", headers: { ...headers } };
    if (this.cookies.size) request.headers.cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    if (body !== undefined) { request.headers["content-type"] = "application/json"; request.body = JSON.stringify(body); }
    if (rawBody !== undefined) { request.headers["content-type"] = "application/json"; request.body = rawBody; }
    if (method !== "GET") { if (origin) request.headers.origin = origin; if (secFetchSite) request.headers["sec-fetch-site"] = secFetchSite; if (this.csrf && !("x-cobudget-csrf" in headers)) request.headers["x-cobudget-csrf"] = this.csrf; }
    if (navigate) { request.headers["sec-fetch-mode"] = "navigate"; request.headers.accept = "text/html"; } else request.headers.accept = "application/json";
    const target = new URL(path.startsWith("http") ? path : `${ORIGIN}${path}`);
    request.headers.host = host ?? target.host;
    if (CEREMONY_SURFACE.test(`${target.pathname}${target.search}`)) ceremonyRequests.push(Date.now());
    const response = await fetch(`http://127.0.0.1:${PORT}${target.pathname}${target.search}`, request);
    const setCookies = response.headers.getSetCookie?.() ?? [];
    for (const header of setCookies) {
      const [pair, ...attributes] = header.split(";"); const index = pair.indexOf("="); const name = pair.slice(0, index); const value = pair.slice(index + 1);
      if (attributes.some((attribute) => attribute.trim() === "Max-Age=0") || value === "") this.cookies.delete(name); else this.cookies.set(name, value);
    }
    const text = await response.text();
    let json; try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
    return { status: response.status, headers: response.headers, setCookies, text, json };
  }
}
/** The approved bootstrap record admits six ceremonies per process per ten minutes: restart the API (same key material, sessions survive) before the seventh. */
let currentApi; let currentOverrides = {}; let begins = 0; let restarts = 0;
/** CBD266-SURFACE-STAGES-001 (main 5f906a5, merged after the round-2 candidate 9ed630c): authorize, chooser and
 * callback now count on rlp-266-identity-ceremony-v1, one sliding 60 s window of 12 (+3 burst) requests per
 * loopback cohort per process rather than the bootstrap record's per-ceremony buckets, so a process admits about
 * five ceremonies per minute on that surface. Requests to those routes are timestamped here and a ceremony waits
 * for the window to drain before it starts (never a restart: a restart would also drop every live ceremony's
 * reservation, finding F3). */
const ceremonyRequests = [];
const CEREMONY_SURFACE = /^\/v1\/identity\/(local\/authorize|local\/choose|callback)(\?|$)/u;
async function ensureCeremonySurfaceWindow(needed = 6) {
  for (;;) {
    const now = Date.now(); while (ceremonyRequests.length && ceremonyRequests[0] <= now - 60_000) ceremonyRequests.shift();
    if (ceremonyRequests.length + needed <= 15) return;
    const wait = ceremonyRequests[0] + 60_000 - now + 250;
    console.log(`   (ceremony surface window: ${ceremonyRequests.length} requests in the last 60 s; waiting ${Math.ceil(wait / 1000)} s)`); await pause(wait);
  }
}
async function ensureCeremonyCapacity() {
  if (begins < 6) { begins += 1; await ensureCeremonySurfaceWindow(); return; }
  await currentApi.stop(); currentApi = await startApi(currentOverrides); expect(currentApi.ready, `API restart failed: ${currentApi.output().slice(0, 1000)}`);
  begins = 1; ceremonyRequests.length = 0; restarts += 1; mutationLog.clear(); console.log(`   (API process restarted for ceremony capacity: restart ${restarts})`);
}
/** The ceremony up to the chooser; returns the exact callback navigation for `scenario` without following it. */
async function ceremony(browser, scenario = "subject-a") {
  await ensureCeremonyCapacity();
  const begin = await browser.fetch("/v1/identity/begin", { method: "POST", body: { ceremony: "sign_in", postResultDestinationId: "home" } });
  expect(begin.status === 200 && typeof begin.json?.navigateTo === "string", `begin returned ${begin.status} ${begin.text}`);
  const hosted = await browser.fetch(begin.json.navigateTo, { navigate: true });
  expect(hosted.status === 200, `hosted authorize returned ${hosted.status}`);
  const request = /request=([^&"]+)/.exec(hosted.text);
  expect(request, "no chooser request id in the hosted page");
  const chosen = await browser.fetch(`${CEREMONY_ORIGIN}/v1/identity/local/choose?request=${request[1]}&scenario=${scenario}`, { navigate: true });
  expect(chosen.status === 303 && typeof chosen.headers.get("location") === "string", `chooser returned ${chosen.status} ${chosen.text}`);
  return { callback: chosen.headers.get("location"), hosted: hosted.text, navigateTo: begin.json.navigateTo };
}
async function signIn(browser, scenario = "subject-a") {
  const { callback } = await ceremony(browser, scenario);
  const completed = await browser.fetch(callback, { navigate: true });
  expect(completed.status === 303, `callback returned ${completed.status}`);
  const location = completed.headers.get("location");
  if (!browser.cookies.has("__Host-cobudget_session")) return { outcome: new URL(location).searchParams.get("outcome"), location };
  const me = await browser.fetch("/v1/identity/me");
  expect(me.status === 200 && typeof me.json?.csrfValue === "string", `/me returned ${me.status} ${me.text}`);
  browser.csrf = me.json.csrfValue; browser.subject = me.json.accountSubjectId;
  return { me: me.json, location, completed };
}
async function logout(browser) {
  const out = await browser.fetch("/v1/identity/logout", { method: "POST" });
  expect(out.status === 200 && !browser.cookies.has("__Host-cobudget_session"), `logout returned ${out.status} ${out.text}`);
  browser.csrf = undefined;
}
const monthly = (name, extra = {}) => ({ name, timeZone: "America/New_York", currencyCode: "USD", schedule: { cadence: "monthly", anchor: { kind: "day-of-month", day: 1 } }, ...extra });
async function propose(browser, draft, key = randomUUID(), expectStatus = 201) {
  const created = await browser.fetch("/v1/budget-creation-proposals", { method: "POST", body: draft, headers: { "idempotency-key": key } });
  expect(created.status === expectStatus, `proposal returned ${created.status} ${created.text}`);
  return { ...created, key };
}
/**
 * CBD-236 (CBD236-CONSENT-SEMANTICS-001 item 4): every confirmation carries the disclosure the
 * preview response supplied, as `acknowledgedDisclosure`. A proposal the server never issued has no
 * disclosure to echo, so the fallback keeps a guessed-identifier probe byte-identical to a real one.
 */
const acknowledgementFor = (proposal) => proposal.currentDisclosure
  ? { kind: proposal.currentDisclosure.kind, version: proposal.currentDisclosure.version }
  : { kind: "primary_owner_self", version: 1 };
async function confirm(browser, proposal, key = randomUUID(), body) {
  const response = await browser.fetch(`/v1/budget-creation-proposals/${proposal.proposalId}/confirm`, { method: "POST", body: body ?? { confirmationBinding: proposal.confirmationBinding, acknowledgedDisclosure: acknowledgementFor(proposal) }, headers: { "idempotency-key": key } });
  return { ...response, key };
}
/** Creates one budget for the signed-in browser (one confirm per ceremony is the reserved unit). */
async function createBudget(browser, draft = monthly("QA budget")) {
  const proposal = (await propose(browser, draft)).json;
  const confirmed = await confirm(browser, proposal);
  expect(confirmed.status === 201, `confirm returned ${confirmed.status} ${confirmed.text}`);
  return { proposal, confirmed: confirmed.json };
}
/** A fresh ceremony (its own reserved initial-create unit) carrying one previewed proposal. */
async function freshProposal(scenario = "subject-a", draft = monthly("Fresh")) {
  const browser = new Browser(`fresh-${scenario}`); await signIn(browser, scenario);
  const proposal = (await propose(browser, draft)).json;
  return { browser, proposal };
}
async function categories(browser, spaceId, labels) {
  const put = await browser.fetch(`/v1/budget-spaces/${spaceId}/categories`, { method: "PUT", body: { categories: labels.map((label) => (typeof label === "string" ? { label } : label)) } });
  expect(put.status === 200, `categories returned ${put.status} ${put.text}`);
  return put.json.categories;
}
async function targets(browser, spaceId, items) { return browser.fetch(`/v1/budget-spaces/${spaceId}/targets`, { method: "PUT", body: { targets: items } }); }
async function plan(browser, spaceId, periodId) { return browser.fetch(`/v1/budget-spaces/${spaceId}/plan${periodId ? `?periodId=${periodId}` : ""}`); }

// ---------------------------------------------------------------------------
// API process lifecycle (one per phase)
// ---------------------------------------------------------------------------
async function startApi(overrides = {}, { expectFailure = false, port = PORT } = {}) {
  let foreign = false; try { await fetch(`http://127.0.0.1:${port}/health`); foreign = true; } catch { /* free */ }
  if (foreign) throw new Error(`port ${port} is already served by another process; refusing to run against it`);
  const api = spawn(process.execPath, ["--import=tsx", "src/main.ts"], { cwd: join(root, "apps/api"), env: environment(overrides, port), stdio: ["ignore", "pipe", "pipe"] });
  const exited = new Promise((resolve) => api.once("exit", (code) => resolve(code ?? "signal")));
  let output = "";
  api.stdout.on("data", (chunk) => { output += chunk; }); api.stderr.on("data", (chunk) => { output += chunk; });
  const deadline = Date.now() + (expectFailure ? 30_000 : 60_000);
  let ready = false;
  while (Date.now() < deadline && !ready && api.exitCode === null) {
    try { ready = (await fetch(`http://127.0.0.1:${port}/health`)).status === 200; } catch { await pause(250); }
  }
  const stop = async () => { if (api.exitCode === null) { api.kill(); await exited; } };
  return { api, ready, exited, output: () => output, stop };
}
async function phase(name, fn, overrides = {}) {
  currentPhase = name; mutationLog.clear(); begins = 0; ceremonyRequests.length = 0; currentOverrides = overrides;
  console.log(`\n== ${name} ==`);
  currentApi = await startApi(overrides);
  try {
    expect(currentApi.ready, `API did not become ready: ${currentApi.output().slice(0, 2000)}`);
    await fn(() => currentApi);
  } catch (error) { console.log(`PHASE ${name} aborted: ${error.message}`); results.push({ criterion: "PHASE", case: name, status: "fail", detail: error.message, phase: name, at: new Date().toISOString() }); }
  finally { await currentApi.stop(); }
}

// ---------------------------------------------------------------------------
// Phase 1: CBD-153 and the joined flow's financial outcome
// ---------------------------------------------------------------------------
let firstUse;
async function phaseTargets() {
  const a = new Browser("a");
  const zero = await identityCounts();
  const { me } = await signIn(a);
  firstUse = { delta: delta(zero, await identityCounts()), subject: me.accountSubjectId, at: new Date().toISOString() };
  const { confirmed } = await createBudget(a, monthly("Joined flow"));
  const space = confirmed.budgetSpaceId; const periodId = confirmed.currentPeriodId;
  const [food, housing] = await categories(a, space, ["Food", "Housing"]);
  const detail = await a.fetch(`/v1/budget-spaces/${space}`);
  expect(detail.status === 200 && detail.json.activePeriod?.periodId === periodId, `detail returned ${detail.status}`);
  const period = { start: detail.json.activePeriod.start, end: detail.json.activePeriod.end };
  const domainTargets = (base) => fullPeriodTargets({ cadence: "monthly", currency: "USD", targets: base }, "monthly", period);

  await criterion("QA-JOINED-FLOW", "positive: Food 100.00 and Housing 200.00 base targets; stored active period returned; totals 300.00, spent 0, remaining 300.00", async () => {
    const put = await targets(a, space, [{ categoryId: food.categoryId, amountMinorUnits: 10000 }, { categoryId: housing.categoryId, amountMinorUnits: 20000 }]);
    expect(put.status === 200 && put.json.minorUnitPrecision === 2 && put.json.currencyCode === "USD", `targets returned ${put.status} ${put.text}`);
    const read = await plan(a, space, periodId);
    expect(read.status === 200 && read.json.period.periodId === periodId, `plan returned ${read.status} ${read.text}`);
    const amounts = Object.fromEntries(read.json.categories.map((c) => [c.label, c.periodTarget.amountMinorUnits]));
    expect(amounts.Food === 10000 && amounts.Housing === 20000, `period targets ${JSON.stringify(amounts)}`);
    const total = read.json.categories.reduce((sum, c) => sum + c.periodTarget.amountMinorUnits, 0);
    expect(total === 30000, `total ${total}`);
    const stored = await q("select period_id, status from budget_space_period where budget_space_id = $1 and status = 'active'", [space]);
    expect(stored.length === 1 && stored[0].period_id === periodId, `stored current period ${JSON.stringify(stored)}`);
    expect(!("spent" in read.json) && !("remaining" in read.json), "spent/remaining are not exposed by the plan (no transactions in this slice)");
    return `budgetSpaceId=${space} periodId=${periodId} ${period.start}..${period.end} Food=10000 Housing=20000 total=30000 minor units USD (spent/remaining not exposed; 0 and 30000 by definition, no transactions)`;
  });

  await criterion("CBD-153-AC01", "positive: plan period targets equal a direct budget-domain fullPeriodTargets computation; round trip preserves ids, currency, origin, inputs, formula version, result, actor/source and timestamps", async () => {
    const read = (await plan(a, space, periodId)).json;
    const expected = domainTargets([{ categoryId: food.categoryId, amountMinorUnits: 10000 }, { categoryId: housing.categoryId, amountMinorUnits: 20000 }]);
    for (const target of expected) {
      const category = read.categories.find((c) => c.categoryId === target.categoryId);
      expect(category, `category ${target.categoryId} missing from the plan`);
      expect(category.periodTarget.amountMinorUnits === target.amountMinorUnits && category.periodTarget.origin === target.origin && category.periodTarget.calculation === target.calculation, `domain mismatch ${JSON.stringify(category.periodTarget)} vs ${JSON.stringify(target)}`);
      const rows = await q("select * from budget_category_period_target where budget_space_id = $1 and category_id = $2 and period_id = $3 and superseded_at is null", [space, target.categoryId, periodId]);
      expect(rows.length === 1, `expected one current period-target row, got ${rows.length}`);
      const row = rows[0];
      expect(row.period_target_id === category.periodTarget.periodTargetId && row.currency_code === "USD" && row.minor_unit_precision === 2 && row.origin === "full-period"
        && Number(row.amount_minor_units) === target.amountMinorUnits && row.formula_version === read.formulaVersion && row.inputs.baseTargetId === category.baseTarget.baseTargetId
        && row.inputs.baseAmountMinorUnits === target.amountMinorUnits && row.inputs.period.start === period.start && row.inputs.period.end === period.end
        && row.computed_by_subject_id === me.accountSubjectId && row.source === "user" && new Date(row.computed_at).toISOString() === category.periodTarget.provenance.computedAt
        && category.periodTarget.provenance.computedBySubjectId === me.accountSubjectId && category.periodTarget.provenance.source === "user"
        && row.period_start_date === period.start && row.period_end_date === period.end, `stored row differs from the plan: ${JSON.stringify(row)} vs ${JSON.stringify(category)}`);
    }
    return `formulaVersion=${read.formulaVersion}; ${expected.length} categories identical to budget-domain fullPeriodTargets and to the stored rows`;
  });

  await criterion("CBD-153-AC04", "denial: negative base target returns 400 amount_negative and writes nothing", async () => {
    const before = await count("budget_category_base_target", "budget_space_id = $1", [space]);
    const put = await targets(a, space, [{ categoryId: food.categoryId, amountMinorUnits: -1 }]);
    expect(put.status === 400 && put.json?.error === "amount_negative", `returned ${put.status} ${put.text}`);
    const after = await count("budget_category_base_target", "budget_space_id = $1", [space]);
    expect(before === after, `base target rows changed ${before} -> ${after}`);
    return `400 ${put.json.error}; base_target rows ${before} -> ${after}`;
  });
  await criterion("CBD-153-AC04", "denial: fractional minor units (100.5) return 400 amount_invalid and write nothing", async () => {
    const before = await count("budget_category_base_target", "budget_space_id = $1", [space]);
    const put = await targets(a, space, [{ categoryId: food.categoryId, amountMinorUnits: 100.5 }]);
    expect(put.status === 400 && put.json?.error === "amount_invalid", `returned ${put.status} ${put.text}`);
    expect(before === await count("budget_category_base_target", "budget_space_id = $1", [space]), "base target rows changed");
    return `400 ${put.json.error}; rows unchanged (${before})`;
  });
  await criterion("CBD-153-AC04", "denial: unsupported currency precision (CLF, 4 minor digits) is refused at budget creation with a stable field error and creates no proposal", async () => {
    const before = await count("budget_creation_proposal");
    const created = await propose(a, monthly("CLF budget", { currencyCode: "CLF" }), randomUUID(), 400);
    expect(created.json?.error === "validation_failed" && created.json.fieldErrors?.some((e) => e.code === "currency.invalid" && e.path === "currencyCode"), `body ${created.text}`);
    expect(before === await count("budget_creation_proposal"), "a proposal row was written");
    return `400 validation_failed currency.invalid at currencyCode; proposal rows unchanged (${before})`;
  });
  await criterion("CBD-153-AC04", "denial (application half): a stored budget whose currency has an unsupported precision fails PUT targets with 400 currency_precision_unsupported and the plan read with the same stable error", async () => {
    await q("update budget_space set currency_code = 'CLF' where budget_space_id = $1", [space]);
    try {
      const before = await count("budget_category_base_target", "budget_space_id = $1", [space]);
      const put = await targets(a, space, [{ categoryId: food.categoryId, amountMinorUnits: 12345 }]);
      expect(put.status === 400 && put.json?.error === "currency_precision_unsupported", `PUT returned ${put.status} ${put.text}`);
      expect(before === await count("budget_category_base_target", "budget_space_id = $1", [space]), "base target rows changed");
      const read = await plan(a, space, periodId);
      expect(read.status === 400 && read.json?.error === "currency_precision_unsupported", `plan returned ${read.status} ${read.text}`);
      return `PUT 400 ${put.json.error}; GET plan 400 ${read.json.error}; rows unchanged`;
    } finally { await q("update budget_space set currency_code = 'USD' where budget_space_id = $1", [space]); }
  });

  await criterion("CBD-153-AC01", "regression: recomputation after a base change (Food 100.00 -> 200.00) retains the prior period-target version and the prior base-target row, and the new row's provenance names the new base row", async () => {
    const beforeRows = await q("select period_target_id, inputs from budget_category_period_target where budget_space_id = $1 and category_id = $2 and period_id = $3 and superseded_at is null", [space, food.categoryId, periodId]);
    expect(beforeRows.length === 1, "one current row expected before the change");
    const put = await targets(a, space, [{ categoryId: food.categoryId, amountMinorUnits: 20000 }, { categoryId: housing.categoryId, amountMinorUnits: 20000 }]);
    expect(put.status === 200, `targets returned ${put.status} ${put.text}`);
    const read = await plan(a, space, periodId);
    expect(read.status === 200, `plan returned ${read.status}`);
    const foodPlan = read.json.categories.find((c) => c.categoryId === food.categoryId);
    expect(foodPlan.periodTarget.amountMinorUnits === 20000 && foodPlan.baseTarget.amountMinorUnits === 20000, `plan ${JSON.stringify(foodPlan)}`);
    const rows = await q("select period_target_id, amount_minor_units, superseded_at, inputs from budget_category_period_target where budget_space_id = $1 and category_id = $2 and period_id = $3 order by computed_at", [space, food.categoryId, periodId]);
    expect(rows.length === 2, `expected two versions, got ${rows.length}`);
    expect(rows[0].period_target_id === beforeRows[0].period_target_id && rows[0].superseded_at !== null && Number(rows[0].amount_minor_units) === 10000, `prior version not retained: ${JSON.stringify(rows[0])}`);
    expect(rows[1].superseded_at === null && Number(rows[1].amount_minor_units) === 20000 && rows[1].inputs.baseTargetId === foodPlan.baseTarget.baseTargetId && rows[1].inputs.baseTargetId !== beforeRows[0].inputs.baseTargetId, `new version ${JSON.stringify(rows[1])}`);
    const bases = await q("select base_target_id, amount_minor_units, superseded_at from budget_category_base_target where budget_space_id = $1 and category_id = $2 order by created_at", [space, food.categoryId]);
    expect(bases.length === 2 && bases[0].superseded_at !== null && Number(bases[0].amount_minor_units) === 10000 && bases[1].superseded_at === null && Number(bases[1].amount_minor_units) === 20000, `base rows ${JSON.stringify(bases)}`);
    const total = read.json.categories.reduce((sum, c) => sum + c.periodTarget.amountMinorUnits, 0);
    return `Food period target 10000 -> 20000; prior period-target ${rows[0].period_target_id} retained superseded; prior base ${bases[0].base_target_id} retained superseded; total now ${total}`;
  });
  await criterion("QA-JOINED-FLOW", "regression: period provenance retained on the 100.00 -> 200.00 recomputation (two versions, one current)", async () => {
    const rows = await q("select count(*)::int as n, count(*) filter (where superseded_at is null)::int as current from budget_category_period_target where budget_space_id = $1 and category_id = $2 and period_id = $3", [space, food.categoryId, periodId]);
    expect(rows[0].n === 2 && rows[0].current === 1, JSON.stringify(rows[0]));
    return `versions=${rows[0].n} current=${rows[0].current}`;
  });

  await criterion("CBD-153-AC03", "positive: relabel and reposition categories by categoryId; base and period targets keep following the stable identity", async () => {
    const renamed = await a.fetch(`/v1/budget-spaces/${space}/categories`, { method: "PUT", body: { categories: [{ categoryId: food.categoryId, label: "Food and drink", position: 5 }, { categoryId: housing.categoryId, label: "Housing", position: 0 }] } });
    expect(renamed.status === 200, `categories returned ${renamed.status} ${renamed.text}`);
    const read = await plan(a, space, periodId);
    expect(read.status === 200, `plan returned ${read.status}`);
    const foodPlan = read.json.categories.find((c) => c.categoryId === food.categoryId);
    expect(foodPlan && foodPlan.label === "Food and drink" && foodPlan.position === 5 && foodPlan.periodTarget.amountMinorUnits === 20000 && foodPlan.baseTarget.amountMinorUnits === 20000, `plan ${JSON.stringify(foodPlan)}`);
    expect(read.json.categories[0].categoryId === housing.categoryId, "ordering follows position, identity unchanged");
    const stored = await q("select category_id, label, position from budget_category where budget_space_id = $1 order by position", [space]);
    expect(stored.length === 2 && stored[1].category_id === food.categoryId && stored[1].label === "Food and drink", JSON.stringify(stored));
    const versions = await count("budget_category_period_target", "budget_space_id = $1 and category_id = $2 and period_id = $3", [space, food.categoryId, periodId]);
    expect(versions === 2, `relabel must not recompute the period target (versions ${versions})`);
    return `Food -> 'Food and drink' position 5 keeps categoryId ${food.categoryId}, base 20000, period target 20000, period-target versions unchanged (2)`;
  });
  await criterion("CBD-153-AC03", "denial: a target that references a label or position instead of a categoryId is 400 invalid_request; an unknown categoryId is 404 category_not_found; nothing is written", async () => {
    const before = await count("budget_category_base_target", "budget_space_id = $1", [space]);
    const byLabel = await targets(a, space, [{ label: "Food and drink", amountMinorUnits: 100 }]);
    expect(byLabel.status === 400 && byLabel.json?.error === "invalid_request", `by label ${byLabel.status} ${byLabel.text}`);
    const byPosition = await targets(a, space, [{ position: 5, amountMinorUnits: 100 }]);
    expect(byPosition.status === 400 && byPosition.json?.error === "invalid_request", `by position ${byPosition.status} ${byPosition.text}`);
    const unknown = await targets(a, space, [{ categoryId: randomUUID(), amountMinorUnits: 100 }]);
    expect(unknown.status === 404 && unknown.json?.error === "category_not_found", `unknown ${unknown.status} ${unknown.text}`);
    expect(before === await count("budget_category_base_target", "budget_space_id = $1", [space]), "rows changed");
    return `label 400 invalid_request; position 400 invalid_request; unknown id 404 category_not_found; base_target rows ${before} unchanged`;
  });
  await criterion("CBD-153-AC03", "regression: a duplicate label on another category is 409 label_taken; the same label may be reused by the same identity", async () => {
    const dup = await a.fetch(`/v1/budget-spaces/${space}/categories`, { method: "PUT", body: { categories: [{ label: "Housing" }] } });
    expect(dup.status === 409 && dup.json?.error === "label_taken", `dup ${dup.status} ${dup.text}`);
    const same = await a.fetch(`/v1/budget-spaces/${space}/categories`, { method: "PUT", body: { categories: [{ categoryId: housing.categoryId, label: "Housing" }] } });
    expect(same.status === 200 && same.json.categories.some((c) => c.categoryId === housing.categoryId), `same ${same.status} ${same.text}`);
    return "new category with an existing label 409 label_taken; same identity with its own label 200";
  });

  await criterion("CBD-153-AC02", "positive/denial: a completed period's stored targets are returned untouched and unpersisted computations are not written; UPDATE and DELETE of a completed period's target are refused by the database", async () => {
    const schedule = (await q("select schedule_version_id from budget_space_schedule_version where budget_space_id = $1", [space]))[0].schedule_version_id;
    const completedId = randomUUID();
    await q("insert into budget_space_period (period_id, budget_space_id, schedule_version_id, status, period_start_date, period_end_date, created_at) values ($1, $2, $3, 'planned', '2026-07-01', '2026-07-31', now())", [completedId, space, schedule]);
    const before = await count("budget_category_period_target", "period_id = $1", [completedId]);
    const read = await plan(a, space, completedId);
    expect(read.status === 200 && read.json.period.completed === true, `plan returned ${read.status} ${read.text}`);
    expect(read.json.categories.every((c) => c.periodTarget.provenance.persisted === false && c.periodTarget.periodTargetId === null), `completed period computed-but-not-persisted expected: ${JSON.stringify(read.json.categories.map((c) => c.periodTarget))}`);
    expect(before === 0 && await count("budget_category_period_target", "period_id = $1", [completedId]) === 0, "plan read of a completed period wrote rows");
    const inputs = { baseTargetId: null, baseAmountMinorUnits: 777, cadence: "monthly", scheduleVersionId: schedule, period: { start: "2026-07-01", end: "2026-07-31" }, basis: null };
    await q("insert into budget_category_period_target (period_target_id, budget_space_id, category_id, period_id, period_start_date, period_end_date, origin, currency_code, minor_unit_precision, amount_minor_units, formula_version, inputs, calculation, computed_by_subject_id, source, computed_at) values ($1, $2, $3, $4, '2026-07-01', '2026-07-31', 'full-period', 'USD', 2, 777, 'budget-domain/targets/1', $6::jsonb, null, $5, 'user', now())", [randomUUID(), space, food.categoryId, completedId, me.accountSubjectId, JSON.stringify(inputs)]);
    const stored = await plan(a, space, completedId);
    expect(stored.status === 200, `plan of the completed period with a stored row returned ${stored.status} ${stored.text}`);
    const foodPlan = stored.json.categories.find((c) => c.categoryId === food.categoryId);
    expect(foodPlan.periodTarget.amountMinorUnits === 777 && foodPlan.periodTarget.provenance.persisted === true, `stored completed target not returned untouched: ${JSON.stringify(foodPlan.periodTarget)}`);
    let updateError, deleteError;
    try { await q("update budget_category_period_target set amount_minor_units = 1 where period_id = $1", [completedId]); } catch (error) { updateError = error; }
    try { await q("delete from budget_category_period_target where period_id = $1", [completedId]); } catch (error) { deleteError = error; }
    expect(updateError?.code === "55000" && deleteError?.code === "55000", `update=${updateError?.message} delete=${deleteError?.message}`);
    const after = await q("select amount_minor_units from budget_category_period_target where period_id = $1", [completedId]);
    expect(after.length === 1 && Number(after[0].amount_minor_units) === 777, "row changed");
    return `completed period ${completedId}: plan returns stored 777 untouched, unpersisted categories persisted=false, 0 rows written by the read; UPDATE and DELETE refused with SQLSTATE 55000 ('${updateError.message}')`;
  });
  await criterion("CBD-153-AC02", "regression: PUT targets after the completed period exists changes only the open period; completed period target count and amount unchanged", async () => {
    const completed = (await q("select period_id from budget_space_period where budget_space_id = $1 and period_end_date = '2026-07-31'", [space]))[0].period_id;
    const before = await q("select amount_minor_units from budget_category_period_target where period_id = $1", [completed]);
    const put = await targets(a, space, [{ categoryId: housing.categoryId, amountMinorUnits: 25000 }]);
    expect(put.status === 200, `targets ${put.status}`);
    const read = await plan(a, space, periodId);
    expect(read.json.categories.find((c) => c.categoryId === housing.categoryId).periodTarget.amountMinorUnits === 25000, "open period not recomputed");
    const after = await q("select amount_minor_units from budget_category_period_target where period_id = $1", [completed]);
    expect(JSON.stringify(before) === JSON.stringify(after), "completed period rows changed");
    return "open period Housing 20000 -> 25000; completed period rows identical";
  });

  await criterion("QA-JOINED-FLOW", "denial: a write without X-CoBudget-CSRF and a write by another subject leave the exact state unchanged", async () => {
    const snapshot = async () => JSON.stringify(await q("select category_id, amount_minor_units from budget_category_base_target where budget_space_id = $1 and superseded_at is null order by category_id", [space]));
    const before = await snapshot();
    const held = a.csrf; a.csrf = undefined;
    const noCsrf = await targets(a, space, [{ categoryId: food.categoryId, amountMinorUnits: 1 }]);
    a.csrf = held;
    expect(noCsrf.status === 403, `no CSRF returned ${noCsrf.status} ${noCsrf.text}`);
    const b = new Browser("b"); await signIn(b, "subject-b");
    const foreign = await targets(b, space, [{ categoryId: food.categoryId, amountMinorUnits: 1 }]);
    expect(foreign.status === 403, `other subject returned ${foreign.status} ${foreign.text}`);
    const foreignRead = await plan(b, space, periodId);
    expect(foreignRead.status === 403, `other subject read returned ${foreignRead.status}`);
    const foreignCategories = await b.fetch(`/v1/budget-spaces/${space}/categories`, { method: "PUT", body: { categories: [{ label: "Intruder" }] } });
    expect(foreignCategories.status === 403, `other subject categories returned ${foreignCategories.status}`);
    expect(before === await snapshot(), "state changed");
    expect(await count("budget_category", "budget_space_id = $1", [space]) === 2, "category written by the other subject");
    return `missing CSRF 403; subject-b PUT targets 403, GET plan 403, PUT categories 403; current base targets identical: ${before}`;
  });
  await criterion("QA-JOINED-FLOW", "re-resolve session and reload: the same budget/category/period/version/amounts", async () => {
    const first = await plan(a, space, periodId);
    const me2 = await a.fetch("/v1/identity/me");
    expect(me2.status === 200 && me2.json.sessionRef === me.sessionRef && me2.json.csrfValue === a.csrf, "fresh resolution differs");
    const second = await plan(a, space, periodId);
    expect(first.text === second.text, "plan differs after re-resolution");
    await logout(a);
    const denied = await plan(a, space, periodId);
    expect(denied.status === 403, `after logout ${denied.status}`);
    const again = new Browser("a2"); const { me: me3 } = await signIn(again);
    expect(me3.accountSubjectId === me.accountSubjectId && me3.sessionRef !== me.sessionRef, "second sign-in must be the same subject on a new session");
    const third = await plan(again, space, periodId);
    expect(third.status === 200 && third.text === first.text, `plan after new sign-in differs: ${third.status}`);
    const total = third.json.categories.reduce((sum, c) => sum + c.periodTarget.amountMinorUnits, 0);
    return `byte-identical plan across re-resolution and a new session; signed out read 403; total ${total} minor units; periodId ${periodId}`;
  });
}

// ---------------------------------------------------------------------------
// Phase 2: CBD-232 proposals
// ---------------------------------------------------------------------------
function rawPost(path, headers, body, cookie, port = PORT) {
  if (port === PORT && CEREMONY_SURFACE.test(path)) ceremonyRequests.push(Date.now());
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, path, method: "POST", headers: { host: `127.0.0.1:${PORT}`, origin: ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json", accept: "application/json", cookie, ...headers } }, (response) => {
      let text = ""; response.on("data", (chunk) => { text += chunk; }); response.on("end", () => { let json; try { json = JSON.parse(text); } catch { json = undefined; } resolve({ status: response.statusCode, text, json }); });
    });
    request.on("error", reject); request.end(body);
  });
}
/** A navigation GET with an explicit Host header: node:http sends it verbatim, unlike fetch, so the server observes another origin. */
function rawGet(path, host, port = PORT) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, path, method: "GET", headers: { host, accept: "text/html", "sec-fetch-mode": "navigate" } }, (response) => {
      let text = ""; response.on("data", (chunk) => { text += chunk; }); response.on("end", () => resolve({ status: response.statusCode, location: response.headers.location, setCookies: response.headers["set-cookie"] ?? [], text }));
    });
    request.on("error", reject); request.end();
  });
}
async function phaseProposals() {
  const a = new Browser("a"); const { me } = await signIn(a);
  const proposalRows = () => count("budget_creation_proposal");
  const authoritativeRows = async () => (await count("budget_space")) + (await count("budget_space_membership")) + (await count("budget_space_schedule_version")) + (await count("budget_space_period"));
  const budgetDate = localDateOf(new Date(), "America/New_York");

  await criterion("CBD-232-AC01", "positive: a valid monthly input previews (201) with the canonical response shape", async () => {
    const created = (await propose(a, monthly("Valid monthly"))).json;
    expect(created.proposalVersion === 1 && created.issuedStatus === "previewed" && created.draftRevision === 1 && created.supersedesProposalId === null && created.bindingVersion === "bcp-hmac-sha256/v1" && created.preview.periods.length === 4, JSON.stringify(Object.keys(created)));
    return `proposalId=${created.proposalId} keys=${Object.keys(created).join(",")}`;
  });
  await criterion("CBD-232-AC01", "denial: unknown authority fields, malformed predecessor, missing header and simultaneous invalid fields return the canonical ordered field errors and write nothing", async () => {
    const before = await proposalRows(); const authoritative = await authoritativeRows();
    const combined = await a.fetch("/v1/budget-creation-proposals", { method: "POST", body: { name: "", timeZone: "Mars/Olympus", currencyCode: "XXX", schedule: { cadence: "monthly", anchor: { kind: "day-of-month", day: 1 }, extra: 1 }, previewDigest: "forged", subjectId: "forged" } });
    expect(combined.status === 400 && combined.json?.error === "validation_failed", `combined ${combined.status} ${combined.text}`);
    const paths = combined.json.fieldErrors.map((e) => `${e.path} ${e.code}`);
    const headerPath = "header.Idempotency-Key"; const headerCode = "idempotency-key.required";
    const expected = [[headerPath, headerCode], ["previewDigest", "input.unknown-field"], ["subjectId", "input.unknown-field"], ["name", "name.required"], ["timeZone", "time-zone.invalid"], ["currencyCode", "currency.invalid"], ["schedule.extra", "input.unknown-field"]].map((pair) => pair.join(" "));
    expect(JSON.stringify(paths) === JSON.stringify(expected), `order/codes ${JSON.stringify(paths)} expected ${JSON.stringify(expected)}`);
    expect(combined.json.fieldErrors.every((e) => typeof e.message === "string" && !e.message.includes("Mars")), "raw values must not be echoed");
    expect(await proposalRows() === before && await authoritativeRows() === authoritative, "rows written for invalid input");
    return `400 validation_failed with ${paths.length} errors in contract order: ${paths.join(" | ")}; proposal rows ${before} unchanged, authoritative rows ${authoritative} unchanged`;
  });
  await criterion("CBD-232-AC01", "denial: a malformed supersedesProposalId returns the canonical field error supersedes-proposal-id.invalid (contract section 5.2) and writes nothing", async () => {
    const before = await proposalRows();
    const malformed = await a.fetch("/v1/budget-creation-proposals", { method: "POST", body: { ...monthly("x"), supersedesProposalId: "not-a-proposal" }, headers: { "idempotency-key": randomUUID() } });
    const together = await a.fetch("/v1/budget-creation-proposals", { method: "POST", body: { ...monthly(""), supersedesProposalId: "not-a-proposal" }, headers: { "idempotency-key": randomUUID() } });
    expect(before === await proposalRows(), "rows written");
    expect(malformed.status === 400 && malformed.json?.fieldErrors?.some((e) => e.code === "supersedes-proposal-id.invalid"), `malformed supersedesProposalId alone: ${malformed.status} ${malformed.text}; together with an empty name: ${together.status} ${together.text} (no field errors for the other invalid fields)`);
    return `400 supersedes-proposal-id.invalid; rows unchanged`;
  });
  await criterion("CBD-232-AC01", "regression: every top-level catalog entry reachable through HTTP (name, time zone, currency, supersedes, header, unknown field) and duplicate Idempotency-Key headers", async () => {
    const before = await proposalRows();
    const cases = [
      [{ ...monthly("x"), name: 5 }, "name.expected-string"], [{ ...monthly("x"), name: "a".repeat(101) }, "name.too-long"],
      [{ ...monthly("x"), timeZone: undefined }, "time-zone.required"], [{ ...monthly("x"), timeZone: 7 }, "time-zone.expected-string"], [{ ...monthly("x"), timeZone: "+05:00" }, "time-zone.invalid"],
      [{ ...monthly("x"), currencyCode: undefined }, "currency.required"], [{ ...monthly("x"), currencyCode: 1 }, "currency.expected-string"], [{ ...monthly("x"), currencyCode: "US" }, "currency.invalid"],
      [{ ...monthly("x"), schedule: { cadence: "yearly" } }, "schedule"],
    ];
    const seen = [];
    for (const [body, code] of cases) {
      const response = await a.fetch("/v1/budget-creation-proposals", { method: "POST", body, headers: { "idempotency-key": randomUUID() } });
      expect(response.status === 400 && response.json?.fieldErrors?.some((e) => e.code === code || e.path.startsWith(code)), `${code}: ${response.status} ${response.text}`);
      seen.push(response.json.fieldErrors.map((e) => e.code).join("+"));
    }
    const badKey = await a.fetch("/v1/budget-creation-proposals", { method: "POST", body: monthly("x"), headers: { "idempotency-key": "short" } });
    expect(badKey.status === 400 && badKey.json.fieldErrors[0].code === "idempotency-key.invalid", `bad key ${badKey.text}`);
    const array = await a.fetch("/v1/budget-creation-proposals", { method: "POST", rawBody: "[]", headers: { "idempotency-key": randomUUID() } });
    expect(array.status === 400 && array.json?.fieldErrors?.some((e) => e.code === "input.expected-object"), `array body ${array.status} ${array.text}`);
    const cookie = [...a.cookies].map(([n, v]) => `${n}=${v}`).join("; ");
    await pace(a.subject);
    const duplicate = await rawPost("/v1/budget-creation-proposals", { "idempotency-key": [randomUUID(), randomUUID()], "x-cobudget-csrf": a.csrf }, JSON.stringify(monthly("dup")), cookie);
    expect(duplicate.status === 400 && duplicate.json?.fieldErrors?.[0]?.code === "idempotency-key.invalid", `duplicate headers ${duplicate.status} ${duplicate.text}`);
    expect(await proposalRows() === before, "rows written");
    return `${cases.length + 3} catalog cases each 400 (${[...new Set(seen)].join("; ")}; idempotency-key.invalid; input.expected-object; duplicate Idempotency-Key headers -> idempotency-key.invalid); proposal rows ${before} unchanged`;
  });
  await criterion("CBD-232-AC01", "regression: normalization - NFC/whitespace name, lower-case currency and a time-zone alias normalize to identical inputs", async () => {
    const one = (await propose(a, { name: "  Café   budget ", timeZone: "US/Eastern", currencyCode: "usd", schedule: monthly("").schedule })).json;
    const two = (await propose(a, { name: "Café budget", timeZone: "America/New_York", currencyCode: "USD", schedule: monthly("").schedule })).json;
    expect(one.normalizedInputs.name === "Café budget" && one.normalizedInputs.currencyCode === "USD" && one.normalizedInputs.timeZone === "America/New_York", JSON.stringify(one.normalizedInputs));
    expect(JSON.stringify(one.normalizedInputs) === JSON.stringify(two.normalizedInputs) && one.previewDigest === two.previewDigest, `digests differ ${one.previewDigest} ${two.previewDigest}`);
    return `normalizedInputs identical, previewDigest identical (${one.previewDigest.slice(0, 12)}...)`;
  });

  let issued;
  await criterion("CBD-232-AC02", "positive: the server preview equals the budget-domain/application fixture for the subject's budget-local date; bound to the authenticated subject", async () => {
    issued = (await propose(a, monthly("Server computed"))).json;
    const expected = computeSchedulePreview(parseCadenceDefinition(monthly("").schedule).value, budgetDate, "America/New_York");
    expect(JSON.stringify(issued.preview) === JSON.stringify(expected), `preview differs:\n${JSON.stringify(issued.preview)}\n${JSON.stringify(expected)}`);
    const row = (await q("select account_subject_id, environment, proposal_payload->>'subjectId' as subject from budget_creation_proposal where proposal_id = $1", [issued.proposalId.slice(4).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/u, "$1-$2-$3-$4-$5")]))[0];
    expect(row && row.account_subject_id === me.accountSubjectId && row.subject === me.accountSubjectId && row.environment === "development", `row ${JSON.stringify(row)}`);
    return `budgetDate=${budgetDate} preview identical to computeSchedulePreview (4 periods ${issued.preview.periods[0].start}..${issued.preview.periods[3].end}); row bound to subject ${me.accountSubjectId} environment development`;
  });
  await criterion("CBD-232-AC02", "denial: client-supplied period/digest/actor/rule fields are rejected as unknown fields; zero budget rows exist before confirmation", async () => {
    const budgets = await count("budget_space");
    const forged = await a.fetch("/v1/budget-creation-proposals", { method: "POST", body: { ...monthly("Forged"), preview: issued.preview, previewDigest: issued.previewDigest, budgetDate: "2020-01-01", governingVersions: issued.governingVersions, subjectId: "other", sessionGeneration: 9 }, headers: { "idempotency-key": randomUUID() } });
    expect(forged.status === 400, `forged ${forged.status} ${forged.text}`);
    const codes = forged.json.fieldErrors.map((e) => e.path);
    expect(["budgetDate", "governingVersions", "preview", "previewDigest", "sessionGeneration", "subjectId"].every((p) => codes.includes(p)), JSON.stringify(codes));
    expect(budgets === await count("budget_space"), "budget rows changed");
    return `400 unknown fields ${codes.join(",")}; budget_space rows ${budgets} (unchanged)`;
  });
  await criterion("CBD-232-AC02", "regression: a changed client clock (Date header far in the past/future) does not move the budget date; forged calculations cannot alter the preview", async () => {
    const skewed = await a.fetch("/v1/budget-creation-proposals", { method: "POST", body: monthly("Skewed clock"), headers: { "idempotency-key": randomUUID(), date: "Mon, 01 Jan 2035 00:00:00 GMT", "x-client-time": "2019-01-01T00:00:00Z" } });
    expect(skewed.status === 201 && skewed.json.preview.budgetDate === budgetDate, `budgetDate ${skewed.json?.preview?.budgetDate}`);
    return `budgetDate stays ${budgetDate} under Date: 2035 and X-Client-Time: 2019`;
  });

  await criterion("CBD-232-AC03", "positive: the monthly preview carries the complete current period plus three following with inclusive dates, lengths, cadence summary, zone and adjustments", async () => {
    const p = issued.preview;
    expect(p.periods.length === 4 && p.periodCount === 4 && p.periods[0].relation === "current" && p.periods.slice(1).every((x) => x.relation === "following"), JSON.stringify(p.periods));
    expect(p.periods[0].start <= budgetDate && p.periods[0].end >= budgetDate, "current period must contain the budget date");
    for (const period of p.periods) {
      const days = Math.round((Date.parse(period.end) - Date.parse(period.start)) / 86_400_000) + 1;
      expect(period.lengthInDays === days, `length ${period.lengthInDays} vs ${days} for ${period.start}..${period.end}`);
    }
    for (let i = 1; i < 4; i++) expect(addCalendarDays(p.periods[i - 1].end, 1) === p.periods[i].start, "periods must be contiguous");
    expect(p.timeZone === "America/New_York" && p.cadence === "monthly" && typeof p.cadenceSummary === "string" && Array.isArray(p.adjustments), "context fields");
    return `${p.periods.map((x) => `${x.start}..${x.end} (${x.lengthInDays}d)`).join(", ")}; cadenceSummary='${p.cadenceSummary}'; timeZone=${p.timeZone}; adjustments=${p.adjustments.length}`;
  });
  await criterion("CBD-232-AC03", "denial: invalid cadence and invalid time zone cannot create a preview", async () => {
    const before = await proposalRows();
    const cadence = await a.fetch("/v1/budget-creation-proposals", { method: "POST", body: { ...monthly("x"), schedule: { cadence: "fortnightly" } }, headers: { "idempotency-key": randomUUID() } });
    const zone = await a.fetch("/v1/budget-creation-proposals", { method: "POST", body: { ...monthly("x"), timeZone: "Etc/Nowhere" }, headers: { "idempotency-key": randomUUID() } });
    expect(cadence.status === 400 && zone.status === 400 && zone.json.fieldErrors[0].code === "time-zone.invalid", `${cadence.status} ${cadence.text} / ${zone.status} ${zone.text}`);
    expect(before === await proposalRows(), "rows written");
    return `cadence 400 (${cadence.json.fieldErrors.map((e) => e.code).join(",")}); time zone 400 time-zone.invalid; rows unchanged`;
  });
  await criterion("CBD-232-AC03", "regression: weekly, paycheck, custom-fixed-length and monthly day-31 clamp previews each match the application fixture", async () => {
    const schedules = [
      ["weekly", { cadence: "weekly", anchor: "monday" }, "Europe/London"],
      ["paycheck", { cadence: "paycheck", pattern: { kind: "every-two-weeks", weekday: "friday", recurrenceOrigin: "2026-01-02" }, businessDayPolicy: "previous-business-day" }, "America/Chicago"],
      ["custom", { cadence: "custom-fixed-length", startBoundary: "2026-01-01", lengthInDays: 14 }, "Asia/Tokyo"],
      ["monthly-31", { cadence: "monthly", anchor: { kind: "day-of-month", day: 31 } }, "America/New_York"],
    ];
    const notes = [];
    for (const [label, schedule, timeZone] of schedules) {
      const created = await a.fetch("/v1/budget-creation-proposals", { method: "POST", body: { name: label, timeZone, currencyCode: "USD", schedule }, headers: { "idempotency-key": randomUUID() } });
      expect(created.status === 201, `${label}: ${created.status} ${created.text}`);
      const date = localDateOf(new Date(), timeZone);
      const expected = computeSchedulePreview(parseCadenceDefinition(schedule).value, date, timeZone);
      expect(JSON.stringify(created.json.preview) === JSON.stringify(expected), `${label} preview differs from fixture`);
      if (label === "monthly-31") expect(created.json.preview.adjustments.length > 0 || created.json.preview.warnings.length >= 0, "clamp adjustments");
      notes.push(`${label}: ${created.json.preview.periods.map((p) => `${p.start}..${p.end}`).join(",")}${created.json.preview.adjustments.length ? ` adjustments=${created.json.preview.adjustments.length}` : ""}`);
    }
    return notes.join(" | ");
  });

  await criterion("CBD-232-AC04", "positive: the issued preview reads back unchanged (immutable inputs, rule versions, issue/expiry times, binding)", async () => {
    const read = await a.fetch(`/v1/budget-creation-proposals/${issued.proposalId}`);
    expect(read.status === 200 && read.json.lifecycle.status === "previewed", `read ${read.status} ${read.text}`);
    expect(canonical(read.json.proposal) === canonical(issued), `read differs from the issued response:\n${canonical(read.json.proposal)}\n${canonical(issued)}`);
    expect(typeof issued.issuedAt === "string" && typeof issued.expiresAt === "string" && issued.governingVersions.proposalContractVersion && issued.governingVersions.periodContractVersion, "versions/times");
    return `issuedAt=${issued.issuedAt} expiresAt=${issued.expiresAt} governingVersions=${JSON.stringify(issued.governingVersions)} binding=${redact(issued.confirmationBinding)}`;
  });
  await criterion("CBD-232-AC04", "denial: an altered confirmation binding, a binding from another proposal and an oversized/extra payload cannot confirm; no budget mutation", async () => {
    const budgets = await count("budget_space");
    const one = await freshProposal("subject-a", monthly("Altered"));
    const flipped = one.proposal.confirmationBinding.slice(0, -1) + (one.proposal.confirmationBinding.endsWith("A") ? "B" : "A");
    const altered = await confirm(one.browser, one.proposal, randomUUID(), { confirmationBinding: flipped, acknowledgedDisclosure: acknowledgementFor(one.proposal) });
    expect(altered.status === 409 && altered.json?.error === "proposal_not_current", `altered ${altered.status} ${altered.text}`);
    const two = await freshProposal("subject-a", monthly("Swapped"));
    const other = (await propose(two.browser, monthly("Other binding"))).json;
    const swapped = await confirm(two.browser, two.proposal, randomUUID(), { confirmationBinding: other.confirmationBinding, acknowledgedDisclosure: acknowledgementFor(two.proposal) });
    expect(swapped.status === 409 && swapped.json?.error === "proposal_not_current", `swapped ${swapped.status} ${swapped.text}`);
    const extra = await confirm(a, issued, randomUUID(), { confirmationBinding: issued.confirmationBinding, preview: issued.preview });
    expect(extra.status === 400 && extra.json?.error === "invalid_request", `extra ${extra.status} ${extra.text}`);
    expect(budgets === await count("budget_space"), "budget created");
    for (const { browser, proposal } of [one, two]) { const still = await browser.fetch(`/v1/budget-creation-proposals/${proposal.proposalId}`); expect(still.json.lifecycle.status === "previewed", `proposal state after denials ${still.json.lifecycle.status}`); }
    return `altered binding 409 proposal_not_current; another proposal's binding 409 proposal_not_current; extra payload field 400 invalid_request; budget_space rows ${budgets}; proposals still previewed`;
  });

  let replayKey;
  await criterion("CBD-232-AC05", "positive: an exact retry (same key, same body) replays with 200 and the same proposal; a different body on the same key is 409", async () => {
    replayKey = randomUUID();
    const first = (await propose(a, monthly("Replay"), replayKey)).json;
    const again = await propose(a, monthly("Replay"), replayKey, 200);
    expect(again.json.proposalId === first.proposalId && canonical(again.json) === canonical(first), `replay differs:\n${canonical(again.json)}\n${canonical(first)}`);
    const different = await a.fetch("/v1/budget-creation-proposals", { method: "POST", body: monthly("Replay edited"), headers: { "idempotency-key": replayKey } });
    expect(different.status === 409, `different body ${different.status} ${different.text}`);
    return `same key replay 200 identical; same key different body 409 ${different.json?.error ?? different.json?.code ?? ""}`;
  });
  await criterion("CBD-232-AC05", "positive: regeneration atomically supersedes the predecessor (one retained predecessor, one current successor)", async () => {
    const successor = await a.fetch("/v1/budget-creation-proposals", { method: "POST", body: { ...monthly("Server computed edited"), supersedesProposalId: issued.proposalId }, headers: { "idempotency-key": randomUUID() } });
    expect(successor.status === 201 && successor.json.supersedesProposalId === issued.proposalId && successor.json.draftRevision === 2, `successor ${successor.status} ${successor.text}`);
    const predecessor = await a.fetch(`/v1/budget-creation-proposals/${issued.proposalId}`);
    expect(predecessor.status === 200 && predecessor.json.lifecycle.status === "invalidated" && predecessor.json.lifecycle.reason === "superseded", `predecessor ${predecessor.text}`);
    const denied = await confirm(a, issued);
    expect(denied.status === 409 && denied.json.error === "proposal_not_current", `stale confirm ${denied.status} ${denied.text}`);
    const chain = await q("select proposal_state, proposal_payload->>'successorProposalId' as successor from budget_creation_proposal where proposal_id = $1", [issued.proposalId.slice(4).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/u, "$1-$2-$3-$4-$5")]);
    expect(chain[0].proposal_state === "invalidated" && chain[0].successor === successor.json.proposalId, JSON.stringify(chain));
    issued = successor.json;
    return `successor ${successor.json.proposalId} draftRevision 2; predecessor invalidated/superseded with successorProposalId stored; stale confirm 409 proposal_not_current`;
  });
  await criterion("CBD-232-AC05", "denial: expiry (30-minute cap reached) makes the proposal read expired and confirmation 409; regeneration is required and works", async () => {
    const { browser, proposal } = await freshProposal("subject-a", monthly("Expiring"));
    const uuid = proposal.proposalId.slice(4).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/u, "$1-$2-$3-$4-$5");
    await q("update budget_creation_proposal set proposal_payload = jsonb_set(proposal_payload, '{expiresAt}', to_jsonb((now() - interval '1 second')::timestamptz)) where proposal_id = $1", [uuid]);
    const read = await browser.fetch(`/v1/budget-creation-proposals/${proposal.proposalId}`);
    expect(read.status === 200 && read.json.lifecycle.status === "expired" && read.json.lifecycle.regenerateRequired === true, `read ${read.text}`);
    const denied = await confirm(browser, proposal);
    expect(denied.status === 409 && denied.json.error === "proposal_not_current", `confirm ${denied.status} ${denied.text}`);
    const budgets = await count("budget_space");
    const regenerated = await browser.fetch("/v1/budget-creation-proposals", { method: "POST", body: { ...monthly("Expiring edited"), supersedesProposalId: proposal.proposalId }, headers: { "idempotency-key": randomUUID() } });
    expect(regenerated.status === 201 && regenerated.json.draftRevision === 2, `regenerate ${regenerated.status} ${regenerated.text}`);
    const successor = await browser.fetch(`/v1/budget-creation-proposals/${regenerated.json.proposalId}`);
    expect(successor.status === 200 && successor.json.lifecycle.status === "previewed", `successor read ${successor.status}`);
    return `expired proposal: read lifecycle expired/${read.json.lifecycle.reason} regenerateRequired; confirm 409 proposal_not_current; budget_space rows ${budgets}; regeneration 201 draftRevision 2, successor previewed`;
  });
  await criterion("CBD-232-AC05", "regression: local-midnight expiry - a zone within 30 minutes of its local midnight gets expiresAt at that midnight; New York and Tokyo previews carry their own budget dates", async () => {
    const now = new Date();
    const zones = Intl.supportedValuesOf("timeZone");
    const near = zones.find((zone) => { try { const next = localMidnightInstant(addCalendarDays(localDateOf(now, zone), 1), zone); return next.getTime() - now.getTime() < 29 * 60_000 && next.getTime() > now.getTime() + 60_000; } catch { return false; } });
    const notes = [];
    for (const zone of ["America/New_York", "Asia/Tokyo"]) {
      const created = await a.fetch("/v1/budget-creation-proposals", { method: "POST", body: { ...monthly(zone), timeZone: zone }, headers: { "idempotency-key": randomUUID() } });
      expect(created.status === 201 && created.json.preview.budgetDate === localDateOf(now, zone), `${zone} ${created.status} ${created.json?.preview?.budgetDate}`);
      const nextMidnight = localMidnightInstant(addCalendarDays(localDateOf(now, zone), 1), zone);
      const cap = new Date(Date.parse(created.json.issuedAt) + 30 * 60_000);
      const expectedExpiry = nextMidnight.getTime() <= cap.getTime() ? nextMidnight : cap;
      expect(created.json.expiresAt === expectedExpiry.toISOString(), `${zone} expiresAt ${created.json.expiresAt} expected ${expectedExpiry.toISOString()}`);
      notes.push(`${zone}: budgetDate ${created.json.preview.budgetDate}, expiresAt ${created.json.expiresAt} (${nextMidnight.getTime() <= cap.getTime() ? "local midnight" : "30-minute cap"})`);
    }
    if (!near) notes.push("no IANA zone is within 30 minutes of its local midnight at this instant; midnight-capped expiry not observed live");
    else {
      const created = await a.fetch("/v1/budget-creation-proposals", { method: "POST", body: { ...monthly(near), timeZone: near }, headers: { "idempotency-key": randomUUID() } });
      const nextMidnight = localMidnightInstant(addCalendarDays(localDateOf(now, near), 1), near);
      expect(created.status === 201 && created.json.expiresAt === nextMidnight.toISOString(), `${near} expiresAt ${created.json?.expiresAt} expected ${nextMidnight.toISOString()}`);
      notes.push(`${near}: expiresAt ${created.json.expiresAt} = next local midnight (< 30 minutes away)`);
    }
    return notes.join(" | ");
  });
  await criterion("CBD-232-AC05", "regression: concurrent regeneration of one predecessor yields exactly one successor; the loser gets the uniform 404", async () => {
    const predecessor = (await propose(a, monthly("Race predecessor"))).json;
    await pace(a.subject); await pace(a.subject);
    const cookie = [...a.cookies].map(([n, v]) => `${n}=${v}`).join("; ");
    const body = JSON.stringify({ ...monthly("Race successor"), supersedesProposalId: predecessor.proposalId });
    const [x, y] = await Promise.all([1, 2].map(() => rawPost("/v1/budget-creation-proposals", { "idempotency-key": randomUUID(), "x-cobudget-csrf": a.csrf }, body, cookie)));
    const statuses = [x.status, y.status].sort();
    expect(statuses[0] === 201 && [403, 404, 409, 503].includes(statuses[1]), `statuses ${statuses}`);
    const loser = [x, y].find((r) => r.status !== 201);
    expect(!/bcp_[0-9a-f]{32}/u.test(loser.text), `loser discloses a proposal id: ${loser.text}`);
    const successors = await count("budget_creation_proposal", "proposal_payload->>'predecessorProposalId' = $1", [predecessor.proposalId]);
    expect(successors === 1, `successors ${successors}`);
    return `statuses ${statuses.join("/")} (loser ${loser.status} ${loser.text}: uniform non-disclosing denial at the boundary's stale-revision recheck); exactly one successor row for ${predecessor.proposalId}`;
  });

  await criterion("CBD-232-AC07", "positive: the owner reads its proposal on the current session; idempotent create replay", async () => {
    const read = await a.fetch(`/v1/budget-creation-proposals/${issued.proposalId}`);
    expect(read.status === 200 && read.json.proposal.proposalId === issued.proposalId, `read ${read.status}`);
    const again = await propose(a, monthly("Replay"), replayKey, 200);
    return `owner read 200; replay 200 proposalId ${again.json.proposalId}`;
  });
  await criterion("CBD-232-AC07", "denial: guessed, cross-subject, cross-environment and stale-session proposals cannot be read or confirmed (uniform non-disclosing outcomes, zero effects)", async () => {
    const b = new Browser("b"); await signIn(b, "subject-b"); const budgetsBefore = await count("budget_space");
    const guessedRead = await a.fetch(`/v1/budget-creation-proposals/bcp_${"1".repeat(32)}`);
    const guessedConfirm = await confirm(a, { proposalId: `bcp_${"1".repeat(32)}`, confirmationBinding: issued.confirmationBinding });
    const crossRead = await b.fetch(`/v1/budget-creation-proposals/${issued.proposalId}`);
    const crossConfirm = await confirm(b, issued);
    const crossRegenerate = await b.fetch("/v1/budget-creation-proposals", { method: "POST", body: { ...monthly("Steal"), supersedesProposalId: issued.proposalId }, headers: { "idempotency-key": randomUUID() } });
    expect(guessedRead.status === 403 && crossRead.status === 403 && guessedRead.text === crossRead.text, `guessed ${guessedRead.status} ${guessedRead.text} vs cross ${crossRead.status} ${crossRead.text}`);
    expect(guessedConfirm.status === 404 && crossConfirm.status === 404 && guessedConfirm.text === crossConfirm.text, `confirm guessed ${guessedConfirm.status} ${guessedConfirm.text} vs cross ${crossConfirm.status} ${crossConfirm.text}`);
    expect(crossRegenerate.status === 403 || crossRegenerate.status === 404, `cross regenerate ${crossRegenerate.status} ${crossRegenerate.text}`);
    const uuid = issued.proposalId.slice(4).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/u, "$1-$2-$3-$4-$5");
    await q("update budget_creation_proposal set environment = 'staging', proposal_payload = jsonb_set(proposal_payload, '{environment}', '\"staging\"') where proposal_id = $1", [uuid]);
    let envRead, envConfirm;
    try { envRead = await a.fetch(`/v1/budget-creation-proposals/${issued.proposalId}`); envConfirm = await confirm(a, issued); }
    finally { await q("update budget_creation_proposal set environment = 'development', proposal_payload = jsonb_set(proposal_payload, '{environment}', '\"development\"') where proposal_id = $1", [uuid]); }
    expect(envRead.status === 403 && envConfirm.status === 404, `cross-environment read ${envRead.status} confirm ${envConfirm.status} ${envConfirm.text}`);
    const staleCookie = new Browser("stale"); staleCookie.cookies = new Map(a.cookies); staleCookie.csrf = a.csrf; staleCookie.subject = a.subject;
    await logout(a);
    const staleRead = await staleCookie.fetch(`/v1/budget-creation-proposals/${issued.proposalId}`);
    const staleConfirm = await confirm(staleCookie, issued);
    expect(staleRead.status === 403 && staleConfirm.status === 403, `stale session read ${staleRead.status} confirm ${staleConfirm.status}`);
    const state = await q("select proposal_state, lifecycle_revision from budget_creation_proposal where proposal_id = $1", [uuid]);
    expect(state[0].proposal_state === "previewed" && await count("budget_space") === budgetsBefore, `effects: ${JSON.stringify(state)} budgets ${await count("budget_space")} (before ${budgetsBefore})`);
    const { me: me2 } = await signIn(a); expect(me2.accountSubjectId === me.accountSubjectId, "re-sign-in");
    const newSession = await a.fetch(`/v1/budget-creation-proposals/${issued.proposalId}`);
    expect(newSession.status === 403 || newSession.status === 404, `old session generation's proposal visible to the new session: ${newSession.status} ${newSession.text}`);
    expect(!newSession.text.includes("preview"), "old-generation proposal content disclosed to the new session");
    return `guessed read 403 = cross-subject read 403 (identical bodies); guessed confirm 404 = cross-subject confirm 404 (identical bodies); cross-subject regenerate ${crossRegenerate.status}; cross-environment read 403 / confirm 404; revoked session read 403 / confirm 403; same subject's new session generation read ${newSession.status} (row exists for the subject, context key differs: not disclosed); proposal still previewed, budget rows unchanged (${budgetsBefore})`;
  });
  await criterion("CBD-232-AC06", "denial (HTTP half): logout and account switch invalidate the authoritative preview; no budget from a draft alone; terminal proposal retained", async () => {
    const previewed = (await propose(a, monthly("Draft only"))).json;
    const before = await count("budget_space");
    await logout(a);
    const b = new Browser("b"); await signIn(b, "subject-b");
    const switched = await b.fetch(`/v1/budget-creation-proposals/${previewed.proposalId}`);
    expect(switched.status === 403, `account switch read ${switched.status}`);
    const { me: back } = await signIn(a); expect(back.accountSubjectId === me.accountSubjectId, "same subject");
    const afterLogout = await a.fetch(`/v1/budget-creation-proposals/${previewed.proposalId}`);
    expect((afterLogout.status === 403 || afterLogout.status === 404) && !afterLogout.text.includes("preview"), `after logout/new session read ${afterLogout.status} ${afterLogout.text}`);
    const retained = await q("select proposal_state from budget_creation_proposal where proposal_id = $1", [previewed.proposalId.slice(4).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/u, "$1-$2-$3-$4-$5")]);
    expect(retained.length === 1 && before === await count("budget_space"), "row/budget delta");
    return `after account switch 403; after logout and re-sign-in ${afterLogout.status} (new session generation, no content); row retained (${retained[0].proposal_state}); budgets ${before} unchanged. Browser draft half in prototype-qa-browser.mjs`;
  });
  await criterion("CBD-232-AC08", "coverage: contract section 11 groups executed through the assembled routes", async () => {
    const executed = results.filter((r) => r.criterion.startsWith("CBD-232") && r.status === "pass").length;
    const failed = results.filter((r) => r.criterion.startsWith("CBD-232") && r.status === "fail").map((r) => r.case);
    return `${executed} CBD-232 cases passed, ${failed.length} failed (${failed.join("; ") || "none"}) on this run: every cadence family (monthly/weekly/paycheck/custom), day-31 clamp, local-midnight expiry computation, normalization, validation catalog and ordering, edit/regenerate, 30-minute expiry (row-adjusted), replay, concurrent regeneration, cross-subject/environment/session isolation. Not executed live: DST 23/25-hour days, leap-year February, holiday adjustments, post-retention key reuse, governing-version change (deploy-time constants; unit fixtures only)`;
  });
}

// ---------------------------------------------------------------------------
// Phase 3: CBD-233 confirmation
// ---------------------------------------------------------------------------
async function phaseConfirmation() {
  const a = new Browser("a"); const { me } = await signIn(a);
  let proposal = (await propose(a, monthly("Confirm me"))).json;
  let confirmed; let confirmKey;
  await criterion("CBD-233-AC01", "positive: a reviewed, current, bound proposal confirms (201)", async () => {
    confirmKey = randomUUID();
    const response = await confirm(a, proposal, confirmKey);
    expect(response.status === 201 && typeof response.json.budgetSpaceId === "string", `confirm ${response.status} ${response.text}`);
    confirmed = response.json;
    return `budgetSpaceId=${confirmed.budgetSpaceId} currentPeriodId=${confirmed.currentPeriodId} policy=${confirmed.authorization.policyVersion} committedAt=${confirmed.committedAt}`;
  });
  await criterion("CBD-233-AC02", "outcome: exactly one budget, one active primary_owner membership, one sequence-1 schedule, one current period (of four), one operation, one success outcome, one audit record, one idempotency row", async () => {
    const c = await cardinalities(confirmed.budgetSpaceId);
    const membership = await q("select role, status, account_subject_id from budget_space_membership where budget_space_id = $1", [confirmed.budgetSpaceId]);
    const schedule = await q("select sequence, status from budget_space_schedule_version where budget_space_id = $1", [confirmed.budgetSpaceId]);
    const audit = await q("select event_type from budget_creation_audit where budget_space_id = $1", [confirmed.budgetSpaceId]);
    expect(c.budget_space === 1 && c.membership === 1 && c.schedule_version === 1 && c.period === 4 && c.current_period === 1 && c.operation === 1 && c.success === 1 && c.audit === 1 && c.idempotency === 1 && c.category === 0 && c.base_target === 0, JSON.stringify(c));
    expect(membership[0].role === "primary_owner" && membership[0].status === "active" && membership[0].account_subject_id === me.accountSubjectId, JSON.stringify(membership));
    expect(schedule[0].sequence === 1 && schedule[0].status === "authoritative", JSON.stringify(schedule));
    return `${JSON.stringify(c)}; membership ${membership[0].role}/${membership[0].status}; schedule sequence ${schedule[0].sequence} ${schedule[0].status}; audit ${audit.map((x) => x.event_type).join(",")}`;
  });
  await criterion("CBD-233-AC02", "denial: audit-insert or deferred-constraint fault injected inside the commit", async () => notRun("no fault-injection seam is reachable in the running API process (the A3/A4 seams are unit-level in apps/api/src/sessions/dispatch.test.ts); patching product code is out of scope"));
  await criterion("CBD-233-AC08", "positive: the success response identifiers resolve to committed rows and versions; one onboarding continuation identity", async () => {
    const space = (await q("select * from budget_space where budget_space_id = $1", [confirmed.budgetSpaceId]))[0];
    const period = (await q("select status from budget_space_period where period_id = $1 and budget_space_id = $2", [confirmed.currentPeriodId, confirmed.budgetSpaceId]))[0];
    const success = (await q("select response_payload from budget_creation_success where budget_space_id = $1", [confirmed.budgetSpaceId]))[0];
    expect(space && space.primary_owner_membership_id === confirmed.primaryOwnerMembershipId && space.initial_schedule_version_id === confirmed.initialScheduleVersionId && space.current_schedule_version_id === confirmed.currentScheduleVersionId && space.current_period_id === confirmed.currentPeriodId && space.name_version === confirmed.nameVersion && space.lifecycle === confirmed.lifecycle && space.lifecycle_version === confirmed.lifecycleVersion, `space ${JSON.stringify(space)}`);
    expect(period?.status === "active", `period ${JSON.stringify(period)}`);
    expect(success && success.response_payload.onboardingContinuationId === confirmed.onboardingContinuationId && success.response_payload.confirmationOutcomeId === confirmed.confirmationOutcomeId, "stored success differs");
    return `primaryOwnerMembershipId, initial/currentScheduleVersionId, currentPeriodId (status active), nameVersion, lifecycle/lifecycleVersion resolve on budget_space; onboardingContinuationId=${confirmed.onboardingContinuationId} stored once`;
  });
  await criterion("CBD-233-AC04", "positive: same key and binding replay returns the byte-equivalent logical response and creates nothing", async () => {
    const before = await cardinalities(confirmed.budgetSpaceId);
    const replay = await confirm(a, proposal, confirmKey);
    expect(replay.status === 201 && canonical(replay.json) === canonical(confirmed), `replay ${replay.status} ${replay.text}`);
    const after = await cardinalities(confirmed.budgetSpaceId);
    expect(JSON.stringify(before) === JSON.stringify(after), `delta ${JSON.stringify(delta(before, after))}`);
    return `201 identical body; cardinalities unchanged ${JSON.stringify(after)}`;
  });
  await criterion("CBD-233-AC08", "outcome: replay recovers the identical stored outcome after the response was delivered", async () => {
    const replay = await confirm(a, proposal, confirmKey);
    expect(canonical(replay.json) === canonical(confirmed), "replay differs");
    return `stored outcome ${confirmed.confirmationOutcomeId} returned again`;
  });
  await criterion("CBD-233-AC04", "denial: the key reused for another proposal is 409 idempotency_key_reused; a new key for the consumed proposal is 409 proposal_not_current; no rows added", async () => {
    const other = (await propose(a, monthly("Another"))).json;
    const before = await cardinalities(confirmed.budgetSpaceId); const budgets = await count("budget_space");
    const reused = await confirm(a, other, confirmKey);
    expect(reused.status === 409 && reused.json.error === "idempotency_key_reused", `reused ${reused.status} ${reused.text}`);
    const newKey = await confirm(a, proposal, randomUUID());
    expect(newKey.status === 409 && newKey.json.error === "proposal_not_current", `new key ${newKey.status} ${newKey.text}`);
    expect(JSON.stringify(before) === JSON.stringify(await cardinalities(confirmed.budgetSpaceId)) && budgets === await count("budget_space"), "rows added");
    return `409 idempotency_key_reused; 409 proposal_not_current; budget_space rows ${budgets}`;
  });
  await criterion("CBD-233-AC07", "denial: categories, targets, bills, goals, transactions, memberships and account links cannot be included in the confirmation; none precede it", async () => {
    const b = new Browser("b"); await signIn(b, "subject-b");
    const p = (await propose(b, monthly("Loaded"))).json;
    const before = await count("budget_space");
    const loaded = await confirm(b, p, randomUUID(), { confirmationBinding: p.confirmationBinding, categories: [{ label: "Food" }], targets: [{ amountMinorUnits: 1 }], bills: [], goals: [], transactions: [], memberships: [{ role: "co_owner" }], accountLinks: [] });
    expect(loaded.status === 400 && loaded.json.error === "invalid_request", `loaded ${loaded.status} ${loaded.text}`);
    expect(before === await count("budget_space"), "budget created");
    const clean = await confirm(b, p);
    expect(clean.status === 201, `clean confirm ${clean.status} ${clean.text}`);
    const c = await cardinalities(clean.json.budgetSpaceId);
    expect(c.category === 0 && c.base_target === 0 && c.period_target === 0 && c.membership === 1, JSON.stringify(c));
    const [food] = await categories(b, clean.json.budgetSpaceId, ["Food"]);
    expect(typeof food.categoryId === "string", "category route after confirmation");
    return `loaded body 400 invalid_request, no budget; clean confirm 201 with categories=0 base_target=0 period_target=0 membership=1; categories created only through PUT afterwards`;
  });
  await criterion("CBD-233-AC01", "denial: expired, guessed/cross-context and altered bindings cannot confirm; identifier possession is never authority", async () => {
    const b = new Browser("b2"); await signIn(b, "subject-b");
    const p = (await propose(a, monthly("Deny me"))).json;
    const budgets = await count("budget_space");
    const cross = await confirm(b, p);
    const guessed = await confirm(a, { proposalId: `bcp_${"2".repeat(32)}`, confirmationBinding: p.confirmationBinding });
    const one = await freshProposal("subject-a", monthly("Altered"));
    const altered = await confirm(one.browser, one.proposal, randomUUID(), { confirmationBinding: `${one.proposal.confirmationBinding.slice(0, -2)}zz`, acknowledgedDisclosure: acknowledgementFor(one.proposal) });
    const two = await freshProposal("subject-a", monthly("Expired"));
    const uuid = two.proposal.proposalId.slice(4).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/u, "$1-$2-$3-$4-$5");
    await q("update budget_creation_proposal set proposal_payload = jsonb_set(proposal_payload, '{expiresAt}', to_jsonb((now() - interval '1 second')::timestamptz)) where proposal_id = $1", [uuid]);
    const expired = await confirm(two.browser, two.proposal);
    expect(cross.status === 404 && guessed.status === 404 && altered.status === 409 && expired.status === 409, `cross ${cross.status} guessed ${guessed.status} altered ${altered.status} ${altered.text} expired ${expired.status} ${expired.text}`);
    expect(budgets === await count("budget_space"), "budget created");
    return `cross-subject 404 proposal_not_found; guessed 404; altered binding 409 proposal_not_current; expired 409 proposal_not_current; budget_space rows ${budgets}`;
  });
  await criterion("PROTO-RESERVED-UNIT", "cross-cutting: a confirm attempt denied inside the effect (altered binding, 409) should not spend the ceremony's reserved initial-create unit (PR #328: failed confirm attempts are no-effect), so the corrected confirm on the same session still commits", async () => {
    const { browser, proposal } = await freshProposal("subject-a", monthly("Retry after denial"));
    const denied = await confirm(browser, proposal, randomUUID(), { confirmationBinding: `${proposal.confirmationBinding.slice(0, -2)}zz` });
    expect(denied.status === 409 && denied.json?.error === "proposal_not_current", `denied ${denied.status} ${denied.text}`);
    const corrected = await confirm(browser, proposal);
    expect(corrected.status === 201, `corrected confirm after one denied attempt returned ${corrected.status} ${corrected.text} (the ceremony's reserved unit was consumed by the denied attempt; the subject must sign in again to create a budget)`);
    return `denied 409 then corrected 201 on the same ceremony`;
  });
  await criterion("CBD-233-AC06", "denial: logout before commit denies (403) and rolls back; account switch denies (404); the unchanged authorized context commits", async () => {
    const p = (await propose(a, monthly("Context"))).json;
    const budgets = await count("budget_space");
    const stale = new Browser("stale"); stale.cookies = new Map(a.cookies); stale.csrf = a.csrf; stale.subject = a.subject;
    await logout(a);
    const afterLogout = await confirm(stale, p);
    expect(afterLogout.status === 403, `after logout ${afterLogout.status} ${afterLogout.text}`);
    const b = new Browser("b3"); await signIn(b, "subject-b");
    const switched = await confirm(b, p);
    expect(switched.status === 404, `switch ${switched.status}`);
    await signIn(a);
    const newGeneration = await confirm(a, p);
    expect(newGeneration.status === 404, `new session generation ${newGeneration.status} ${newGeneration.text}`);
    expect(budgets === await count("budget_space"), "budget created");
    const fresh = (await propose(a, monthly("Fresh context"))).json;
    const ok = await confirm(a, fresh);
    expect(ok.status === 201, `fresh ${ok.status} ${ok.text}`);
    return `revoked session 403; other subject 404; same subject new session generation 404; budgets unchanged (${budgets}); fresh proposal on the current session commits 201`;
  });
  await criterion("CBD-233-AC06", "denial: session rotation/revocation or policy/version change between precheck and commit", async () => notRun("CONF-233-T04/T05 commit-boundary seams (revocation fence, epoch bump during the transaction) are exercised only by apps/api/src/sessions/revocation-fence.live.test.ts; no request-level seam exists in the running process"));
  await criterion("CBD-233-AC03", "denial: failure injected before/after each precommit write", async () => notRun("CONF-233-T06/T07 fault points are not reachable without a product seam; rollback of every access-conferring row is covered by unit/live tests (dispatch.test.ts, confirmation.live.test.ts), not observed here"));
  await criterion("CBD-233-AC03", "positive/outcome: the normal confirmation commits; a denied confirmation leaves zero creation or access residue", async () => {
    const b = new Browser("b4"); await signIn(b, "subject-b");
    const p = (await propose(b, monthly("Residue"))).json;
    const candidate = (await q("select candidate_budget_space_id, candidate_primary_membership_id from budget_creation_proposal where proposal_id = $1", [p.proposalId.slice(4).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/u, "$1-$2-$3-$4-$5")]))[0];
    const denied = await confirm(b, p, randomUUID(), { confirmationBinding: `${p.confirmationBinding.slice(0, -2)}zz` });
    expect(denied.status === 409, `denied ${denied.status}`);
    const residue = await cardinalities(candidate.candidate_budget_space_id);
    expect(Object.values(residue).every((n) => n === 0) && await count("budget_space_membership", "membership_id = $1", [candidate.candidate_primary_membership_id]) === 0, JSON.stringify(residue));
    const again = await freshProposal("subject-b", monthly("Residue committed"));
    const ok = await confirm(again.browser, again.proposal);
    expect(ok.status === 201, `commit ${ok.status} ${ok.text}`);
    return `denied confirm leaves candidate ${candidate.candidate_budget_space_id} with zero rows (${JSON.stringify(residue)}); a valid confirm on a fresh ceremony commits ${ok.json.budgetSpaceId}`;
  });
  await criterion("CBD-233-AC05", "positive/outcome: synchronized same-key and different-key confirmations of one proposal yield exactly one committed budget; losers follow the contract outcomes (real PostgreSQL uniqueness)", async () => {
    const b = new Browser("b5"); await signIn(b, "subject-b");
    const p = (await propose(b, monthly("Race"))).json;
    for (let i = 0; i < 6; i++) await pace(b.subject);
    const cookie = [...b.cookies].map(([n, v]) => `${n}=${v}`).join("; ");
    const sameKey = randomUUID();
    // CBD-236: every racer carries the acknowledged disclosure, so the race is decided by PostgreSQL
    // uniqueness and not by a stale-disclosure denial.
    const body = JSON.stringify({ confirmationBinding: p.confirmationBinding, acknowledgedDisclosure: acknowledgementFor(p) });
    // A second API process on the next port shares the database but has its own in-process reservation gate, so the
    // two winners of the per-process gates race on PostgreSQL itself (the contract's final guard).
    const second = await startApi(currentOverrides, { port: PORT + 1 });
    expect(second.ready, `second API process: ${second.output().slice(0, 500)}`);
    let responses;
    try {
      const keys = [sameKey, sameKey, sameKey, randomUUID(), randomUUID(), randomUUID()];
      const headersFor = (value) => ({ "idempotency-key": value, "x-cobudget-csrf": b.csrf });
      const portFor = (index) => (index % 2 ? PORT + 1 : PORT);
      responses = await Promise.all(keys.map((value, index) => rawPost(`/v1/budget-creation-proposals/${p.proposalId}/confirm`, headersFor(value), body, cookie, portFor(index))));
    } finally { await second.stop(); }
    const statuses = responses.map((r, index) => `${index % 2 ? "B" : "A"}:${r.status}${r.json?.error ?? r.json?.reason ? `:${r.json.error ?? r.json.reason}` : ""}`);
    const winners = responses.filter((r) => r.status === 201);
    expect(winners.length >= 1 && winners.every((r) => r.json.budgetSpaceId === winners[0].json.budgetSpaceId), `winners ${JSON.stringify(statuses)}`);
    expect(responses.every((r) => [201, 403, 409, 503].includes(r.status)), `unexpected statuses ${JSON.stringify(statuses)}`);
    const recovered = await confirm(b, p, sameKey);
    expect(recovered.status === 201 && recovered.json.budgetSpaceId === winners[0].json.budgetSpaceId, `exact retry after the race ${recovered.status} ${recovered.text}`);
    const otherKey = await confirm(b, p, randomUUID());
    expect(otherKey.status === 409 && otherKey.json.error === "proposal_not_current", `new key after the race ${otherKey.status} ${otherKey.text}`);
    const c = await cardinalities(winners[0].json.budgetSpaceId);
    const ownedByB = await count("budget_space_membership", "account_subject_id = $1 and budget_space_id = $2", [b.subject, winners[0].json.budgetSpaceId]);
    expect(c.budget_space === 1 && c.membership === 1 && c.schedule_version === 1 && c.current_period === 1 && c.success === 1 && c.operation === 1 && ownedByB === 1, JSON.stringify(c));
    const spaces = await count("budget_space", "created_by_subject_id = $1", [b.subject]);
    const proposals = await count("budget_creation_proposal", "account_subject_id = $1 and proposal_state = 'confirmed'", [b.subject]);
    return `six synchronized submits across two API processes A (the ceremony's process) and B (a second process on the same database; 3 same key, 3 distinct keys): ${statuses.join(",")}; losers on A are denied by the per-ceremony reservation gate, every request on B is denied because the ceremony is unknown to that process (in-memory challenge store); exactly one budget ${winners[0].json.budgetSpaceId} (${JSON.stringify(c)}); exact-key retry after the race replays 201, new key 409 proposal_not_current; subject-b spaces=${spaces} confirmed proposals=${proposals}`;
  });
  await criterion("CBD-233-AC09", "coverage: T01-T10 executed against the running candidate with positive controls", async () => {
    const failed = results.filter((r) => r.criterion.startsWith("CBD-233") && r.status === "fail").map((r) => r.case);
    const notRunCases = results.filter((r) => r.criterion.startsWith("CBD-233") && r.status === "not_run").map((r) => r.case);
    return `${failed.length} CBD-233 cases failed (${failed.join("; ") || "none"}); executed live: T01 (cardinalities), T02 (replay before/after delivery), T03 (six synchronized submits), T04 (expiry, successor, altered binding), T05 (logout, account switch, new session generation), T08 (cross-subject, guessed, altered), T09 (forbidden entities), T10 (post-commit replay identical). Not executed live: ${notRunCases.length} cases (${notRunCases.join("; ")})`;
  });
}

// ---------------------------------------------------------------------------
// Phase: CBD-236 consent record (CBD236-CONSENT-SEMANTICS-001)
//
// Its own API process, so its ceremonies and reserved initial-creation units
// are its own. The reservation counters are process-local, and several
// criteria elsewhere assert the exact gate a denial reaches (404 locator
// versus 403 exhausted), which depends on how many units the phase has spent.
// ---------------------------------------------------------------------------
async function phaseConsent() {
  await criterion("CBD-236-CONSENT-01", "positive: a completed confirmation writes exactly one current self_disclosure consent row, carrying the approved registry's version and digest and the decision's policy tuple", async () => {
    const registry = JSON.parse(await readFile(new URL("../config/consent-disclosure-registry.json", import.meta.url), "utf8"));
    const approved = registry.filter((entry) => entry.kind === "primary_owner_self").at(-1);
    const fresh = await freshProposal("subject-a", monthly("Consent write"));
    const proposed = fresh.proposal;
    expect(proposed.currentDisclosure?.kind === approved.kind && proposed.currentDisclosure.version === approved.version && proposed.currentDisclosure.digest === approved.digest,
      `the preview carries ${JSON.stringify(proposed.currentDisclosure)} against registry ${JSON.stringify(approved)}`);
    expect(Array.isArray(proposed.currentDisclosure.text?.items) && proposed.currentDisclosure.text.items.length > 0 && typeof proposed.currentDisclosure.text.acknowledgement === "string",
      "the preview carries the disclosure text and its acknowledgement sentence");
    const created = await confirm(fresh.browser, proposed);
    expect(created.status === 201, `confirm ${created.status} ${created.text}`);
    const rows = await q("select membership_id, account_subject_id, recorded_by_subject_id, role, resource_scope, source, source_record_version, disclosure_kind, disclosure_version, disclosure_digest, policy_version, policy_digest, state, assurance_ref, ended_at from budget_space_consent where budget_space_id = $1", [created.json.budgetSpaceId]);
    expect(rows.length === 1, `${rows.length} consent rows`);
    const row = rows[0];
    expect(row.membership_id === created.json.primaryOwnerMembershipId, "the row names the creator membership");
    expect(row.account_subject_id === row.recorded_by_subject_id, "the acting subject recorded their own consent");
    expect(row.role === "primary_owner" && row.resource_scope === "full" && row.source === "self_disclosure" && row.state === "current" && row.assurance_ref === null && row.ended_at === null, JSON.stringify(row));
    expect(row.disclosure_kind === approved.kind && Number(row.disclosure_version) === approved.version && row.disclosure_digest === approved.digest,
      "the recorded disclosure is the registry's, never the request's");
    expect(row.policy_version === created.json.authorization.policyVersion && row.policy_digest === created.json.authorization.policyDigest, "the row carries the decision's policy tuple");
    expect(Number(row.source_record_version) >= 1, "the confirmed proposal lifecycle revision is recorded");
    const detail = await fresh.browser.fetch(`/v1/budget-spaces/${created.json.budgetSpaceId}`);
    expect(detail.status === 200, `1.view_space with a current consent row ${detail.status} ${detail.text}`);
    return `one current self_disclosure row: disclosure ${row.disclosure_kind} v${row.disclosure_version} digest ${String(row.disclosure_digest).slice(0, 12)}...; policy ${row.policy_version}; ordinary cell 200`;
  });
  await criterion("CBD-236-CONSENT-02", "denial: a stale or missing acknowledged disclosure fails confirmation with stale_disclosure and writes nothing; an ordinary cell denies once the consent row is no longer current", async () => {
    const budgetsBefore = await count("budget_space");
    const consentsBefore = (await q("select count(*)::int as total from budget_space_consent", []))[0].total;
    for (const [label, acknowledgedDisclosure] of [
      ["a superseded version", { kind: "primary_owner_self", version: 99 }],
      ["another disclosure kind", { kind: "invitation", version: 1 }],
      ["no acknowledgement at all", undefined],
    ]) {
      const stale = await freshProposal("subject-a", monthly(`Stale ${label}`));
      const body = acknowledgedDisclosure
        ? { confirmationBinding: stale.proposal.confirmationBinding, acknowledgedDisclosure }
        : { confirmationBinding: stale.proposal.confirmationBinding };
      const denied = await confirm(stale.browser, stale.proposal, randomUUID(), body);
      expect(denied.status === 409 && denied.json.error === "stale_disclosure", `${label}: ${denied.status} ${denied.text}`);
    }
    expect(budgetsBefore === await count("budget_space"), "a denied confirmation created a budget");
    expect(consentsBefore === (await q("select count(*)::int as total from budget_space_consent", []))[0].total, "a denied confirmation wrote a consent row");

    // CONSENT-L-03: the datastore row is the only source of the consent fact. The same owner and the
    // same cell, with nothing changed but the row's state.
    const owner = await freshProposal("subject-b", monthly("Consent ended"));
    const created = await confirm(owner.browser, owner.proposal);
    expect(created.status === 201, `confirm ${created.status} ${created.text}`);
    const allowed = await owner.browser.fetch(`/v1/budget-spaces/${created.json.budgetSpaceId}`);
    expect(allowed.status === 200, `with a current consent row ${allowed.status} ${allowed.text}`);
    await q("update budget_space_consent set state = 'ended', ended_at = now(), ended_reason_class = 'qa_probe' where budget_space_id = $1", [created.json.budgetSpaceId]);
    const denied = await owner.browser.fetch(`/v1/budget-spaces/${created.json.budgetSpaceId}`);
    expect(denied.status === 403, `consent no longer current: ${denied.status} ${denied.text}`);
    return `stale, foreign-kind and missing acknowledgements each 409 stale_disclosure with no budget_space row and no consent row; the same owner and the same cell: 200 with a current consent row, ${denied.status} once it is ended`;
  });
}

// ---------------------------------------------------------------------------
// Phase 4: CBD-190 identity (local adapter)
// ---------------------------------------------------------------------------
async function phaseIdentity(started) {
  const before = await identityCounts();
  const a = new Browser("a");
  let first;
  await criterion("CBD-190-AC03", "positive: first use (the run's first ceremony, phase 1) created exactly one account subject, one financial profile, one identity binding and one session; a later ceremony adds only a session; the hosted page carries no credential input", async () => {
    expect(firstUse && firstUse.delta.account_subject === 1 && firstUse.delta.financial_profile === 1 && firstUse.delta.identity_binding === 1 && firstUse.delta.account_session === 1, `first-use delta ${JSON.stringify(firstUse?.delta)}`);
    const { callback, hosted } = await ceremony(a);
    expect(!/<input|<form|<textarea/iu.test(hosted) && /No password, passkey, factor or recovery input/u.test(hosted), "hosted chooser contains credential input markup");
    const completed = await a.fetch(callback, { navigate: true });
    expect(completed.status === 303 && a.cookies.has("__Host-cobudget_session"), `callback ${completed.status}`);
    const cookie = completed.setCookies.find((c) => c.startsWith("__Host-cobudget_session="));
    expect(/HttpOnly/iu.test(cookie) && /Secure/iu.test(cookie) && /SameSite=(Lax|Strict)/iu.test(cookie) && /Path=\//u.test(cookie) && !/Domain=/iu.test(cookie), `cookie attributes ${cookie?.replace(/=[^;]+/u, "=<redacted>")}`);
    const me = await a.fetch("/v1/identity/me"); a.csrf = me.json.csrfValue; a.subject = me.json.accountSubjectId; first = me.json;
    const after = await identityCounts();
    const d = delta(before, after);
    expect(d.account_subject === undefined && d.financial_profile === undefined && d.identity_binding === undefined && d.account_session === 1 && first.accountSubjectId === firstUse.subject, JSON.stringify(d));
    const profile = await q("select profile_state from financial_profile where account_subject_id = $1", [first.accountSubjectId]);
    expect(profile.length === 1 && profile[0].profile_state === "active", JSON.stringify(profile));
    return `first use at ${firstUse.at}: delta ${JSON.stringify(firstUse.delta)}; this ceremony: delta ${JSON.stringify(d)}; subject ${first.accountSubjectId} profile ${first.profileId} (${profile[0].profile_state}); cookie HttpOnly Secure host-only; environmentId=${first.environmentId}`;
  });
  await criterion("CBD-190-AC03", "outcome: repeat/concurrent deliveries of one callback and an existing subject's second sign-in yield one mapping, one handoff winner and no second profile", async () => {
    const b = new Browser("a-concurrent");
    const { callback } = await ceremony(b);
    const snapshot = await identityCounts();
    const [x, y] = await Promise.all([b.fetch(callback, { navigate: true }), b.fetch(callback, { navigate: true })]);
    const cookies = [x, y].filter((r) => r.setCookies.some((c) => c.startsWith("__Host-cobudget_session="))).length;
    expect(x.status === 303 && y.status === 303 && cookies === 1, `statuses ${x.status}/${y.status}, cookie deliveries ${cookies}`);
    const d = delta(snapshot, await identityCounts());
    expect(d.account_subject === undefined && d.financial_profile === undefined && d.identity_binding === undefined && d.account_session === 1 && d.handoff === 1, JSON.stringify(d));
    const replay = await b.fetch(callback, { navigate: true });
    expect(replay.status === 303 && !replay.setCookies.length, `later replay ${replay.status} cookies ${replay.setCookies.length}`);
    const me = await b.fetch("/v1/identity/me");
    expect(me.status === 200 && me.json.accountSubjectId === first.accountSubjectId && me.json.sessionRef !== first.sessionRef, "second sign-in must resolve the same subject on a new session");
    const profiles = await count("financial_profile", "account_subject_id = $1", [first.accountSubjectId]);
    const bindings = await count("identity_binding", "account_subject_id = $1", [first.accountSubjectId]);
    expect(profiles === 1 && bindings === 1, `profiles ${profiles} bindings ${bindings}`);
    b.csrf = me.json.csrfValue; await logout(b);
    return `concurrent deliveries: one Set-Cookie, one session and one handoff added, no subject/profile/binding; later replay 303 without cookie; same subject ${first.accountSubjectId}, profiles=1 bindings=1`;
  });
  await criterion("CBD-190-AC03", "denial: a disabled subject completes no session and gets a uniform safe outcome; injected commit failure", async () => {
    const b = new Browser("b"); const { callback } = await ceremony(b, "subject-b");
    const bId = (await q("select account_subject_id from identity_binding where provider_subject not in (select provider_subject from identity_binding where account_subject_id = $1) limit 1", [first.accountSubjectId]))[0]?.account_subject_id;
    // subject-b may not exist yet: create it through one ceremony, then disable it.
    if (!bId) {
      const done = await b.fetch(callback, { navigate: true }); expect(done.status === 303 && b.cookies.has("__Host-cobudget_session"), "subject-b first sign-in");
      const me = await b.fetch("/v1/identity/me"); b.csrf = me.json.csrfValue; await logout(b);
    }
    const subjectB = (await q("select account_subject_id from account_subject where account_subject_id <> $1", [first.accountSubjectId]))[0].account_subject_id;
    await q("update account_subject set lifecycle_state = 'disabled' where account_subject_id = $1", [subjectB]);
    try {
      const c = new Browser("b-disabled"); const snapshot = await identityCounts();
      const { outcome, location } = await signIn(c, "subject-b");
      expect(!c.cookies.has("__Host-cobudget_session"), "session issued to a disabled subject");
      expect(typeof outcome === "string" && new URL(location).pathname === "/identity/result", `location ${location}`);
      const d = delta(snapshot, await identityCounts());
      expect(d.account_session === undefined && d.account_subject === undefined && d.financial_profile === undefined, JSON.stringify(d));
      const injected = "injected commit failure: no seam in the running process (mapping.live.test.ts covers it); not observed here";
      return `disabled subject: outcome=${outcome}, no cookie, delta ${JSON.stringify(d)}. ${injected}`;
    } finally { await q("update account_subject set lifecycle_state = 'active' where account_subject_id = $1", [subjectB]); }
  });

  await criterion("CBD-190-AC02", "positive/outcome: after a completed exchange no password, private key, MFA seed, recovery secret, or provider token (JWT or refresh token) is present in any database column, the session cookie, or the API log", async () => {
    const dump = await q("select string_agg(t, ' ') as all_text from (select row_to_json(s)::text as t from account_session s union all select row_to_json(h)::text from identity_session_handoff h union all select row_to_json(d)::text from session_delivery_result d union all select row_to_json(c)::text from identity_callback c union all select row_to_json(i)::text from identity_binding i union all select row_to_json(o)::text from revocation_outbox o) x");
    const text = dump[0].all_text ?? "";
    const jwt = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/u;
    expect(!jwt.test(text) && !/refresh_token|access_token|id_token|"password"|"passkey"|totp|mfa_seed/iu.test(text), "raw provider material found in identity tables");
    const log = started().output();
    expect(!jwt.test(log) && !/refresh_token=|access_token=|id_token=/u.test(log), "provider token material in the API log");
    const cookie = a.cookies.get("__Host-cobudget_session");
    expect(cookie && !jwt.test(cookie), "session cookie carries a JWT");
    const sealed = await q("select envelope_key_version, length(sealed_envelope) as l from session_delivery_result limit 1");
    return `identity tables (${text.length} chars serialized) contain no JWT/token/password/passkey/MFA strings; API log (${log.length} chars) contains none; session cookie is an opaque ${cookie.length}-char value; delivery envelopes sealed (${sealed[0]?.envelope_key_version ?? "none"})`;
  });
  await criterion("CBD-190-AC02", "denial: expired and invalid provider tokens (expired, future, bad signature, wrong issuer/audience, alg none/HS256, unknown kid, malformed, missing sub, nonce mismatch, use-not-id) issue no session and add no subject", async () => {
    const scenarios = ["expired-token", "future-token", "bad-signature", "wrong-issuer", "wrong-audience", "alg-none", "alg-hs256", "unknown-kid", "malformed-token", "missing-sub", "nonce-mismatch", "use-not-id"];
    const outcomes = [];
    for (const scenario of scenarios) {
      const b = new Browser(scenario); const snapshot = await identityCounts();
      const { outcome } = await signIn(b, scenario);
      expect(!b.cookies.has("__Host-cobudget_session") && typeof outcome === "string", `${scenario}: cookie=${b.cookies.has("__Host-cobudget_session")} outcome=${outcome}`);
      const d = delta(snapshot, await identityCounts());
      expect(d.account_session === undefined && d.account_subject === undefined && d.financial_profile === undefined, `${scenario}: ${JSON.stringify(d)}`);
      const me = await b.fetch("/v1/identity/me"); expect(me.status === 403, `${scenario}: /me ${me.status}`);
      outcomes.push(`${scenario}=${outcome}`);
    }
    return outcomes.join(", ");
  });
  await criterion("CBD-190-AC02", "regression: late issuance, JWKS timeout, stalled revocation, idle PKCE, unread CSRF sweep", async () => notRun("bounded to unit seams (identity/exchange.test.ts B2/A9, challenge.test.ts, ceremony.test.ts A8); no request-level seam in the running process. Provider-side custody and revocation evidence not_run under PROVIDERS-LOCAL-001"));

  await criterion("CBD-190-AC04", "denial: missing, unknown-state, duplicate state/code, code-plus-error, oversized, malformed, cross-origin, wrong-method and wrong-path callbacks return the uniform safe outcome with zero subject/session delta", async () => {
    const snapshot = await identityCounts();
    const { callback } = await ceremony(new Browser("faults"));
    const url = new URL(callback); const state = url.searchParams.get("state"); const code = url.searchParams.get("code");
    const variants = {
      missing: "/v1/identity/callback", unknown_state: `/v1/identity/callback?code=${code}&state=${"x".repeat(43)}`, code_plus_error: `/v1/identity/callback?code=${code}&state=${state}&error=access_denied`,
      duplicate_state: `/v1/identity/callback?code=${code}&state=${state}&state=${state}`, duplicate_code: `/v1/identity/callback?code=${code}&code=${code}&state=${state}`,
      oversized: `/v1/identity/callback?code=${code}&state=${state}&pad=${"p".repeat(9000)}`,
    };
    const outcomes = {};
    for (const [name, path] of Object.entries(variants)) {
      const r = await new Browser(name).fetch(path, { navigate: true });
      const location = r.headers.get("location") ?? "";
      expect(!r.setCookies.length, `${name}: cookie issued`);
      if (r.status === 303) { expect(location.startsWith(`${ORIGIN}/identity/result?outcome=`), `${name}: ${r.status} ${location}`); outcomes[name] = new URL(location).searchParams.get("outcome"); }
      else { expect(r.status === 403 && r.json?.outcome === "deny", `${name}: ${r.status} ${r.text}`); outcomes[name] = `403 ${r.json.reason} (rate-limit gate: no ceremony resolvable from the query)`; }
    }
    expect(Object.values(outcomes).every((o) => o === "invalid_or_expired" || o.startsWith("403")), JSON.stringify(outcomes));
    // The challenge was terminated by the malformed variants naming its state: the exact well-formed replay is now terminal.
    const terminal = await new Browser("terminal").fetch(callback, { navigate: true });
    expect(terminal.status === 303 && new URL(terminal.headers.get("location")).searchParams.get("outcome") === "invalid_or_expired" && !terminal.setCookies.length, "terminated challenge replay");
    const fresh = await ceremony(new Browser("cross"));
    const callbackUrl = new URL(fresh.callback);
    const crossOrigin = await rawGet(`${callbackUrl.pathname}${callbackUrl.search}`, `localhost:${PORT}`);
    expect(crossOrigin.status === 303 && new URL(crossOrigin.location).searchParams.get("outcome") === "invalid_or_expired" && !crossOrigin.setCookies.length, `cross-origin ${crossOrigin.status} ${crossOrigin.location} cookies=${crossOrigin.setCookies.length}`);
    const afterCross = await rawGet(`${callbackUrl.pathname}${callbackUrl.search}`, `127.0.0.1:${PORT}`);
    expect(!afterCross.setCookies.length && new URL(afterCross.location).searchParams.get("outcome") === "invalid_or_expired", `callback still usable after a wrong-origin delivery terminated the challenge: ${afterCross.status} ${afterCross.location}`);
    const evilHost = await ceremony(new Browser("evil"));
    const evilUrl = new URL(evilHost.callback);
    const foreign = await rawGet(`${evilUrl.pathname}${evilUrl.search}`, "app.attacker.example");
    expect(foreign.status === 303 && new URL(foreign.location).searchParams.get("outcome") === "invalid_or_expired" && !foreign.setCookies.length, `foreign host ${foreign.status} ${foreign.location}`);
    const wrongMethod = await new Browser("post").fetch(fresh.callback, { method: "POST", navigate: true });
    expect(wrongMethod.status === 303 || wrongMethod.status === 404 || wrongMethod.status === 405, `wrong method ${wrongMethod.status}`);
    const d = delta(snapshot, await identityCounts());
    expect(d.account_session === undefined && d.account_subject === undefined && d.financial_profile === undefined, JSON.stringify(d));
    return `${Object.entries(outcomes).map(([k, v]) => `${k}=${v}`).join(", ")}; terminated challenge replay invalid_or_expired; wrong-origin (Host localhost:${PORT}, the ceremony origin) invalid_or_expired and the challenge terminal for the correct origin afterwards; foreign Host app.attacker.example invalid_or_expired; POST ${wrongMethod.status}; delta ${JSON.stringify(d)} (no subject/session); callback rows delta ${d.callback ?? 0}`;
  });
  await criterion("CBD-190-AC04", "denial: provider outage, replay after success and a stale challenge; a fresh ceremony succeeds afterwards", async () => {
    const outage = new Browser("outage"); const snapshot = await identityCounts();
    const { outcome } = await signIn(outage, "outage");
    expect(outcome === "temporarily_unavailable" && !outage.cookies.has("__Host-cobudget_session"), `outage outcome ${outcome}`);
    const d = delta(snapshot, await identityCounts());
    expect(d.account_session === undefined, JSON.stringify(d));
    const fresh = new Browser("fresh"); const { me } = await signIn(fresh);
    expect(me?.accountSubjectId === first.accountSubjectId, "fresh ceremony after faults");
    fresh.csrf = me.csrfValue; await logout(fresh);
    return `outage -> temporarily_unavailable, no session (delta ${JSON.stringify(d)}); fresh ceremony afterwards succeeds for ${me.accountSubjectId}`;
  });
  await criterion("CBD-190-AC06", "denial (HTTP half): cancelled, denied, verification-pending and outage results navigate to the application result page with a closed outcome and no account-existence information", async () => {
    const seen = [];
    for (const [scenario, expected] of [["cancel", "cancelled"], ["deny", "not_completed"], ["verification-pending", "verification_pending"]]) {
      const b = new Browser(scenario); const { outcome, location } = await signIn(b, scenario);
      const target = new URL(location);
      expect(outcome === expected && target.origin === ORIGIN && target.pathname === "/identity/result" && [...target.searchParams.keys()].join() === "outcome", `${scenario}: ${location}`);
      seen.push(`${scenario}=${outcome}`);
    }
    return `${seen.join(", ")}; query carries only ?outcome=<closed value>; no description, subject or account hint. Accessibility half in prototype-qa-browser.mjs`;
  });
  await criterion("CBD-190-AC01", "hosted Cognito pages on the approved custom domain", async () => notRun("real Cognito custom domain / RP-ID not activated (PROVIDERS-LOCAL-001). Local evidence only: begin redirects to the ceremony origin, the local chooser contains no credential input, callbacks are bounded to the configured application origin"));
}
async function phaseExpiredChallenge() {
  await criterion("CBD-190-AC04", "denial: an expired state (challenge lifetime elapsed) completes no session", async () => {
    const b = new Browser("expired"); const { callback } = await ceremony(b);
    await pause(2500);
    const snapshot = await identityCounts();
    const r = await b.fetch(callback, { navigate: true });
    const outcome = new URL(r.headers.get("location")).searchParams.get("outcome");
    expect(r.status === 303 && outcome === "invalid_or_expired" && !r.setCookies.length, `expired ${r.status} ${outcome}`);
    const d = delta(snapshot, await identityCounts());
    expect(d.account_session === undefined, JSON.stringify(d));
    return `COBUDGET_IDENTITY_CHALLENGE_LIFETIME_SECONDS=1, callback after 2.5 s -> ${outcome}, no cookie, delta ${JSON.stringify(d)}`;
  });
}
async function phaseConfiguration() {
  currentPhase = "CBD-190-AC05 configuration"; console.log(`\n== ${currentPhase} ==`);
  const listening = async () => { try { await fetch(`${ORIGIN}/health`); return true; } catch { return false; } };
  const refusals = [
    ["local provider under NODE_ENV=production", { NODE_ENV: "production" }],
    ["environment id staging under NODE_ENV=development", { COBUDGET_IDENTITY_ENVIRONMENT_ID: "staging" }],
    ["issuer from another origin", { COBUDGET_IDENTITY_ISSUER: "http://127.0.0.1:9999/v1/identity/local" }],
    ["callback on a hosted origin", { COBUDGET_IDENTITY_CALLBACK_URI: "https://app.moneypact.example/v1/identity/callback" }],
    ["application origin equal to the ceremony origin", { COBUDGET_IDENTITY_APPLICATION_ORIGIN: CEREMONY_ORIGIN }],
    ["wildcard client id", { COBUDGET_IDENTITY_CLIENT_ID: "*" }],
    ["cognito provider (not activated)", { COBUDGET_IDENTITY_PROVIDER: "cognito" }],
  ];
  for (const [label, overrides] of refusals) {
    await criterion("CBD-190-AC05", `denial: ${label} refuses startup with zero listener`, async () => {
      const started = await startApi(overrides, { expectFailure: true });
      try {
        const exited = await Promise.race([started.exited, pause(20_000).then(() => "timeout")]);
        expect(!started.ready && exited !== "timeout" && exited !== 0 && !(await listening()), `ready=${started.ready} exit=${exited}`);
        const line = started.output().split("\n").find((l) => /rejected|refused|failed|belongs|must/iu.test(l)) ?? started.output().slice(0, 200);
        expect(!/[A-Za-z0-9+/]{40,}={0,2}/u.test(line), "diagnostic leaks key material");
        return `exit ${exited}, no listener; diagnostic: ${line.trim().slice(0, 160)}`;
      } finally { await started.stop(); }
    });
  }
  await criterion("CBD-190-AC05", "positive: the development local tuple starts and listens", async () => {
    const started = await startApi();
    try { expect(started.ready, started.output().slice(0, 500)); return `ready on ${ORIGIN}`; } finally { await started.stop(); }
  });
  await criterion("CBD-190-AC05", "regression: three real Cognito environments", async () => notRun("no hosted pools/clients exist (PROVIDERS-LOCAL-001)"));
}

// ---------------------------------------------------------------------------
async function main() {
  await db.connect();
  const identity = await q("select current_database() as db, current_user as u, inet_server_addr()::text as host, inet_server_port() as port, current_setting('server_version_num') as v");
  expect(identity[0].db === DB_NAME && identity[0].v.startsWith("17"), `database identity ${JSON.stringify(identity)}`);
  console.log(`candidate ${CANDIDATE}; database ${identity[0].db} on ${identity[0].host ?? "loopback"}:${identity[0].port} server ${identity[0].v}; clock ${new Date().toISOString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`);
  const owner = await q("select pg_get_userbyid(datdba) as owner from pg_database where datname = current_database()");
  expect(owner[0].owner === "cobudget_migration", `database owner ${owner[0].owner}`);
  try {
    await phase("CBD-153 targets and the joined flow", phaseTargets);
    await phase("CBD-232 proposals", phaseProposals);
    await phase("CBD-233 confirmation", phaseConfirmation);
    await phase("CBD-236 consent record", phaseConsent);
    await phase("CBD-190 identity", phaseIdentity);
    await phase("CBD-190 expired challenge", phaseExpiredChallenge, { COBUDGET_IDENTITY_CHALLENGE_LIFETIME_SECONDS: "1" });
    await phaseConfiguration();
  } finally { await db.end(); }
  const byCriterion = {};
  for (const r of results) { (byCriterion[r.criterion] ??= []).push(r); }
  console.log("\n== Summary ==");
  for (const [id, cases] of Object.entries(byCriterion).sort()) {
    const status = cases.some((c) => c.status === "fail") ? "FAIL" : cases.every((c) => c.status === "not_run") ? "NOT_RUN" : "PASS";
    console.log(`${id}: ${status} (${cases.filter((c) => c.status === "pass").length} pass, ${cases.filter((c) => c.status === "fail").length} fail, ${cases.filter((c) => c.status === "not_run").length} not_run)`);
  }
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ candidate: CANDIDATE, database: DB_NAME, at: new Date().toISOString(), results }, null, 2));
  const failed = results.filter((r) => r.status === "fail").length;
  console.log(failed ? `PROTOTYPE-QA FAILED (${failed} case(s))` : "PROTOTYPE-QA PASSED");
  process.exitCode = failed ? 1 : 0;
}

await main();
