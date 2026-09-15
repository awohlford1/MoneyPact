#!/usr/bin/env node
/* global fetch, setTimeout, URL, document, location, window, getComputedStyle */
/**
 * PROTO-QA-CBD200-211-001: the browser halves of the CBD-211 presentation
 * criteria (AC01 to AC04), observed in headless Chrome against the Next
 * development server in live mode and the real API on a scratch database,
 * exactly as scripts/prototype-qa-browser.mjs arranges them (web on 3000,
 * API on 3001, the same-origin /v1 rewrite).
 *
 *   node scripts/prototype-qa-browser-cbd211.mjs --db <scratch> [--json out.json]
 *
 * Every representation the criterion names is inspected, not only the DOM
 * text: the accessibility tree (what a screen reader speaks), title
 * attributes (tooltips), aria-label/aria-describedby, and the page at a
 * 400 px viewport (the compact view). A failed case is a finding with its
 * reproduction; nothing here changes product code. The API halves live in
 * scripts/prototype-qa-cbd200-211.mjs.
 */
import { execFileSync, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const WEB_PORT = 3000; const API_PORT = 3001;
const ORIGIN = `http://localhost:${WEB_PORT}`; const CEREMONY_ORIGIN = `http://127.0.0.1:${API_PORT}`;
function argument(name) { const index = process.argv.indexOf(name); return index === -1 ? undefined : process.argv[index + 1]; }
const DB_NAME = argument("--db"); const JSON_OUT = argument("--json");
if (!DB_NAME || DB_NAME === "cobudget_dev" || DB_NAME === "cobudget_demo") { console.error("--db must name a migrated scratch database (never cobudget_dev or cobudget_demo)"); process.exit(2); }
const CANDIDATE = (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); } catch { return "unknown"; } })();
const axeSource = readFileSync(join(root, "node_modules/axe-core/axe.min.js"), "utf8");

const KEYS = { field: randomBytes(32).toString("base64"), pepper: randomBytes(32).toString("base64"), envelope: randomBytes(32).toString("base64") };
const apiEnvironment = {
  NODE_ENV: "development", LOG_LEVEL: "info", SERVICE_VERSION: "prototype-qa-browser-cbd211", API_PORT: String(API_PORT), API_LISTEN_ADDRESS: "127.0.0.1",
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
  COBUDGET_DB_NAME: DB_NAME,
};

const results = [];
class Expectation extends Error {}
class Blocked extends Error {}
function expect(condition, message) { if (!condition) throw new Expectation(message); }
const blocked = (reason) => { throw new Blocked(reason); };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let shots; let shotIndex = 0; let page;
async function criterion(id, name, fn) {
  const started = new Date().toISOString();
  try {
    const detail = await fn();
    results.push({ criterion: id, case: name, status: "pass", detail: detail ?? "", at: started });
    console.log(`[${id}] PASS ${name}${detail ? `: ${detail}` : ""}`);
  } catch (error) {
    const status = error instanceof Blocked ? "blocked" : "fail";
    let where = "";
    if (status === "fail" && page) { try { const file = join(shots, `qa-cbd211-failure-${++shotIndex}.png`); await page.screenshot({ path: file, fullPage: true }); where = ` (screenshot ${file}; route ${new URL(page.url()).pathname})`; } catch { /* no page */ } }
    results.push({ criterion: id, case: name, status, detail: `${error.message}${where}`, at: started });
    console.log(`[${id}] ${status.toUpperCase()} ${name}: ${error.message}${where}`);
    if (status === "fail" && !(error instanceof Expectation)) console.log(error.stack);
  }
}
async function waitFor(check, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { try { if (await check()) return; } catch { /* not yet */ } await pause(300); }
  throw new Error(`timed out: ${label}`);
}
async function assertPortFree(port, label) {
  let answered = false;
  try { await fetch(`http://127.0.0.1:${port}/health`); answered = true; } catch { /* free */ }
  if (answered) throw new Error(`port ${port} (${label}) is already served by another process; this run must not use it (never stop a process you did not start)`);
}
function startApi() {
  const api = spawn(process.execPath, ["--import=tsx", "src/main.ts"], { cwd: join(root, "apps/api"), env: apiEnvironment, stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; for (const stream of [api.stdout, api.stderr]) stream.on("data", (chunk) => { output = (output + chunk).slice(-8000); });
  const exited = new Promise((resolve) => api.once("exit", resolve));
  const routesReady = async () => {
    if (api.exitCode !== null) return false;
    if ((await fetch(`${CEREMONY_ORIGIN}/health`)).status !== 200) return false;
    const probe = await fetch(`${CEREMONY_ORIGIN}/v1/identity/begin`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    return probe.status !== 404;
  };
  return { api, output: () => output, ready: () => waitFor(routesReady, `API ready with identity routes mounted (${output})`), stop: async () => { if (api.exitCode === null) { api.kill(); await exited; } } };
}

/**
 * A Node-side session for the world setup, through the same-origin /v1 rewrite of the web
 * server (so the API sees exactly the Origin and Host a browser tab would send). It is a
 * separate session of the same Primary Owner: the CSRF bootstrap value is handed out once per
 * session on the first /v1/identity/me read, and the page's own SessionProvider consumes the
 * page session's value, so page-context mutations are not possible from outside the app.
 */
class Session {
  cookies = new Map(); csrf = undefined; mutations = [];
  async fetch(path, { method = "GET", body, headers = {}, navigate = false } = {}) {
    if (method !== "GET" && !path.includes("/v1/identity/")) {
      for (;;) { const now = Date.now(); while (this.mutations.length && now - this.mutations[0] > 61_000) this.mutations.shift(); if (this.mutations.length < 12) break; const wait = 61_000 - (now - this.mutations[0]) + 250; console.log(`   (pacing: waiting ${Math.ceil(wait / 1000)} s for the mutation window)`); await pause(wait); }
      this.mutations.push(Date.now());
    }
    const request = { method, redirect: "manual", headers: { accept: navigate ? "text/html" : "application/json", ...headers } };
    if (this.cookies.size) request.headers.cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    if (body !== undefined) { request.headers["content-type"] = "application/json"; request.body = JSON.stringify(body); }
    if (method !== "GET") { request.headers.origin = ORIGIN; request.headers["sec-fetch-site"] = "same-origin"; if (this.csrf) request.headers["x-cobudget-csrf"] = this.csrf; }
    if (navigate) request.headers["sec-fetch-mode"] = "navigate";
    const response = await fetch(path.startsWith("http") ? path : `${ORIGIN}${path}`, request);
    for (const header of response.headers.getSetCookie?.() ?? []) {
      const [pair, ...attributes] = header.split(";"); const index = pair.indexOf("="); const name = pair.slice(0, index); const value = pair.slice(index + 1);
      if (attributes.some((attribute) => attribute.trim() === "Max-Age=0") || value === "") this.cookies.delete(name); else this.cookies.set(name, value);
    }
    const text = await response.text(); let json; try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
    return { status: response.status, headers: response.headers, text, json };
  }
  async signIn(scenario) {
    const begin = await this.fetch("/v1/identity/begin", { method: "POST", body: { ceremony: "sign_in", postResultDestinationId: "home" } });
    expect(begin.status === 200 && typeof begin.json?.navigateTo === "string", `begin ${begin.status} ${begin.text}`);
    const hosted = await this.fetch(begin.json.navigateTo, { navigate: true });
    const request = /request=([^&"]+)/.exec(hosted.text); expect(hosted.status === 200 && request, `hosted authorize ${hosted.status}`);
    const chosen = await this.fetch(`${CEREMONY_ORIGIN}/v1/identity/local/choose?request=${request[1]}&scenario=${scenario}`, { navigate: true });
    expect(chosen.status === 303, `chooser ${chosen.status} ${chosen.text}`);
    const completed = await this.fetch(chosen.headers.get("location"), { navigate: true });
    expect(completed.status === 303 && this.cookies.has("__Host-cobudget_session"), `callback ${completed.status} ${completed.text.slice(0, 200)}`);
    const me = await this.fetch("/v1/identity/me");
    expect(me.status === 200 && typeof me.json?.csrfValue === "string", `/me ${me.status} ${me.text}`);
    this.csrf = me.json.csrfValue;
    return me.json;
  }
}

/** Formats minor units the way the web does, so expectations read like the page. */
const money = (minor) => `${(Math.abs(minor) / 100).toFixed(2)} USD`;

async function main() {
  await assertPortFree(API_PORT, "API"); await assertPortFree(WEB_PORT, "web");
  const marker = join(root, "apps/web/.api-mode");
  const previous = existsSync(marker) ? readFileSync(marker, "utf8") : undefined;
  writeFileSync(marker, "live\n");
  const api = startApi();
  const web = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "--port", String(WEB_PORT)], { cwd: join(root, "apps/web"), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let webOutput = ""; for (const stream of [web.stdout, web.stderr]) stream.on("data", (chunk) => { webOutput = (webOutput + chunk).slice(-8000); });
  let browser;
  try {
    await api.ready();
    await waitFor(async () => web.exitCode === null && (await fetch(`${ORIGIN}/sign-in`)).ok, `web ready (${webOutput})`, 120_000);
    console.log(`candidate ${CANDIDATE}; API ${CEREMONY_ORIGIN} (COBUDGET_DB_NAME=${DB_NAME}); web ${ORIGIN} (next dev, apps/web/.api-mode=live); clock ${new Date().toISOString()}`);
    const executablePath = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
    browser = await puppeteer.launch({ ...(executablePath ? { executablePath } : {}), headless: true, args: ["--no-sandbox"] });
    page = await browser.newPage(); page.setDefaultTimeout(30_000);
    await page.setViewport({ width: 1280, height: 900 });
    shots = join(root, "apps/web/.next"); mkdirSync(shots, { recursive: true });
    const pageErrors = []; page.on("pageerror", (error) => pageErrors.push(error.message));

    const waitText = (value, timeout) => page.waitForFunction((value) => document.querySelector("main")?.textContent?.includes(value), timeout ? { timeout } : {}, value);
    const clickText = async (label) => {
      for (const handle of await page.$$("button, a")) if ((await handle.evaluate((node) => node.textContent?.trim())) === label) { await handle.scrollIntoView(); await handle.click(); return; }
      throw new Error(`Missing control: ${label}`);
    };
    const accessibility = async () => {
      await page.evaluate(axeSource);
      const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector("main"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations.map((item) => ({ id: item.id, nodes: item.nodes.map((node) => node.target) })));
      expect(violations.length === 0, `axe violations ${JSON.stringify(violations)}`);
      return "axe wcag2a/wcag2aa/wcag21aa: 0 violations";
    };
    const signInAs = async (scenario) => {
      await page.goto(`${ORIGIN}/sign-in`); await page.waitForFunction(() => document.querySelector("main")?.textContent?.includes("Continue to sign in"));
      const beginResponse = page.waitForResponse((r) => r.url().endsWith("/v1/identity/begin"));
      await clickText("Continue to sign in");
      expect((await beginResponse).status() === 200, "POST /v1/identity/begin");
      await page.waitForFunction(() => location.pathname === "/v1/identity/local/authorize" && location.port === "3001");
      await clickText(scenario);
      await page.waitForFunction(() => location.port === "3000");
    };
    // The world is written by a Node-side session of the same Primary Owner (see Session); the page reads it.
    const session = new Session();
    const apiJson = async (path) => { const r = await session.fetch(path); return { status: r.status, body: r.json }; };
    const post = async (path, body, method = "POST") => { const r = await session.fetch(path, { method, body, headers: { "idempotency-key": randomUUID() } }); expect(r.status === 200 || r.status === 201, `${method} ${path} -> ${r.status} ${r.text.slice(0, 300)}`); return r.json; };

    // ----------------------------------------------------------------- world
    const owner = await session.signIn("subject-a");
    await signInAs("subject-a");
    const pageSubject = await page.evaluate(async () => (await (await fetch("/v1/identity/me", { headers: { accept: "application/json" } })).json()).accountSubjectId);
    expect(pageSubject === owner.accountSubjectId, `the page and the setup session are different subjects: ${pageSubject} vs ${owner.accountSubjectId}`);
    const proposal = await post("/v1/budget-creation-proposals", { name: "QA CBD-211 presentation", timeZone: "America/New_York", currencyCode: "USD", schedule: { cadence: "monthly", anchor: { kind: "day-of-month", day: 1 } } });
    const disclosure = proposal.currentDisclosure ? { kind: proposal.currentDisclosure.kind, version: proposal.currentDisclosure.version } : { kind: "primary_owner_self", version: 1 };
    const confirmed = await post(`/v1/budget-creation-proposals/${proposal.proposalId}/confirm`, { confirmationBinding: proposal.confirmationBinding, acknowledgedDisclosure: disclosure });
    const budgetId = confirmed.budgetSpaceId; const periodId = confirmed.currentPeriodId;
    const labels = ["Groceries", "Transport", "Over", "Zero", "Positive", "Refund", "Idle", "Net zero"];
    const created = await post(`/v1/budget-spaces/${budgetId}/categories`, { categories: labels.map((label) => ({ label })) }, "PUT");
    const category = Object.fromEntries(labels.map((label) => [label, created.categories.find((c) => c.label === label).categoryId]));
    await post(`/v1/budget-spaces/${budgetId}/targets`, { targets: [{ categoryId: category.Groceries, amountMinorUnits: 10_000 }, { categoryId: category.Transport, amountMinorUnits: 5_000 }, ...["Over", "Zero", "Positive", "Refund", "Idle", "Net zero"].map((l) => ({ categoryId: category[l], amountMinorUnits: 10_000 }))] }, "PUT");
    const account = await post(`/v1/budget-spaces/${budgetId}/accounts`, { accountType: "checking", label: "Everyday", currencyCode: "USD", openingBalanceMinorUnits: 100_000 });
    const accountId = account.account.accountId;
    const plan = await apiJson(`/v1/budget-spaces/${budgetId}/plan?periodId=${periodId}`); expect(plan.status === 200, `plan ${plan.status}`);
    const budgetDate = plan.body.period.start;
    const record = (amount, allocations, description) => post(`/v1/budget-spaces/${budgetId}/transactions`, { accountId, amountMinorUnits: amount, budgetDate, description, allocations });
    // Groceries: a split share (-8.00 of a 12.50 expense), a whole expense (-3.00) and a refund (+2.00): settled -9.00, remaining 91.00.
    await record(-1_250, [{ categoryId: category.Groceries, amountMinorUnits: -800 }, { categoryId: category.Transport, amountMinorUnits: -450 }], "Corner shop");
    await record(-300, [{ categoryId: category.Groceries, amountMinorUnits: -300 }], "Milk");
    await record(200, [{ categoryId: category.Groceries, amountMinorUnits: 200 }], "Refund for spoiled milk");
    // The five AC04 states plus a net-zero-with-activity control, targets 100.00 each.
    await record(-15_000, [{ categoryId: category.Over, amountMinorUnits: -15_000 }], "over");
    await record(-10_000, [{ categoryId: category.Zero, amountMinorUnits: -10_000 }], "zero");
    await record(-2_500, [{ categoryId: category.Positive, amountMinorUnits: -2_500 }], "positive");
    await record(-1_000, [{ categoryId: category.Refund, amountMinorUnits: -1_000 }], "small spend");
    await record(3_000, [{ categoryId: category.Refund, amountMinorUnits: 3_000 }], "large refund");
    await record(-1_000, [{ categoryId: category["Net zero"], amountMinorUnits: -1_000 }], "spend");
    await record(1_000, [{ categoryId: category["Net zero"], amountMinorUnits: 1_000 }], "refund");
    const aggregate = await apiJson(`/v1/budget-spaces/${budgetId}/periods/${periodId}/progress`); expect(aggregate.status === 200, `progress ${aggregate.status}`);
    const cellOf = (label) => aggregate.body.cells.find((c) => c.categoryId === category[label]);
    console.log(`budget ${budgetId}; API cells [label, settled, pending, remaining after settled, remaining after pending, settled records]: ${JSON.stringify(aggregate.body.cells.map((c) => [aggregate.body.labels[c.categoryId], c.settledActualMinorUnits, c.pendingProvisionalImpactMinorUnits, c.remainingAfterSettledMinorUnits, c.remainingAfterPendingMinorUnits, c.settledRecordIds?.length]))}`);

    // -------------------------------------------------------------- helpers over the dashboard
    /** The dev server occasionally answers a route with its 404 page while compiling (F-BFIX-03); a second navigation resolves it. */
    const openDashboard = async () => {
      for (let attempt = 1; ; attempt += 1) {
        await page.goto(`${ORIGIN}/budgets/${budgetId}`);
        try { await waitText("Spent and remaining this period", 15_000); await page.waitForSelector('[data-testid="progress-row"]'); return; }
        catch (error) { if (attempt >= 3) throw error; console.log(`   (dashboard attempt ${attempt} showed "${(await page.$eval("body", (n) => n.textContent.trim().slice(0, 60)).catch(() => "?"))}"; retrying)`); await pause(2_000); }
      }
    };
    /** Every representation of one progress row: visible text, accessible names and descriptions, tooltips, aria attributes. */
    const rowRepresentations = () => page.$$eval('[data-testid="progress-row"]', (rows) => rows.map((row) => ({
      text: row.textContent.replace(/\s+/gu, " ").trim(),
      label: row.querySelector("h4")?.textContent.trim(),
      tooltips: [...row.querySelectorAll("[title]")].map((n) => n.getAttribute("title")),
      ariaLabels: [...row.querySelectorAll("[aria-label]")].map((n) => n.getAttribute("aria-label")),
      ariaDescribed: [...row.querySelectorAll("[aria-describedby]")].map((n) => document.getElementById(n.getAttribute("aria-describedby"))?.textContent ?? null),
      hidden: [...row.querySelectorAll("[aria-hidden='true']")].map((n) => n.textContent.trim()),
      visuallyHidden: [...row.querySelectorAll(".sr-only, [class*='visually-hidden']")].map((n) => n.textContent.trim()),
      colors: [...row.querySelectorAll("p")].map((n) => getComputedStyle(n).color),
    })));
    /**
     * What a screen reader announces: one entry per paragraph, heading, link or list item of the
     * progress list, with its static text joined (React renders "Spent 9.00 USD of 100.00 USD" as
     * several text nodes, which a reader speaks as one sentence).
     */
    const spokenRows = async () => {
      const tree = await page.accessibility.snapshot({ interestingOnly: false });
      const spoken = [];
      const textOf = (node) => (node.role === "StaticText" || node.role === "InlineTextBox" ? (node.role === "StaticText" ? node.name ?? "" : "") : (node.children ?? []).map(textOf).join(""));
      const walk = (node, inside) => { if (!node) return; const here = inside || (node.role === "list" && node.name === "Spending by category"); if (here && ["paragraph", "heading", "link", "listitem"].includes(node.role)) { const text = textOf(node).replace(/\s+/gu, " ").trim(); if (text) spoken.push(`${node.role}:${text}`); } for (const child of node.children ?? []) walk(child, here); };
      walk(tree, false);
      return spoken;
    };

    // ------------------------------------------------------------------ AC01
    await criterion("CBD-211-AC01", "Each category displays settled actual, pending provisional impact, remaining after settled, and remaining after pending as separately labeled values (web dashboard row)", async () => {
      await openDashboard();
      const rows = await rowRepresentations();
      const groceries = rows.find((r) => r.label === "Groceries");
      expect(groceries, `no Groceries row: ${JSON.stringify(rows.map((r) => r.label))}`);
      const cell = cellOf("Groceries");
      const axe = await accessibility();
      // The same row as a screen reader speaks it (one entry per paragraph) and as the 400 px view shows it.
      const spoken = await spokenRows();
      const start = spoken.findIndex((entry) => entry === "heading:Groceries"); const end = spoken.findIndex((entry, index) => index > start && entry.startsWith("heading:"));
      const spokenGroceries = start === -1 ? "" : spoken.slice(start, end === -1 ? undefined : end).filter((entry) => entry.startsWith("paragraph:")).join(" | ");
      await page.setViewport({ width: 400, height: 800 }); await openDashboard();
      const compact = (await rowRepresentations()).find((r) => r.label === "Groceries")?.text ?? "";
      await page.setViewport({ width: 1280, height: 900 });
      // What the row shows and what the API says for the same cell.
      const observed = `row text "${groceries.text}"; spoken "${spokenGroceries}"; compact (400 px) "${compact}"; API cell settled ${cell.settledActualMinorUnits}, pending ${cell.pendingProvisionalImpactMinorUnits}, remaining after settled ${cell.remainingAfterSettledMinorUnits}, remaining after pending ${cell.remainingAfterPendingMinorUnits}; tooltips ${JSON.stringify(groceries.tooltips)}; aria-labels ${JSON.stringify(groceries.ariaLabels)}; ${axe}`;
      // Each of the four values must be labelled with the API's name and carry the API's magnitude, in every representation.
      const value = (minor) => new RegExp(money(minor).replace(".", "\\."), "u");
      const expected = {
        "settled actual": [/Settled actual: /u, value(cell.settledActualMinorUnits)],
        "pending provisional impact": [/Pending provisional impact: /u, value(cell.pendingProvisionalImpactMinorUnits)],
        "remaining after settled": [/Remaining after settled: /u, value(cell.remainingAfterSettledMinorUnits)],
        "remaining after pending": [/Remaining after pending: /u, value(cell.remainingAfterPendingMinorUnits)],
      };
      const missing = [];
      for (const [mode, text] of [["text", groceries.text], ["spoken", spokenGroceries], ["compact", compact]]) {
        for (const [name, patterns] of Object.entries(expected)) if (!patterns.every((pattern) => pattern.test(text))) missing.push(`${mode}: ${name}`);
      }
      expect(missing.length === 0, `not every one of the four values is labelled with the API's name and magnitude in every representation; missing: ${missing.join(", ")}. ${observed}`);
      return observed;
    });

    // ------------------------------------------------------------------ AC02
    await criterion("CBD-211-AC02", "No visual, spoken, tooltip, or compact representation merges provisional and settled values into one unlabeled number (web: DOM text, accessibility tree, title attributes, aria, 400 px viewport)", async () => {
      await openDashboard();
      const wide = await rowRepresentations();
      const spoken = (await spokenRows()).filter((entry) => /USD/u.test(entry));
      await page.setViewport({ width: 400, height: 800 });
      await openDashboard();
      const compact = await rowRepresentations();
      const compactShot = join(shots, "qa-cbd211-compact.png"); await page.screenshot({ path: compactShot, fullPage: true });
      await page.setViewport({ width: 1280, height: 900 });
      const numbers = (text) => [...text.matchAll(/(?:^|[^\d.])(\d+\.\d{2}) USD/gu)].map((m) => m[1]);
      // Every number on every row, in every representation, sits behind one of the row's labels (the API's four names, the target, or "over by" inside a remaining value).
      const labelledNumber = /(Target|Settled actual:|Pending provisional impact:|Remaining after settled:|Remaining after pending:|over by) \d+\.\d{2} USD/gu;
      const isLabelled = (text) => new RegExp(labelledNumber.source, "u").test(text);
      const unlabeled = [];
      for (const [mode, rows] of [["wide", wide], ["compact", compact]]) {
        for (const row of rows) {
          const all = numbers(row.text); const labelledCount = (row.text.match(labelledNumber) ?? []).length;
          if (all.length !== labelledCount) unlabeled.push(`${mode} ${row.label}: ${all.length} numbers, ${labelledCount} labelled: "${row.text}"`);
          for (const tip of row.tooltips) if (/\d+\.\d{2}/u.test(tip) && !isLabelled(tip)) unlabeled.push(`${mode} ${row.label} tooltip "${tip}"`);
          for (const aria of row.ariaLabels) if (/\d+\.\d{2}/u.test(aria) && !isLabelled(aria)) unlabeled.push(`${mode} ${row.label} aria-label "${aria}"`);
        }
      }
      for (const entry of spoken) { const all = numbers(entry); const labelled = (entry.match(labelledNumber) ?? []).length; if (all.length !== labelled) unlabeled.push(`spoken ${entry} (${all.length} numbers, ${labelled} labelled)`); }
      expect(unlabeled.length === 0, `an unlabeled number was found: ${unlabeled.join("; ")}`);
      const tooltipCount = wide.reduce((n, r) => n + r.tooltips.length, 0) + compact.reduce((n, r) => n + r.tooltips.length, 0);
      const observed = `wide rows ${wide.length}, compact rows ${compact.length} (screenshot ${compactShot}), spoken entries with an amount ${spoken.length} (e.g. ${JSON.stringify(spoken.slice(0, 5))}), tooltips ${tooltipCount}, aria-labels ${wide.reduce((n, r) => n + r.ariaLabels.length, 0)}; every amount in every representation is labelled Target / Settled actual / Pending provisional impact / Remaining after settled / Remaining after pending (over by); Groceries wide "${wide.find((r) => r.label === "Groceries")?.text}" compact "${compact.find((r) => r.label === "Groceries")?.text}"`;
      // The merge the criterion forbids cannot be produced: no pending record can exist in the prototype (manual_transaction CHECK settlement_state = 'settled'). The web maps pendingProvisionalImpactMinorUnits and remainingAfterPendingMinorUnits to their own labelled sentences (apps/web/src/api/client.ts toProgressCell, spending.tsx progressSentences) and never adds them to the settled pair, so with a pending value it would show it separately rather than merge it (inferred from code and apps/web/tests/progress-presentation.test.ts, not observed in the browser).
      blocked(`no pending record can exist, so a merge cannot be observed; with pending = 0 on every cell: ${observed}`);
    });

    // ------------------------------------------------------------------ AC03
    await criterion("CBD-211-AC03", "Activating a category total opens authorized itemized detail whose signed sum equals that value under the same snapshot and report mode (web: click the category, compare the itemized rows with the total)", async () => {
      await openDashboard();
      const rowText = (await rowRepresentations()).find((r) => r.label === "Groceries").text;
      await clickText("Groceries");
      await waitText("Transactions in this category");
      await page.waitForSelector('[data-testid="detail-item"]');
      const axe = await accessibility();
      const figure = (name) => page.$eval(`[data-testid="detail-${name}"]`, (n) => n.textContent.trim());
      const header = { settled: await figure("settled"), pending: await figure("pending"), remainingAfterSettled: await figure("remaining-settled"), remainingAfterPending: await figure("remaining-pending") };
      const items = await page.$$eval('[data-testid="detail-item"]', (nodes) => nodes.map((n) => ({ title: n.querySelector("h3")?.textContent.trim(), line: n.querySelector("p")?.textContent.replace(/\s+/gu, " ").trim() })));
      const cell = cellOf("Groceries");
      const detail = await apiJson(`/v1/budget-spaces/${budgetId}/periods/${periodId}/progress/${category.Groceries}`); expect(detail.status === 200, `detail ${detail.status}`);
      const apiSum = detail.body.items.reduce((t, i) => t + i.amountMinorUnits, 0);
      const observed = `dashboard "${rowText}"; detail header ${JSON.stringify(header)}; items ${JSON.stringify(items)}; API items ${JSON.stringify(detail.body.items.map((i) => [i.description, i.amountMinorUnits]))} signed sum ${apiSum} == API cell ${cell.settledActualMinorUnits}; ${axe}`;
      // The header speaks the same four values as the row, in the row's words.
      const word = (minor) => (minor < 0 ? `${money(minor)} spent` : minor > 0 ? `${money(minor)} net refund` : money(minor));
      expect(header.settled.startsWith(word(cell.settledActualMinorUnits)), `the detail's settled actual is not the cell's (${word(cell.settledActualMinorUnits)}): ${observed}`);
      expect(header.remainingAfterSettled === (cell.remainingAfterSettledMinorUnits < 0 ? `over by ${money(cell.remainingAfterSettledMinorUnits)}` : money(cell.remainingAfterSettledMinorUnits)), `the detail's remaining after settled is not the cell's: ${observed}`);
      expect(rowText.includes(`Settled actual: ${header.settled}`) && rowText.includes(`Remaining after settled: ${header.remainingAfterSettled}`), `the header and the dashboard row disagree in words: ${observed}`);
      expect(items.length === detail.body.items.length, `item count: ${observed}`);
      // The signed sum of what the page shows must equal the value the person activated, read from the page's own
      // words: "N USD spent" is money out, "N USD refund" money back. A refund must not read like a spend.
      const refundRow = items.find((i) => i.title === "Refund for spoiled milk");
      expect(refundRow && /refund|credit|income|returned/iu.test(refundRow.line.replace(/Refund for spoiled milk/u, "")), `the refund item shows the same shape as a spend ("${refundRow?.line}"), so the sign is not visible and the itemized rows cannot be summed to the total. ${observed}`);
      const signedFromPage = items.map((i) => { const m = /(\d+\.\d{2}) USD( spent| refund)?/u.exec(i.line); if (!m) return Number.NaN; const cents = Math.round(Number(m[1]) * 100); return m[2] === " spent" ? -cents : m[2] === " refund" ? cents : cents === 0 ? 0 : Number.NaN; });
      const sum = signedFromPage.reduce((a, b) => a + b, 0);
      expect(!Number.isNaN(sum) && sum === cell.settledActualMinorUnits, `the signed sum read from the page (${sum} minor units, from ${JSON.stringify(signedFromPage)}) is not the settled actual ${cell.settledActualMinorUnits}: ${observed}`);
      return observed;
    });

    // ------------------------------------------------------------------ AC04
    await criterion("CBD-211-AC04", "Negative remaining, zero, positive remaining, negative net actual, and no-activity states have unambiguous text/semantics and do not rely on color alone (web dashboard rows)", async () => {
      await openDashboard();
      const rows = await rowRepresentations();
      const axe = await accessibility();
      const text = (label) => rows.find((r) => r.label === label)?.text ?? "(missing)";
      const states = { over: text("Over"), zero: text("Zero"), positive: text("Positive"), refund: text("Refund"), idle: text("Idle"), netZero: text("Net zero") };
      const observed = Object.entries(states).map(([k, v]) => `${k}: "${v}"`).join("; ");
      const problems = [];
      // Negative remaining: named with a word, not only a colour.
      if (!/Remaining after settled: over by 50\.00 USD/u.test(states.over)) problems.push(`negative remaining is not named: "${states.over}"`);
      if (!/Remaining after settled: 0\.00 USD/u.test(states.zero)) problems.push(`zero remaining: "${states.zero}"`);
      if (!/Remaining after settled: 75\.00 USD/u.test(states.positive)) problems.push(`positive remaining: "${states.positive}"`);
      // Negative net actual (a net refund of 20.00): the row must say refund and must not read as 20.00 spent.
      if (/20\.00 USD spent/u.test(states.refund) || !/Settled actual: 20\.00 USD net refund/u.test(states.refund)) problems.push(`negative net actual (API settled +2000, a net refund) reads as "${states.refund}" - not named as a net refund`);
      if (!/Remaining after settled: 120\.00 USD/u.test(states.refund)) problems.push(`the net refund's remaining after settled: "${states.refund}"`);
      // No activity must be distinguishable from activity that nets to zero, in words.
      const idleCore = states.idle.replace(/^Idle/u, ""); const netZeroCore = states.netZero.replace(/^Net zero/u, "");
      if (idleCore === netZeroCore) problems.push(`no-activity and net-zero activity are indistinguishable: "${states.idle}" vs "${states.netZero}"`);
      if (!/Settled actual: 0\.00 USD, no activity/u.test(states.idle)) problems.push(`no activity is not named: "${states.idle}"`);
      if (!/Settled actual: 0\.00 USD, nets to zero/u.test(states.netZero)) problems.push(`net-zero activity is not named: "${states.netZero}"`);
      // Colour: the over row's paragraphs use the same colours as a positive row (no colour-only signal to miss) or, if they differ, the word "Over" carries the state anyway.
      const overColors = rows.find((r) => r.label === "Over")?.colors; const positiveColors = rows.find((r) => r.label === "Positive")?.colors;
      const colourNote = JSON.stringify(overColors) === JSON.stringify(positiveColors) ? "over and positive rows use identical text colours (the word carries the state)" : `over ${JSON.stringify(overColors)} vs positive ${JSON.stringify(positiveColors)} (the word "Over by" is present regardless)`;
      expect(problems.length === 0, `${problems.join("; ")}. ${observed}; ${colourNote}; ${axe}`);
      return `${observed}; ${colourNote}; ${axe}`;
    });

    expect(pageErrors.length === 0, `page errors: ${JSON.stringify(pageErrors)}`);
  } catch (error) {
    console.log(`RUN aborted: ${error.message}`); results.push({ criterion: "RUN", case: "setup", status: "fail", detail: error.message, at: new Date().toISOString() });
    console.log(api.output()); console.log(webOutput);
  } finally {
    try { await browser?.close(); } catch { /* closed */ }
    if (web.exitCode === null) web.kill();
    await api.stop();
    if (previous === undefined) { try { unlinkSync(marker); } catch { /* gone */ } } else writeFileSync(marker, previous);
  }
  console.log("\n== Summary ==");
  const byCriterion = {};
  for (const r of results) (byCriterion[r.criterion] ??= []).push(r);
  for (const [id, cases] of Object.entries(byCriterion).sort()) {
    const status = cases.some((c) => c.status === "fail") ? "FAIL" : cases.some((c) => c.status === "blocked") ? "BLOCKED" : "PASS";
    console.log(`${id}: ${status} (${cases.filter((c) => c.status === "pass").length} pass, ${cases.filter((c) => c.status === "fail").length} fail, ${cases.filter((c) => c.status === "blocked").length} blocked)`);
  }
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ candidate: CANDIDATE, database: DB_NAME, at: new Date().toISOString(), results }, null, 2));
  const failed = results.filter((r) => r.status === "fail").length;
  console.log(failed ? `PROTOTYPE-QA-BROWSER-CBD211 COMPLETED WITH ${failed} FAILING CASE(S)` : "PROTOTYPE-QA-BROWSER-CBD211 PASSED");
  process.exit(failed ? 1 : 0);
}

await main();
