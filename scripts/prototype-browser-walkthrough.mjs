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
 * and see the same plan; then sign out. Both processes are started here with
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
const DB_NAME = argument("--db");
if (!DB_NAME || DB_NAME === "cobudget_dev") { console.error("--db must name a migrated scratch database (never cobudget_dev)"); process.exit(2); }

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
  writeFileSync(marker, "live\n");
  const api = spawn(process.execPath, ["--import=tsx", "src/main.ts"], { cwd: join(root, "apps/api"), env: apiEnvironment, stdio: ["ignore", "pipe", "pipe"] });
  const web = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "--port", String(WEB_PORT)], { cwd: join(root, "apps/web"), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let apiOutput = ""; let webOutput = "";
  for (const stream of [api.stdout, api.stderr]) stream.on("data", (chunk) => { apiOutput = (apiOutput + chunk).slice(-8000); });
  for (const stream of [web.stdout, web.stderr]) stream.on("data", (chunk) => { webOutput = (webOutput + chunk).slice(-8000); });
  let browser;
  try {
    await waitFor(async () => api.exitCode === null && (await fetch(`${CEREMONY_ORIGIN}/health`)).status === 200, `API ready (${apiOutput})`);
    await waitFor(async () => web.exitCode === null && (await fetch(`${ORIGIN}/sign-in`)).ok, `web ready (${webOutput})`, 120_000);
    log("Processes", `API ${CEREMONY_ORIGIN} (NODE_ENV=development, COBUDGET_IDENTITY_PROVIDER=local, COBUDGET_DB_NAME=${DB_NAME}); web ${ORIGIN} (npm run dev, apps/web/.api-mode=live, mock adapter off)`);
    const executablePath = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
    browser = await puppeteer.launch({ ...(executablePath ? { executablePath } : {}), headless: true, args: ["--no-sandbox"] });
    const page = await browser.newPage(); page.setDefaultTimeout(30_000);
    const shots = join(root, "apps/web/.next"); mkdirSync(shots, { recursive: true });
    const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    const requests = [];
    page.on("request", (request) => { const url = new URL(request.url()); if (url.pathname.startsWith("/v1/")) requests.push(`${request.method()} ${url.pathname}`); });
    const text = () => page.$eval("main", (node) => node.textContent ?? "");
    const waitText = (value) => page.waitForFunction((value) => document.querySelector("main")?.textContent?.includes(value), {}, value);
    const clickText = async (label) => {
      for (const handle of await page.$$("button, a")) if ((await handle.evaluate((node) => node.textContent?.trim())) === label) { await handle.scrollIntoView(); await handle.click(); return; }
      throw new Error(`Missing control: ${label}`);
    };

    await page.goto(`${ORIGIN}/budgets`); await page.waitForFunction(() => location.pathname === "/sign-in");
    log("GET /budgets signed out", "redirected to /sign-in (GET /v1/identity/me denied)");
    await clickText("Continue to sign in");
    await page.waitForFunction(() => location.pathname === "/v1/identity/local/authorize" && location.port === "3001");
    log("Continue to sign in", `POST /v1/identity/begin, browser navigated to the hosted chooser on ${CEREMONY_ORIGIN}`);
    await page.screenshot({ path: join(shots, "walkthrough-1-chooser.png") });
    await clickText("subject-a");
    await page.waitForFunction(() => location.pathname === "/budgets");
    await waitText("Your budgets");
    const cookies = await browser.cookies();
    expect(cookies.some((cookie) => cookie.name === "__Host-cobudget_session" && cookie.httpOnly), "the session cookie is HttpOnly");
    expect(!cookies.some((cookie) => cookie.name.toLowerCase().includes("csrf")), "no CSRF cookie exists");
    log("Chooser subject-a", "callback committed on the application origin, __Host-cobudget_session (HttpOnly) set, no CSRF cookie, landed on /budgets");
    await page.screenshot({ path: join(shots, "walkthrough-2-budgets.png") });

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
    await page.screenshot({ path: join(shots, "walkthrough-3-preview.png") });
    await clickText("Confirm and create budget");
    await waitText("No categories yet");
    const budgetId = new URL(page.url()).pathname.split("/").at(-1);
    const dashboard = await text();
    expect(dashboard.includes("Active period identity"), "the dashboard shows the active period");
    log("Confirm and create budget", `POST .../confirm committed; dashboard /budgets/${budgetId} shows the stored active period`);
    await page.screenshot({ path: join(shots, "walkthrough-4-dashboard.png") });

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
    await page.screenshot({ path: join(shots, "walkthrough-5-plan.png") });
    const before = await text();
    await page.reload(); await waitText("Period target: 1500.00 USD");
    const after = await text();
    expect(after.includes("Period target: 400.00 USD") && after.includes("Period target: 1500.00 USD"), "both targets survive the reload");
    expect(after.includes(budgetId), "the same budget identity after reload");
    log("Reload", "GET /v1/identity/me bootstrapped again, GET detail and plan: the same plan (Groceries 400.00, Rent 1500.00 USD)");
    await page.screenshot({ path: join(shots, "walkthrough-6-reload.png") });
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
    await page.screenshot({ path: join(shots, "walkthrough-7-accounts.png") });

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
    await waitText("Spent 8.00 USD of 400.00 USD");
    await waitText("Remaining 392.00 USD");
    await waitText("Spent 4.50 USD of 1500.00 USD");
    await waitText("Remaining 1495.50 USD");
    log("Record expense 12.50 split 8.00 Groceries / 4.50 Rent", "POST .../transactions 201; GET .../progress: Groceries spent 8.00 remaining 392.00, Rent spent 4.50 remaining 1495.50");
    await page.screenshot({ path: join(shots, "walkthrough-8-progress.png") });

    await page.reload(); await waitText("Spent 8.00 USD of 400.00 USD");
    log("Reload after recording", "the same figures: they are the server's, not the browser's");

    await clickText("Groceries"); await waitText("Transactions in this category");
    await waitText("Corner shop");
    await waitText("8.00 USD · Everyday");
    log("Open the Groceries detail", "GET .../progress/{categoryId} 200: one itemized transaction of 8.00 USD agreeing with the aggregate");
    await page.screenshot({ path: join(shots, "walkthrough-9-detail.png") });

    // F-REVB-01 (PR #340): this row is the Groceries SHARE of a 12.50 expense split 8.00/4.50.
    // The in-place edit rewrites the whole transaction with one allocation, so offering it here
    // would take 4.50 away from Rent with nothing said. The page withholds it and states why,
    // and its removal control is labelled for what it actually removes.
    const controls = async () => page.$$eval("button", (nodes) => nodes.map((node) => node.textContent?.trim()));
    const splitShareIntact = async (when) => {
      const body = await text();
      expect(body.includes("Corner shop") && body.includes("8.00 USD · Everyday"), `the split share moved ${when}`);
    };
    await waitText("This expense is split across 2 categories, so it cannot be changed from this page");
    expect(!(await controls()).includes("Edit this expense"), "a share of a split expense still offers the in-place edit");
    expect((await controls()).includes("Remove this whole expense"), `the whole-expense removal is missing: ${JSON.stringify(await controls())}`);
    await splitShareIntact("when the detail refused the edit");
    log("The split share refuses the in-place edit", "allocationCount 2: no 'Edit this expense' control, the page states 'This expense is split across 2 categories, so it cannot be changed from this page', and removal is offered as 'Remove this whole expense'");
    await page.screenshot({ path: join(shots, "walkthrough-10-split-refusal.png") });

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
    await waitText("Spent 11.00 USD of 400.00 USD");
    await waitText("Spent 4.50 USD of 1500.00 USD");
    log("Record a single-category expense Milk 3.00 Groceries", "POST .../transactions 201 with one allocation; Groceries spent 8.00 + 3.00 = 11.00, Rent untouched at 4.50");

    await clickText("Groceries"); await waitText("Transactions in this category");
    await waitText("Milk");
    await splitShareIntact("when the single-category expense was recorded");
    await clickText("Edit this expense");
    const amountId = await page.$eval('input[id^="edit-amount-"]', (node) => `#${node.id}`);
    await fill(amountId, "20.00");
    await clickText("Save expense"); await waitText("Expense updated.");
    await waitText("20.00 USD · Everyday");
    await splitShareIntact("when the single-category expense was edited");
    log("Edit Milk in place to 20.00", "PATCH .../transactions 200 revision 2; the split share is still Corner shop 8.00 USD, so editing one expense moved no other category");
    await page.screenshot({ path: join(shots, "walkthrough-11-single-edit.png") });

    await clickText("Remove this expense"); await waitText("Expense removed.");
    // The detail states its own spent figure; "Spent N of M" is the dashboard's wording, not this page's.
    await page.waitForFunction(() => document.querySelector('[data-testid="detail-spent"]')?.textContent?.trim() === "8.00 USD");
    await splitShareIntact("when the single-category expense was removed");
    log("Remove Milk", "POST .../remove 201 tombstone; the detail falls back to the split share alone and Groceries returns to 8.00");

    await clickText("Remove this whole expense"); await waitText("Expense removed.");
    await waitText("Nothing has been recorded against this category for the active period.");
    await clickText("Back to the budget"); await waitText("Accounts and spending");
    await waitText("Spent 0.00 USD of 400.00 USD");
    await waitText("Remaining 400.00 USD");
    await waitText("Spent 0.00 USD of 1500.00 USD");
    await waitText("Remaining 1500.00 USD");
    log("Remove the whole split expense", "POST .../remove 201 tombstone on the split transaction; both shares go with it, so spent returns to 0.00 and remaining to the target for Groceries and Rent alike, in the aggregate and the detail");
    await page.screenshot({ path: join(shots, "walkthrough-12-removed.png") });

    await clickText("Sign out"); await page.waitForFunction(() => location.pathname === "/");
    expect(!(await browser.cookies()).some((cookie) => cookie.name === "__Host-cobudget_session"), "the session cookie is deleted at logout");
    await page.goto(`${ORIGIN}/budgets`); await page.waitForFunction(() => location.pathname === "/sign-in");
    log("Sign out", "POST /v1/identity/logout with X-CoBudget-CSRF: cookie deleted, /budgets redirects to /sign-in again");
    expect(errors.length === 0, `page errors: ${errors.join("; ")}`);
    log("API requests observed from the browser", [...new Set(requests)].join(", "));
    console.log("PROTOTYPE-WALKTHROUGH PASSED");
  } catch (error) {
    console.error(`API output (tail):\n${apiOutput.slice(-2000)}\nweb output (tail):\n${webOutput.slice(-2000)}`);
    throw error;
  } finally {
    await browser?.close();
    if (previous === undefined) { try { unlinkSync(marker); } catch { /* already gone */ } } else writeFileSync(marker, previous);
    api.kill(); web.kill();
    await Promise.all([new Promise((resolve) => api.once("exit", resolve)), new Promise((resolve) => web.once("exit", resolve))]);
  }
}

await main();
