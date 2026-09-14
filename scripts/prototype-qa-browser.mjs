#!/usr/bin/env node
/* global fetch, setTimeout, URL, document, location, sessionStorage, localStorage, window, HTMLInputElement, Event, innerWidth */
/**
 * PROTO-E2E-QA-001: browser-level validation of CBD-242 (creation journey),
 * CBD-218 (dashboard shell), CBD-190-AC06 (result pages), CBD-232-AC06
 * (browser drafts) and the joined flow, through headless Chrome against the
 * Next development server in live mode (`apps/web/.api-mode` = `live`) and
 * the real API with the local identity adapter on a scratch database.
 *
 * Builds on scripts/prototype-browser-walkthrough.mjs (same process
 * arrangement) and adds, per criterion, the positive case, the denial case,
 * the exact outcome and the regression the packet names. Every case is
 * tagged with its criterion id; a failed case is recorded with its
 * reproduction and the run continues. Exit code is non-zero on any failure.
 *
 *   node scripts/prototype-qa-browser.mjs --db cobudget_qa [--json out.json]
 *
 * Injected API responses (denied, terminal, stale, partial, slow, provider
 * failure) are produced by Chrome request interception on the same-origin
 * /v1 proxy path, so the shell's handling of each state is observed on the
 * live wire shape. Screenshots go to apps/web/.next/qa-*.png (untracked).
 * The API is restarted once for the identity-outcome cases (six ceremonies
 * per process under the approved bootstrap record). No secret is printed.
 */
import { execFileSync, spawn } from "node:child_process";
import http from "node:http";
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
if (!DB_NAME || DB_NAME === "cobudget_dev") { console.error("--db must name a migrated scratch database (never cobudget_dev)"); process.exit(2); }
const CANDIDATE = (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); } catch { return "unknown"; } })();
const axeSource = readFileSync(join(root, "node_modules/axe-core/axe.min.js"), "utf8");

const KEYS = { field: randomBytes(32).toString("base64"), pepper: randomBytes(32).toString("base64"), envelope: randomBytes(32).toString("base64") };
const apiEnvironment = {
  NODE_ENV: "development", LOG_LEVEL: "info", SERVICE_VERSION: "prototype-qa-browser", API_PORT: String(API_PORT), API_LISTEN_ADDRESS: "127.0.0.1",
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
class NotRun extends Error {}
function expect(condition, message) { if (!condition) throw new Expectation(message); }
const notRun = (reason) => { throw new NotRun(reason); };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let shots; let shotIndex = 0; let page;
async function criterion(id, name, fn) {
  const started = new Date().toISOString();
  try {
    const detail = await fn();
    results.push({ criterion: id, case: name, status: "pass", detail: detail ?? "", at: started });
    console.log(`[${id}] PASS ${name}${detail ? `: ${detail}` : ""}`);
  } catch (error) {
    const status = error instanceof NotRun ? "not_run" : "fail";
    let where = "";
    if (status === "fail" && page) { try { const file = join(shots, `qa-failure-${++shotIndex}.png`); await page.screenshot({ path: file, fullPage: true }); where = ` (screenshot ${file}; route ${new URL(page.url()).pathname})`; } catch { /* no page */ } }
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
/** Refuses to run against a listener this script did not start: a foreign process on the API port would receive the journey's writes. */
async function assertPortFree(port, label) {
  let answered = false;
  try { await fetch(`http://127.0.0.1:${port}/health`); answered = true; } catch { /* free */ }
  if (answered) throw new Error(`port ${port} (${label}) is already served by another process; this run must not use it (stop that process or wait for it to end)`);
}
function startApi() {
  const api = spawn(process.execPath, ["--import=tsx", "src/main.ts"], { cwd: join(root, "apps/api"), env: apiEnvironment, stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; for (const stream of [api.stdout, api.stderr]) stream.on("data", (chunk) => { output = (output + chunk).slice(-8000); });
  const exited = new Promise((resolve) => api.once("exit", resolve));
  return { api, output: () => output, ready: () => waitFor(async () => api.exitCode === null && (await fetch(`${CEREMONY_ORIGIN}/health`)).status === 200, `API ready (${output})`), stop: async () => { if (api.exitCode === null) { api.kill(); await exited; } } };
}

async function main() {
  await assertPortFree(API_PORT, "API"); await assertPortFree(WEB_PORT, "web");
  const marker = join(root, "apps/web/.api-mode");
  const previous = existsSync(marker) ? readFileSync(marker, "utf8") : undefined;
  writeFileSync(marker, "live\n");
  let api = startApi();
  const web = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "--port", String(WEB_PORT)], { cwd: join(root, "apps/web"), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let webOutput = ""; for (const stream of [web.stdout, web.stderr]) stream.on("data", (chunk) => { webOutput = (webOutput + chunk).slice(-8000); });
  let browser;
  try {
    await api.ready();
    await waitFor(async () => web.exitCode === null && (await fetch(`${ORIGIN}/sign-in`)).ok, `web ready (${webOutput})`, 120_000);
    console.log(`candidate ${CANDIDATE}; API ${CEREMONY_ORIGIN} (NODE_ENV=development, COBUDGET_IDENTITY_PROVIDER=local, COBUDGET_DB_NAME=${DB_NAME}); web ${ORIGIN} (next dev, apps/web/.api-mode=live); clock ${new Date().toISOString()}`);
    const executablePath = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
    browser = await puppeteer.launch({ ...(executablePath ? { executablePath } : {}), headless: true, args: ["--no-sandbox"] });
    page = await browser.newPage(); page.setDefaultTimeout(30_000);
    shots = join(root, "apps/web/.next"); mkdirSync(shots, { recursive: true });
    const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    const apiRequests = [];
    page.on("request", (request) => { const url = new URL(request.url()); if (url.pathname.startsWith("/v1/")) apiRequests.push({ method: request.method(), path: url.pathname, body: request.postData(), at: Date.now() }); });
    const text = () => page.$eval("main", (node) => node.textContent ?? "");
    const waitText = (value, timeout) => page.waitForFunction((value) => document.querySelector("main")?.textContent?.includes(value), timeout ? { timeout } : {}, value);
    const clickText = async (label, target = page) => {
      for (const handle of await target.$$("button, a")) if ((await handle.evaluate((node) => node.textContent?.trim())) === label) { await handle.scrollIntoView(); await handle.click(); return; }
      throw new Error(`Missing control: ${label}`);
    };
    const confirmDisabled = () => page.evaluate(() => [...document.querySelectorAll("button")].find((node) => node.textContent === "Confirm and create budget")?.disabled);
    const waitConfirmEnabled = () => page.waitForFunction(() => [...document.querySelectorAll("button")].find((node) => node.textContent === "Confirm and create budget")?.disabled === false);
    const accessibility = async (target = page) => {
      await target.evaluate(axeSource);
      const violations = await target.evaluate(async () => (await window.axe.run(document.querySelector("main"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations.map((item) => ({ id: item.id, nodes: item.nodes.map((node) => node.target) })));
      expect(violations.length === 0, `axe violations ${JSON.stringify(violations)}`);
      return "axe wcag2a/wcag2aa/wcag21aa: 0 violations";
    };
    const signInAs = async (scenario, target = page) => {
      await target.goto(`${ORIGIN}/sign-in`); await target.waitForFunction(() => document.querySelector("main")?.textContent?.includes("Continue to sign in"));
      const beginResponse = target.waitForResponse((r) => r.url().endsWith("/v1/identity/begin"));
      await clickText("Continue to sign in", target);
      const begun = await beginResponse;
      expect(begun.status() === 200, `POST /v1/identity/begin returned ${begun.status()} ${await begun.text().catch(() => "")}`);
      await target.waitForFunction(() => location.pathname === "/v1/identity/local/authorize" && location.port === "3001");
      await clickText(scenario, target);
      await target.waitForFunction(() => location.port === "3000");
    };
    /** The approved mutation record admits 12 (+3 burst) mutations per actor per minute: wait until `n` more proposal POSTs fit. */
    const roomFor = async (n) => {
      for (;;) {
        const now = Date.now(); const recent = apiRequests.filter((r) => r.method === "POST" && r.path === "/v1/budget-creation-proposals" && now - r.at < 61_000);
        if (recent.length + n <= 12) return;
        const wait = 61_000 - (now - recent[0].at); console.log(`   (pacing: waiting ${Math.ceil(wait / 1000)} s for the mutation window)`); await pause(wait);
      }
    };
    /** Performs the browser's proposal POST from here (same cookie, CSRF and key) so the response can be altered before Chrome sees it. */
    const proxiedPost = async (request) => {
      const cookie = (await browser.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
      const headers = request.headers(); const url = new URL(request.url());
      return new Promise((resolve, reject) => {
        const r = http.request({ host: "127.0.0.1", port: API_PORT, path: `${url.pathname}${url.search}`, method: "POST", headers: { host: `localhost:${WEB_PORT}`, origin: ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json", accept: "application/json", cookie, "idempotency-key": headers["idempotency-key"], "x-cobudget-csrf": headers["x-cobudget-csrf"] } }, (response) => {
          let body = ""; response.on("data", (chunk) => { body += chunk; }); response.on("end", () => resolve({ status: response.statusCode, body: JSON.parse(body) }));
        });
        r.on("error", reject); r.end(request.postData());
      });
    };
    /** Replaces a controlled input's value through the native setter (a triple-click selection is lost on React's re-render). */
    const setValue = (selector, value) => page.$eval(selector, (el, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); }, value);
    const apiJson = (path, init) => page.evaluate(async (path, init) => { const r = await fetch(path, init); let body; try { body = await r.json(); } catch { body = undefined; } return { status: r.status, body }; }, path, init);

    // ---------------------------------------------------------------- sign-in
    await criterion("CBD-190-AC06", "positive: the signed-out protected route redirects to an accessible sign-in page; keyboard reaches the sign-in control", async () => {
      await page.goto(`${ORIGIN}/budgets`); await page.waitForFunction(() => location.pathname === "/sign-in");
      const axe = await accessibility();
      await page.evaluate(() => document.getElementById("app-main")?.focus());
      for (let step = 0; step < 20; step++) { await page.keyboard.press("Tab"); if (await page.evaluate(() => document.activeElement?.textContent === "Continue to sign in")) break; }
      expect(await page.evaluate(() => document.activeElement?.textContent) === "Continue to sign in", "Tab does not reach the sign-in control");
      return `/budgets -> /sign-in; ${axe}; Tab reaches 'Continue to sign in'`;
    });
    let session;
    await criterion("QA-JOINED-FLOW", "positive (browser): sign in on the local adapter; HttpOnly host-only session cookie accepted by Chrome on the localhost application origin; no CSRF cookie; no credential or token in browser storage", async () => {
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => location.pathname === "/v1/identity/local/authorize" && location.port === "3001");
      const hostedInputs = await page.$$eval("input, form, textarea", (nodes) => nodes.length);
      expect(hostedInputs === 0, `hosted chooser has ${hostedInputs} input/form elements`);
      await clickText("subject-a"); await page.waitForFunction(() => location.pathname === "/budgets"); await waitText("Your budgets");
      const cookies = await browser.cookies();
      const sessionCookie = cookies.find((c) => c.name === "__Host-cobudget_session");
      expect(sessionCookie && sessionCookie.httpOnly && sessionCookie.secure && sessionCookie.domain === "localhost" && sessionCookie.path === "/", `cookie ${JSON.stringify(cookies.map((c) => ({ name: c.name, httpOnly: c.httpOnly, secure: c.secure, domain: c.domain })))}`);
      expect(!cookies.some((c) => /csrf/iu.test(c.name)), "a CSRF cookie exists");
      const storage = await page.evaluate(() => JSON.stringify({ local: Object.entries(localStorage), session: Object.entries(sessionStorage) }));
      expect(!/eyJ[A-Za-z0-9_-]{10,}\.|password|passkey|refresh_token|access_token|csrf/iu.test(storage), `browser storage: ${storage.slice(0, 300)}`);
      session = (await apiJson("/v1/identity/me")).body;
      expect(session && typeof session.accountSubjectId === "string", "me");
      return `cookie __Host-cobudget_session HttpOnly Secure domain=localhost path=/; cookies=${cookies.length}; storage keys=${JSON.parse(storage).local.length + JSON.parse(storage).session.length} (no token/credential); subject ${session.accountSubjectId}`;
    });

    // ------------------------------------------------------------ CBD-242 form
    const spacesBefore = (await apiJson("/v1/budget-spaces")).body.spaces.length;
    const issued = [];
    const capture = async (response) => { if (response.request().method() === "POST" && response.url().endsWith("/budget-creation-proposals") && response.ok()) { try { issued.push(await response.json()); } catch { /* aborted */ } } };
    page.on("response", capture);
    await criterion("CBD-242-AC01", "positive/denial: every required field is labeled; a server field error is mapped to its field, announced and focused; unrelated valid inputs survive", async () => {
      await roomFor(4);
      await clickText("Create a budget"); await waitText("Budget and schedule");
      expect(await confirmDisabled() === true, "confirm must start disabled");
      const labels = await page.$$eval("label", (nodes) => nodes.map((n) => n.textContent.trim()));
      expect(["Budget name", "IANA time zone", "Currency code", "Cadence"].every((l) => labels.some((x) => x.startsWith(l))), `labels ${labels.join(", ")}`);
      await clickText("Preview schedule"); await waitText("Enter a budget name.");
      expect(await page.$eval('[id="field-name"]', (n) => n.getAttribute("aria-invalid")) === "true", "name not marked invalid");
      expect(await page.evaluate(() => document.activeElement?.id) === "field-name", "focus not moved to the invalid field");
      const described = await page.$eval('[id="field-name"]', (n) => n.getAttribute("aria-describedby"));
      expect(described && await page.evaluate((id) => document.getElementById(id)?.textContent, described.split(" ")[0]), "error not linked through aria-describedby");
      const errorList = await page.$eval("#validation-errors", (n) => n.getAttribute("aria-label"));
      expect(errorList === "Validation errors", "validation error list not labeled");
      await page.type('[id="field-name"]', "Household QA");
      await setValue('[id="field-timeZone"]', "Mars/Olympus");
      await waitText("Choose a valid named IANA time zone.");
      expect(await page.$eval('[id="field-name"]', (n) => n.value) === "Household QA" && await page.$eval('[id="field-currencyCode"]', (n) => n.value) === "USD", "valid inputs erased by an unrelated field error");
      expect(await page.$eval('[id="field-name"]', (n) => n.getAttribute("aria-invalid")) !== "true" && await page.$eval('[id="field-timeZone"]', (n) => n.getAttribute("aria-invalid")) === "true", "error mapped to the wrong field");
      expect(await confirmDisabled() === true, "confirm enabled while a field is invalid");
      await setValue('[id="field-timeZone"]', "America/New_York");
      await waitText("Complete current period"); await waitConfirmEnabled();
      return `empty name -> server 'Enter a budget name.' on field-name (aria-invalid, aria-describedby, focus); Mars/Olympus -> 'Choose a valid named IANA time zone.' on field-timeZone with name 'Household QA' and currency USD retained; ${await accessibility()}`;
    });
    await criterion("CBD-242-AC02", "positive: the client sends only raw inputs and renders the server-generated preview; it never supplies period boundaries", async () => {
      const posts = apiRequests.filter((r) => r.method === "POST" && r.path === "/v1/budget-creation-proposals");
      expect(posts.length > 0, "no proposal POST observed");
      for (const post of posts) {
        const keys = Object.keys(JSON.parse(post.body)).sort();
        expect(keys.every((k) => ["name", "timeZone", "currencyCode", "schedule", "supersedesProposalId"].includes(k)), `client supplied ${keys.join(",")}`);
      }
      const rendered = await page.$$eval("ol li", (nodes) => nodes.map((n) => n.textContent));
      const latest = issued.at(-1);
      expect(rendered.length === 4 && latest.preview.periods.every((p, i) => rendered[i].includes(`${p.start} through ${p.end}`) && rendered[i].includes(`${p.lengthInDays} days`)), `rendered ${JSON.stringify(rendered)} vs ${JSON.stringify(latest.preview.periods)}`);
      return `${posts.length} proposal POST(s), body keys only {name,timeZone,currencyCode,schedule[,supersedesProposalId]}; the four rendered periods equal the server preview of ${latest.proposalId}`;
    });
    await criterion("CBD-242-AC03", "positive: review shows the budget name, time zone, currency, cadence summary, the complete current period and three following periods with inclusive dates and lengths", async () => {
      const latest = issued.at(-1); const body = await text();
      expect(body.includes(latest.normalizedInputs.name) && body.includes(`${latest.normalizedInputs.timeZone} · ${latest.normalizedInputs.currencyCode}`) && body.includes(latest.preview.cadenceSummary), "review header incomplete");
      const items = await page.$$eval("ol li h3", (nodes) => nodes.map((n) => n.textContent));
      expect(items[0] === "Complete current period" && items.slice(1).every((h, i) => h === `Following period ${i + 1}`), JSON.stringify(items));
      expect(body.includes("dates inclusive"), "inclusive-dates statement missing");
      return `name '${latest.normalizedInputs.name}', '${latest.normalizedInputs.timeZone} · ${latest.normalizedInputs.currencyCode}', '${latest.preview.cadenceSummary}', ${items.join(" / ")}, dates inclusive with lengths`;
    });
    await criterion("CBD-242-AC05", "positive: a result-affecting edit disables the old confirmation immediately and obtains a new preview that supersedes the old proposal", async () => {
      await roomFor(1);
      const before = issued.at(-1).proposalId;
      await page.type('[id="field-name"]', " edited");
      expect(await confirmDisabled() === true, "confirm still enabled right after the edit");
      await page.waitForFunction((before) => !document.querySelector("main")?.textContent?.includes("Review your complete current period") || document.querySelectorAll("ol li").length === 4 && before, {}, before);
      await waitConfirmEnabled();
      const after = issued.at(-1);
      expect(after.proposalId !== before && after.supersedesProposalId === before, `successor ${after.proposalId} supersedes ${after.supersedesProposalId} (expected ${before})`);
      return `edit disabled confirm synchronously; new proposal ${after.proposalId} supersedes ${before}`;
    });
    await criterion("CBD-242-AC04", "positive/denial: confirm is unavailable while the preview loads and until it is rendered and bound; a slow response keeps it disabled", async () => {
      await page.setRequestInterception(true);
      let delayProposal = 1500;
      const slow = (request) => {
        if (delayProposal && request.method() === "POST" && new URL(request.url()).pathname === "/v1/budget-creation-proposals") { const wait = delayProposal; setTimeout(() => request.continue().catch(() => {}), wait); }
        else request.continue().catch(() => {});
      };
      await roomFor(1);
      page.on("request", slow);
      await page.type('[id="field-name"]', "!");
      await pause(600);
      expect(await confirmDisabled() === true && (await text()).includes("Preparing your schedule"), "confirm enabled during loading");
      await waitConfirmEnabled();
      delayProposal = 0; page.off("request", slow); await page.setRequestInterception(false);
      return "disabled during 'Preparing your schedule…' (1.5 s delayed response); enabled only after the four periods rendered";
    });
    await criterion("CBD-242-AC06", "regression: slow/out-of-order proposal responses never render or bind a preview for stale inputs", async () => {
      await page.setRequestInterception(true);
      let first = true;
      const reorder = (request) => {
        if (request.method() === "POST" && new URL(request.url()).pathname === "/v1/budget-creation-proposals" && first) { first = false; setTimeout(() => request.continue().catch(() => {}), 2500); }
        else request.continue().catch(() => {});
      };
      await roomFor(2);
      page.on("request", reorder);
      await page.type('[id="field-name"]', " A"); await pause(500); await page.type('[id="field-name"]', "B");
      await waitConfirmEnabled(); await pause(2800);
      page.off("request", reorder); await page.setRequestInterception(false);
      const name = await page.$eval('[id="field-name"]', (n) => n.value);
      const shown = await text();
      expect(shown.includes(name) && await confirmDisabled() === false, `review shows '${shown.slice(0, 120)}' for input '${name}'`);
      const latest = issued.at(-1);
      expect(latest.normalizedInputs.name === name, `bound proposal name '${latest.normalizedInputs.name}' vs input '${name}'`);
      return `two edits with the first response delayed 2.5 s: review and bound proposal (${latest.proposalId}) carry the latest input '${name}'`;
    });
    let stateBeforeRefresh;
    await criterion("CBD-242-AC06", "regression: refresh, back/forward, restored draft and a duplicate tab require new previews and never restore a binding", async () => {
      await roomFor(5);
      const before = issued.at(-1).proposalId;
      stateBeforeRefresh = await page.$eval('[id="field-name"]', (n) => n.value);
      await page.reload(); await waitText("Complete current period"); await waitConfirmEnabled();
      expect(await page.$eval('[id="field-name"]', (n) => n.value) === stateBeforeRefresh, "draft not restored");
      expect(issued.at(-1).proposalId !== before, "refresh reused the previous proposal");
      const refreshed = issued.at(-1).proposalId;
      await clickText("Your budgets"); await waitText("Create a budget");
      await page.goBack(); await waitText("Complete current period"); await waitConfirmEnabled();
      expect(issued.at(-1).proposalId !== refreshed, "back navigation reused the previous proposal");
      await page.goForward(); await waitText("Create a budget");
      await page.goBack(); await waitText("Complete current period"); await waitConfirmEnabled();
      const storage = await page.evaluate(() => Object.entries(sessionStorage));
      expect(!storage.some(([, v]) => v.includes("confirmationBinding") || v.includes("proposalId")), "a binding or proposal id is persisted in sessionStorage");
      const duplicate = await browser.newPage();
      await duplicate.evaluateOnNewDocument((entries) => { for (const [k, v] of entries) sessionStorage.setItem(k, v); }, storage);
      const newProposal = duplicate.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/budget-creation-proposals") && r.ok());
      await duplicate.goto(`${ORIGIN}/budgets/new`);
      const duplicated = await (await newProposal).json();
      expect(duplicated.proposalId !== issued.at(-1).proposalId && duplicated.supersedesProposalId === null, "duplicate tab reused the proposal chain");
      await duplicate.close(); await page.bringToFront();
      return `refresh -> new proposal; back -> new proposal; forward/back -> new proposal; sessionStorage holds the raw draft only; duplicate tab -> fresh proposal ${duplicated.proposalId} without predecessor`;
    });
    await criterion("CBD-242-AC02", "denial: a locally altered preview (tampered proposal response) is not confirmed; the client re-reads the server proposal, regenerates and never creates the budget from the altered preview", async () => {
      await page.setRequestInterception(true);
      let tampered = false;
      const tamper = async (request) => {
        if (!tampered && request.method() === "POST" && new URL(request.url()).pathname === "/v1/budget-creation-proposals") {
          tampered = true;
          const raw = await proxiedPost(request);
          const body = raw.body; if (raw.status === 201) { body.preview.periods[0].end = "2099-12-31"; body.preview.periods[0].lengthInDays = 9999; }
          await request.respond({ status: raw.status, contentType: "application/json", body: JSON.stringify(body) }).catch(() => {});
        } else request.continue().catch(() => {});
      };
      await roomFor(2);
      page.on("request", tamper);
      await page.type('[id="field-name"]', "T");
      await waitText("2099-12-31"); await waitConfirmEnabled();
      const altered = issued.at(-1).proposalId;
      const confirms = apiRequests.filter((r) => r.path.endsWith("/confirm")).length;
      await clickText("Confirm and create budget");
      await page.waitForFunction(() => document.querySelectorAll("ol li").length === 4 && !document.querySelector("main")?.textContent?.includes("2099-12-31"));
      await waitConfirmEnabled();
      page.off("request", tamper); await page.setRequestInterception(false);
      expect(apiRequests.filter((r) => r.path.endsWith("/confirm")).length === confirms, "a confirm request was sent for the altered preview");
      expect(new URL(page.url()).pathname === "/budgets/new" && issued.at(-1).proposalId !== altered, "no regeneration after the altered preview");
      return `altered response rendered 2099-12-31; confirm re-read the server row, sent no confirm request, regenerated ${issued.at(-1).proposalId} and re-rendered the server preview`;
    });
    await criterion("CBD-242-AC05", "denial: expiry disables the old confirmation and obtains a new preview (expiresAt injected 3 s ahead)", async () => {
      await page.setRequestInterception(true);
      let shortened = false;
      const shorten = async (request) => {
        if (!shortened && request.method() === "POST" && new URL(request.url()).pathname === "/v1/budget-creation-proposals") {
          shortened = true;
          const raw = await proxiedPost(request);
          const body = raw.body; if (raw.status === 201) body.expiresAt = new Date(Date.now() + 3000).toISOString();
          await request.respond({ status: raw.status, contentType: "application/json", body: JSON.stringify(body) }).catch(() => {});
        } else request.continue().catch(() => {});
      };
      await roomFor(2);
      page.on("request", shorten);
      await page.type('[id="field-name"]', "E"); await waitConfirmEnabled();
      const shortLived = issued.at(-1).proposalId;
      await pause(3500);
      await page.waitForFunction(() => document.querySelectorAll("ol li").length === 4); await waitConfirmEnabled();
      page.off("request", shorten); await page.setRequestInterception(false);
      expect(issued.at(-1).proposalId !== shortLived, "no new preview after the injected expiry");
      return `proposal ${shortLived} with expiresAt +3 s: at expiry the client disabled confirm and obtained ${issued.at(-1).proposalId}`;
    });
    await criterion("CBD-242-AC05", "regression: governing-rule change and budget-local-midnight rollover in the browser", async () => notRun("no rule-version seam and no clock seam in the running processes; the API-side local-midnight expiry computation is covered in prototype-qa-criteria.mjs (CBD-232-AC05); the client's expiry timer is exercised by the injected-expiry case above"));
    await criterion("CBD-242-AC07", "denial: invalid/unsupported cadence inputs, a monthly day-31 clamp and an API failure have deterministic accessible states and create no budget", async () => {
      await roomFor(4);
      await page.select('[id="field-schedule.cadence"]', "custom-fixed-length");
      await page.waitForSelector('[id="field-schedule.lengthInDays"]');
      await setValue('[id="field-schedule.lengthInDays"]', "0");
      await setValue('[id="field-schedule.startBoundary"]', "2026-01-01");
      await clickText("Preview schedule");
      await page.waitForFunction(() => document.querySelector("#validation-errors"));
      const lengthError = await page.$eval('[id="field-schedule.lengthInDays"]', (n) => n.getAttribute("aria-invalid"));
      expect(lengthError === "true" && await confirmDisabled() === true, "length 0 not mapped to its field");
      const axe1 = await accessibility();
      await page.select('[id="field-schedule.cadence"]', "monthly");
      await page.waitForSelector('[id="field-schedule.anchor.day"]');
      await setValue('[id="field-schedule.anchor.day"]', "31");
      await clickText("Preview schedule"); await waitText("Complete current period"); await waitConfirmEnabled();
      const clampShown = (await text()).includes("does not exist in this month");
      const clampExpected = issued.at(-1).preview.warnings.length > 0;
      expect(clampShown === clampExpected, `clamp warning shown=${clampShown} expected=${clampExpected}`);
      await page.setRequestInterception(true);
      const outage = (request) => { if (request.method() === "POST" && new URL(request.url()).pathname === "/v1/budget-creation-proposals") request.respond({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) }).catch(() => {}); else request.continue().catch(() => {}); };
      page.on("request", outage);
      await page.type('[id="field-name"]', "X"); await waitText("We could not prepare this schedule");
      expect(await confirmDisabled() === true, "confirm enabled after an API failure");
      const axe2 = await accessibility();
      page.off("request", outage); await page.setRequestInterception(false);
      const spaces = (await apiJson("/v1/budget-spaces")).body.spaces.length;
      expect(spaces === spacesBefore, `budgets created during failures: ${spacesBefore} -> ${spaces}`);
      await setValue('[id="field-schedule.anchor.day"]', "1");
      await clickText("Preview schedule"); await waitText("Complete current period"); await waitConfirmEnabled();
      return `custom length 0 -> field error on field-schedule.lengthInDays (${axe1}); monthly day 31 -> clamp warning ${clampShown ? "shown" : "not needed this month"}; 503 on preview -> 'We could not prepare this schedule', confirm disabled (${axe2}); 0 budgets`;
    });
    await criterion("CBD-242-AC07", "regression: DST and time-zone boundary journeys in the browser", async () => notRun("wall-clock bound; the API preview fixtures for other zones are compared in prototype-qa-criteria.mjs (CBD-232-AC03/AC05); not driven through the browser"));

    let budgetId; let confirmResponse; let confirmedName;
    await criterion("CBD-242-AC04", "outcome: the confirm request carries only the server binding under the current subject, and the confirmed space id matches the dashboard route and the API", async () => {
      const latest = issued.at(-1);
      const confirmRequest = page.waitForRequest((r) => r.url().endsWith("/confirm") && r.method() === "POST");
      const confirmed = page.waitForResponse((r) => r.url().endsWith("/confirm") && r.request().method() === "POST");
      await clickText("Confirm and create budget");
      const request = await confirmRequest;
      expect(request.url().includes(latest.proposalId) && JSON.stringify(Object.keys(JSON.parse(request.postData()))) === '["confirmationBinding"]' && typeof request.headers()["x-cobudget-csrf"] === "string" && typeof request.headers()["idempotency-key"] === "string", "confirm request shape");
      confirmResponse = await (await confirmed).json(); confirmedName = latest.normalizedInputs.name;
      await waitText("No categories yet"); budgetId = new URL(page.url()).pathname.split("/").at(-1);
      expect(budgetId === confirmResponse.budgetSpaceId, `route ${budgetId} vs response ${confirmResponse.budgetSpaceId}`);
      const detail = (await apiJson(`/v1/budget-spaces/${budgetId}`)).body;
      expect(detail.activePeriod.periodId === confirmResponse.currentPeriodId, "dashboard period differs from the confirmation");
      return `POST .../${latest.proposalId}/confirm {confirmationBinding} with X-CoBudget-CSRF and Idempotency-Key -> ${confirmResponse.budgetSpaceId}; route /budgets/${budgetId}; activePeriod ${detail.activePeriod.periodId} = currentPeriodId`;
    });
    page.off("response", capture);

    // ------------------------------------------------------------ CBD-218 shell
    let detailResponse;
    await criterion("CBD-218-AC01", "positive: the dashboard renders the server-supplied budget and active-period identities verbatim and computes no boundary locally", async () => {
      detailResponse = (await apiJson(`/v1/budget-spaces/${budgetId}`)).body;
      const body = await text();
      expect(body.includes(detailResponse.space?.budgetSpaceId ?? budgetId) && body.includes(detailResponse.activePeriod.periodId) && body.includes(detailResponse.activePeriod.start) && body.includes(detailResponse.activePeriod.end), `dashboard text lacks server identities: ${body.slice(0, 400)}`);
      expect((await page.title()).includes("Budget dashboard"), "title");
      const axe = await accessibility();
      return `budget ${budgetId}, active period ${detailResponse.activePeriod.periodId} ${detailResponse.activePeriod.start}..${detailResponse.activePeriod.end} rendered verbatim from GET /v1/budget-spaces/{id}; ${axe}`;
    });
    let scenario = null;
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      if (scenario && new URL(request.url()).pathname === `/v1/budget-spaces/${budgetId}`) {
        const selected = scenario;
        void (async () => { if (selected.delay) await pause(selected.delay); try { await request.respond({ status: selected.status ?? 200, contentType: "application/json", body: JSON.stringify(selected.body ?? detailResponse) }); } catch { /* cancelled navigation */ } })();
      } else request.continue().catch(() => {});
    });
    for (const [label, body, expected] of [["true-empty", { ...detailResponse, activePeriod: null }, "No active period"], ["partial", { ...detailResponse, scheduleVersion: null }, "Budget details are incomplete"]]) {
      await criterion("CBD-218-AC03", `positive: ${label} state identifies the affected scope and never shows incomplete data as current`, async () => {
        scenario = { body }; await clickText("Refresh budget"); await waitText(expected);
        if (label === "partial") expect(await page.$("#plan-heading") === null, "plan shown on a partial response");
        return `${label}: '${expected}'; ${await accessibility()}`;
      });
    }
    await criterion("CBD-218-AC03", "denial: the stale state (freshness signal)", async () => notRun("the merged detail response carries no staleness signal (apps/web/API-ASSUMPTIONS.md); the stale shell state is not reachable from a live response"));
    for (const [label, status, expected] of [["permission-denied", 403, "Access unavailable"], ["recoverable-error", 503, "Unable to load this budget"], ["terminal-error", 404, "Budget unavailable"]]) {
      await criterion("CBD-218-AC02", `denial: injected ${status} renders the distinct ${label} state`, async () => {
        scenario = { status, body: { error: label } }; await clickText("Refresh budget"); await waitText(expected);
        return `${status} -> '${expected}'; ${await accessibility()}`;
      });
    }
    await criterion("CBD-218-AC02", "positive: loading, refreshed and success states have distinct copy", async () => {
      scenario = { delay: 1000 }; await clickText("Refresh budget"); await waitText("Loading the active budget period"); await waitText("Budget refreshed.");
      scenario = null; await page.reload(); await waitText("The active budget period is ready.");
      return "'Loading the active budget period' -> 'Budget refreshed.' -> on reload 'The active budget period is ready.'";
    });
    await criterion("CBD-218-AC04", "outcome: navigation away discards a slow response from another budget; nothing from it renders", async () => {
      scenario = { delay: 1200, body: { ...detailResponse, space: { ...detailResponse.space, name: "Stale response marker" } } };
      await clickText("Refresh budget"); await waitText("Loading the active budget period");
      await clickText("Your budgets"); await waitText("Create a budget"); await pause(1500);
      expect(!(await text()).includes("Stale response marker"), "stale response rendered after navigation");
      scenario = null;
      return "1.2 s delayed detail with a marker name discarded after navigating to /budgets";
    });
    await criterion("CBD-218-AC04", "regression: rapid refresh discards the earlier slow response and renders the later one", async () => {
      await clickText(confirmedName); await waitText("The active budget period is ready.");
      scenario = { delay: 1500, body: { ...detailResponse, space: { ...detailResponse.space, name: "Slow marker" } } };
      await clickText("Refresh budget"); await pause(100);
      scenario = { delay: 100, body: { ...detailResponse, space: { ...detailResponse.space, name: "Fast marker" } } };
      await clickText("Refresh budget"); await waitText("Fast marker"); await pause(1700);
      const body = await text();
      expect(body.includes("Fast marker") && !body.includes("Slow marker"), `rendered ${body.slice(0, 200)}`);
      scenario = null;
      return "two refreshes: the slow first response (1.5 s) never overwrote the fast second";
    });
    await criterion("CBD-218-AC05", "positive: single main landmark, budgets navigation landmark, page title, main focus on arrival, status announcements, Tab order, 320 px and 400% reflow, error recovery by keyboard", async () => {
      await clickText("Refresh budget"); await waitText("Budget refreshed.");
      expect((await page.title()).includes("Budget dashboard"), "title");
      expect(await page.$$eval("main", (n) => n.length) === 1 && await page.$('nav[aria-label="Budgets"]'), "landmarks");
      expect((await page.$$eval('[role="status"]', (nodes) => nodes.map((n) => n.textContent))).some((v) => v.includes("Budget refreshed")), "status announcement");
      await page.reload(); await waitText("The active budget period is ready.");
      expect(await page.evaluate(() => document.activeElement?.id) === "app-main", "focus not on main after arrival");
      await page.keyboard.press("Tab"); expect(await page.evaluate(() => document.activeElement?.tagName) !== "BODY", "Tab leaves focus on body");
      await page.setViewport({ width: 320, height: 800 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "horizontal overflow at 320 px");
      const axe320 = await accessibility();
      await page.setViewport({ width: 320, height: 225, deviceScaleFactor: 4 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "horizontal overflow at 400%");
      await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
      scenario = { status: 503, body: { error: "recoverable" } };
      await clickText("Refresh budget"); await waitText("Unable to load this budget");
      await page.evaluate(() => document.getElementById("app-main").focus());
      for (let step = 0; step < 30; step++) { await page.keyboard.press("Tab"); if (await page.evaluate(() => document.activeElement?.textContent === "Try again")) break; }
      expect(await page.evaluate(() => document.activeElement?.textContent) === "Try again", "Try again not reachable by keyboard");
      scenario = null; await page.keyboard.press("Enter"); await waitText("Budget refreshed.");
      return `title 'Budget dashboard', one main, nav[aria-label=Budgets], role=status announcements, focus #app-main on arrival, Tab order, 320 px reflow (${axe320}), 320x225@4x reflow, 503 -> 'Try again' by keyboard -> 'Budget refreshed.'`;
    });

    // --------------------------------------------------------------- plan flow
    await criterion("QA-JOINED-FLOW", "positive (browser): Food 100.00 and Housing 200.00 base targets; the plan shows the period targets and survives a reload", async () => {
      await clickText("Edit category plan"); await waitText("Add category");
      for (const [name, amount] of [["Food", "100"], ["Housing", "200"]]) {
        await page.type("#category-name", name); await clickText("Add category"); await waitText(`Base target for ${name}`);
        const rows = await page.$$('[id^="target-"]'); const target = rows.at(-1);
        await target.click({ clickCount: 3 }); await target.type(amount);
        const buttons = []; for (const b of await page.$$("button")) if ((await b.evaluate((n) => n.textContent?.trim())) === "Save target") buttons.push(b);
        await buttons.at(-1).click(); await waitText(`Period target: ${amount}.00 USD`);
      }
      const plan = (await apiJson(`/v1/budget-spaces/${budgetId}/plan`)).body;
      const amounts = Object.fromEntries(plan.categories.map((c) => [c.label, c.periodTarget.amountMinorUnits]));
      expect(amounts.Food === 10000 && amounts.Housing === 20000 && plan.period.periodId === confirmResponse.currentPeriodId, JSON.stringify(amounts));
      await page.reload(); await waitText("Period target: 200.00 USD");
      const after = await text();
      expect(after.includes("Period target: 100.00 USD") && after.includes("Period target: 200.00 USD") && after.includes(budgetId), "plan differs after reload");
      const axe = await accessibility();
      return `Food 100.00, Housing 200.00 (API: Food=10000 Housing=20000 minor units, total 30000, period ${plan.period.periodId}); identical after reload; ${axe}`;
    });
    await criterion("CBD-153-AC04", "denial (browser): a negative base target is refused by the server and the plan is unchanged", async () => {
      const rows = await page.$$('[id^="target-"]'); const target = rows[0];
      await target.click({ clickCount: 3 }); await target.type("-5");
      const buttons = []; for (const b of await page.$$("button")) if ((await b.evaluate((n) => n.textContent?.trim())) === "Save target") buttons.push(b);
      const response = page.waitForResponse((r) => r.url().includes("/targets") && r.request().method() === "PUT").catch(() => undefined);
      await buttons[0].click();
      const put = await response;
      const status = put?.status();
      await pause(500);
      const plan = (await apiJson(`/v1/budget-spaces/${budgetId}/plan`)).body;
      const amounts = Object.fromEntries(plan.categories.map((c) => [c.label, c.periodTarget.amountMinorUnits]));
      expect(amounts.Food === 10000 && amounts.Housing === 20000, `plan changed ${JSON.stringify(amounts)}`);
      const body = await text();
      return `PUT targets -> ${status ?? "not sent (client refused)"}; plan unchanged (Food 10000, Housing 20000); page shows ${body.includes("Period target: 100.00 USD") ? "the stored 100.00" : body.slice(0, 120)}`;
    });

    // ------------------------------------------------- cross-subject (CBD-242-AC08)
    await criterion("CBD-242-AC08", "denial: another subject's proposal identifier cannot be read or confirmed from this browser; an account switch reveals no other draft/preview", async () => {
      const other = await browser.createBrowserContext(); const otherPage = await other.newPage(); otherPage.setDefaultTimeout(30_000);
      await signInAs("subject-b", otherPage); await otherPage.waitForFunction(() => location.pathname === "/budgets");
      const posted = otherPage.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/budget-creation-proposals") && r.ok());
      await otherPage.goto(`${ORIGIN}/budgets/new`); await otherPage.waitForFunction(() => document.querySelector("main")?.textContent?.includes("Budget and schedule"));
      await otherPage.type('[id="field-name"]', "Subject B secret");
      const theirs = await (await posted).json();
      const read = await apiJson(`/v1/budget-creation-proposals/${theirs.proposalId}`);
      const confirmAttempt = await apiJson(`/v1/budget-creation-proposals/${theirs.proposalId}/confirm`, { method: "POST", headers: { "content-type": "application/json", "x-cobudget-csrf": (await apiJson("/v1/identity/me")).body.csrfValue, "idempotency-key": randomUUID() }, body: JSON.stringify({ confirmationBinding: theirs.confirmationBinding }) });
      expect(read.status === 403 && confirmAttempt.status === 404, `read ${read.status} confirm ${confirmAttempt.status}`);
      const mine = await apiJson("/v1/budget-spaces");
      const theirSpaces = await otherPage.evaluate(async () => (await (await fetch("/v1/budget-spaces")).json()).spaces);
      expect(mine.body.spaces.some((x) => x.budgetSpaceId === budgetId) && !theirSpaces.some((x) => x.budgetSpaceId === budgetId), "budget visibility crosses subjects");
      const theirDraft = await otherPage.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith("cobudget.draft.creation.")));
      await other.close();
      await clickText("Sign out"); await page.waitForFunction(() => location.pathname === "/");
      await signInAs("subject-b"); await page.goto(`${ORIGIN}/budgets/new`); await waitText("Budget and schedule");
      const restored = await page.$eval('[id="field-name"]', (n) => n.value);
      const body = await text();
      expect(restored === "" && !body.includes("Subject B secret") && !body.includes("Household QA"), `restored '${restored}' / body ${body.slice(0, 200)}`);
      const visible = (await apiJson("/v1/budget-spaces")).body.spaces;
      expect(!visible.some((x) => x.budgetSpaceId === budgetId), `subject-b sees ${budgetId}`);
      return `subject-b proposal ${theirs.proposalId}: read 403, confirm 404 from subject-a's browser; subject-b draft keyed ${theirDraft.join(",")}; after switching this browser to subject-b (new sessionRef) the form restores no draft and no preview; subject-b does not see ${budgetId}`;
    });
    await criterion("QA-JOINED-FLOW", "denial (browser): after sign-out the protected route is denied again", async () => {
      await clickText("Your budgets"); await waitText("Create a budget");
      await clickText("Sign out"); await page.waitForFunction(() => location.pathname === "/");
      expect(!(await browser.cookies()).some((c) => c.name === "__Host-cobudget_session"), "cookie survives sign-out");
      await page.goto(`${ORIGIN}/budgets`); await page.waitForFunction(() => location.pathname === "/sign-in");
      await page.goto(`${ORIGIN}/budgets/${budgetId}`); await page.waitForFunction(() => location.pathname === "/sign-in");
      return "POST /v1/identity/logout deleted the cookie; /budgets and /budgets/{id} redirect to /sign-in";
    });
    expect(errors.length === 0, `page errors: ${errors.join("; ")}`);

    // --------------------------------------------- identity result pages (AC06)
    await api.stop(); await assertPortFree(API_PORT, "API"); api = startApi(); await api.ready();
    const copies = {};
    for (const [scenario, outcome] of [["cancel", "cancelled"], ["deny", "not_completed"], ["verification-pending", "verification_pending"], ["outage", "temporarily_unavailable"]]) {
      await criterion("CBD-190-AC06", `positive/denial: the ${scenario} result page is keyboard/screen-reader accessible (focus on the heading, retry reachable) and discloses no account-existence information`, async () => {
        await signInAs(scenario);
        await page.waitForFunction(() => location.pathname === "/identity/result");
        expect(new URL(page.url()).searchParams.get("outcome") === outcome, `outcome ${new URL(page.url()).search}`);
        await waitText("Sign-in did not complete");
        const focused = await page.evaluate(() => `${document.activeElement?.tagName}#${document.activeElement?.id}`);
        expect(focused === "H1#" || focused === "MAIN#app-main", `focus on ${focused}`);
        const body = await text();
        expect(!body.includes(outcome) && !/account|exists|registered|not found|unknown user/iu.test(body.replace("Sign in to MoneyPact", "")), `result copy discloses: ${body.slice(0, 200)}`);
        copies[scenario] = body;
        for (let step = 0; step < 10; step++) { await page.keyboard.press("Tab"); if (await page.evaluate(() => document.activeElement?.textContent === "Continue to sign in")) break; }
        expect(await page.evaluate(() => document.activeElement?.textContent) === "Continue to sign in", "retry control not reachable by keyboard");
        const axe = await accessibility();
        expect(!(await browser.cookies()).some((c) => c.name === "__Host-cobudget_session"), "session cookie after a failed ceremony");
        await page.goBack(); await page.waitForFunction(() => location.port === "3001" || location.pathname === "/sign-in");
        return `?outcome=${outcome}: 'Sign-in did not complete. You can try again.', focus on ${focused}, Tab -> 'Continue to sign in', no cookie, ${axe}; back navigation returns to ${new URL(page.url()).pathname}`;
      });
    }
    await criterion("CBD-190-AC06", "outcome: every failure outcome (including invalid_or_expired and an unknown value) renders identical non-enumerating copy; query text is never echoed", async () => {
      await page.goto(`${ORIGIN}/identity/result?outcome=invalid_or_expired`); await waitText("Sign-in did not complete"); copies.invalid = await text();
      await page.goto(`${ORIGIN}/identity/result?outcome=untrusted-provider-detail<script>`); await waitText("Sign-in did not complete"); copies.unknown = await text();
      const values = [...new Set(Object.values(copies))];
      expect(values.length === 1 && !copies.unknown.includes("untrusted-provider-detail"), `copies differ across outcomes (${values.length} variants) or echo the query`);
      const axe = await accessibility();
      return `identical copy across ${Object.keys(copies).join(", ")}; unknown query value not echoed; ${axe}`;
    });
    await criterion("CBD-190-AC06", "regression: real provider pages", async () => notRun("hosted Cognito pages are not activated (PROVIDERS-LOCAL-001); only the local scaffold and the application result pages were exercised"));
    expect(errors.length === 0, `page errors: ${errors.join("; ")}`);
  } catch (error) {
    results.push({ criterion: "RUN", case: "harness", status: "fail", detail: error.message, at: new Date().toISOString() });
    console.error(`RUN aborted: ${error.message}\nAPI output (tail):\n${api.output().slice(-1500)}\nweb output (tail):\n${webOutput.slice(-1500)}`);
  } finally {
    await browser?.close();
    if (previous === undefined) { try { unlinkSync(marker); } catch { /* already gone */ } } else writeFileSync(marker, previous);
    await api.stop(); web.kill();
    await new Promise((resolve) => web.once("exit", resolve));
  }
  const byCriterion = {};
  for (const r of results) (byCriterion[r.criterion] ??= []).push(r);
  console.log("\n== Summary ==");
  for (const [id, cases] of Object.entries(byCriterion).sort()) {
    const status = cases.some((c) => c.status === "fail") ? "FAIL" : cases.every((c) => c.status === "not_run") ? "NOT_RUN" : "PASS";
    console.log(`${id}: ${status} (${cases.filter((c) => c.status === "pass").length} pass, ${cases.filter((c) => c.status === "fail").length} fail, ${cases.filter((c) => c.status === "not_run").length} not_run)`);
  }
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ candidate: CANDIDATE, database: DB_NAME, at: new Date().toISOString(), results }, null, 2));
  const failed = results.filter((r) => r.status === "fail").length;
  console.log(failed ? `PROTOTYPE-QA-BROWSER FAILED (${failed} case(s))` : "PROTOTYPE-QA-BROWSER PASSED");
  process.exitCode = failed ? 1 : 0;
}

await main();
