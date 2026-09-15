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
 * per process under the approved bootstrap record). Every case establishes
 * its own page state (session, route, first control) so one failure cannot
 * cascade into the next case. No secret is printed.
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
/** Runs before every case: resets interception and viewport so a failed case cannot poison the next one. */
let beforeCase = async () => {};
async function criterion(id, name, fn) {
  const started = new Date().toISOString();
  try {
    await beforeCase();
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
    /**
     * CBD-236 (CBD236-CONSENT-SEMANTICS-001 item 1): the confirm control is enabled only after the
     * person explicitly acknowledges the current-version Primary Owner self-disclosure. Nothing ticks
     * the box for them, so every path that expects an enabled confirm ticks it here first.
     */
    const acknowledgeDisclosure = async () => {
      const box = await page.$('[id="field-acknowledged-disclosure"]');
      if (box && !(await box.evaluate((node) => node.checked || node.disabled))) await box.click();
      return box;
    };
    /**
     * A preview that resolves after the box was ticked republishes the review and drops the
     * acknowledgement with it -- correctly, because the acknowledgement was given against the previous
     * review. So re-tick until the control is actually enabled rather than ticking once and hoping.
     */
    const waitConfirmEnabled = async (timeoutMs = 30_000) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        await acknowledgeDisclosure();
        try {
          return await page.waitForFunction(() => [...document.querySelectorAll("button")].find((node) => node.textContent === "Confirm and create budget")?.disabled === false, { timeout: 1_000 });
        } catch (error) {
          if (Date.now() >= deadline) throw error;
        }
      }
    };
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
        const now = Date.now(); const recent = apiRequests.filter((r) => r.method !== "GET" && r.path.startsWith("/v1/budget-") && !r.path.endsWith("/confirm") && now - r.at < 61_000);
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


    // ------------------------------------------------------- page-state control
    // Every case establishes the page state it needs (route, session, first control) and the wrapper resets
    // request interception before each case, so a failing case cannot leave the next one on the wrong page.
    const recorder = (request) => { const url = new URL(request.url()); if (url.pathname.startsWith("/v1/")) apiRequests.push({ method: request.method(), path: url.pathname, body: request.postData(), at: Date.now() }); };
    page.removeAllListeners("request"); page.on("request", recorder);
    let interceptor = null; let scenario = null;
    const resetInterception = async () => {
      page.removeAllListeners("request"); page.on("request", recorder);
      if (interceptor) { page.on("request", interceptor); await page.setRequestInterception(true); } else await page.setRequestInterception(false);
    };
    const intercept = async (handler) => { await page.setRequestInterception(true); page.on("request", handler); };
    beforeCase = async () => { scenario = null; await resetInterception(); try { await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 }); } catch { /* ignore */ } };
    const pathname = () => new URL(page.url()).pathname;
    const clearCookies = async () => { const cdp = await page.createCDPSession(); await cdp.send("Network.clearBrowserCookies"); await cdp.detach(); };
    const signedIn = async () => (await browser.cookies()).some((c) => c.name === "__Host-cobudget_session");
    const ensureSignedIn = async (scenarioName = "subject-a") => {
      if (await signedIn()) { const me = await apiJson("/v1/identity/me"); if (me.status === 200) return me.body; await clearCookies(); }
      await signInAs(scenarioName); await page.waitForFunction(() => location.pathname === "/budgets");
      return (await apiJson("/v1/identity/me")).body;
    };
    const ensureForm = async () => {
      await ensureSignedIn();
      if (pathname() !== "/budgets/new") await page.goto(`${ORIGIN}/budgets/new`);
      await page.waitForSelector('[id="field-name"]'); await waitText("Budget and schedule");
      // A restored draft previews on mount; let that settle so a case's own edit is the next proposal POST.
      await pause(600); await page.waitForFunction(() => !document.querySelector("main")?.textContent?.includes("Preparing your schedule"));
    };
    /** A fresh form with `name` previewed and confirm enabled; returns the server proposal Chrome received. */
    let previewCounter = 0;
    const previewFresh = async (name) => {
      await ensureForm(); await roomFor(1);
      const posted = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/budget-creation-proposals") && r.ok());
      await setValue('[id="field-name"]', `${name} ${++previewCounter}`);
      const proposal = await (await posted).json();
      await waitText("Complete current period"); await waitConfirmEnabled();
      return proposal;
    };
    /** The next successful proposal POST Chrome receives; the rejection is observed so a timed-out wait cannot crash the run. */
    const nextProposal = () => { const p = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/budget-creation-proposals") && r.ok()).then((r) => r.json()); p.catch(() => {}); return p; };
    let budgetId; let confirmResponse; let confirmedName; let confirmBody; let confirmedDisclosure;
    const createBudget = async (name) => {
      const proposal = await previewFresh(name);
      const confirmed = page.waitForResponse((r) => r.url().endsWith("/confirm") && r.request().method() === "POST");
      await clickText("Confirm and create budget");
      const response = await (await confirmed).json();
      await waitText("No categories yet");
      budgetId = pathname().split("/").at(-1); confirmResponse = response; confirmedName = proposal.normalizedInputs.name;
      return { proposal, response };
    };
    const ensureDashboard = async () => {
      await ensureSignedIn();
      if (!budgetId) await createBudget("Household QA");
      await page.goto(`${ORIGIN}/budgets/${budgetId}`);
      await waitText("Active period identity"); await page.waitForFunction(() => [...document.querySelectorAll("button")].some((n) => n.textContent === "Refresh budget"));
    };
    const ensurePlan = async () => {
      await ensureDashboard();
      await clickText("Edit category plan"); await waitText("Add category");
    };
    /** Locates the base-target input by its label text and the Save button of the same category block. */
    const saveTarget = async (name, amount) => {
      const located = await page.evaluate((name) => {
        const label = [...document.querySelectorAll("label")].find((l) => l.textContent?.trim().startsWith(`Base target for ${name}`));
        if (!label) return null;
        const inputId = label.getAttribute("for") ?? label.querySelector("input")?.id;
        const saves = [...document.querySelectorAll("button")].filter((b) => b.textContent?.trim() === "Save target");
        let block = label; while (block && !saves.some((b) => block.contains(b))) block = block.parentElement;
        return { inputId, buttonIndex: saves.findIndex((b) => block?.contains(b)) };
      }, name);
      expect(located && located.inputId && located.buttonIndex >= 0, `no base-target input/save button for ${name}`);
      await setValue(`[id="${located.inputId}"]`, amount);
      const buttons = []; for (const b of await page.$$("button")) if ((await b.evaluate((n) => n.textContent?.trim())) === "Save target") buttons.push(b);
      const response = page.waitForResponse((r) => r.url().includes("/targets") && r.request().method() === "PUT", { timeout: 5000 }).catch(() => undefined);
      await buttons[located.buttonIndex].click();
      return response;
    };

    // ---------------------------------------------------------------- sign-in
    await criterion("CBD-190-AC06", "positive: the signed-out protected route redirects to an accessible sign-in page; keyboard reaches the sign-in control", async () => {
      await clearCookies();
      await page.goto(`${ORIGIN}/budgets`); await page.waitForFunction(() => location.pathname === "/sign-in");
      const axe = await accessibility();
      await page.evaluate(() => document.getElementById("app-main")?.focus());
      for (let step = 0; step < 20; step++) { await page.keyboard.press("Tab"); if (await page.evaluate(() => document.activeElement?.textContent === "Continue to sign in")) break; }
      expect(await page.evaluate(() => document.activeElement?.textContent) === "Continue to sign in", "Tab does not reach the sign-in control");
      return `/budgets -> /sign-in; ${axe}; Tab reaches 'Continue to sign in'`;
    });
    let session;
    await criterion("QA-JOINED-FLOW", "positive (browser): sign in on the local adapter; HttpOnly host-only session cookie accepted by Chrome on the localhost application origin; no CSRF cookie; no credential or token in browser storage", async () => {
      await clearCookies(); await page.goto(`${ORIGIN}/sign-in`); await waitText("Continue to sign in");
      const beginResponse = page.waitForResponse((r) => r.url().endsWith("/v1/identity/begin"));
      await clickText("Continue to sign in");
      expect((await beginResponse).status() === 200, "begin");
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
    const spacesBefore = (await apiJson("/v1/budget-spaces")).body?.spaces?.length ?? 0;
    await criterion("CBD-242-AC01", "positive/denial: every required field is labeled; a server field error is mapped to its field, announced and focused; unrelated valid inputs survive", async () => {
      await ensureForm(); await roomFor(4);
      expect(await confirmDisabled() === true, "confirm must start disabled");
      const labels = await page.$$eval("label", (nodes) => nodes.map((n) => n.textContent.trim()));
      expect(["Budget name", "IANA time zone", "Currency code", "Cadence"].every((l) => labels.some((x) => x.startsWith(l))), `labels ${labels.join(", ")}`);
      await setValue('[id="field-name"]', "");
      await clickText("Preview schedule"); await waitText("Enter a budget name.");
      expect(await page.$eval('[id="field-name"]', (n) => n.getAttribute("aria-invalid")) === "true", "name not marked invalid");
      expect(await page.evaluate(() => document.activeElement?.id) === "field-name", "focus not moved to the invalid field");
      const described = await page.$eval('[id="field-name"]', (n) => n.getAttribute("aria-describedby"));
      expect(described && await page.evaluate((id) => document.getElementById(id)?.textContent, described.split(" ")[0]), "error not linked through aria-describedby");
      expect(await page.$eval("#validation-errors", (n) => n.getAttribute("aria-label")) === "Validation errors", "validation error list not labeled");
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
      const since = apiRequests.length;
      const latest = await previewFresh("Household QA");
      const posts = apiRequests.slice(since).filter((r) => r.method === "POST" && r.path === "/v1/budget-creation-proposals");
      expect(posts.length > 0, "no proposal POST observed");
      for (const post of posts) { const keys = Object.keys(JSON.parse(post.body)).sort(); expect(keys.every((k) => ["name", "timeZone", "currencyCode", "schedule", "supersedesProposalId"].includes(k)), `client supplied ${keys.join(",")}`); }
      const rendered = await page.$$eval("ol li", (nodes) => nodes.map((n) => n.textContent));
      expect(rendered.length === 4 && latest.preview.periods.every((p, i) => rendered[i].includes(`${p.start} through ${p.end}`) && rendered[i].includes(`${p.lengthInDays} days`)), `rendered ${JSON.stringify(rendered)} vs ${JSON.stringify(latest.preview.periods)}`);
      return `${posts.length} proposal POST(s), body keys only {name,timeZone,currencyCode,schedule[,supersedesProposalId]}; the four rendered periods equal the server preview of ${latest.proposalId}`;
    });
    await criterion("CBD-242-AC03", "positive: review shows the budget name, time zone, currency, cadence summary, the complete current period and three following periods with inclusive dates and lengths", async () => {
      const latest = await previewFresh("Household QA review"); const body = await text();
      expect(body.includes(latest.normalizedInputs.name) && body.includes(`${latest.normalizedInputs.timeZone} · ${latest.normalizedInputs.currencyCode}`) && body.includes(latest.preview.cadenceSummary), "review header incomplete");
      const items = await page.$$eval("ol li h3", (nodes) => nodes.map((n) => n.textContent));
      expect(items[0] === "Complete current period" && items.slice(1).every((h, i) => h === `Following period ${i + 1}`), JSON.stringify(items));
      expect(body.includes("dates inclusive"), "inclusive-dates statement missing");
      return `name '${latest.normalizedInputs.name}', '${latest.normalizedInputs.timeZone} · ${latest.normalizedInputs.currencyCode}', '${latest.preview.cadenceSummary}', ${items.join(" / ")}, dates inclusive with lengths`;
    });
    await criterion("CBD-242-AC05", "positive: a result-affecting edit disables the old confirmation immediately and obtains a new preview that supersedes the old proposal", async () => {
      const before = await previewFresh("Household QA edit"); await roomFor(1);
      const next = nextProposal();
      await page.type('[id="field-name"]', "!");
      expect(await confirmDisabled() === true, "confirm still enabled right after the edit");
      const after = await next; await waitConfirmEnabled();
      expect(after.proposalId !== before.proposalId && after.supersedesProposalId === before.proposalId, `successor ${after.proposalId} supersedes ${after.supersedesProposalId} (expected ${before.proposalId})`);
      return `edit disabled confirm synchronously; new proposal ${after.proposalId} supersedes ${before.proposalId}`;
    });
    await criterion("CBD-242-AC04", "positive/denial: confirm is unavailable while the preview loads and until it is rendered and bound; a slow response keeps it disabled", async () => {
      await ensureForm(); await roomFor(1);
      await intercept((request) => { if (request.method() === "POST" && new URL(request.url()).pathname === "/v1/budget-creation-proposals") setTimeout(() => request.continue().catch(() => {}), 1500); else request.continue().catch(() => {}); });
      await setValue('[id="field-name"]', "Household QA slow");
      await pause(700);
      expect(await confirmDisabled() === true && (await text()).includes("Preparing your schedule"), "confirm enabled during loading");
      await waitConfirmEnabled();
      return "disabled during 'Preparing your schedule…' (1.5 s delayed response); enabled only after the four periods rendered";
    });
    await criterion("CBD-242-AC06", "regression: slow/out-of-order proposal responses never render or bind a preview for stale inputs", async () => {
      await ensureForm(); await roomFor(2);
      let first = true;
      await intercept((request) => { if (request.method() === "POST" && new URL(request.url()).pathname === "/v1/budget-creation-proposals" && first) { first = false; setTimeout(() => request.continue().catch(() => {}), 2500); } else request.continue().catch(() => {}); });
      await setValue('[id="field-name"]', "Household QA A"); await pause(500); await page.type('[id="field-name"]', "B");
      await waitConfirmEnabled(); await pause(2800);
      const name = await page.$eval('[id="field-name"]', (n) => n.value); const shown = await text();
      expect(shown.includes(name) && await confirmDisabled() === false, `review shows '${shown.slice(0, 120)}' for input '${name}'`);
      return `two edits with the first response delayed 2.5 s: the review carries the latest input '${name}' and confirm is enabled only for it`;
    });
    await criterion("CBD-242-AC06", "regression: refresh, back/forward, restored draft and a duplicate tab obtain new previews and never restore a binding", async () => {
      const before = await previewFresh("Household QA restored"); await roomFor(5);
      const refreshed = nextProposal(); await page.reload(); const afterRefresh = await refreshed; await waitText("Complete current period"); await waitConfirmEnabled();
      expect(await page.$eval('[id="field-name"]', (n) => n.value) === before.normalizedInputs.name, "draft not restored");
      expect(afterRefresh.proposalId !== before.proposalId, "refresh reused the previous proposal");
      await clickText("Your budgets"); await page.waitForFunction(() => location.pathname === "/budgets"); await waitText("Your budgets");
      const back = nextProposal(); await page.goBack(); await page.waitForFunction(() => location.pathname === "/budgets/new"); const afterBack = await back; await waitText("Complete current period"); await waitConfirmEnabled();
      expect(afterBack.proposalId !== afterRefresh.proposalId, "back navigation reused the previous proposal");
      await page.goForward(); await page.waitForFunction(() => location.pathname === "/budgets"); await waitText("Your budgets");
      const back2 = nextProposal(); await page.goBack(); await page.waitForFunction(() => location.pathname === "/budgets/new"); const afterBack2 = await back2; await waitText("Complete current period"); await waitConfirmEnabled();
      expect(afterBack2.proposalId !== afterBack.proposalId, "second back navigation reused the previous proposal");
      const storage = await page.evaluate(() => Object.entries(sessionStorage));
      expect(!storage.some(([, v]) => v.includes("confirmationBinding") || v.includes("proposalId")), "a binding or proposal id is persisted in sessionStorage");
      const duplicate = await browser.newPage();
      await duplicate.evaluateOnNewDocument((entries) => { for (const [k, v] of entries) sessionStorage.setItem(k, v); }, storage);
      const newProposal = duplicate.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/budget-creation-proposals") && r.ok());
      await duplicate.goto(`${ORIGIN}/budgets/new`);
      const duplicated = await (await newProposal).json();
      expect(duplicated.proposalId !== afterBack2.proposalId && duplicated.supersedesProposalId === null, "duplicate tab reused the proposal chain");
      await duplicate.close(); await page.bringToFront();
      return `refresh ${before.proposalId} -> ${afterRefresh.proposalId}; back -> ${afterBack.proposalId}; forward/back -> ${afterBack2.proposalId}; sessionStorage holds the raw draft only; duplicate tab -> ${duplicated.proposalId} without predecessor`;
    });
    await criterion("CBD-242-AC02", "denial: a locally altered preview (tampered proposal response) is not confirmed; the client re-reads the server proposal, regenerates and never creates the budget from the altered preview", async () => {
      await ensureForm(); await roomFor(2);
      let tampered = false;
      await intercept(async (request) => {
        if (!tampered && request.method() === "POST" && new URL(request.url()).pathname === "/v1/budget-creation-proposals") {
          tampered = true; const raw = await proxiedPost(request);
          const body = raw.body; if (raw.status === 201) { body.preview.periods[0].end = "2099-12-31"; body.preview.periods[0].lengthInDays = 9999; }
          await request.respond({ status: raw.status, contentType: "application/json", body: JSON.stringify(body) }).catch(() => {});
        } else request.continue().catch(() => {});
      });
      await setValue('[id="field-name"]', "Household QA tampered");
      await waitText("2099-12-31"); await waitConfirmEnabled();
      const confirms = apiRequests.filter((r) => r.path.endsWith("/confirm")).length;
      const regenerated = nextProposal();
      await clickText("Confirm and create budget");
      const fresh = await regenerated;
      await page.waitForFunction(() => document.querySelectorAll("ol li").length === 4 && !document.querySelector("main")?.textContent?.includes("2099-12-31"));
      await waitConfirmEnabled();
      expect(apiRequests.filter((r) => r.path.endsWith("/confirm")).length === confirms, "a confirm request was sent for the altered preview");
      expect(pathname() === "/budgets/new", "left the form");
      return `altered response rendered 2099-12-31; confirm re-read the server row, sent no confirm request, regenerated ${fresh.proposalId} and re-rendered the server preview`;
    });
    await criterion("CBD-242-AC05", "denial: expiry disables the old confirmation and obtains a new preview (expiresAt injected 3 s ahead)", async () => {
      await ensureForm(); await roomFor(2);
      let shortened = false; let shortLived;
      await intercept(async (request) => {
        if (!shortened && request.method() === "POST" && new URL(request.url()).pathname === "/v1/budget-creation-proposals") {
          shortened = true; const raw = await proxiedPost(request);
          const body = raw.body; if (raw.status === 201) { body.expiresAt = new Date(Date.now() + 3000).toISOString(); shortLived = body.proposalId; }
          await request.respond({ status: raw.status, contentType: "application/json", body: JSON.stringify(body) }).catch(() => {});
        } else request.continue().catch(() => {});
      });
      const renewed = nextProposal().then(() => nextProposal());
      await setValue('[id="field-name"]', "Household QA expiring"); await waitConfirmEnabled();
      const next = await renewed;
      await page.waitForFunction(() => document.querySelectorAll("ol li").length === 4); await waitConfirmEnabled();
      expect(shortLived && next.proposalId !== shortLived, "no new preview after the injected expiry");
      return `proposal ${shortLived} with expiresAt +3 s: at expiry the client disabled confirm and obtained ${next.proposalId}`;
    });
    await criterion("CBD-242-AC05", "regression: governing-rule change and budget-local-midnight rollover in the browser", async () => notRun("no rule-version seam and no clock seam in the running processes; the API-side local-midnight expiry computation is covered in prototype-qa-criteria.mjs (CBD-232-AC05); the client's expiry timer is exercised by the injected-expiry case above"));
    await criterion("CBD-242-AC07", "denial: invalid/unsupported cadence inputs, a monthly day-31 clamp and an API failure have deterministic accessible states and create no budget", async () => {
      await ensureForm(); await roomFor(4);
      await setValue('[id="field-name"]', "Household QA cadence");
      await page.select('[id="field-schedule.cadence"]', "custom-fixed-length");
      await page.waitForSelector('[id="field-schedule.lengthInDays"]');
      await setValue('[id="field-schedule.lengthInDays"]', "0"); await setValue('[id="field-schedule.startBoundary"]', "2026-01-01");
      await clickText("Preview schedule");
      await page.waitForFunction(() => document.querySelector("#validation-errors"));
      expect(await page.$eval('[id="field-schedule.lengthInDays"]', (n) => n.getAttribute("aria-invalid")) === "true" && await confirmDisabled() === true, "length 0 not mapped to its field");
      const axe1 = await accessibility();
      await page.select('[id="field-schedule.cadence"]', "monthly");
      await page.waitForSelector('[id="field-schedule.anchor.day"]');
      const clamped = nextProposal();
      await setValue('[id="field-schedule.anchor.day"]', "31");
      await clickText("Preview schedule"); const clampProposal = await clamped; await waitText("Complete current period"); await waitConfirmEnabled();
      const clampShown = (await text()).includes("does not exist in this month");
      expect(clampShown === (clampProposal.preview.warnings.length > 0), `clamp warning shown=${clampShown} expected=${clampProposal.preview.warnings.length > 0}`);
      await intercept((request) => { if (request.method() === "POST" && new URL(request.url()).pathname === "/v1/budget-creation-proposals") request.respond({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) }).catch(() => {}); else request.continue().catch(() => {}); });
      await page.type('[id="field-name"]', "X"); await waitText("We could not prepare this schedule");
      expect(await confirmDisabled() === true, "confirm enabled after an API failure");
      const axe2 = await accessibility();
      await resetInterception();
      const spaces = (await apiJson("/v1/budget-spaces")).body.spaces.length;
      expect(spaces === spacesBefore + (budgetId ? 1 : 0), `budgets created during failures: ${spacesBefore} -> ${spaces}`);
      return `custom length 0 -> field error on field-schedule.lengthInDays (${axe1}); monthly day 31 -> clamp warning ${clampShown ? "shown" : "not needed this month"} (warnings=${clampProposal.preview.warnings.length}); 503 on preview -> 'We could not prepare this schedule', confirm disabled (${axe2}); no budget created`;
    });
    await criterion("CBD-242-AC07", "regression: DST and time-zone boundary journeys in the browser", async () => notRun("wall-clock bound; the API preview fixtures for other zones are compared in prototype-qa-criteria.mjs (CBD-232-AC03/AC05); not driven through the browser"));

    await criterion("CBD-242-AC04", "outcome: the confirm request carries only the server binding under the current subject, and the confirmed space id matches the dashboard route and the API", async () => {
      await ensureForm(); await roomFor(1);
      const proposal = await previewFresh("Household QA");
      const confirmRequest = page.waitForRequest((r) => r.url().endsWith("/confirm") && r.method() === "POST");
      const confirmed = page.waitForResponse((r) => r.url().endsWith("/confirm") && r.request().method() === "POST");
      await clickText("Confirm and create budget");
      const request = await confirmRequest;
      // CBD-236: the body is still closed -- the server binding plus the acknowledged disclosure, and nothing else.
      confirmBody = JSON.parse(request.postData());
      expect(request.url().includes(proposal.proposalId) && Object.keys(confirmBody).sort().join(",") === "acknowledgedDisclosure,confirmationBinding" && typeof request.headers()["x-cobudget-csrf"] === "string" && typeof request.headers()["idempotency-key"] === "string", `confirm request shape ${JSON.stringify(Object.keys(confirmBody))}`);
      confirmedDisclosure = proposal.currentDisclosure;
      confirmResponse = await (await confirmed).json();
      await waitText("No categories yet"); budgetId = pathname().split("/").at(-1); confirmedName = proposal.normalizedInputs.name;
      expect(budgetId === confirmResponse.budgetSpaceId, `route ${budgetId} vs response ${confirmResponse.budgetSpaceId}`);
      const detail = (await apiJson(`/v1/budget-spaces/${budgetId}`)).body;
      expect(detail.activePeriod.periodId === confirmResponse.currentPeriodId, "dashboard period differs from the confirmation");
      return `POST .../${proposal.proposalId}/confirm {confirmationBinding, acknowledgedDisclosure} with X-CoBudget-CSRF and Idempotency-Key -> ${confirmResponse.budgetSpaceId}; route /budgets/${budgetId}; activePeriod ${detail.activePeriod.periodId} = currentPeriodId`;
    });
    await criterion("CBD-236-CONSENT-03", "positive/denial: the review presents the approved Primary Owner self-disclosure above the confirm control, nothing is ticked for the person, confirming is impossible until they tick it and impossible again once they untick it, and the confirmation echoes exactly the disclosure the server sent", async () => {
      // The confirmation that created the budget above is the evidence for the request half; no second
      // budget is created here, so the failure-path budget counting downstream is undisturbed.
      expect(confirmedDisclosure && typeof confirmedDisclosure.kind === "string" && Number.isSafeInteger(confirmedDisclosure.version) && /^[0-9a-f]{64}$/u.test(confirmedDisclosure.digest ?? ""),
        `the preview response carried no approved disclosure: ${JSON.stringify(confirmedDisclosure)}`);
      expect(confirmBody.acknowledgedDisclosure?.kind === confirmedDisclosure.kind && confirmBody.acknowledgedDisclosure.version === confirmedDisclosure.version,
        `the acknowledgement ${JSON.stringify(confirmBody.acknowledgedDisclosure)} is not the disclosure the server sent`);
      expect(confirmBody.acknowledgedDisclosure.digest === undefined, "the client echoes only the kind and version; the digest is the server's own");

      // The presentation and the gate, on a fresh review that is deliberately never confirmed.
      await ensureForm(); await roomFor(1);
      const posted = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/budget-creation-proposals") && r.ok());
      await setValue('[id="field-name"]', "Disclosure review");
      const proposal = await (await posted).json();
      await waitText("Complete current period");
      const disclosure = proposal.currentDisclosure;
      const shown = await text();
      expect(shown.includes(disclosure.text.heading), `the disclosure heading is not on the review: ${shown.slice(0, 200)}`);
      for (const item of disclosure.text.items) expect(shown.includes(item.text), `disclosure item ${item.id} is not presented`);
      expect(shown.includes(disclosure.text.acknowledgement), "the acknowledgement sentence is not presented");
      const box = await page.$('[id="field-acknowledged-disclosure"]');
      expect(box !== null, "there is no acknowledgement control");
      expect(await box.evaluate((node) => node.checked) === false, "the acknowledgement is ticked by default");
      expect(await confirmDisabled() === true, "confirm is enabled before the disclosure is acknowledged");
      await box.click();
      await page.waitForFunction(() => [...document.querySelectorAll("button")].find((node) => node.textContent === "Confirm and create budget")?.disabled === false);
      await box.click();
      await page.waitForFunction(() => [...document.querySelectorAll("button")].find((node) => node.textContent === "Confirm and create budget")?.disabled === true);
      const accessible = await accessibility();
      await clickText("Your budgets");
      return `${disclosure.kind} v${disclosure.version}: heading, ${disclosure.text.items.length} items and the acknowledgement sentence are presented with nothing ticked; confirm disabled until ticked and disabled again when unticked; the committed confirm body was exactly {confirmationBinding, acknowledgedDisclosure ${confirmedDisclosure.kind} v${confirmedDisclosure.version}}; ${accessible}`;
    });

    // ------------------------------------------------------------ CBD-218 shell
    let detailResponse;
    await criterion("CBD-218-AC01", "positive: the dashboard renders the server-supplied budget and active-period identities verbatim and computes no boundary locally", async () => {
      await ensureDashboard();
      detailResponse = (await apiJson(`/v1/budget-spaces/${budgetId}`)).body;
      const body = await text();
      expect(body.includes(budgetId) && body.includes(detailResponse.activePeriod.periodId) && body.includes(detailResponse.activePeriod.start) && body.includes(detailResponse.activePeriod.end), `dashboard text lacks server identities: ${body.slice(0, 400)}`);
      expect((await page.title()).includes("Budget dashboard"), "title");
      return `budget ${budgetId}, active period ${detailResponse.activePeriod.periodId} ${detailResponse.activePeriod.start}..${detailResponse.activePeriod.end} rendered verbatim from GET /v1/budget-spaces/{id}; ${await accessibility()}`;
    });
    interceptor = (request) => {
      if (scenario && budgetId && new URL(request.url()).pathname === `/v1/budget-spaces/${budgetId}`) {
        const selected = scenario;
        void (async () => { if (selected.delay) await pause(selected.delay); try { await request.respond({ status: selected.status ?? 200, contentType: "application/json", body: JSON.stringify(selected.body ?? detailResponse) }); } catch { /* cancelled navigation */ } })();
      } else request.continue().catch(() => {});
    };
    const withDashboard = async () => { await ensureDashboard(); if (!detailResponse) detailResponse = (await apiJson(`/v1/budget-spaces/${budgetId}`)).body; };
    for (const [label, patch, expected] of [["true-empty", { activePeriod: null }, "No active period"], ["partial", { scheduleVersion: null }, "Budget details are incomplete"]]) {
      await criterion("CBD-218-AC03", `positive: ${label} state identifies the affected scope and never shows incomplete data as current`, async () => {
        await withDashboard(); scenario = { body: { ...detailResponse, ...patch } }; await clickText("Refresh budget"); await waitText(expected);
        if (label === "partial") expect(await page.$("#plan-heading") === null, "plan shown on a partial response");
        return `${label}: '${expected}'; ${await accessibility()}`;
      });
    }
    await criterion("CBD-218-AC03", "denial: the stale state (freshness signal)", async () => notRun("the merged detail response carries no staleness signal (apps/web/API-ASSUMPTIONS.md); the stale shell state is not reachable from a live response"));
    for (const [label, status, expected] of [["permission-denied", 403, "Access unavailable"], ["recoverable-error", 503, "Unable to load this budget"], ["terminal-error", 404, "Budget unavailable"]]) {
      await criterion("CBD-218-AC02", `denial: injected ${status} renders the distinct ${label} state`, async () => {
        await withDashboard(); scenario = { status, body: { error: label } }; await clickText("Refresh budget"); await waitText(expected);
        return `${status} -> '${expected}'; ${await accessibility()}`;
      });
    }
    await criterion("CBD-218-AC02", "positive: loading, refreshed and success states have distinct copy", async () => {
      await withDashboard(); scenario = { delay: 1000 }; await clickText("Refresh budget"); await waitText("Loading the active budget period"); await waitText("Budget refreshed.");
      scenario = null; await page.reload(); await waitText("The active budget period is ready.");
      return "'Loading the active budget period' -> 'Budget refreshed.' -> on reload 'The active budget period is ready.'";
    });
    await criterion("CBD-218-AC04", "outcome: navigation away discards a slow response from another budget; nothing from it renders", async () => {
      await withDashboard(); scenario = { delay: 1200, body: { ...detailResponse, space: { ...detailResponse.space, name: "Stale response marker" } } };
      await clickText("Refresh budget"); await waitText("Loading the active budget period");
      await clickText("Your budgets"); await page.waitForFunction(() => location.pathname === "/budgets"); await waitText("Your budgets"); await pause(1500);
      expect(!(await text()).includes("Stale response marker"), "stale response rendered after navigation");
      return "1.2 s delayed detail with a marker name discarded after navigating to /budgets";
    });
    await criterion("CBD-218-AC04", "regression: rapid refresh discards the earlier slow response and renders the later one", async () => {
      await withDashboard();
      scenario = { delay: 1500, body: { ...detailResponse, space: { ...detailResponse.space, name: "Slow marker" } } };
      await clickText("Refresh budget"); await pause(100);
      scenario = { delay: 100, body: { ...detailResponse, space: { ...detailResponse.space, name: "Fast marker" } } };
      await clickText("Refresh budget"); await waitText("Fast marker"); await pause(1700);
      const body = await text();
      expect(body.includes("Fast marker") && !body.includes("Slow marker"), `rendered ${body.slice(0, 200)}`);
      return "two refreshes: the slow first response (1.5 s) never overwrote the fast second";
    });
    await criterion("CBD-218-AC05", "positive: single main landmark, budgets navigation landmark, page title, main focus on arrival, status announcements, Tab order, 320 px and 400% reflow, error recovery by keyboard", async () => {
      await withDashboard(); await clickText("Refresh budget"); await waitText("Budget refreshed.");
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
    interceptor = null;

    // --------------------------------------------------------------- plan flow
    await criterion("QA-JOINED-FLOW", "positive (browser): Food 100.00 and Housing 200.00 base targets; the plan shows the period targets and survives a reload", async () => {
      await ensurePlan(); await roomFor(4);
      for (const [name, amount] of [["Food", "100"], ["Housing", "200"]]) {
        await page.type("#category-name", name); await clickText("Add category"); await waitText(`Base target for ${name}`);
        const put = await saveTarget(name, amount);
        expect(put && put.status() === 200, `PUT targets for ${name} -> ${put ? `${put.status()} ${await put.text().catch(() => "")}` : "not sent"}`);
        await waitText(`Period target: ${amount}.00 USD`);
      }
      const plan = (await apiJson(`/v1/budget-spaces/${budgetId}/plan`)).body;
      const amounts = Object.fromEntries(plan.categories.map((c) => [c.label, c.periodTarget.amountMinorUnits]));
      expect(amounts.Food === 10000 && amounts.Housing === 20000 && plan.period.periodId === confirmResponse.currentPeriodId, JSON.stringify(amounts));
      await page.reload(); await waitText("Period target: 200.00 USD");
      const after = await text();
      expect(after.includes("Period target: 100.00 USD") && after.includes("Period target: 200.00 USD") && after.includes(budgetId), "plan differs after reload");
      return `Food 100.00, Housing 200.00 (API: Food=10000 Housing=20000 minor units, total 30000, period ${plan.period.periodId}); identical after reload; ${await accessibility()}`;
    });
    await criterion("CBD-153-AC04", "denial (browser): a negative base target is refused by the server and the plan is unchanged", async () => {
      await ensurePlan(); await roomFor(1);
      const planBefore = (await apiJson(`/v1/budget-spaces/${budgetId}/plan`)).body;
      const amountsBefore = Object.fromEntries(planBefore.categories.map((c) => [c.label, c.periodTarget.amountMinorUnits]));
      expect(amountsBefore.Food !== undefined, "no Food category to edit (previous case did not create it)");
      const put = await saveTarget("Food", "-5"); const status = put?.status(); await pause(500);
      const plan = (await apiJson(`/v1/budget-spaces/${budgetId}/plan`)).body;
      const amounts = Object.fromEntries(plan.categories.map((c) => [c.label, c.periodTarget.amountMinorUnits]));
      expect(JSON.stringify(amounts) === JSON.stringify(amountsBefore), `plan changed ${JSON.stringify(amounts)}`);
      return `PUT targets -> ${status ?? "not sent (client refused)"}; plan unchanged (${JSON.stringify(amounts)})`;
    });

    // ------------------------------- manual accounts, expenses and progress (PROTO-INCREMENT-B-001)
    // These run against the same budget the plan cases built, so Food (100.00) and Housing (200.00)
    // already carry period targets and the figures below are measured against real ones.
    const fillById = async (selector, value) => { await page.waitForSelector(selector); await setValue(selector, value); };
    let expenseCategoryId;
    await criterion("CBD-196-AC01", "positive (browser): a manual account is added from the dashboard, listed with its type and opening balance, and survives a reload", async () => {
      await ensureDashboard(); await roomFor(2);
      await waitText("Accounts and spending");
      await fillById('[id="account-name"]', "Everyday");
      await fillById('[id="account-opening"]', "125.00");
      await clickText("Add account");
      await waitText("Added Everyday.");
      await waitText("checking · opening balance 125.00 USD");
      await page.reload(); await waitText("checking · opening balance 125.00 USD");
      const listed = (await apiJson(`/v1/budget-spaces/${budgetId}/accounts`)).body;
      expect(listed.accounts.length === 1 && listed.accounts[0].origin === "manual" && listed.accounts[0].openingBalanceMinorUnits === 12500, JSON.stringify(listed));
      return `one manual account, opening 12500 minor units, identical after reload; ${await accessibility()}`;
    });
    await criterion("CBD-201-AC02", "positive/denial (browser): an inexact split is refused by the server and announced on the allocation fieldset; the exact split is recorded and moves spent and remaining for both categories", async () => {
      await ensureDashboard(); await roomFor(3);
      await waitText("Record an expense");
      const period = (await apiJson(`/v1/budget-spaces/${budgetId}`)).body.activePeriod;
      const allocationIds = await page.$$eval('input[id^="allocation-"]', (nodes) => nodes.map((node) => `[id="${node.id}"]`));
      expect(allocationIds.length === 2, `expected one allocation input per live category, got ${allocationIds.length}`);
      const enter = async (food, housing) => {
        await fillById('[id="expense-date"]', period.start);
        await fillById('[id="expense-amount"]', "12.50");
        await fillById('[id="expense-description"]', "Corner shop");
        await fillById(allocationIds[0], food);
        await fillById(allocationIds[1], housing);
        await clickText("Record expense");
      };
      await enter("8.00", "4.00");
      await waitText("The category amounts must add up to the expense amount exactly.");
      const afterRefusal = (await apiJson(`/v1/budget-spaces/${budgetId}/periods/${period.periodId}/progress`)).body;
      expect(afterRefusal.cells.every((cell) => cell.settledActualMinorUnits === 0), `the refused split was recorded: ${JSON.stringify(afterRefusal.cells)}`);
      const refusalAccessibility = await accessibility();

      await enter("8.00", "4.50");
      await waitText("Expense recorded.");
      await waitText("Spent 8.00 USD of 100.00 USD");
      await waitText("Remaining 92.00 USD");
      await waitText("Spent 4.50 USD of 200.00 USD");
      await waitText("Remaining 195.50 USD");
      const progress = (await apiJson(`/v1/budget-spaces/${budgetId}/periods/${period.periodId}/progress`)).body;
      const food = progress.cells.find((cell) => progress.labels[cell.categoryId] === "Food");
      expenseCategoryId = food.categoryId;
      expect(food.settledActualMinorUnits === -800 && food.remainingAfterSettledMinorUnits === 9200, JSON.stringify(food));
      await page.reload(); await waitText("Spent 8.00 USD of 100.00 USD");
      return `inexact split refused with nothing recorded (${refusalAccessibility}); the exact split moves Food to spent 8.00 remaining 92.00 and Housing to spent 4.50 remaining 195.50, identical after reload; ${await accessibility()}`;
    });
    await criterion("CBD-211-AC01", "positive (browser): the category row opens the itemized detail, which agrees with the aggregate; editing and removing the expense from there returns both figures to the target", async () => {
      await ensureDashboard(); await roomFor(2);
      await waitText("Spent 8.00 USD of 100.00 USD");
      await clickText("Food");
      await waitText("Transactions in this category");
      await waitText("Corner shop");
      await waitText("8.00 USD · Everyday");
      const detailAccessibility = await accessibility();
      expect((await page.title()).includes("Category detail"), `title ${await page.title()}`);

      await clickText("Edit this expense");
      const amountId = await page.$eval('input[id^="edit-amount-"]', (node) => `[id="${node.id}"]`);
      await fillById(amountId, "20.00");
      await clickText("Save expense"); await waitText("Expense updated.");
      await waitText("20.00 USD · Everyday");

      await clickText("Remove this expense"); await waitText("Expense removed.");
      await waitText("Nothing has been recorded against this category for the active period.");
      await clickText("Back to the budget"); await waitText("Accounts and spending");
      await waitText("Spent 0.00 USD of 100.00 USD");
      await waitText("Remaining 100.00 USD");
      const period = (await apiJson(`/v1/budget-spaces/${budgetId}`)).body.activePeriod;
      const detail = (await apiJson(`/v1/budget-spaces/${budgetId}/periods/${period.periodId}/progress/${expenseCategoryId}`)).body;
      expect(detail.items.length === 0 && detail.cell.settledActualMinorUnits === 0, `a removed expense still itemizes: ${JSON.stringify(detail)}`);
      return `detail 200 with one item agreeing with the aggregate (${detailAccessibility}); edit then removal return spent to 0.00 and remaining to the target in both the aggregate and the detail; ${await accessibility()}`;
    });

    // ------------------------------------------------- cross-subject (CBD-242-AC08)
    await criterion("CBD-242-AC08", "denial: another subject's proposal identifier cannot be read or confirmed from this browser; an account switch reveals no other draft/preview", async () => {
      await ensureDashboard(); const myName = confirmedName;
      await page.goto(`${ORIGIN}/budgets/new`); await page.waitForSelector('[id="field-name"]'); await setValue('[id="field-name"]', "Subject A draft"); await pause(600);
      const other = await browser.createBrowserContext(); const otherPage = await other.newPage(); otherPage.setDefaultTimeout(30_000);
      await signInAs("subject-b", otherPage); await otherPage.waitForFunction(() => location.pathname === "/budgets");
      const posted = otherPage.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/budget-creation-proposals") && r.ok());
      await otherPage.goto(`${ORIGIN}/budgets/new`); await otherPage.waitForSelector('[id="field-name"]');
      await otherPage.type('[id="field-name"]', "Subject B secret");
      const theirs = await (await posted).json();
      const read = await apiJson(`/v1/budget-creation-proposals/${theirs.proposalId}`);
      const confirmAttempt = await apiJson(`/v1/budget-creation-proposals/${theirs.proposalId}/confirm`, { method: "POST", headers: { "content-type": "application/json", "x-cobudget-csrf": (await apiJson("/v1/identity/me")).body.csrfValue, "idempotency-key": randomUUID() }, body: JSON.stringify({ confirmationBinding: theirs.confirmationBinding }) });
      expect(read.status === 403 && confirmAttempt.status === 404, `read ${read.status} confirm ${confirmAttempt.status}`);
      const theirSpaces = await otherPage.evaluate(async () => (await (await fetch("/v1/budget-spaces")).json()).spaces);
      expect(!theirSpaces.some((x) => x.budgetSpaceId === budgetId), "budget visibility crosses subjects");
      await other.close();
      await page.goto(`${ORIGIN}/budgets`); await waitText("Your budgets"); await clickText("Sign out"); await page.waitForFunction(() => location.pathname === "/");
      await signInAs("subject-b"); await page.goto(`${ORIGIN}/budgets/new`); await page.waitForSelector('[id="field-name"]'); await waitText("Budget and schedule");
      const restored = await page.$eval('[id="field-name"]', (n) => n.value); const body = await text();
      expect(restored === "" && !body.includes("Subject B secret") && !body.includes("Subject A draft") && !body.includes("Complete current period"), `restored '${restored}' / body ${body.slice(0, 200)}`);
      const visible = (await apiJson("/v1/budget-spaces")).body.spaces;
      expect(!visible.some((x) => x.budgetSpaceId === budgetId), `subject-b sees ${budgetId}`);
      await page.goto(`${ORIGIN}/budgets`); await waitText("Your budgets"); await clickText("Sign out"); await page.waitForFunction(() => location.pathname === "/");
      return `subject-b proposal ${theirs.proposalId}: read 403, confirm 404 from subject-a's browser; subject-b cannot see ${budgetId} ('${myName}'); after switching this browser to subject-b (new sessionRef) the form restores no draft and no preview`;
    });
    await criterion("QA-JOINED-FLOW", "denial (browser): after sign-out the protected route is denied again", async () => {
      await ensureSignedIn(); await page.goto(`${ORIGIN}/budgets`); await waitText("Your budgets");
      await clickText("Sign out"); await page.waitForFunction(() => location.pathname === "/");
      expect(!(await browser.cookies()).some((c) => c.name === "__Host-cobudget_session"), "cookie survives sign-out");
      await page.goto(`${ORIGIN}/budgets`); await page.waitForFunction(() => location.pathname === "/sign-in");
      await page.goto(`${ORIGIN}/budgets/${budgetId}`); await page.waitForFunction(() => location.pathname === "/sign-in");
      return "POST /v1/identity/logout deleted the cookie; /budgets and /budgets/{id} redirect to /sign-in";
    });
    const pageErrors = errors.splice(0);
    results.push({ criterion: "HARNESS", case: "page errors during the journey", status: pageErrors.length ? "fail" : "pass", detail: pageErrors.join("; ") || "none", at: new Date().toISOString() });

    // --------------------------------------------- identity result pages (AC06)
    await api.stop(); await assertPortFree(API_PORT, "API"); api = startApi(); await api.ready();
    const copies = {};
    for (const [scenarioName, outcome] of [["cancel", "cancelled"], ["deny", "not_completed"], ["verification-pending", "verification_pending"], ["outage", "temporarily_unavailable"]]) {
      await criterion("CBD-190-AC06", `positive/denial: the ${scenarioName} result page is keyboard/screen-reader accessible (focus on the heading, retry reachable) and discloses no account-existence information`, async () => {
        await clearCookies(); await signInAs(scenarioName);
        await page.waitForFunction(() => location.pathname === "/identity/result");
        expect(new URL(page.url()).searchParams.get("outcome") === outcome, `outcome ${new URL(page.url()).search}`);
        await waitText("Sign-in did not complete");
        await page.waitForFunction(() => ["H1", "MAIN"].includes(document.activeElement?.tagName ?? ""), { timeout: 5000 }).catch(() => {});
        const focused = await page.evaluate(() => `${document.activeElement?.tagName}#${document.activeElement?.id}`);
        expect(focused === "H1#" || focused === "MAIN#app-main", `focus on ${focused}`);
        const body = await text();
        expect(!body.includes(outcome) && !/account|exists|registered|not found|unknown user/iu.test(body.replace("Sign in to MoneyPact", "")), `result copy discloses: ${body.slice(0, 200)}`);
        copies[scenarioName] = body;
        for (let step = 0; step < 10; step++) { await page.keyboard.press("Tab"); if (await page.evaluate(() => document.activeElement?.textContent === "Continue to sign in")) break; }
        expect(await page.evaluate(() => document.activeElement?.textContent) === "Continue to sign in", "retry control not reachable by keyboard");
        const axe = await accessibility();
        expect(!(await browser.cookies()).some((c) => c.name === "__Host-cobudget_session"), "session cookie after a failed ceremony");
        await page.goBack(); await page.waitForFunction(() => location.port === "3001" || location.pathname === "/sign-in");
        return `?outcome=${outcome}: 'Sign-in did not complete. You can try again.', focus on ${focused}, Tab -> 'Continue to sign in', no cookie, ${axe}; back navigation returns to ${pathname()} on port ${new URL(page.url()).port}`;
      });
    }
    await criterion("CBD-190-AC06", "outcome: every failure outcome (including invalid_or_expired and an unknown value) renders identical non-enumerating copy; query text is never echoed", async () => {
      await clearCookies();
      await page.goto(`${ORIGIN}/identity/result?outcome=invalid_or_expired`); await waitText("Sign-in did not complete"); copies.invalid = await text();
      await page.goto(`${ORIGIN}/identity/result?outcome=untrusted-provider-detail<script>`); await waitText("Sign-in did not complete"); copies.unknown = await text();
      const values = [...new Set(Object.values(copies))];
      expect(values.length === 1 && !copies.unknown.includes("untrusted-provider-detail"), `copies differ across outcomes (${values.length} variants: ${JSON.stringify(values.map((v) => v.slice(0, 120)))}) or echo the query`);
      const axe = await accessibility();
      return `identical copy across ${Object.keys(copies).join(", ")}; unknown query value not echoed; ${axe}`;
    });
    await criterion("CBD-190-AC06", "regression: real provider pages", async () => notRun("hosted Cognito pages are not activated (PROVIDERS-LOCAL-001); only the local scaffold and the application result pages were exercised"));
    const lateErrors = errors.splice(0);
    results.push({ criterion: "HARNESS", case: "page errors during the result pages", status: lateErrors.length ? "fail" : "pass", detail: lateErrors.join("; ") || "none", at: new Date().toISOString() });
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
