/**
 * PK9-02 / R-03 observation: PROTO-INVITATIONS-PK8-REVIEW-001-RESULT.r1 finding R-03 (level 1, not required for
 * approval, carried to PK-9) says a proved ceremony opened in a second tab, or with sessionStorage unavailable, is
 * asked for the code again rather than reaching the same disclosure step, because the per-tab `memory.proved` flag
 * (apps/web/src/app/(public)/invitation/ceremony-view.tsx `advance()`) is the only source of the proved state. This
 * is a QA observation, not a fix: the packet excludes product fixes from this assignment (report findings). The
 * case proves channel control once in one browser context, then resolves the identical ceremony link in a second,
 * storage-isolated context (Puppeteer's per-context storage partition stands in for "a second tab or
 * sessionStorage unavailable" -- a fresh BrowserContext shares no sessionStorage, matching the review's exact
 * failure condition) and records the sentence the second context is shown.
 *
 * Setup mirrors invitations.live.journey.mjs (same scratch-database marker, same API/web composition):
 *
 *   docker exec cobudget-db-1 psql -U postgres -c "CREATE DATABASE cobudget_pk9r03" -c "ALTER DATABASE cobudget_pk9r03 OWNER TO cobudget_migration"
 *   docker exec cobudget-db-1 psql -U postgres -d cobudget_pk9r03 -c "REVOKE CREATE ON SCHEMA public FROM PUBLIC"
 *   COBUDGET_DB_NAME=cobudget_pk9r03 npm run db:migrate --workspace=@cobudget/migrations
 *   echo cobudget_pk9r03 > apps/web/.verification/live-db
 *   node --test apps/web/tests/invitations-r03-storage-loss.live.journey.mjs
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const root = join(webRoot, "..", "..");
const marker = join(webRoot, ".verification", "live-db");
const DB_NAME = existsSync(marker) ? readFileSync(marker, "utf8").trim() : "";
const configured = DB_NAME !== "" && DB_NAME !== "cobudget_dev" && DB_NAME !== "cobudget_demo";
const API_PORT = 3001; const CEREMONY_ORIGIN = `http://127.0.0.1:${API_PORT}`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const server = createServer(); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function waitFor(check, label, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { try { if (await check()) return; } catch { /* not yet */ } await pause(300); }
  assert.fail(`timed out: ${label}`);
}
function apiEnvironment(origin) {
  return {
    NODE_ENV: "development", LOG_LEVEL: "warn", SERVICE_VERSION: "pk9-r03", API_PORT: String(API_PORT), API_LISTEN_ADDRESS: "127.0.0.1",
    COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local", COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: randomBytes(32).toString("base64"), COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "pk9-v1",
    COBUDGET_SESSION_PEPPER: randomBytes(32).toString("base64"),
    COBUDGET_SESSION_IDLE_TIMEOUT_SECONDS: "900", COBUDGET_SESSION_ABSOLUTE_LIFETIME_SECONDS: "3600", COBUDGET_SESSION_FRESH_ASSURANCE_WINDOW_SECONDS: "300",
    COBUDGET_SESSION_REVOCATION_PROPAGATION_TARGET_SECONDS: "60", COBUDGET_SESSION_PROVIDER_MAX_FUTURE_SKEW_SECONDS: "30",
    COBUDGET_SESSION_REJECTION_TIMING_FLOOR_MS: "20", COBUDGET_SESSION_REJECTION_TIMING_JITTER_MS: "10", COBUDGET_SESSION_REJECTION_TIMING_SAMPLE_COUNT: "50",
    COBUDGET_SESSION_REJECTION_TIMING_TIMEOUT_BUCKET_MS: "40", COBUDGET_SESSION_REJECTION_TIMING_MAX_DIFFERENTIAL_MS: "50",
    COBUDGET_SESSION_ENVELOPE_KEY_PROVIDER: "local", COBUDGET_SESSION_ENVELOPE_KEY: randomBytes(32).toString("base64"), COBUDGET_SESSION_ENVELOPE_KEY_VERSION: "pk9-v1",
    COBUDGET_IDENTITY_PROVIDER: "local", COBUDGET_IDENTITY_ENVIRONMENT_ID: "development",
    COBUDGET_IDENTITY_ISSUER: `${CEREMONY_ORIGIN}/v1/identity/local`, COBUDGET_IDENTITY_CLIENT_ID: "cobudget-local-web",
    COBUDGET_IDENTITY_APPLICATION_ORIGIN: origin, COBUDGET_IDENTITY_CEREMONY_ORIGIN: CEREMONY_ORIGIN, COBUDGET_IDENTITY_CALLBACK_URI: `${origin}/v1/identity/callback`,
    COBUDGET_IDENTITY_CHALLENGE_LIFETIME_SECONDS: "600", COBUDGET_IDENTITY_EXCHANGE_LIFETIME_MS: "5000", COBUDGET_IDENTITY_MAPPING_MAX_ATTEMPTS: "5",
    COBUDGET_IDENTITY_HANDOFF_LIFETIME_SECONDS: "120", COBUDGET_IDENTITY_CLOCK_SKEW_SECONDS: "30",
    COBUDGET_DB_NAME: DB_NAME,
  };
}
function driver(page) {
  page.setDefaultTimeout(30000);
  const text = async () => page.$eval("main", node => node.textContent);
  const waitText = async value => page.waitForFunction(value => document.querySelector("main")?.textContent.includes(value), {}, value);
  const clickText = async label => {
    for (const handle of await page.$$("button, a")) if ((await handle.evaluate(node => node.textContent.trim())) === label) { await handle.scrollIntoView(); await handle.click(); return; }
    assert.fail(`Missing control: ${label}`);
  };
  const fill = async (selector, value) => { await page.waitForSelector(selector); await page.focus(selector); await page.type(selector, value); };
  return { page, text, waitText, clickText, fill };
}

test("PK9-R03 observation: a proved ceremony opened in a second, storage-isolated context is asked for the code again", { skip: !configured, timeout: 300_000 }, async t => {
  const port = await freePort(); const origin = `http://localhost:${port}`;
  const modeMarker = join(webRoot, ".api-mode");
  const previous = existsSync(modeMarker) ? readFileSync(modeMarker, "utf8") : undefined;
  writeFileSync(modeMarker, "live\n");
  const api = spawn(process.execPath, ["--import=tsx", "src/main.ts"], { cwd: join(root, "apps/api"), env: apiEnvironment(origin), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const web = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "--port", String(port)], { cwd: webRoot, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let apiOutput = ""; let webOutput = "";
  for (const stream of [api.stdout, api.stderr]) stream.on("data", chunk => { apiOutput = (apiOutput + chunk).slice(-8000); });
  for (const stream of [web.stdout, web.stderr]) stream.on("data", chunk => { webOutput = (webOutput + chunk).slice(-8000); });
  let browser;
  t.after(async () => {
    await browser?.close();
    if (previous === undefined) { try { unlinkSync(modeMarker); } catch { /* already gone */ } } else writeFileSync(modeMarker, previous);
    api.kill(); web.kill();
    for (const child of [api, web]) { child.stdout.destroy(); child.stderr.destroy(); child.unref(); }
    await Promise.all([new Promise(resolve => api.once("exit", resolve)), new Promise(resolve => web.once("exit", resolve))]);
  });
  await waitFor(async () => api.exitCode === null && (await fetch(`${CEREMONY_ORIGIN}/health`)).status === 200, `API ready (${apiOutput})`);
  await waitFor(async () => web.exitCode === null && (await fetch(`${origin}/sign-in`)).ok, `web ready (${webOutput})`, 150_000);
  await fetch(`${origin}/sign-in`).catch(() => {});
  mkdirSync(join(webRoot, ".next"), { recursive: true });
  const executablePath = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
  browser = await puppeteer.launch({ ...(executablePath ? { executablePath } : {}), headless: true, args: ["--no-sandbox"] });

  const ownerContext = await browser.createBrowserContext();
  const owner = driver(await ownerContext.newPage());
  const budgetName = `PK-9 R-03 ${randomBytes(3).toString("hex")}`;
  let code; let challenge; let ceremonyPath;

  await t.test("set up: owner creates a budget and sends an invitation; the simulated delivery yields the code and channel challenge", async () => {
    await owner.page.goto(`${origin}/budgets`); await owner.page.waitForFunction(() => location.pathname === "/sign-in");
    await owner.clickText("Continue to sign in");
    await owner.page.waitForFunction(() => location.pathname === "/v1/identity/local/authorize" && location.port === "3001");
    await owner.clickText("subject-a"); await owner.page.waitForFunction(origin => location.origin === origin, {}, origin);
    await owner.waitText("Your budgets");
    await owner.clickText("Create a budget"); await owner.waitText("Budget name");
    await owner.page.type('[id="field-name"]', budgetName); await owner.clickText("Preview schedule"); await owner.waitText("Complete current period");
    await owner.page.click('[id="field-acknowledged-disclosure"]');
    await owner.page.waitForFunction(() => ![...document.querySelectorAll("button")].find(node => node.textContent.trim() === "Confirm and create budget")?.disabled);
    await owner.clickText("Confirm and create budget"); await owner.waitText("No categories yet");
    await owner.clickText("Invitations"); await owner.waitText("No invitations yet");
    await owner.fill("#invite-destination", "R03Invitee@Example.com"); await owner.clickText("Send invitation");
    await owner.waitText("Invitation sent to r***@example.com as Collaborator.");
    const deliveries = await owner.page.evaluate(async () => (await fetch("/v1/local/invitation-deliveries")).json());
    const delivered = deliveries.deliveries.find(row => row.destinationMasked === "r***@example.com");
    ({ code, channelChallenge: challenge } = delivered);
  });

  const firstContext = await browser.createBrowserContext();
  const first = driver(await firstContext.newPage());

  await t.test("first tab: resolve the link and prove channel control once", async () => {
    await first.page.goto(`${origin}/invitation#code=${encodeURIComponent(code)}`);
    await first.page.waitForFunction(() => location.pathname.startsWith("/invitation/ceremony/"));
    ceremonyPath = new URL(first.page.url()).pathname;
    await first.waitText("Prove you received this invitation");
    await first.fill("#channel-code", challenge); await first.clickText("Check code");
    await first.waitText("Sign in or create your MoneyPact account");
  });

  let secondSentence;
  await t.test("second, storage-isolated context: the identical ceremony URL is opened directly (no fragment, no resolve step -- exactly the second-tab / no-sessionStorage condition R-03 names)", async () => {
    const secondContext = await browser.createBrowserContext();
    const second = driver(await secondContext.newPage());
    await second.page.goto(`${origin}${ceremonyPath}`);
    // Give the client its render pass, then read whatever main says without asserting a specific outcome -- this
    // case is an observation, not a pass/fail gate on product behavior QA is not authorized to change.
    await pause(2000);
    secondSentence = (await second.text().catch(() => "(no main content rendered)"))?.trim();
    console.log(`R-03 OBSERVED: second-context ceremony page at ${ceremonyPath} shows: ${JSON.stringify(secondSentence)}`);
  });

  const askedForCodeAgain = /Prove you received this invitation/u.test(secondSentence ?? "");
  const reachedDisclosureStep = /Sign in or create your MoneyPact account/u.test(secondSentence ?? "");
  console.log(`R-03 OBSERVED: asked for code again = ${askedForCodeAgain}; reached same step as the first tab = ${reachedDisclosureStep}`);
  assert.ok(secondSentence, "the second context rendered some sentence to observe");
});
