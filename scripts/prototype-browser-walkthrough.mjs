#!/usr/bin/env node
/* global fetch, setTimeout, URL, document, location */
/**
 * PROTOTYPE-SLICE-001 browser walkthrough against the real API (PROTO-ACTIVATION-001, ACT-05).
 *
 * Drives headless Chrome through the Next development server (`npm run dev`,
 * mock adapter off via `apps/web/.api-mode` = `live`) and the real API
 * process on 127.0.0.1:3001 with the local identity adapter and a scratch
 * PostgreSQL database: sign in on the hosted chooser, create a monthly budget
 * through preview and confirm, add two categories with base targets, reload,
 * and see the same plan; then (PK-8) invite a person, run the
 * invitation ceremony in a second browser, confirm, and transfer primary
 * ownership with the step-up; then sign out. Both processes are started here with
 * development configuration and stopped afterwards; the `.api-mode` marker is
 * restored to its previous content, or removed if it did not exist.
 *
 *   node scripts/prototype-browser-walkthrough.mjs --db cobudget_activation
 *
 * The scratch database is named on the command line (the repository's
 * environment guard reserves `process.env` for the shared loader) and is
 * never `cobudget_dev`; the API child receives an explicit environment
 * built here. Screenshots go to apps/web/.next/walkthrough-*.png
 * (untracked). No secret is printed; key material is generated per run.
 *
 * Mock mode (PROTO-WALKTHROUGH-MOCK-001) runs the same journey against the web
 * app's own mock adapter (`apps/web/src/api/mock-server.ts`, selected by the
 * development server when `apps/web/.api-mode` does not say `live`): no API
 * process, no database, no Docker.
 *
 *   node scripts/prototype-browser-walkthrough.mjs --mock
 *
 * `--db` is refused together with `--mock`. The marker is written as `mock`
 * for the run and restored exactly as in live mode. The mock signs in and
 * steps up without the hosted chooser on 127.0.0.1:3001 and enforces no rate
 * limit, so the steps that exist only to exercise those live-API surfaces are
 * logged as "skipped in mock mode: <reason>" instead of failing; every other
 * step runs and asserts as it does live. Screenshots go to
 * apps/web/.next/mock-walkthrough-*.png, and the transcript ends with the
 * count of steps run and skipped. Live mode is unchanged.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const WEB_PORT = 3000; const API_PORT = 3001;
const ORIGIN = `http://localhost:${WEB_PORT}`; const CEREMONY_ORIGIN = `http://127.0.0.1:${API_PORT}`;
function argument(name) { const index = process.argv.indexOf(name); return index === -1 ? undefined : process.argv[index + 1]; }
const MOCK = process.argv.includes("--mock");
const DB_NAME = argument("--db");
if (MOCK && process.argv.includes("--db")) { console.error("--db cannot be combined with --mock: mock mode runs against the web mock adapter with no API process and no database"); process.exit(2); }
if (!MOCK && (!DB_NAME || DB_NAME === "cobudget_dev")) { console.error("--db must name a migrated scratch database (never cobudget_dev), or pass --mock to run against the web mock adapter"); process.exit(2); }
/** The browser-side API base the web app uses in each mode (`apps/web/src/api/runtime-mode*.ts`) and the session cookie each transport sets. */
const API_BASE = MOCK ? "/api/mock/v1" : "/v1";
const SESSION_COOKIE = MOCK ? "__Host-cobudget_mock" : "__Host-cobudget_session";
const SHOT_PREFIX = MOCK ? "mock-walkthrough" : "walkthrough";

/** Exactly the variables `npm run dev` for the API needs (values here are per-run non-secrets); see the PR body. */
const apiEnvironment = {
  NODE_ENV: "development", LOG_LEVEL: "info", SERVICE_VERSION: "walkthrough", API_PORT: String(API_PORT), API_LISTEN_ADDRESS: "127.0.0.1",
  COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local", COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: randomBytes(32).toString("base64"), COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "walk-v1",
  COBUDGET_SESSION_PEPPER: randomBytes(32).toString("base64"),
  COBUDGET_SESSION_IDLE_TIMEOUT_SECONDS: "900", COBUDGET_SESSION_ABSOLUTE_LIFETIME_SECONDS: "3600", COBUDGET_SESSION_FRESH_ASSURANCE_WINDOW_SECONDS: "300",
  COBUDGET_SESSION_REVOCATION_PROPAGATION_TARGET_SECONDS: "60", COBUDGET_SESSION_PROVIDER_MAX_FUTURE_SKEW_SECONDS: "30",
  COBUDGET_SESSION_REJECTION_TIMING_FLOOR_MS: "20", COBUDGET_SESSION_REJECTION_TIMING_JITTER_MS: "10", COBUDGET_SESSION_REJECTION_TIMING_SAMPLE_COUNT: "50",
  COBUDGET_SESSION_REJECTION_TIMING_TIMEOUT_BUCKET_MS: "40", COBUDGET_SESSION_REJECTION_TIMING_MAX_DIFFERENTIAL_MS: "50",
  COBUDGET_SESSION_ENVELOPE_KEY_PROVIDER: "local", COBUDGET_SESSION_ENVELOPE_KEY: randomBytes(32).toString("base64"), COBUDGET_SESSION_ENVELOPE_KEY_VERSION: "walk-v1",
  COBUDGET_IDENTITY_PROVIDER: "local", COBUDGET_IDENTITY_ENVIRONMENT_ID: "development",
  COBUDGET_IDENTITY_ISSUER: `${CEREMONY_ORIGIN}/v1/identity/local`, COBUDGET_IDENTITY_CLIENT_ID: "cobudget-local-web",
  COBUDGET_IDENTITY_APPLICATION_ORIGIN: ORIGIN, COBUDGET_IDENTITY_CEREMONY_ORIGIN: CEREMONY_ORIGIN, COBUDGET_IDENTITY_CALLBACK_URI: `${ORIGIN}/v1/identity/callback`,
  COBUDGET_IDENTITY_CHALLENGE_LIFETIME_SECONDS: "600", COBUDGET_IDENTITY_EXCHANGE_LIFETIME_MS: "5000", COBUDGET_IDENTITY_MAPPING_MAX_ATTEMPTS: "5",
  COBUDGET_IDENTITY_HANDOFF_LIFETIME_SECONDS: "120", COBUDGET_IDENTITY_CLOCK_SKEW_SECONDS: "30",
  COBUDGET_DB_NAME: DB_NAME,
};

const steps = [];
function log(step, detail) { const line = `${String(steps.length + 1).padStart(2, "0")}. ${step}${detail === undefined ? "" : `: ${detail}`}`; steps.push(line); console.log(line); }
/** Mock mode only: one clear line for a step the mock adapter cannot perform, counted separately from the steps run. */
const skipped = [];
function skip(step, reason) { const line = `--. ${step}: skipped in mock mode: ${reason}`; skipped.push(line); console.log(line); }
function expect(condition, message) { if (!condition) { console.error(`FAILED: ${message}`); process.exitCode = 1; throw new Error(message); } }
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { try { if (await check()) return; } catch { /* not yet */ } await pause(300); }
  throw new Error(`timed out: ${label}`);
}

async function main() {
  const marker = join(root, "apps/web/.api-mode");
  // Restore whatever was there before (content included), or remove the marker if it did not exist.
  const previous = existsSync(marker) ? readFileSync(marker, "utf8") : undefined;
  writeFileSync(marker, MOCK ? "mock\n" : "live\n");
  // Mock mode starts no API child: the web mock adapter answers every request inside the Next process.
  const api = MOCK ? undefined : spawn(process.execPath, ["--import=tsx", "src/main.ts"], { cwd: join(root, "apps/api"), env: apiEnvironment, stdio: ["ignore", "pipe", "pipe"] });
  const web = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "--port", String(WEB_PORT)], { cwd: join(root, "apps/web"), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let apiOutput = ""; let webOutput = "";
  if (api) for (const stream of [api.stdout, api.stderr]) stream.on("data", (chunk) => { apiOutput = (apiOutput + chunk).slice(-8000); });
  for (const stream of [web.stdout, web.stderr]) stream.on("data", (chunk) => { webOutput = (webOutput + chunk).slice(-8000); });
  let browser;
  try {
    if (api) await waitFor(async () => api.exitCode === null && (await fetch(`${CEREMONY_ORIGIN}/health`)).status === 200, `API ready (${apiOutput})`);
    await waitFor(async () => web.exitCode === null && (await fetch(`${ORIGIN}/sign-in`)).ok, `web ready (${webOutput})`, 120_000);
    if (MOCK) log("Processes", `web ${ORIGIN} only (npm run dev, apps/web/.api-mode=mock, mock adapter on at ${API_BASE}); no API process, no database`);
    else log("Processes", `API ${CEREMONY_ORIGIN} (NODE_ENV=development, COBUDGET_IDENTITY_PROVIDER=local, COBUDGET_DB_NAME=${DB_NAME}); web ${ORIGIN} (npm run dev, apps/web/.api-mode=live, mock adapter off)`);
    const executablePath = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
    browser = await puppeteer.launch({ ...(executablePath ? { executablePath } : {}), headless: true, args: ["--no-sandbox"] });
    const page = await browser.newPage(); page.setDefaultTimeout(30_000);
    const shots = join(root, "apps/web/.next"); mkdirSync(shots, { recursive: true });
    const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    const requests = [];
    const readTimes = [];
    page.on("request", (request) => { const url = new URL(request.url()); if (url.pathname.startsWith(`${API_BASE}/`)) requests.push(`${request.method()} ${url.pathname}`); if (request.method() === "GET" && url.pathname.startsWith(`${API_BASE}/budget-spaces`)) readTimes.push(Date.now()); });
    const text = () => page.$eval("main", (node) => node.textContent ?? "");
    const waitText = (value) => page.waitForFunction((value) => document.querySelector("main")?.textContent?.includes(value), {}, value);
    /** One progress row by its category label, every snippet present (CBD-211: the four values are per row, so "0.00 USD, no activity" alone names no category). */
    const waitRow = (label, ...snippets) => page.waitForFunction((label, snippets) => {
      const row = [...document.querySelectorAll('[data-testid="progress-row"]')].find((node) => node.querySelector("h4")?.textContent?.trim() === label);
      const content = row?.textContent?.replace(/\s+/gu, " ") ?? "";
      return snippets.every((snippet) => content.includes(snippet));
    }, {}, label, snippets);
    const clickText = async (label) => {
      for (const handle of await page.$$("button, a")) if ((await handle.evaluate((node) => node.textContent?.trim())) === label) { await handle.scrollIntoView(); await handle.click(); return; }
      throw new Error(`Missing control: ${label}`);
    };

    await page.goto(`${ORIGIN}/budgets`); await page.waitForFunction(() => location.pathname === "/sign-in");
    log("GET /budgets signed out", `redirected to /sign-in (GET ${API_BASE}/identity/me denied)`);
    await clickText("Continue to sign in");
    if (MOCK) {
      // The mock's POST identity/begin sets the session cookie and answers `navigateTo: /budgets` itself: no provider hop.
      skip("Continue to sign in (hosted chooser)", `the mock adapter signs in without the hosted chooser on ${CEREMONY_ORIGIN}; POST ${API_BASE}/identity/begin navigates straight to /budgets`);
      skip("Chooser subject-a", "no chooser and no callback on the application origin in mock mode; the session is the mock's own");
    } else {
      await page.waitForFunction(() => location.pathname === "/v1/identity/local/authorize" && location.port === "3001");
      log("Continue to sign in", `POST /v1/identity/begin, browser navigated to the hosted chooser on ${CEREMONY_ORIGIN}`);
      await page.screenshot({ path: join(shots, `${SHOT_PREFIX}-1-chooser.png`) });
      await clickText("subject-a");
    }
    await page.waitForFunction(() => location.pathname === "/budgets");
    await waitText("Your budgets");
    const cookies = await browser.cookies();
    expect(cookies.some((cookie) => cookie.name === SESSION_COOKIE && cookie.httpOnly), "the session cookie is HttpOnly");
    expect(!cookies.some((cookie) => cookie.name.toLowerCase().includes("csrf")), "no CSRF cookie exists");
    if (MOCK) log("Signed in on the mock adapter", `${SESSION_COOKIE} (HttpOnly) set, no CSRF cookie, landed on /budgets`);
    else log("Chooser subject-a", "callback committed on the application origin, __Host-cobudget_session (HttpOnly) set, no CSRF cookie, landed on /budgets");
    await page.screenshot({ path: join(shots, `${SHOT_PREFIX}-2-budgets.png`) });

    await clickText("Create a budget"); await waitText("Budget name");
    await page.type('[id="field-name"]', "Household walkthrough");
    await clickText("Preview schedule"); await waitText("Complete current period");
    // CBD-236: the approved Primary Owner self-disclosure is presented above the confirm control and
    // must be explicitly acknowledged; nothing is ticked for the person.
    const acknowledgement = await page.$('[id="field-acknowledged-disclosure"]');
    if (!acknowledgement) throw new Error("the creation review presents no consent acknowledgement");
    if (await acknowledgement.evaluate((node) => node.checked)) throw new Error("the consent acknowledgement is ticked by default");
    await acknowledgement.click();
    await page.waitForFunction(() => [...document.querySelectorAll("button")].find((node) => node.textContent === "Confirm and create budget")?.disabled === false);
    const periods = await page.$$eval("ol li", (nodes) => nodes.map((node) => node.textContent));
    expect(periods.length === 4, "the preview shows the current period plus three");
    log("Create a budget: Preview schedule (monthly, day 1)", `POST /v1/budget-creation-proposals 201; ${periods.length} periods rendered; confirm enabled after render`);
    await page.screenshot({ path: join(shots, `${SHOT_PREFIX}-3-preview.png`) });
    await clickText("Confirm and create budget");
    await waitText("No categories yet");
    const budgetId = new URL(page.url()).pathname.split("/").at(-1);
    const dashboard = await text();
    expect(dashboard.includes("Active period identity"), "the dashboard shows the active period");
    log("Confirm and create budget", `POST .../confirm committed; dashboard /budgets/${budgetId} shows the stored active period`);
    await page.screenshot({ path: join(shots, `${SHOT_PREFIX}-4-dashboard.png`) });

    await clickText("Edit category plan"); await waitText("Add category");
    for (const [name, amount] of [["Groceries", "400"], ["Rent", "1500"]]) {
      await page.type("#category-name", name); await clickText("Add category"); await waitText(`Base target for ${name}`);
      const input = await page.$(`[id^="target-"]:not([data-done])`);
      const rows = await page.$$('[id^="target-"]');
      const target = rows.at(-1) ?? input;
      await target.click({ clickCount: 3 }); await target.type(amount);
      const buttons = await page.$$("button");
      const saveButtons = [];
      for (const button of buttons) if ((await button.evaluate((node) => node.textContent?.trim())) === "Save target") saveButtons.push(button);
      await saveButtons.at(-1).click();
      await waitText(`Period target: ${amount}.00 USD`);
      log(`Add category ${name}, base target ${amount}`, `PUT categories, PUT targets, GET plan: period target ${amount}.00 USD`);
    }
    await page.screenshot({ path: join(shots, `${SHOT_PREFIX}-5-plan.png`) });
    const before = await text();
    await page.reload(); await waitText("Period target: 1500.00 USD");
    const after = await text();
    expect(after.includes("Period target: 400.00 USD") && after.includes("Period target: 1500.00 USD"), "both targets survive the reload");
    expect(after.includes(budgetId), "the same budget identity after reload");
    log("Reload", "GET /v1/identity/me bootstrapped again, GET detail and plan: the same plan (Groceries 400.00, Rent 1500.00 USD)");
    await page.screenshot({ path: join(shots, `${SHOT_PREFIX}-6-reload.png`) });
    expect(before.includes("400.00") && after.includes("400.00"), "plan content is stable");

    // --- PROTO-INCREMENT-B-001: an account, one split expense, progress and the detail -------------
    await page.goto(`${ORIGIN}/budgets/${budgetId}`); await waitText("Accounts and spending");
    const fill = async (selector, value) => {
      await page.waitForSelector(selector);
      await page.focus(selector);
      await page.keyboard.down("Control"); await page.keyboard.press("KeyA"); await page.keyboard.up("Control");
      await page.keyboard.press("Backspace");
      await page.type(selector, value);
      const actual = await page.$eval(selector, (node) => node.value);
      expect(actual === value, `typing into ${selector} did not take (${actual})`);
    };
    await fill("#account-name", "Everyday");
    await fill("#account-opening", "1250.00");
    await clickText("Add account"); await waitText("Added Everyday.");
    await waitText("checking · opening balance 1250.00 USD");
    log("Add account Everyday (checking, opening 1250.00)", "POST .../accounts 201; the account is listed with its type and opening balance");
    await page.screenshot({ path: join(shots, `${SHOT_PREFIX}-7-accounts.png`) });

    const periodStart = (await text()).match(/(\d{4}-\d{2}-\d{2}) through/)[1];
    const allocationIds = await page.$$eval('input[id^="allocation-"]', (nodes) => nodes.map((node) => `#${node.id}`));
    expect(allocationIds.length === 2, `one allocation input per live category, got ${allocationIds.length}`);
    const recordExpense = async (groceries, rent) => {
      await fill("#expense-date", periodStart);
      await fill("#expense-amount", "12.50");
      await fill("#expense-description", "Corner shop");
      await fill(allocationIds[0], groceries);
      await fill(allocationIds[1], rent);
      await clickText("Record expense");
    };
    await recordExpense("8.00", "4.00");
    await waitText("The category amounts must add up to the expense amount exactly.");
    log("Record expense with an inexact split", "POST .../transactions 400 allocation_sum_mismatch; the server's refusal is shown on the allocation fieldset");

    await recordExpense("8.00", "4.50");
    await waitText("Expense recorded.");
    // CBD-211-AC01: each row shows the API's four values under the API's names, each a magnitude with its sign as a word.
    await waitRow("Groceries", "Target 400.00 USD", "Settled actual: 8.00 USD spent", "Pending provisional impact: 0.00 USD, none", "Remaining after settled: 392.00 USD", "Remaining after pending: 392.00 USD");
    await waitRow("Rent", "Target 1500.00 USD", "Settled actual: 4.50 USD spent", "Pending provisional impact: 0.00 USD, none", "Remaining after settled: 1495.50 USD", "Remaining after pending: 1495.50 USD");
    log("Record expense 12.50 split 8.00 Groceries / 4.50 Rent", "POST .../transactions 201; GET .../progress: Groceries settled actual 8.00 spent, pending 0.00 none, remaining after settled 392.00, remaining after pending 392.00; Rent 4.50 spent, 1495.50 remaining after settled and after pending");
    await page.screenshot({ path: join(shots, `${SHOT_PREFIX}-8-progress.png`) });

    await page.reload(); await waitRow("Groceries", "Settled actual: 8.00 USD spent");
    log("Reload after recording", "the same figures: they are the server's, not the browser's");

    await clickText("Groceries"); await waitText("Transactions in this category");
    await waitText("Corner shop");
    await waitText("8.00 USD spent · Everyday");
    // CBD-211-AC03: the detail header speaks the same four values as the row, and each item carries its sign as a word.
    const figure = async (name) => page.$eval(`[data-testid="detail-${name}"]`, (node) => node.textContent?.trim());
    expect((await figure("settled")) === "8.00 USD spent" && (await figure("pending")) === "0.00 USD, none" && (await figure("remaining-settled")) === "392.00 USD" && (await figure("remaining-pending")) === "392.00 USD",
      `the detail header disagrees with the row: settled "${await figure("settled")}", pending "${await figure("pending")}", remaining after settled "${await figure("remaining-settled")}", remaining after pending "${await figure("remaining-pending")}"`);
    log("Open the Groceries detail", "GET .../progress/{categoryId} 200: one itemized transaction of 8.00 USD spent agreeing with the header (settled actual 8.00 USD spent, pending 0.00 USD none, remaining after settled and after pending 392.00 USD)");
    await page.screenshot({ path: join(shots, `${SHOT_PREFIX}-9-detail.png`) });

    // F-REVB-01 (PR #340): this row is the Groceries SHARE of a 12.50 expense split 8.00/4.50.
    // The in-place edit rewrites the whole transaction with one allocation, so offering it here
    // would take 4.50 away from Rent with nothing said. The page withholds it and states why,
    // and its removal control is labelled for what it actually removes.
    const controls = async () => page.$$eval("button", (nodes) => nodes.map((node) => node.textContent?.trim()));
    const splitShareIntact = async (when) => {
      const body = await text();
      expect(body.includes("Corner shop") && body.includes("8.00 USD spent · Everyday"), `the split share moved ${when}`);
    };
    await waitText("This expense is split across 2 categories, so it cannot be changed from this page");
    expect(!(await controls()).includes("Edit this expense"), "a share of a split expense still offers the in-place edit");
    expect((await controls()).includes("Remove this whole expense"), `the whole-expense removal is missing: ${JSON.stringify(await controls())}`);
    await splitShareIntact("when the detail refused the edit");
    log("The split share refuses the in-place edit", "allocationCount 2: no 'Edit this expense' control, the page states 'This expense is split across 2 categories, so it cannot be changed from this page', and removal is offered as 'Remove this whole expense'");
    await page.screenshot({ path: join(shots, `${SHOT_PREFIX}-10-split-refusal.png`) });

    // A single-category expense is the whole expense, so it does still edit in place.
    await clickText("Back to the budget"); await waitText("Accounts and spending");
    // The section's heading renders before its read resolves, so wait for the form itself.
    await waitText("Record an expense"); await page.waitForSelector('input[id^="allocation-"]');
    const singleIds = await page.$$eval('input[id^="allocation-"]', (nodes) => nodes.map((node) => `#${node.id}`));
    await fill("#expense-date", periodStart);
    await fill("#expense-amount", "3.00");
    await fill("#expense-description", "Milk");
    await fill(singleIds[0], "3.00");
    await clickText("Record expense"); await waitText("Expense recorded.");
    await waitRow("Groceries", "Settled actual: 11.00 USD spent", "Remaining after settled: 389.00 USD");
    await waitRow("Rent", "Settled actual: 4.50 USD spent");
    log("Record a single-category expense Milk 3.00 Groceries", "POST .../transactions 201 with one allocation; Groceries spent 8.00 + 3.00 = 11.00, Rent untouched at 4.50");

    await clickText("Groceries"); await waitText("Transactions in this category");
    await waitText("Milk");
    await splitShareIntact("when the single-category expense was recorded");
    await clickText("Edit this expense");
    const amountId = await page.$eval('input[id^="edit-amount-"]', (node) => `#${node.id}`);
    await fill(amountId, "20.00");
    await clickText("Save expense"); await waitText("Expense updated.");
    await waitText("20.00 USD spent · Everyday");
    await splitShareIntact("when the single-category expense was edited");
    log("Edit Milk in place to 20.00", "PATCH .../transactions 200 revision 2; the split share is still Corner shop 8.00 USD, so editing one expense moved no other category");
    await page.screenshot({ path: join(shots, `${SHOT_PREFIX}-11-single-edit.png`) });

    await clickText("Remove this expense"); await waitText("Expense removed.");
    // The detail states its own settled actual, in the same words as the dashboard row.
    await page.waitForFunction(() => document.querySelector('[data-testid="detail-settled"]')?.textContent?.trim() === "8.00 USD spent");
    await splitShareIntact("when the single-category expense was removed");
    log("Remove Milk", "POST .../remove 201 tombstone; the detail falls back to the split share alone and Groceries returns to 8.00");

    await clickText("Remove this whole expense"); await waitText("Expense removed.");
    await waitText("Nothing has been recorded against this category for the active period.");
    await clickText("Back to the budget"); await waitText("Accounts and spending");
    // CBD-211-AC04: a category with nothing recorded against it says so in words (a removed expense leaves no record behind).
    await waitRow("Groceries", "Settled actual: 0.00 USD, no activity", "Remaining after settled: 400.00 USD", "Remaining after pending: 400.00 USD");
    await waitRow("Rent", "Settled actual: 0.00 USD, no activity", "Remaining after settled: 1500.00 USD", "Remaining after pending: 1500.00 USD");
    log("Remove the whole split expense", "POST .../remove 201 tombstone on the split transaction; both shares go with it, so the settled actual returns to 0.00 USD, no activity, and remaining after settled and after pending to the target for Groceries and Rent alike, in the aggregate and the detail");
    await page.screenshot({ path: join(shots, `${SHOT_PREFIX}-12-removed.png`) });

    // --- PK-8 (INVITATIONS-DESIGN-001): the invitation ceremony over the web and the Primary transfer with the step-up ---
    // A second browser context is the invitee's own browser: its own cookie jar, no session, the link in hand.
    // The owner's reads count on rlp-266-authenticated-read-v1 (60 per sliding minute plus a burst of 10 per actor); the
    // steps above spend most of that pool, so the PK-8 half starts once the window has drained rather than as a uniform denial.
    const recentReads = readTimes.filter((at) => Date.now() - at < 60_000);
    if (MOCK) skip("Rate-limit window", `the mock adapter enforces no rlp-266-authenticated-read-v1 pool (${recentReads.length} budget reads in the sliding minute, no wait)`);
    else if (recentReads.length >= 30) { const wait = 61_000 - (Date.now() - recentReads[0]); log("Rate-limit window", `${recentReads.length} budget reads in the sliding minute; waiting ${Math.ceil(wait / 1000)} s for surf-266-budget-read to drain`); await pause(wait); }
    const inviteeContext = await browser.createBrowserContext();
    const invitee = await inviteeContext.newPage(); invitee.setDefaultTimeout(30_000);
    invitee.on("pageerror", (error) => errors.push(error.message));
    invitee.on("request", (request) => { const url = new URL(request.url()); if (url.pathname.startsWith(`${API_BASE}/`)) requests.push(`${request.method()} ${url.pathname}`); });
    const on = (target) => ({
      text: () => target.$eval("main", (node) => node.textContent ?? ""),
      waitText: (value) => target.waitForFunction((value) => document.querySelector("main")?.textContent?.includes(value), {}, value),
      clickText: async (label) => { for (const handle of await target.$$("button, a")) if ((await handle.evaluate((node) => node.textContent?.trim())) === label) { await handle.scrollIntoView(); await handle.click(); return; } throw new Error(`Missing control: ${label}`); },
      fill: async (selector, value) => { await target.waitForSelector(selector); await target.focus(selector); await target.keyboard.down("Control"); await target.keyboard.press("KeyA"); await target.keyboard.up("Control"); await target.keyboard.press("Backspace"); await target.type(selector, value); expect((await target.$eval(selector, (node) => node.value)) === value, `typing into ${selector} did not take`); },
      waitEnabled: (label) => target.waitForFunction((label) => [...document.querySelectorAll("button")].find((node) => node.textContent?.trim() === label)?.disabled === false, {}, label),
      rows: (count) => target.waitForFunction((count) => document.querySelectorAll('[data-testid="member-row"]').length === count, {}, count),
      chooser: async (scenario) => { await target.waitForFunction(() => location.pathname === "/v1/identity/local/authorize" && location.port === "3001"); for (const handle of await target.$$("a")) if ((await handle.evaluate((node) => node.textContent?.trim())) === scenario) { await handle.click(); break; } await target.waitForFunction((origin) => location.origin === origin, {}, ORIGIN); },
    });
    const owner = on(page); const holder = on(invitee);

    await page.goto(`${ORIGIN}/budgets/${budgetId}/members`); await owner.rows(1); await owner.waitText("Primary Owner");
    log("Members page", "GET .../members on 1.view_members: one row, display name (the neutral label until a display name exists), role Primary Owner, joined-at");
    await page.screenshot({ path: join(shots, `${SHOT_PREFIX}-13-members.png`) });

    await owner.clickText("Invitations"); await owner.waitText("No invitations yet");
    await owner.fill("#invite-destination", "Invitee@Example.com"); await owner.clickText("Send invitation");
    await owner.waitText("Invitation sent to i***@example.com as Collaborator."); await owner.waitText("Sent, awaiting a response");
    const deliveries = await page.evaluate(async (base) => (await fetch(`${base}/local/invitation-deliveries`)).json(), API_BASE);
    const delivered = deliveries.deliveries.find((row) => row.destinationMasked === "i***@example.com");
    expect(delivered && deliveries.fidelityLabel === "simulated", "the simulated delivery surface renders the new invitation");
    expect(!(await owner.text()).includes(delivered.code), "the bearer never appears on the owner's page");
    log("Invite a person (Collaborator, i***@example.com)", `POST .../invitations 201 on 24.invite_nonowner with an idempotency key; the list shows the masked destination, role and state; GET ${API_BASE}/local/invitation-deliveries (FIDELITY_LABEL simulated) carries the link code and the six-digit challenge`);
    await page.screenshot({ path: join(shots, `${SHOT_PREFIX}-14-invitations.png`) });

    await invitee.goto(`${ORIGIN}/invitation#code=${encodeURIComponent(delivered.code)}`);
    await invitee.waitForFunction(() => location.pathname.startsWith("/invitation/ceremony/"));
    await holder.waitText("Prove you received this invitation");
    const ceremonyCookie = (await inviteeContext.cookies()).find((cookie) => cookie.name === "__Host-mp_invitation_ceremony");
    expect(ceremonyCookie && ceremonyCookie.httpOnly && ceremonyCookie.secure && ceremonyCookie.sameSite === "Strict", "the ceremony cookie is HttpOnly, Secure, SameSite=Strict on the application origin");
    expect(!invitee.url().includes(delivered.code), "the code left the address bar");
    const wrongCode = delivered.channelChallenge === "000000" ? "000001" : "000000";
    await holder.fill("#channel-code", wrongCode); await holder.clickText("Check code"); await holder.waitText("That code did not match. 4 attempts remain.");
    await holder.fill("#channel-code", delivered.channelChallenge); await holder.clickText("Check code"); await holder.waitText("Sign in or create your MoneyPact account");
    expect(!(await holder.text()).includes("Collaborator"), "nothing about the invitation is shown before sign-in");
    log("Invitee opens the link in a second browser", "POST /v1/invitations/resolve 200 (same-origin, no CSRF header) set __Host-mp_invitation_ceremony; one wrong six-digit code committed its attempt (4 remain); the right one proved the channel; the page offers sign-in or account creation and shows nothing about the invitation yet");
    await invitee.screenshot({ path: join(shots, `${SHOT_PREFIX}-15-ceremony-signin.png`) });

    const ceremonyUrl = invitee.url();
    await holder.clickText("Sign in or create your MoneyPact account");
    // CBD-190 section 3.5: the bounded return destination class for `invitation_ceremony` lands identity/begin
    // on /invitation, not back on the ceremony itself, in both modes since PR #390. No per-invitation identifier
    // travels through the identity challenge, so the person reopens their invitation link (the same ceremony
    // URL) to continue, as apps/web/tests/invitations.browser.mjs (about lines 150-155) does.
    if (MOCK) skip("Invitee chooser subject-b", "the mock adapter signs the invitee in without the hosted chooser and lands on /invitation");
    else await holder.chooser("subject-b");
    await invitee.waitForFunction(() => location.pathname === "/invitation");
    await invitee.goto(ceremonyUrl);
    await invitee.waitForFunction(() => location.pathname.startsWith("/invitation/ceremony/"));
    await holder.waitText("Before you accept");
    expect((await invitee.$eval("#choice-accept", (node) => node.checked)) === false && (await invitee.$eval("#choice-decline", (node) => node.checked)) === false, "the choice is presented with no default");
    await invitee.screenshot({ path: join(shots, `${SHOT_PREFIX}-16-disclosure.png`) });
    await invitee.click("#choice-accept"); await invitee.click("#acknowledged-disclosure"); await holder.waitEnabled("Record my acceptance");
    await holder.clickText("Record my acceptance"); await holder.waitText("Your acceptance is recorded");
    log("Invitee signs in as subject-b and returns, attaches, reads, accepts", `POST ${API_BASE}/identity/begin landed on /invitation (the bounded return destination, no return marker); the invitation link was reopened to reach the ceremony again; POST .../attach 200 (CSRF header); GET /v1/invitations/{ceremonyId}: the approved invitation_collaborator v1 text with choice {accept: false, decline: false}; POST .../accept 200 awaiting_confirmation with the acknowledged kind and version only`);
    await invitee.screenshot({ path: join(shots, `${SHOT_PREFIX}-17-accepted.png`) });

    // The real API projects `awaiting_confirmation` the moment the invitee accepts (PK8-F05, apps/api/src/invitations/http.test.ts
    // about line 265), exactly as the mock does; both modes wait for the same projected state.
    await page.reload(); await owner.waitText("Acceptance awaiting your confirmation");
    await owner.clickText("Confirm acceptance from i***@example.com"); await owner.waitText("Acceptance confirmed: the person joined as Collaborator.");
    await owner.clickText("Members"); await owner.rows(2); await owner.waitText("Collaborator");
    await invitee.goto(`${ORIGIN}/budgets/${budgetId}/members`); await holder.rows(2);
    log("Owner confirms the acceptance (TR-73-39 + TR-73-13)", "POST .../invitations/{id}/confirm 200 with a confirmationIdempotencyKey: the receipt names the role; GET .../members shows Primary Owner and Collaborator to both members");
    await page.screenshot({ path: join(shots, `${SHOT_PREFIX}-18-members-two.png`) });

    await page.goto(`${ORIGIN}/budgets/${budgetId}/transfer`); await owner.waitText("Propose a transfer");
    await page.select("#transfer-recipient", await page.$eval("#transfer-recipient option:nth-child(2)", (node) => node.value));
    await owner.clickText("Propose transfer"); await page.waitForFunction(() => /\/transfer\/[0-9a-f-]{36}$/u.test(location.pathname));
    const transferPath = new URL(page.url()).pathname;
    await owner.waitText("Proposed, awaiting the recipient");
    log("Primary Owner proposes the transfer", `POST .../primary-transfers 201 on 29.propose_primary_transfer; the status view ${transferPath.split("/").at(-1)} is shown to the two parties only`);
    await invitee.goto(`${ORIGIN}${transferPath}`); await holder.waitText("Before you accept primary ownership");
    await invitee.click("#recipient-acknowledged"); await holder.waitEnabled("Accept primary ownership"); await holder.clickText("Accept primary ownership");
    await holder.waitText("Accepted by the recipient, awaiting the Primary Owner's confirmation");
    log("Recipient accepts (TR-73-41)", "POST .../accept 200 recipient_accepted after the approved primary_transfer_recipient v1 disclosure was acknowledged");
    await invitee.screenshot({ path: join(shots, `${SHOT_PREFIX}-19-transfer-accepted.png`) });

    await owner.clickText("Refresh transfer"); await owner.waitText("Accepted by the recipient");
    await page.click("#outgoing-acknowledged"); await owner.waitEnabled("Continue to the identity check");
    await owner.clickText("Continue to the identity check");
    if (MOCK) skip("Step-up chooser subject-a", "the mock adapter issues the fresh-assurance grant without a chooser hop and navigates to the space's transfer page");
    else await owner.chooser("subject-a");
    await owner.waitText("Back from the identity check"); await page.waitForFunction(() => location.search === "");
    await page.click("#outgoing-acknowledged"); await owner.waitEnabled("Confirm the transfer"); await owner.clickText("Confirm the transfer");
    await owner.waitText("Transfer committed");
    await page.goto(`${ORIGIN}/budgets/${budgetId}/members`); await owner.rows(2);
    const roles = await page.$$eval('[data-testid="member-row"] dd', (nodes) => nodes.map((node) => node.textContent));
    expect(roles.includes("Co-owner") && roles.includes("Primary Owner"), `the roles swapped: ${roles.join(", ")}`);
    // CBD-190 §3.2/§3.3/§3.5: `budget_transfer` is a reserved destination the API derives from the step-up
    // challenge's own bound budget space; the post-result navigation returns to the space's transfer page with
    // no client-held return marker, in either mode. Mock skips the hosted-chooser hop itself (see the `skip` above).
    const stepUpNavigation = MOCK
      ? `POST ${API_BASE}/identity/step-up/begin bound to 29.transfer_primary_ownership and the space; the mock adapter issues the fresh-assurance grant with no chooser hop and navigates straight to the space's transfer page`
      : "POST /v1/identity/step-up/begin bound to 29.transfer_primary_ownership and the space, the hosted chooser, then GET /v1/identity/step-up/callback back to the space's transfer page (the budget_transfer destination, no client-held return marker)";
    log("Primary Owner steps up and confirms (TR-73-42, TR-73-43)", `${stepUpNavigation}; POST .../confirm with the acknowledgedDisclosure claim on the live transferId read from the view: committed, freshAssurance consumed; the members list now shows the former Primary Owner as Co-owner and the recipient as Primary Owner`);
    await page.screenshot({ path: join(shots, `${SHOT_PREFIX}-20-transfer-committed.png`) });
    await inviteeContext.close();

    await clickText("Sign out"); await page.waitForFunction(() => location.pathname === "/");
    expect(!(await browser.cookies()).some((cookie) => cookie.name === SESSION_COOKIE), "the session cookie is deleted at logout");
    await page.goto(`${ORIGIN}/budgets`); await page.waitForFunction(() => location.pathname === "/sign-in");
    log("Sign out", "POST /v1/identity/logout with X-CoBudget-CSRF: cookie deleted, /budgets redirects to /sign-in again");
    expect(errors.length === 0, `page errors: ${errors.join("; ")}`);
    log("API requests observed from the browser", [...new Set(requests)].join(", "));
    if (MOCK) console.log(`Mock mode: ${steps.length} steps run, ${skipped.length} skipped${skipped.length ? `\n${skipped.join("\n")}` : ""}`);
    console.log("PROTOTYPE-WALKTHROUGH PASSED");
  } catch (error) {
    console.error(`API output (tail):\n${apiOutput.slice(-2000)}\nweb output (tail):\n${webOutput.slice(-2000)}`);
    // The failing pages, for the person reading the transcript (untracked, like every screenshot here).
    for (const [index, target] of (browser ? await browser.pages() : []).entries()) {
      try { await target.screenshot({ path: join(root, "apps/web/.next", `${SHOT_PREFIX}-failure-${index}.png`), fullPage: true }); } catch { /* a closed page */ }
    }
    throw error;
  } finally {
    await browser?.close();
    if (previous === undefined) { try { unlinkSync(marker); } catch { /* already gone */ } } else writeFileSync(marker, previous);
    api?.kill(); web.kill();
    await Promise.all([...(api ? [new Promise((resolve) => api.once("exit", resolve))] : []), new Promise((resolve) => web.once("exit", resolve))]);
  }
}

await main();
