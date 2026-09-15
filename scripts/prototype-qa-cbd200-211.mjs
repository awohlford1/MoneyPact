#!/usr/bin/env node
/* global fetch, setTimeout, URL */
/**
 * PROTO-QA-CBD200-211-001: one executable case per live Jira acceptance
 * criterion of CBD-200 (manual-transaction mutation and recalculation
 * lifecycle) and CBD-211 (category progress and reconciled drill-downs),
 * driven through the fully composed API process (NestJS on Fastify, the
 * fail-closed authorization boundary, the local identity adapter) on a fresh
 * scratch PostgreSQL database.
 *
 *   node scripts/prototype-qa-cbd200-211.mjs --db <scratch> [--port 3103] [--json out.json]
 *
 * The criterion texts are the ones read from Jira customfield_10066 on
 * 2026-09-15; each case names the criterion it exercises and reports the
 * values it observed. A failed case is a finding with its reproduction and
 * the run continues; nothing here changes product code. The browser halves
 * of the CBD-211 presentation criteria live in
 * scripts/prototype-qa-browser-cbd211.mjs.
 *
 * PROTO-CBD200-CONCURRENCY-IDEMPOTENCY-001 (Executive decision 2026-09-16 on
 * QA-F01, F02, F03): the CBD-200-AC04 and AC05 cases are the acceptance proof
 * of the version precondition, the conflict mapping and the idempotency
 * store. The concurrent AC04 case has two halves, because the merged
 * CBD-266 mutation surface (`rlp-266-mutation-v1`, `concurrency=1`) admits
 * one in-flight mutation per verified actor and refuses the rest at the
 * surface gate before authorization: six simultaneous edits by one Primary
 * Owner therefore prove the gate, and the effect-level race is proved
 * against a writer the gate cannot see -- a second transaction on the
 * database standing in for a second API process.
 *
 * Same harness shape as scripts/prototype-qa-criteria.mjs (cookie-jar
 * browser, local ceremony, CBD-266 pacing) without that script's phases, so
 * the Manager can run this one alone in a few minutes.
 */
import { execFileSync, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadLocalDatabaseConfigFrom } from "../packages/migrations/src/local-config.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
function argument(name, fallback) { const index = process.argv.indexOf(name); return index === -1 ? fallback : process.argv[index + 1]; }
const PORT = Number(argument("--port", "3103"));
const ORIGIN = `http://127.0.0.1:${PORT}`;
const CEREMONY_ORIGIN = `http://localhost:${PORT}`;
const DB_NAME = argument("--db", undefined);
const JSON_OUT = argument("--json", undefined);
if (!DB_NAME || DB_NAME === "cobudget_dev" || DB_NAME === "cobudget_demo") { console.error("--db must name a migrated scratch database (never cobudget_dev or cobudget_demo)"); process.exit(2); }
const CANDIDATE = (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); } catch { return "unknown"; } })();

/** Per-run key material; never written anywhere. */
const KEYS = { field: randomBytes(32).toString("base64"), pepper: randomBytes(32).toString("base64"), envelope: randomBytes(32).toString("base64") };
function environment() {
  return {
    COBUDGET_DB_NAME: DB_NAME,
    NODE_ENV: "development", LOG_LEVEL: "info", SERVICE_VERSION: "prototype-qa-cbd200-211", API_PORT: String(PORT), API_LISTEN_ADDRESS: "127.0.0.1",
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
  };
}

// ---------------------------------------------------------------------------
// Result ledger
// ---------------------------------------------------------------------------
const results = [];
class Expectation extends Error {}
class Blocked extends Error {}
function expect(condition, message) { if (!condition) throw new Expectation(message); }
const blocked = (reason) => { throw new Blocked(reason); };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function criterion(id, name, fn) {
  const started = new Date().toISOString();
  try {
    const detail = await fn();
    results.push({ criterion: id, case: name, status: "pass", detail: detail ?? "", at: started });
    console.log(`[${id}] PASS ${name}${detail ? `: ${detail}` : ""}`);
  } catch (error) {
    const status = error instanceof Blocked ? "blocked" : "fail";
    results.push({ criterion: id, case: name, status, detail: error.message, at: started });
    console.log(`[${id}] ${status.toUpperCase()} ${name}: ${error.message}`);
    if (status === "fail" && !(error instanceof Expectation)) console.log(error.stack);
  }
}

// ---------------------------------------------------------------------------
// Database (bootstrap superuser on the scratch database only)
// ---------------------------------------------------------------------------
pg.types.setTypeParser(1082, (value) => value);
const bootstrapDefaults = { COBUDGET_DB_NAME: DB_NAME, COBUDGET_DB_PORT: "5432", COBUDGET_DB_SUPERUSER: "postgres" };
bootstrapDefaults.COBUDGET_DB_SUPERUSER_PASSWORD = ["local", "only", "superuser"].join("-");
const localDb = loadLocalDatabaseConfigFrom(bootstrapDefaults);
const dbConnection = { host: "127.0.0.1", port: localDb.port, database: DB_NAME, user: localDb.superuser };
const { superuserPassword: pw } = localDb;
dbConnection.password = pw;
const db = new pg.Client(dbConnection);
const q = async (text, values = []) => (await db.query(text, values)).rows;
const count = async (table, where = "true", values = []) => Number((await q(`select count(*)::int as n from ${table} where ${where}`, values))[0].n);

// ---------------------------------------------------------------------------
// Browser-shaped client, CBD-266 pacing, the local ceremony
// ---------------------------------------------------------------------------
const mutationLog = new Map(); const readLog = new Map();
const recent = (log, key, window = 61_000) => { const now = Date.now(); const kept = (log.get(key) ?? []).filter((t) => now - t < window); log.set(key, kept); return kept; };
/** rlp-266-mutation-v1 admits 12 (+3 burst) mutations per actor per minute; the read record 60 per minute. */
async function roomFor(key, n, log = mutationLog, limit = 13) {
  for (;;) {
    const kept = recent(log, key);
    if (kept.length + n <= limit) return;
    const wait = 61_000 - (Date.now() - kept[0]) + 250;
    console.log(`   (pacing ${key}: waiting ${Math.ceil(wait / 1000)} s for ${n} more ${log === mutationLog ? "mutation" : "read"}(s))`);
    await pause(wait);
  }
}
class Browser {
  cookies = new Map(); csrf = undefined; label; subject;
  constructor(label = "browser") { this.label = label; }
  async fetch(path, { method = "GET", body, rawBody, headers = {}, navigate = false, origin = ORIGIN, unpaced = false } = {}) {
    const key = this.subject ?? this.label;
    const target = new URL(path.startsWith("http") ? path : `${ORIGIN}${path}`);
    if (!unpaced && method !== "GET" && !path.startsWith("/v1/identity")) { await roomFor(key, 1); recent(mutationLog, key).push(Date.now()); }
    if (!unpaced && method === "GET" && target.pathname.startsWith("/v1/budget-")) { await roomFor(key, 1, readLog, 55); recent(readLog, key).push(Date.now()); }
    const request = { method, redirect: "manual", headers: { ...headers } };
    if (this.cookies.size) request.headers.cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    if (body !== undefined) { request.headers["content-type"] = "application/json"; request.body = JSON.stringify(body); }
    if (rawBody !== undefined) { request.headers["content-type"] = "application/json"; request.body = rawBody; }
    if (method !== "GET") { request.headers.origin = origin; request.headers["sec-fetch-site"] = "same-origin"; if (this.csrf && !("x-cobudget-csrf" in headers)) request.headers["x-cobudget-csrf"] = this.csrf; }
    if (navigate) { request.headers["sec-fetch-mode"] = "navigate"; request.headers.accept = "text/html"; } else request.headers.accept = "application/json";
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
async function signIn(browser, scenario = "subject-a") {
  const begin = await browser.fetch("/v1/identity/begin", { method: "POST", body: { ceremony: "sign_in", postResultDestinationId: "home" } });
  expect(begin.status === 200 && typeof begin.json?.navigateTo === "string", `begin returned ${begin.status} ${begin.text}`);
  const hosted = await browser.fetch(begin.json.navigateTo, { navigate: true });
  expect(hosted.status === 200, `hosted authorize returned ${hosted.status}`);
  const request = /request=([^&"]+)/.exec(hosted.text);
  expect(request, "no chooser request id in the hosted page");
  const chosen = await browser.fetch(`${CEREMONY_ORIGIN}/v1/identity/local/choose?request=${request[1]}&scenario=${scenario}`, { navigate: true });
  expect(chosen.status === 303, `chooser returned ${chosen.status} ${chosen.text}`);
  const completed = await browser.fetch(chosen.headers.get("location"), { navigate: true });
  expect(completed.status === 303 && browser.cookies.has("__Host-cobudget_session"), `callback returned ${completed.status}`);
  const me = await browser.fetch("/v1/identity/me");
  expect(me.status === 200 && typeof me.json?.csrfValue === "string", `/me returned ${me.status} ${me.text}`);
  browser.csrf = me.json.csrfValue; browser.subject = me.json.accountSubjectId;
  return me.json;
}
const monthly = (name) => ({ name, timeZone: "America/New_York", currencyCode: "USD", schedule: { cadence: "monthly", anchor: { kind: "day-of-month", day: 1 } } });
async function createBudget(browser, draft) {
  const proposed = await browser.fetch("/v1/budget-creation-proposals", { method: "POST", body: draft, headers: { "idempotency-key": randomUUID() } });
  expect(proposed.status === 201, `proposal returned ${proposed.status} ${proposed.text}`);
  const proposal = proposed.json;
  const disclosure = proposal.currentDisclosure ? { kind: proposal.currentDisclosure.kind, version: proposal.currentDisclosure.version } : { kind: "primary_owner_self", version: 1 };
  const confirmed = await browser.fetch(`/v1/budget-creation-proposals/${proposal.proposalId}/confirm`, { method: "POST", body: { confirmationBinding: proposal.confirmationBinding, acknowledgedDisclosure: disclosure }, headers: { "idempotency-key": randomUUID() } });
  expect(confirmed.status === 201, `confirm returned ${confirmed.status} ${confirmed.text}`);
  return confirmed.json;
}
async function categories(browser, spaceId, labels) {
  const put = await browser.fetch(`/v1/budget-spaces/${spaceId}/categories`, { method: "PUT", body: { categories: labels.map((label) => ({ label })) } });
  expect(put.status === 200, `categories returned ${put.status} ${put.text}`);
  return put.json.categories;
}
async function targets(browser, spaceId, items) {
  const put = await browser.fetch(`/v1/budget-spaces/${spaceId}/targets`, { method: "PUT", body: { targets: items } });
  expect(put.status === 200, `targets returned ${put.status} ${put.text}`);
  return put.json;
}

// ---------------------------------------------------------------------------
// API process
// ---------------------------------------------------------------------------
async function startApi() {
  let foreign = false; try { await fetch(`${ORIGIN}/health`); foreign = true; } catch { /* free */ }
  if (foreign) throw new Error(`port ${PORT} is already served by another process; refusing to run against it`);
  const api = spawn(process.execPath, ["--import=tsx", "src/main.ts"], { cwd: join(root, "apps/api"), env: environment(), stdio: ["ignore", "pipe", "pipe"] });
  const exited = new Promise((resolve) => api.once("exit", (code) => resolve(code ?? "signal")));
  let output = ""; api.stdout.on("data", (chunk) => { output = (output + chunk).slice(-8000); }); api.stderr.on("data", (chunk) => { output = (output + chunk).slice(-8000); });
  const deadline = Date.now() + 90_000; let ready = false;
  while (Date.now() < deadline && !ready && api.exitCode === null) {
    try {
      if ((await fetch(`${ORIGIN}/health`)).status === 200) {
        const probe = await fetch(`${ORIGIN}/v1/identity/begin`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
        ready = probe.status !== 404;
      }
    } catch { /* not yet */ }
    if (!ready) await pause(250);
  }
  expect(ready, `API did not become ready: ${output}`);
  return { stop: async () => { if (api.exitCode === null) { api.kill(); await exited; } }, output: () => output };
}

// ---------------------------------------------------------------------------
// Shared helpers over the routes under test
// ---------------------------------------------------------------------------
const cellOf = (body, categoryId) => body.cells.find((cell) => cell.categoryId === categoryId);
const FOUR = ["settledActualMinorUnits", "pendingProvisionalImpactMinorUnits", "remainingAfterSettledMinorUnits", "remainingAfterPendingMinorUnits"];
const four = (cell) => Object.fromEntries(FOUR.map((k) => [k, cell[k]]));
const versionsOf = (transactionId) => q("select revision, superseded_at, removed_at, amount_minor_units::int as amount, budget_date, account_id, period_id from manual_transaction where transaction_id = $1 order by revision", [transactionId]);

// ---------------------------------------------------------------------------
// CBD-200: manual-transaction mutation and recalculation lifecycle
// ---------------------------------------------------------------------------
async function cbd200(browser, world) {
  const { spaceId, periodId, nextPeriodId, budgetDate, nextBudgetDate, accountId, secondAccountId, groceries, transport, rent } = world;
  const transactions = `/v1/budget-spaces/${spaceId}/transactions`;
  const progress = (period = periodId) => browser.fetch(`/v1/budget-spaces/${spaceId}/periods/${period}/progress`);
  const detail = (category, period = periodId) => browser.fetch(`/v1/budget-spaces/${spaceId}/periods/${period}/progress/${category}`);
  const write = (overrides = {}) => ({ accountId, amountMinorUnits: -1_250, budgetDate, description: "Corner shop", allocations: [{ categoryId: groceries, amountMinorUnits: -800 }, { categoryId: transport, amountMinorUnits: -450 }], ...overrides });
  let transactionId; let rentTransactionId;

  await criterion("CBD-200-AC01", "Creating a manual transaction applies its signed allocation effect once to the supplied period/category calculations", async () => {
    const before = await progress();
    expect(before.status === 200, `progress ${before.status} ${before.text}`);
    expect(four(cellOf(before.json, groceries)).settledActualMinorUnits === 0 && four(cellOf(before.json, transport)).settledActualMinorUnits === 0, `cells not empty before: ${JSON.stringify(before.json.cells)}`);
    const recorded = await browser.fetch(transactions, { method: "POST", body: write() });
    expect(recorded.status === 201, `record ${recorded.status} ${recorded.text}`);
    transactionId = recorded.json.current.version.transactionId; world.transactionId = transactionId;
    expect(recorded.json.current.version.revision === 1 && recorded.json.previous === null, "first revision");
    const after = await progress();
    const g = cellOf(after.json, groceries); const t = cellOf(after.json, transport); const r = cellOf(after.json, rent);
    expect(g.settledActualMinorUnits === -800 && g.remainingAfterSettledMinorUnits === 50_000 - 800, `groceries applied once: ${JSON.stringify(four(g))}`);
    expect(t.settledActualMinorUnits === -450 && t.remainingAfterSettledMinorUnits === 20_000 - 450, `transport applied once: ${JSON.stringify(four(t))}`);
    expect(r.settledActualMinorUnits === 0 && r.remainingAfterSettledMinorUnits === 100_000, `rent untouched: ${JSON.stringify(four(r))}`);
    expect(g.settledRecordIds.length === 1 && t.settledRecordIds.length === 1, "each cell counts exactly one settled record");
    // A second read applies nothing again.
    const again = await progress();
    expect(JSON.stringify(cellOf(again.json, groceries)) === JSON.stringify(g), "a repeated read changes the cell");
    // A second, independent expense on Rent so the later criteria can prove unaffected cells stay unchanged.
    const rentRecorded = await browser.fetch(transactions, { method: "POST", body: write({ amountMinorUnits: -30_000, description: "September rent", allocations: [{ categoryId: rent, amountMinorUnits: -30_000 }] }) });
    expect(rentRecorded.status === 201, `rent ${rentRecorded.status} ${rentRecorded.text}`);
    rentTransactionId = rentRecorded.json.current.version.transactionId;
    const rows = await q("select count(*)::int as n from transaction_allocation where budget_space_id = $1", [spaceId]);
    expect(rows[0].n === 3, `three allocation rows expected, ${rows[0].n} found`);
    return `POST 201 revision 1; groceries settled -800 remaining 49200, transport settled -450 remaining 19550, rent untouched at 0 / 100000; one settled record per cell; a repeated read is identical`;
  });

  await criterion("CBD-200-AC02", "Editing date, amount, account, or allocations atomically removes every prior effect and applies every new effect; unaffected periods/categories remain unchanged", async () => {
    const rentBefore = cellOf((await progress()).json, rent);
    // 1. amount + allocations: -1250 split 800/450 becomes -2000 wholly on Groceries.
    const edit1 = await browser.fetch(`${transactions}/${transactionId}`, { method: "PATCH", body: write({ amountMinorUnits: -2_000, description: "Corner shop, corrected", allocations: [{ categoryId: groceries, amountMinorUnits: -2_000 }] }) });
    expect(edit1.status === 200 && edit1.json.current.version.revision === 2, `edit 1 ${edit1.status} ${edit1.text}`);
    let now = (await progress()).json;
    expect(cellOf(now, groceries).settledActualMinorUnits === -2_000, `groceries after amount/allocation edit: ${JSON.stringify(four(cellOf(now, groceries)))}`);
    expect(cellOf(now, transport).settledActualMinorUnits === 0 && cellOf(now, transport).remainingAfterSettledMinorUnits === 20_000, `transport's prior -450 was not removed: ${JSON.stringify(four(cellOf(now, transport)))}`);
    expect(cellOf(now, groceries).settledRecordIds.length === 1, "the superseded allocation still counts");
    // 2. account: the effect on the categories is unchanged, the version carries the new account.
    const edit2 = await browser.fetch(`${transactions}/${transactionId}`, { method: "PATCH", body: write({ accountId: secondAccountId, amountMinorUnits: -2_000, allocations: [{ categoryId: groceries, amountMinorUnits: -2_000 }] }) });
    expect(edit2.status === 200 && edit2.json.current.version.revision === 3 && edit2.json.current.version.accountId === secondAccountId, `edit 2 ${edit2.status} ${edit2.text}`);
    now = (await progress()).json;
    expect(cellOf(now, groceries).settledActualMinorUnits === -2_000, "an account change keeps the category effect");
    // 3. date into the next period: the effect leaves this period and appears in the next, once.
    const edit3 = await browser.fetch(`${transactions}/${transactionId}`, { method: "PATCH", body: write({ accountId: secondAccountId, amountMinorUnits: -2_000, budgetDate: nextBudgetDate, allocations: [{ categoryId: groceries, amountMinorUnits: -2_000 }] }) });
    expect(edit3.status === 200 && edit3.json.current.version.revision === 4 && edit3.json.current.version.periodId === nextPeriodId, `edit 3 ${edit3.status} ${edit3.text}`);
    now = (await progress()).json;
    expect(cellOf(now, groceries).settledActualMinorUnits === 0 && cellOf(now, groceries).remainingAfterSettledMinorUnits === 50_000, `the moved expense still counts in the old period: ${JSON.stringify(four(cellOf(now, groceries)))}`);
    const next = await progress(nextPeriodId);
    expect(next.status === 200, `next period progress ${next.status} ${next.text}`);
    expect(cellOf(next.json, groceries).settledActualMinorUnits === -2_000 && cellOf(next.json, groceries).settledRecordIds.length === 1, `next period: ${JSON.stringify(four(cellOf(next.json, groceries)))}`);
    // 4. back to this period with the original split so the CBD-211 cases see the -800/-450 shape again.
    const edit4 = await browser.fetch(`${transactions}/${transactionId}`, { method: "PATCH", body: write() });
    expect(edit4.status === 200 && edit4.json.current.version.revision === 5, `edit 4 ${edit4.status} ${edit4.text}`);
    now = (await progress()).json;
    expect(cellOf(now, groceries).settledActualMinorUnits === -800 && cellOf(now, transport).settledActualMinorUnits === -450, "the original split is back");
    expect(cellOf((await progress(nextPeriodId)).json, groceries).settledActualMinorUnits === 0, "the next period is empty again");
    // Unaffected category: Rent never moved.
    expect(JSON.stringify(four(cellOf(now, rent))) === JSON.stringify(four(rentBefore)) && JSON.stringify(four(rentBefore)) === JSON.stringify({ settledActualMinorUnits: -30_000, pendingProvisionalImpactMinorUnits: 0, remainingAfterSettledMinorUnits: 70_000, remainingAfterPendingMinorUnits: 70_000 }), `rent changed: ${JSON.stringify(four(cellOf(now, rent)))}`);
    // Atomicity on disk: exactly one current version, every prior version retained with its own allocation set.
    const versions = await versionsOf(transactionId);
    expect(versions.length === 5 && versions.filter((v) => v.superseded_at === null).length === 1 && versions[4].superseded_at === null, `versions: ${JSON.stringify(versions)}`);
    const allocationCounts = await q("select mt.revision, count(ta.allocation_id)::int as n from manual_transaction mt left join transaction_allocation ta on ta.transaction_version_id = mt.transaction_version_id where mt.transaction_id = $1 group by mt.revision order by mt.revision", [transactionId]);
    expect(JSON.stringify(allocationCounts.map((r) => r.n)) === JSON.stringify([2, 1, 1, 1, 2]), `allocation sets per revision: ${JSON.stringify(allocationCounts)}`);
    // A refused edit (inexact split) leaves the current version and every cell untouched.
    const refused = await browser.fetch(`${transactions}/${transactionId}`, { method: "PATCH", body: write({ allocations: [{ categoryId: groceries, amountMinorUnits: -1_000 }] }) });
    expect(refused.status === 400 && refused.json.error === "allocation_sum_mismatch", `refused edit ${refused.status} ${refused.text}`);
    expect((await versionsOf(transactionId)).length === 5, "a refused edit wrote a version");
    expect(JSON.stringify(four(cellOf((await progress()).json, groceries))) === JSON.stringify(four(cellOf(now, groceries))), "a refused edit changed a cell");
    return `amount+allocations (rev 2): groceries -2000, transport back to 0; account (rev 3): effect unchanged; date into the next period (rev 4): this period 0, next period -2000 once; back (rev 5): -800/-450; rent -30000/70000 throughout; 5 versions, 1 current, allocation sets 2,1,1,1,2; an inexact edit is 400 allocation_sum_mismatch and writes nothing`;
  });

  await criterion("CBD-200-AC03", "Removing a transaction immediately excludes it from ordinary reads and calculations while preserving authorized audit and required retention/tombstone evidence", async () => {
    const detailBefore = (await detail(rent)).json;
    expect(detailBefore.items.length === 1 && detailBefore.items[0].transactionId === rentTransactionId, `rent detail before: ${JSON.stringify(detailBefore.items)}`);
    const allocationsBefore = await count("transaction_allocation", "budget_space_id = $1", [spaceId]);
    const removed = await browser.fetch(`${transactions}/${rentTransactionId}/remove`, { method: "POST", body: {} });
    expect(removed.status === 201 && removed.json.current.version.removedAt !== null && removed.json.current.allocations.length === 0, `remove ${removed.status} ${removed.text}`);
    expect(removed.json.current.version.removedBySubjectId === browser.subject, "the tombstone names the remover");
    // Ordinary reads: the aggregate and the detail exclude it at once.
    const now = (await progress()).json;
    expect(cellOf(now, rent).settledActualMinorUnits === 0 && cellOf(now, rent).remainingAfterSettledMinorUnits === 100_000 && cellOf(now, rent).settledRecordIds.length === 0, `rent after removal: ${JSON.stringify(four(cellOf(now, rent)))}`);
    const detailAfter = (await detail(rent)).json;
    expect(detailAfter.items.length === 0 && detailAfter.cell.settledActualMinorUnits === 0, `rent detail after: ${JSON.stringify(detailAfter.items)}`);
    // Retention: the tombstone is a version, nothing is deleted, the prior allocations are still on disk, and history still reads.
    const versions = await versionsOf(rentTransactionId);
    expect(versions.length === 2 && versions[0].superseded_at !== null && versions[1].removed_at !== null && versions[1].superseded_at === null, `versions: ${JSON.stringify(versions)}`);
    expect(await count("transaction_allocation", "budget_space_id = $1", [spaceId]) === allocationsBefore, "removal deleted allocation rows");
    const history = await browser.fetch(`${transactions}/${rentTransactionId}/history`);
    expect(history.status === 200 && history.json.history.length === 2 && history.json.history[1].version.removedAt !== null && history.json.history[0].allocations.length === 1, `history ${history.status} ${history.text}`);
    // Further mutation of a removed identity is refused, and a second removal too.
    const again = await browser.fetch(`${transactions}/${rentTransactionId}/remove`, { method: "POST", body: {} });
    expect(again.status === 409 && again.json.error === "transaction_removed", `second removal ${again.status} ${again.text}`);
    const editRemoved = await browser.fetch(`${transactions}/${rentTransactionId}`, { method: "PATCH", body: write({ allocations: [{ categoryId: rent, amountMinorUnits: -1_250 }] }) });
    expect(editRemoved.status === 409 && editRemoved.json.error === "transaction_removed", `edit of a removed transaction ${editRemoved.status} ${editRemoved.text}`);
    // The database refuses mutation of history: an UPDATE of the retained version's amount and a DELETE of the tombstone.
    let deleteState = null; try { await q("delete from manual_transaction where transaction_id = $1 and revision = 2", [rentTransactionId]); } catch (error) { deleteState = error.code; }
    let updateState = null; try { await q("update manual_transaction set amount_minor_units = 1 where transaction_id = $1 and revision = 1", [rentTransactionId]); } catch (error) { updateState = error.code; }
    expect(deleteState === "55000" && updateState === "55000", `DELETE of the tombstone -> ${deleteState}; UPDATE of history -> ${updateState} (expected 55000 for both)`);
    return `remove 201 as revision 2 with no allocations and the remover named; aggregate rent 0/100000 and detail empty at once; both versions and the prior allocation row retained; history 200 with 2 entries; second remove and edit 409 transaction_removed; DELETE and UPDATE of history refused by the database with SQLSTATE 55000. Authorization audit: the allow event is written to the API's in-process restricted audit stream, which has no external read surface (inferred from apps/api/src/authorization/boundary.ts, not observed here)`;
  });

  await criterion("CBD-200-AC04", "A stale mutation commits no transaction or calculation change and returns a reload-and-retry result (stale client view: two clients read revision 5, one edits, the other mutates from its stale view)", async () => {
    const second = new Browser("client-b"); await signIn(second, "subject-a");
    expect(second.subject === browser.subject, "the second browser is the same Primary Owner");
    const viewA = (await browser.fetch(`${transactions}/${transactionId}/history`)).json;
    const viewB = (await second.fetch(`${transactions}/${transactionId}/history`)).json;
    const currentOf = (view) => view.history.find((entry) => entry.version.supersededAt === null).version;
    expect(currentOf(viewA).revision === 5 && currentOf(viewB).revision === 5, `both clients start at revision 5: ${currentOf(viewA).revision}/${currentOf(viewB).revision}`);
    const staleVersionId = currentOf(viewB).transactionVersionId;
    // Client A moves the transaction on.
    const editA = await browser.fetch(`${transactions}/${transactionId}`, { method: "PATCH", body: write({ amountMinorUnits: -900, description: "A's correction", allocations: [{ categoryId: groceries, amountMinorUnits: -900 }] }) });
    expect(editA.status === 200 && editA.json.current.version.revision === 6, `A's edit ${editA.status} ${editA.text}`);
    const cellsAfterA = four(cellOf((await progress()).json, groceries));
    // Client B mutates from its stale revision-5 view. Every way the client could state its basis is tried:
    // the revision and version id it saw in the body, and an If-Match header carrying the version id.
    const staleBody = { ...write({ amountMinorUnits: -700, description: "B's stale correction", allocations: [{ categoryId: transport, amountMinorUnits: -700 }] }), expectedRevision: 5, expectedTransactionVersionId: staleVersionId };
    const editB = await second.fetch(`${transactions}/${transactionId}`, { method: "PATCH", body: staleBody, headers: { "if-match": `"${staleVersionId}"` } });
    const versionsAfterB = await versionsOf(transactionId);
    const cellsAfterB = { groceries: four(cellOf((await progress()).json, groceries)), transport: four(cellOf((await progress()).json, transport)) };
    const observed = `B's stale PATCH (basis revision 5 / version ${staleVersionId.slice(0, 8)} stated in the body and in If-Match) answered ${editB.status} ${editB.text.slice(0, 200)}; versions on disk: ${versionsAfterB.length} (${versionsAfterB.map((v) => `${v.revision}${v.superseded_at === null ? "*" : ""}`).join(",")}); groceries ${JSON.stringify(cellsAfterA)} -> ${JSON.stringify(cellsAfterB.groceries)}; transport ${JSON.stringify(cellsAfterB.transport)}`;
    expect(editB.status === 409 || editB.status === 412 || editB.status === 428, `expected the stale mutation to be refused with a reload-and-retry result; ${observed}`);
    expect(versionsAfterB.length === 6, `expected no new version from the stale mutation; ${observed}`);
    return observed;
  });

  await criterion("CBD-200-AC04", "A stale mutation commits no transaction or calculation change and returns a reload-and-retry result (concurrent: six simultaneous edits of one current version; the losers reload and retry)", async () => {
    const current = (await versionsOf(transactionId)).find((v) => v.superseded_at === null);
    // Part 1: six simultaneous edits by one actor. The CBD-266 surface admits one in flight per actor;
    // the rest are refused at the gate with nothing consumed, evaluated or written.
    const before = await progress();
    await roomFor(browser.subject, 7);
    const attempts = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => browser.fetch(`${transactions}/${transactionId}`, { method: "PATCH", unpaced: true, body: write({ amountMinorUnits: -1_000 - i, description: `racer ${i}`, allocations: [{ categoryId: groceries, amountMinorUnits: -1_000 - i }] }) })));
    for (let i = 0; i < 6; i += 1) recent(mutationLog, browser.subject).push(Date.now());
    const statuses = attempts.map((a) => `${a.status}${a.json?.error ? ` ${a.json.error}` : a.json?.reason ? ` ${a.json.reason}` : ""}`);
    const winners = attempts.filter((a) => a.status === 200);
    const versions = await versionsOf(transactionId);
    const currentAfter = versions.filter((v) => v.superseded_at === null);
    const after = await progress();
    const summary = `statuses ${JSON.stringify(statuses)}; versions ${versions.length} (was ${current.revision}), current ${currentAfter.length}; groceries ${JSON.stringify(four(cellOf(before.json, groceries)))} -> ${JSON.stringify(four(cellOf(after.json, groceries)))}`;
    expect(winners.length >= 1, `no edit succeeded: ${summary}`);
    expect(currentAfter.length === 1, `more than one current version: ${summary}`);
    expect(versions.length === current.revision + winners.length, `a refused edit still wrote a version: ${summary}`);
    const revisions = versions.map((v) => v.revision); expect(JSON.stringify(revisions) === JSON.stringify(revisions.map((_, i) => i + 1)), `revisions not contiguous: ${summary}`);
    expect(cellOf(after.json, groceries).settledActualMinorUnits === currentAfter[0].amount && cellOf(after.json, groceries).settledRecordIds.length === 1, `the aggregate does not match the single current version: ${summary}`);
    const losers = attempts.filter((a) => a.status !== 200);
    // A loser reloads and retries against the current version: it succeeds and writes exactly one more revision.
    const reloaded = (await browser.fetch(`${transactions}/${transactionId}/history`)).json.history.find((entry) => entry.version.supersededAt === null).version;
    expect(reloaded.revision === versions.length, "reload sees the committed revision");
    const retry = await browser.fetch(`${transactions}/${transactionId}`, { method: "PATCH", body: write({ amountMinorUnits: -1_250, description: "retried after reload", allocations: [{ categoryId: groceries, amountMinorUnits: -800 }, { categoryId: transport, amountMinorUnits: -450 }] }) });
    expect(retry.status === 200 && retry.json.current.version.revision === reloaded.revision + 1, `retry ${retry.status} ${retry.text}`);
    const gated = losers.filter((a) => a.status === 403);
    const conflicted = losers.filter((a) => a.status === 409 && (a.json?.error === "conflict" || a.json?.error === "stale_version"));
    expect(gated.length + conflicted.length === losers.length, `expected every loser to be either the CBD-266 surface refusal (403, concurrency=1, before authorization) or a canonical 409 conflict/stale_version; ${summary}; losers ${JSON.stringify(losers.map((a) => `${a.status} ${a.text.slice(0, 80)}`))}`);

    // Part 2: the effect-level race the gate cannot fence. A second writer -- this script's own
    // superuser connection, standing in for a second API process -- supersedes the current version
    // and holds the row lock uncommitted. The API's edit passes the surface gate, the precheck and
    // the commit-window recheck (all of which see the still-current version), then blocks at its
    // supersession stamp until the writer commits, at which point the database refuses it as the
    // loser. The client must get a 409 it can reload and retry on, and the API must have written
    // nothing.
    const held = (await versionsOf(transactionId)).find((v) => v.superseded_at === null);
    const heldRow = (await q("select transaction_version_id from manual_transaction where transaction_id = $1 and superseded_at is null", [transactionId]))[0];
    const writer = new pg.Client(dbConnection); await writer.connect();
    let external;
    try {
      await writer.query("begin");
      await writer.query("update manual_transaction set superseded_at = now() where transaction_version_id = $1", [heldRow.transaction_version_id]);
      external = (await writer.query(
        "insert into manual_transaction (transaction_version_id, transaction_id, budget_space_id, account_id, revision, origin, settlement_state, currency_code, minor_unit_precision,"
        + " amount_minor_units, budget_date, period_id, period_start_date, period_end_date, description, recorded_by_subject_id, source, created_at)"
        + " select gen_random_uuid(), transaction_id, budget_space_id, account_id, revision + 1, origin, settlement_state, currency_code, minor_unit_precision,"
        + " amount_minor_units, budget_date, period_id, period_start_date, period_end_date, 'external writer', recorded_by_subject_id, source, now()"
        + " from manual_transaction where transaction_version_id = $1 returning transaction_version_id, revision, amount_minor_units::int as amount", [heldRow.transaction_version_id])).rows[0];
      await writer.query("insert into transaction_allocation (allocation_id, budget_space_id, transaction_version_id, category_id, currency_code, minor_unit_precision, amount_minor_units, created_at)"
        + " select gen_random_uuid(), budget_space_id, $2, category_id, currency_code, minor_unit_precision, amount_minor_units, now() from transaction_allocation where transaction_version_id = $1", [heldRow.transaction_version_id, external.transaction_version_id]);
      const racing = browser.fetch(`${transactions}/${transactionId}`, { method: "PATCH", body: write({ amountMinorUnits: -1_300, description: "racer against an external writer", allocations: [{ categoryId: groceries, amountMinorUnits: -1_300 }] }) });
      // Wait until the API's stamp is blocked on the writer's row lock, then let the writer win.
      const deadline = Date.now() + 15_000; let blocked = false;
      while (Date.now() < deadline && !blocked) {
        const waiting = await q("select count(*)::int as n from pg_stat_activity where datname = $1 and wait_event_type = 'Lock' and query ilike 'update manual_transaction%'", [DB_NAME]);
        blocked = waiting[0].n > 0; if (!blocked) await pause(100);
      }
      expect(blocked, "the API's supersession stamp never blocked on the external writer's lock (the race did not form)");
      await writer.query("commit");
      const lost = await racing;
      const afterRace = await versionsOf(transactionId);
      const currentAfterRace = afterRace.filter((v) => v.superseded_at === null);
      const raceSummary = `external writer committed revision ${external.revision}; the API's concurrent edit answered ${lost.status} ${lost.text.slice(0, 120)}; versions ${afterRace.length} (was ${held.revision}), current ${currentAfterRace.length} at revision ${currentAfterRace[0]?.revision} amount ${currentAfterRace[0]?.amount}`;
      expect(lost.status === 409 && lost.json?.error === "conflict", `expected the concurrent loser to receive 409 conflict, never the uniform denial; ${raceSummary}`);
      expect(afterRace.length === held.revision + 1 && currentAfterRace.length === 1 && currentAfterRace[0].amount === external.amount, `expected the loser to have written nothing and the writer's version to stand alone; ${raceSummary}`);
      // The loser reloads and retries against the writer's version: one more revision, no partial state.
      const reloadedAgain = (await browser.fetch(`${transactions}/${transactionId}/history`)).json.history.find((entry) => entry.version.supersededAt === null).version;
      expect(reloadedAgain.revision === external.revision, `reload sees the writer's revision ${external.revision}, saw ${reloadedAgain.revision}`);
      const retried = await browser.fetch(`${transactions}/${transactionId}`, { method: "PATCH", body: { ...write({ amountMinorUnits: -1_250, description: "retried after the external writer", allocations: [{ categoryId: groceries, amountMinorUnits: -800 }, { categoryId: transport, amountMinorUnits: -450 }] }), expectedTransactionVersionId: reloadedAgain.transactionVersionId } });
      expect(retried.status === 200 && retried.json.current.version.revision === external.revision + 1, `retry after reload ${retried.status} ${retried.text.slice(0, 120)}`);
      const observed = `${summary}; losers ${losers.length}: ${gated.length} refused by the CBD-266 surface gate (403, concurrency=1 per actor, before authorization) and ${conflicted.length} by a canonical 409; reload sees revision ${reloaded.revision}; retry 200 revision ${reloaded.revision + 1}. Effect-level race: ${raceSummary}; reload sees revision ${reloadedAgain.revision}; retry with the reloaded basis 200 revision ${external.revision + 1}`;
      return observed;
    } finally { try { await writer.query("rollback"); } catch { /* already committed */ } await writer.end(); }
  });

  await criterion("CBD-200-AC05", "Replaying the same operation identity produces one transaction revision, one recalculation outcome, and one correlated audit-success effect", async () => {
    const key = randomUUID();
    const body = write({ amountMinorUnits: -333, description: `replayed ${key.slice(0, 8)}`, allocations: [{ categoryId: transport, amountMinorUnits: -333 }] });
    const before = await count("manual_transaction", "budget_space_id = $1", [spaceId]);
    const cellBefore = four(cellOf((await progress()).json, transport));
    const first = await browser.fetch(transactions, { method: "POST", body, headers: { "idempotency-key": key } });
    expect(first.status === 201, `first ${first.status} ${first.text}`);
    const replay = await browser.fetch(transactions, { method: "POST", body, headers: { "idempotency-key": key } });
    const rows = await q("select transaction_id, revision from manual_transaction where budget_space_id = $1 and description = $2 order by created_at", [spaceId, body.description]);
    const cellAfter = four(cellOf((await progress()).json, transport));
    const identities = new Set(rows.map((r) => r.transaction_id));
    // The same identity on an edit as well.
    const editKey = randomUUID();
    const editBody = write({ amountMinorUnits: -444, description: `replayed edit ${editKey.slice(0, 8)}`, allocations: [{ categoryId: transport, amountMinorUnits: -444 }] });
    const target = first.json.current.version.transactionId;
    const edit1 = await browser.fetch(`${transactions}/${target}`, { method: "PATCH", body: editBody, headers: { "idempotency-key": editKey } });
    const edit2 = await browser.fetch(`${transactions}/${target}`, { method: "PATCH", body: editBody, headers: { "idempotency-key": editKey } });
    const editVersions = await versionsOf(target);
    const stored = await q("select action, idempotency_key, transaction_version_id from manual_transaction_idempotency where budget_space_id = $1 and idempotency_key = any($2) order by created_at", [spaceId, [key, editKey]]);
    // The same key with a different command is refused before policy, and writes nothing.
    const mismatch = await browser.fetch(transactions, { method: "POST", body: write({ amountMinorUnits: -334, description: body.description, allocations: [{ categoryId: transport, amountMinorUnits: -334 }] }), headers: { "idempotency-key": key } });
    const rowsAfterMismatch = await q("select transaction_id from manual_transaction where budget_space_id = $1 and description = $2", [spaceId, body.description]);
    const observed = `POST x2 with Idempotency-Key ${key.slice(0, 8)}: ${first.status} then ${replay.status} (${replay.json?.current?.version?.transactionVersionId === first.json?.current?.version?.transactionVersionId ? "same stored response" : "different response"}); transaction identities created ${identities.size} (rows ${rows.length}, table delta ${(await count("manual_transaction", "budget_space_id = $1", [spaceId])) - before}); transport ${JSON.stringify(cellBefore)} -> ${JSON.stringify(cellAfter)} (the effect applied ${(cellBefore.settledActualMinorUnits - cellAfter.settledActualMinorUnits) / 333} times); PATCH x2 with key ${editKey.slice(0, 8)}: ${edit1.status} rev ${edit1.json?.current?.version?.revision} then ${edit2.status} rev ${edit2.json?.current?.version?.revision}; versions of the target ${editVersions.length}; idempotency rows ${JSON.stringify(stored.map((r) => r.action))}; same key, different command: ${mismatch.status} ${mismatch.json?.error} with ${rowsAfterMismatch.length} row(s) still. Audit-success count is not externally observable (in-process restricted stream); a replay is answered from the stored response before policy, so it evaluates no decision and emits no second allow event`;
    expect(identities.size === 1 && rows.length === 1, `expected one transaction from the replayed identity; ${observed}`);
    expect(cellAfter.settledActualMinorUnits === cellBefore.settledActualMinorUnits - 333, `expected one recalculation outcome; ${observed}`);
    expect(replay.status === 201 && replay.json?.current?.version?.transactionVersionId === first.json.current.version.transactionVersionId, `expected the replay to answer with the first outcome; ${observed}`);
    expect(editVersions.length === 2 && edit1.status === 200 && edit2.status === 200 && edit2.json?.current?.version?.revision === 2, `expected one revision from the replayed edit identity; ${observed}`);
    expect(stored.length === 2 && stored[0].action === "create" && stored[1].action === "edit", `expected one idempotency row per accepted key; ${observed}`);
    expect(mismatch.status === 409 && mismatch.json?.error === "idempotency_mismatch" && rowsAfterMismatch.length === 1, `expected the same key with a different command to be refused idempotency_mismatch with nothing written; ${observed}`);
    return observed;
  });
}

// ---------------------------------------------------------------------------
// CBD-211: category progress and reconciled drill-downs (API halves)
// ---------------------------------------------------------------------------
async function cbd211(browser, world) {
  const { spaceId, periodId, budgetDate, accountId, groceries, transport, rent } = world;
  const transactions = `/v1/budget-spaces/${spaceId}/transactions`;
  const progress = () => browser.fetch(`/v1/budget-spaces/${spaceId}/periods/${periodId}/progress`);
  const detail = (category) => browser.fetch(`/v1/budget-spaces/${spaceId}/periods/${periodId}/progress/${category}`);
  const record = async (amount, category, description) => {
    const r = await browser.fetch(transactions, { method: "POST", body: { accountId, amountMinorUnits: amount, budgetDate, description, allocations: [{ categoryId: category, amountMinorUnits: amount }] } });
    expect(r.status === 201, `record ${description} ${r.status} ${r.text}`);
    return r.json.current.version.transactionId;
  };

  await criterion("CBD-211-AC01", "Each category displays settled actual, pending provisional impact, remaining after settled, and remaining after pending as separately labeled values (API representation: four distinct named fields per cell)", async () => {
    const body = (await progress()).json;
    for (const cell of body.cells) {
      for (const field of FOUR) expect(Number.isSafeInteger(cell[field]), `${cell.label}: ${field} is ${cell[field]}`);
      expect(cell.remainingAfterSettledMinorUnits === cell.targetMinorUnits + cell.settledActualMinorUnits, `${cell.label}: remaining after settled != target + settled`);
      expect(cell.remainingAfterPendingMinorUnits === cell.remainingAfterSettledMinorUnits + cell.pendingProvisionalImpactMinorUnits, `${cell.label}: remaining after pending != remaining after settled + pending`);
    }
    const g = cellOf(body, groceries);
    return `${body.cells.length} cells, each carrying the four named fields; groceries ${JSON.stringify(four(g))} against target ${g.targetMinorUnits}. Web representation: see scripts/prototype-qa-browser-cbd211.mjs`;
  });

  await criterion("CBD-211-AC02", "No visual, spoken, tooltip, or compact representation merges provisional and settled values into one unlabeled number (API: can a pending record exist at all?)", async () => {
    const body = (await progress()).json;
    const merged = body.cells.filter((cell) => Object.entries(cell).some(([k, v]) => !FOUR.includes(k) && k !== "targetMinorUnits" && typeof v === "number" && v === cell.settledActualMinorUnits + cell.pendingProvisionalImpactMinorUnits && cell.pendingProvisionalImpactMinorUnits !== 0));
    expect(merged.length === 0, `a cell carries an unlabeled merged number: ${JSON.stringify(merged)}`);
    // Try to make a pending record exist: the storage refuses the state (CBD-199-AC02 CHECK), and the API's manual route has no way to ask for one.
    const current = (await q("select * from manual_transaction where budget_space_id = $1 and superseded_at is null and removed_at is null limit 1", [spaceId]))[0];
    let sqlState = null;
    try {
      await q("insert into manual_transaction (transaction_version_id, transaction_id, budget_space_id, revision, origin, settlement_state, account_id, currency_code, minor_unit_precision, amount_minor_units, budget_date, period_id, period_start_date, period_end_date, description, recorded_by_subject_id, source, created_at) values ($1,$2,$3,1,'manual','pending',$4,$5,$6,-100,$7,$8,$9,$10,'pending probe',$11,'user',$12)",
        [randomUUID(), randomUUID(), spaceId, current.account_id, current.currency_code, current.minor_unit_precision, current.budget_date, current.period_id, current.period_start_date, current.period_end_date, current.recorded_by_subject_id, current.created_at]);
    } catch (error) { sqlState = error.code; }
    const probe = await browser.fetch(transactions, { method: "POST", body: { accountId, amountMinorUnits: -100, budgetDate, description: "pending probe", settlementState: "pending", allocations: [{ categoryId: groceries, amountMinorUnits: -100 }] } });
    const stored = probe.status === 201 ? (await q("select settlement_state from manual_transaction where transaction_id = $1", [probe.json.current.version.transactionId]))[0].settlement_state : null;
    if (probe.status === 201) expect((await browser.fetch(`${transactions}/${probe.json.current.version.transactionId}/remove`, { method: "POST", body: {} })).status === 201, "cleanup of the probe");
    blocked(`no pending record can exist in the prototype: a raw INSERT with settlement_state='pending' is refused by the database (SQLSTATE ${sqlState}, CHECK settlement_state = 'settled') and the manual route ignores a settlementState field (probe answered ${probe.status}, stored as ${stored}); every cell reports pendingProvisionalImpactMinorUnits 0, so a merge cannot be observed. Observed with pending = 0: ${body.cells.length} cells, no unlabeled merged number in the API shape`);
  });

  await criterion("CBD-211-AC03", "Activating a category total opens authorized itemized detail whose signed sum equals that value under the same snapshot and report mode (API: the detail's signed item sum equals the aggregate cell, same calculation version)", async () => {
    // Several items with both signs in one category: a split share, a whole expense and a refund.
    const milk = await record(-300, groceries, "Milk");
    const refund = await record(200, groceries, "Refund for spoiled milk");
    const aggregate = (await progress()).json;
    const g = cellOf(aggregate, groceries);
    const d = (await detail(groceries)).json;
    const sum = d.items.reduce((total, item) => total + item.amountMinorUnits, 0);
    expect(d.categoryId === groceries && d.label === "Groceries", `detail identity ${JSON.stringify(d).slice(0, 200)}`);
    expect(sum === g.settledActualMinorUnits, `signed item sum ${sum} != aggregate settled ${g.settledActualMinorUnits}; items ${JSON.stringify(d.items.map((i) => [i.description, i.amountMinorUnits]))}`);
    expect(JSON.stringify(four(d.cell)) === JSON.stringify(four(g)), `detail cell ${JSON.stringify(four(d.cell))} != aggregate cell ${JSON.stringify(four(g))}`);
    expect(d.calculationVersion === aggregate.calculationVersion, `calculation versions differ: ${d.calculationVersion} vs ${aggregate.calculationVersion}`);
    expect(d.items.length === g.settledRecordIds.length && d.items.every((item) => g.settledRecordIds.includes(item.allocationId)), `the detail's items are not the aggregate's settled records: ${JSON.stringify(d.items.map((i) => i.allocationId))} vs ${JSON.stringify(g.settledRecordIds)}`);
    // Split shares report the whole version's allocation count.
    const share = d.items.find((item) => item.transactionId === world.transactionId);
    expect(share && share.allocationCount === 2, `the split share does not report allocationCount 2: ${JSON.stringify(share)}`);
    // Authorized: the same read from another subject with no membership is denied, and a category of another budget too.
    const stranger = new Browser("stranger"); await signIn(stranger, "subject-b");
    const denied = await stranger.fetch(`/v1/budget-spaces/${spaceId}/periods/${periodId}/progress/${groceries}`);
    expect(denied.status === 403, `a non-member reads the detail: ${denied.status} ${denied.text}`);
    expect((await browser.fetch(`${transactions}/${refund}/remove`, { method: "POST", body: {} })).status === 201, "cleanup refund");
    expect((await browser.fetch(`${transactions}/${milk}/remove`, { method: "POST", body: {} })).status === 201, "cleanup milk");
    return `items ${JSON.stringify(d.items.map((i) => [i.description, i.amountMinorUnits, i.allocationCount]))} sum ${sum} == aggregate settled ${g.settledActualMinorUnits}; detail cell equals aggregate cell ${JSON.stringify(four(g))}; calculationVersion ${d.calculationVersion} on both; item allocation ids == settledRecordIds; non-member 403. Snapshot note: the aggregate and the detail are two reads in two serializable transactions with no shared snapshot identity beyond calculationVersion; equality holds when nothing changes between them (see finding on AC03 if the browser half differs)`;
  });

  await criterion("CBD-211-AC04", "Negative remaining, zero, positive remaining, negative net actual, and no-activity states have unambiguous text/semantics and do not rely on color alone (API: the five states are distinguishable from the cell fields)", async () => {
    // Fresh categories so each state is isolated: targets 100.00 each.
    const all = await categories(browser, spaceId, ["Over", "Zero", "Positive", "Refund", "Idle"]);
    const byLabel = (label) => { const found = all.find((c) => c.label === label); expect(found, `category ${label} missing from ${JSON.stringify(all.map((c) => c.label))}`); return found; };
    const [over, zero, positive, refund, idle] = ["Over", "Zero", "Positive", "Refund", "Idle"].map(byLabel);
    await targets(browser, spaceId, [
      { categoryId: groceries, amountMinorUnits: 50_000 }, { categoryId: transport, amountMinorUnits: 20_000 }, { categoryId: rent, amountMinorUnits: 100_000 },
      ...[over, zero, positive, refund, idle].map((c) => ({ categoryId: c.categoryId, amountMinorUnits: 10_000 })),
    ]);
    const ids = [];
    ids.push(await record(-15_000, over.categoryId, "over"));
    ids.push(await record(-10_000, zero.categoryId, "zero"));
    ids.push(await record(-2_500, positive.categoryId, "positive"));
    ids.push(await record(-1_000, refund.categoryId, "small spend"));
    ids.push(await record(3_000, refund.categoryId, "large refund"));
    const body = (await progress()).json;
    const states = Object.fromEntries([["over", over], ["zero", zero], ["positive", positive], ["refund", refund], ["idle", idle]].map(([name, c]) => [name, { ...four(cellOf(body, c.categoryId)), records: cellOf(body, c.categoryId).settledRecordIds.length }]));
    expect(states.over.remainingAfterSettledMinorUnits === -5_000 && states.over.settledActualMinorUnits === -15_000, `over: ${JSON.stringify(states.over)}`);
    expect(states.zero.remainingAfterSettledMinorUnits === 0 && states.zero.settledActualMinorUnits === -10_000, `zero: ${JSON.stringify(states.zero)}`);
    expect(states.positive.remainingAfterSettledMinorUnits === 7_500, `positive: ${JSON.stringify(states.positive)}`);
    expect(states.refund.settledActualMinorUnits === 2_000 && states.refund.remainingAfterSettledMinorUnits === 12_000 && states.refund.records === 2, `negative net actual (net refund): ${JSON.stringify(states.refund)}`);
    expect(states.idle.settledActualMinorUnits === 0 && states.idle.remainingAfterSettledMinorUnits === 10_000 && states.idle.records === 0, `no activity: ${JSON.stringify(states.idle)}`);
    world.stateCategories = { over, zero, positive, refund, idle };
    return `over ${JSON.stringify(states.over)}; zero ${JSON.stringify(states.zero)}; positive ${JSON.stringify(states.positive)}; net refund ${JSON.stringify(states.refund)}; no activity ${JSON.stringify(states.idle)} - the signed settled value, the signed remaining and the settled record count distinguish all five in the API. Text/colour semantics are the web's: see scripts/prototype-qa-browser-cbd211.mjs`;
  });

  await criterion("CBD-211-AC05", "Component and end-to-end tests cover pending replacement, Duplicate-review, refunds, transfers, partial visibility, and aggregate/detail reconciliation (inventory of the tests on the progress, transaction and web surfaces)", async () => {
    // The surfaces CBD-211 names: the progress calculator, the transaction application and routes, the web, and the prototype scripts.
    const scopes = ["packages/budget-domain/src/progress", "packages/budget-application/src/transactions", "packages/budget-application/src/persistence", "apps/api/src/transactions", "apps/web/src", "apps/web/tests", "scripts"];
    const self = fileURLToPath(import.meta.url);
    const files = [];
    const walk = (dir) => { for (const entry of readdirSync(dir)) { const full = join(dir, entry); if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue; if (statSync(full).isDirectory()) walk(full); else if (full !== self && (/\.test\.(ts|tsx|mjs|js)$/u.test(entry) || (/^prototype-.*\.mjs$/u.test(entry) && dir.endsWith("scripts")))) files.push(full); } };
    for (const scope of scopes) walk(join(root, scope));
    const terms = {
      // "pending replacement": a pending record replaced by (or superseded into) its settled form.
      "pending replacement": /pending[^\n]{0,40}(replac|supersed)|(replac|supersed)[^\n]{0,40}pending/iu,
      "Duplicate-review": /duplicate[- ]review/iu,
      // A refund of money in a category, not a refunded rate-limit unit.
      "refunds": /refund(?![^\n]*(unit|reserv|rate))/iu,
      // A money transfer between accounts, not a Primary Owner transfer.
      "transfers": /\btransfer(s|red)?\b(?![^\n]*(primary|ownership|owner|Primary))/iu,
      "partial visibility": /partial[- ]visibility|partially visible|partial[^\n]{0,40}(access|member|permission)/iu,
      "aggregate/detail reconciliation": /aggregate[^\n]{0,80}detail|detail[^\n]{0,80}aggregate|reconcil/iu,
    };
    const hits = {};
    for (const [term, pattern] of Object.entries(terms)) {
      hits[term] = [];
      for (const file of files) {
        if (term === "transfers" && /primary-transfer/u.test(file)) continue;
        const lines = readFileSync(file, "utf8").split("\n");
        const line = lines.findIndex((text) => pattern.test(text));
        if (line !== -1) hits[term].push(`${file.slice(root.length + 1).replaceAll("\\", "/")}:${line + 1}`);
      }
    }
    const missing = Object.entries(hits).filter(([, list]) => list.length === 0).map(([term]) => term);
    const summary = Object.entries(hits).map(([term, list]) => `${term}: ${list.length ? list.join(", ") : "NONE"}`).join("; ");
    expect(missing.length === 0, `no component or end-to-end test on these surfaces covers ${missing.join(", ")} (${files.length} test files scanned under ${scopes.join(", ")}). ${summary}`);
    return `${files.length} test files scanned. ${summary}`;
  });
}

// ---------------------------------------------------------------------------
async function main() {
  await db.connect();
  const identity = await q("select current_database() as db, current_setting('server_version_num') as v, pg_get_userbyid((select datdba from pg_database where datname = current_database())) as owner");
  expect(identity[0].db === DB_NAME && identity[0].v.startsWith("17") && identity[0].owner === "cobudget_migration", `database identity ${JSON.stringify(identity)}`);
  console.log(`candidate ${CANDIDATE}; database ${DB_NAME} server ${identity[0].v} owner ${identity[0].owner}; clock ${new Date().toISOString()}`);
  const api = await startApi();
  try {
    const browser = new Browser("primary-owner");
    await signIn(browser, "subject-a");
    const confirmed = await createBudget(browser, monthly("QA CBD-200/211"));
    const spaceId = confirmed.budgetSpaceId; const periodId = confirmed.currentPeriodId;
    const [groceries, transport, rent] = await categories(browser, spaceId, ["Groceries", "Transport", "Rent"]);
    await targets(browser, spaceId, [{ categoryId: groceries.categoryId, amountMinorUnits: 50_000 }, { categoryId: transport.categoryId, amountMinorUnits: 20_000 }, { categoryId: rent.categoryId, amountMinorUnits: 100_000 }]);
    const periods = await q("select period_id, period_start_date as start, period_end_date as finish from budget_space_period where budget_space_id = $1 order by period_start_date", [spaceId]);
    const currentIndex = periods.findIndex((p) => p.period_id === periodId);
    expect(currentIndex >= 0 && periods[currentIndex + 1], `no following period: ${JSON.stringify(periods)}`);
    const accountsUrl = `/v1/budget-spaces/${spaceId}/accounts`;
    const account = await browser.fetch(accountsUrl, { method: "POST", body: { accountType: "checking", label: "Everyday", currencyCode: "USD", openingBalanceMinorUnits: 100_000 } });
    const second = await browser.fetch(accountsUrl, { method: "POST", body: { accountType: "credit-card", label: "Card", currencyCode: "USD", openingBalanceMinorUnits: 0 } });
    expect(account.status === 201 && second.status === 201, `accounts ${account.status} ${second.status}`);
    const world = {
      spaceId, periodId, nextPeriodId: periods[currentIndex + 1].period_id, budgetDate: periods[currentIndex].start, nextBudgetDate: periods[currentIndex + 1].start,
      accountId: account.json.account.accountId, secondAccountId: second.json.account.accountId,
      groceries: groceries.categoryId, transport: transport.categoryId, rent: rent.categoryId,
    };
    console.log(`budget ${spaceId} period ${periodId} (${world.budgetDate}) next ${world.nextPeriodId} (${world.nextBudgetDate})`);
    await cbd200(browser, world);
    await cbd211(browser, world);
  } catch (error) {
    console.log(`RUN aborted: ${error.message}`); results.push({ criterion: "RUN", case: "setup", status: "fail", detail: error.message, at: new Date().toISOString() });
    console.log(api.output());
  } finally { await api.stop(); await db.end(); }
  console.log("\n== Summary ==");
  const byCriterion = {};
  for (const r of results) (byCriterion[r.criterion] ??= []).push(r);
  for (const [id, cases] of Object.entries(byCriterion).sort()) {
    const status = cases.some((c) => c.status === "fail") ? "FAIL" : cases.some((c) => c.status === "blocked") ? "BLOCKED" : "PASS";
    console.log(`${id}: ${status} (${cases.filter((c) => c.status === "pass").length} pass, ${cases.filter((c) => c.status === "fail").length} fail, ${cases.filter((c) => c.status === "blocked").length} blocked)`);
  }
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ candidate: CANDIDATE, database: DB_NAME, at: new Date().toISOString(), results }, null, 2));
  const failed = results.filter((r) => r.status === "fail").length;
  console.log(failed ? `PROTOTYPE-QA-CBD200-211 COMPLETED WITH ${failed} FAILING CASE(S)` : "PROTOTYPE-QA-CBD200-211 PASSED");
  process.exitCode = failed ? 1 : 0;
}

await main();
