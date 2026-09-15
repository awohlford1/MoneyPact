/**
 * PK8-01: the real-Chrome journey against the real API on a scratch PostgreSQL database -- the PK-6 ceremony over the
 * web from invite to confirm, and the PK-7B transfer from propose to commit with the PK-4 step-up.
 *
 * Opt-in, and run by name: the file `apps/web/.verification/live-db` names a migrated scratch database (never
 * `cobudget_dev` or `cobudget_demo`); without it the test is skipped. The file is not named `*.test.mjs` on purpose,
 * so `npm test` never collects it: it switches `apps/web/.api-mode` to `live` for its run, which would send the
 * mock-mode browser suite running in parallel to the real API. Both processes are started here exactly as the browser
 * walkthrough starts them: the API on 127.0.0.1:3001 (the port the Next `/v1` rewrite targets) with the local
 * identity adapter and an explicit per-run environment, the Next development server on a free port with
 * `apps/web/.api-mode` = `live` (restored afterwards). The scratch database is named in the marker file because the
 * repository's environment guard reserves `process.env` for the shared loader.
 *
 *   docker exec cobudget-db-1 psql -U postgres -c "CREATE DATABASE cobudget_pk8web" -c "ALTER DATABASE cobudget_pk8web OWNER TO cobudget_migration"
 *   docker exec cobudget-db-1 psql -U postgres -d cobudget_pk8web -c "REVOKE CREATE ON SCHEMA public FROM PUBLIC"
 *   COBUDGET_DB_NAME=cobudget_pk8web npm run db:migrate --workspace=@cobudget/migrations
 *   echo cobudget_pk8web > apps/web/.verification/live-db
 *   node --test apps/web/tests/invitations.live.journey.mjs
 *
 * Identity-ceremony budget (PR 368 finding 3): one composed API process affords six `begin`s in ten minutes. This
 * journey spends three -- the owner's sign-in, the invitee's sign-in from the ceremony page, and the Primary Owner's
 * step-up -- so one harness carries both halves; the count is asserted so a later addition that crosses the budget
 * fails here by name rather than as a 503.
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
const axeSource = readFileSync(fileURLToPath(import.meta.resolve("axe-core/axe.min.js")), "utf8");
const marker = join(webRoot, ".verification", "live-db");
const DB_NAME = existsSync(marker) ? readFileSync(marker, "utf8").trim() : "";
const configured = DB_NAME !== "" && DB_NAME !== "cobudget_dev" && DB_NAME !== "cobudget_demo";
const API_PORT = 3001; const CEREMONY_ORIGIN = `http://127.0.0.1:${API_PORT}`;
const BEGIN_BUDGET = 6;
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
/** Exactly the variables the API needs, with per-run non-secret key material (as the walkthrough builds them). */
function apiEnvironment(origin) {
  return {
    NODE_ENV: "development", LOG_LEVEL: "warn", SERVICE_VERSION: "pk8-live", API_PORT: String(API_PORT), API_LISTEN_ADDRESS: "127.0.0.1",
    COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local", COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: randomBytes(32).toString("base64"), COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "pk8-v1",
    COBUDGET_SESSION_PEPPER: randomBytes(32).toString("base64"),
    COBUDGET_SESSION_IDLE_TIMEOUT_SECONDS: "900", COBUDGET_SESSION_ABSOLUTE_LIFETIME_SECONDS: "3600", COBUDGET_SESSION_FRESH_ASSURANCE_WINDOW_SECONDS: "300",
    COBUDGET_SESSION_REVOCATION_PROPAGATION_TARGET_SECONDS: "60", COBUDGET_SESSION_PROVIDER_MAX_FUTURE_SKEW_SECONDS: "30",
    COBUDGET_SESSION_REJECTION_TIMING_FLOOR_MS: "20", COBUDGET_SESSION_REJECTION_TIMING_JITTER_MS: "10", COBUDGET_SESSION_REJECTION_TIMING_SAMPLE_COUNT: "50",
    COBUDGET_SESSION_REJECTION_TIMING_TIMEOUT_BUCKET_MS: "40", COBUDGET_SESSION_REJECTION_TIMING_MAX_DIFFERENTIAL_MS: "50",
    COBUDGET_SESSION_ENVELOPE_KEY_PROVIDER: "local", COBUDGET_SESSION_ENVELOPE_KEY: randomBytes(32).toString("base64"), COBUDGET_SESSION_ENVELOPE_KEY_VERSION: "pk8-v1",
    COBUDGET_IDENTITY_PROVIDER: "local", COBUDGET_IDENTITY_ENVIRONMENT_ID: "development",
    COBUDGET_IDENTITY_ISSUER: `${CEREMONY_ORIGIN}/v1/identity/local`, COBUDGET_IDENTITY_CLIENT_ID: "cobudget-local-web",
    COBUDGET_IDENTITY_APPLICATION_ORIGIN: origin, COBUDGET_IDENTITY_CEREMONY_ORIGIN: CEREMONY_ORIGIN, COBUDGET_IDENTITY_CALLBACK_URI: `${origin}/v1/identity/callback`,
    COBUDGET_IDENTITY_CHALLENGE_LIFETIME_SECONDS: "600", COBUDGET_IDENTITY_EXCHANGE_LIFETIME_MS: "5000", COBUDGET_IDENTITY_MAPPING_MAX_ATTEMPTS: "5",
    COBUDGET_IDENTITY_HANDOFF_LIFETIME_SECONDS: "120", COBUDGET_IDENTITY_CLOCK_SKEW_SECONDS: "30",
    COBUDGET_DB_NAME: DB_NAME,
  };
}

function driver(page, origin, errors, begins) {
  page.setDefaultTimeout(30000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.method() === "POST" && /\/v1\/identity\/(?:step-up\/)?begin$/u.test(new URL(request.url()).pathname)) begins.push(new URL(request.url()).pathname); });
  const text = async () => page.$eval("main", node => node.textContent);
  const waitText = async value => {
    try { await page.waitForFunction(value => document.querySelector("main")?.textContent.includes(value), {}, value); }
    catch { await page.screenshot({ path: `${webRoot}/.next/invitations-live-failure.png`, fullPage: true }); assert.fail(`Expected ${JSON.stringify(value)}; route ${page.url()}; visible synthetic test content: ${await text().catch(() => "(no main)")}`); }
  };
  const clickText = async label => {
    for (const handle of await page.$$("button, a")) if ((await handle.evaluate(node => node.textContent.trim())) === label) { await handle.scrollIntoView(); await handle.click(); return; }
    assert.fail(`Missing control: ${label}`);
  };
  const fill = async (selector, value) => {
    await page.waitForSelector(selector); await page.focus(selector);
    await page.keyboard.down("Control"); await page.keyboard.press("KeyA"); await page.keyboard.up("Control"); await page.keyboard.press("Backspace");
    await page.type(selector, value);
    assert.equal(await page.$eval(selector, node => node.value), value, `Typing into ${selector} did not take`);
  };
  const waitEnabled = async label => page.waitForFunction(label => [...document.querySelectorAll("button")].find(node => node.textContent.trim() === label)?.disabled === false, {}, label);
  const accessibility = async () => {
    await page.evaluate(axeSource);
    const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector("main"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })));
    assert.deepEqual(violations, [], `axe on ${new URL(page.url()).pathname}`);
  };
  /** The hosted chooser on the ceremony origin: the person picks one of the two synthetic subjects. */
  const choose = async scenario => {
    await page.waitForFunction(() => location.pathname === "/v1/identity/local/authorize" && location.port === "3001");
    await clickText(scenario);
    await page.waitForFunction(origin => location.origin === origin, {}, origin);
  };
  return { page, text, waitText, clickText, fill, waitEnabled, accessibility, choose };
}

test("PK8-01 live: invite to confirm over the web, then propose to commit with the step-up, on the real API and a scratch database", { skip: !configured, timeout: 600_000 }, async t => {
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
  mkdirSync(join(webRoot, ".next"), { recursive: true });
  const executablePath = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
  browser = await puppeteer.launch({ ...(executablePath ? { executablePath } : {}), headless: true, args: ["--no-sandbox"] });
  const errors = []; const begins = [];
  const ownerContext = await browser.createBrowserContext(); const inviteeContext = await browser.createBrowserContext();
  const owner = driver(await ownerContext.newPage(), origin, errors, begins);
  const invitee = driver(await inviteeContext.newPage(), origin, errors, begins);
  const requests = [];
  for (const person of [owner, invitee]) person.page.on("request", request => { const url = new URL(request.url()); if (url.pathname.startsWith("/v1/")) requests.push(`${request.method()} ${url.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gu, "{id}")}`); });
  // The two synthetic subjects persist on a reused scratch database, so the budget name is unique per run.
  const budgetName = `PK-8 live ${randomBytes(3).toString("hex")}`;
  let budgetId; let code; let challenge; let transferUrl;

  await t.test("the owner (subject-a) signs in on the hosted chooser and creates a budget", async () => {
    await owner.page.goto(`${origin}/budgets`); await owner.page.waitForFunction(() => location.pathname === "/sign-in");
    await owner.clickText("Continue to sign in"); await owner.choose("subject-a");
    await owner.waitText("Your budgets");
    await owner.clickText("Create a budget"); await owner.waitText("Budget name");
    await owner.page.type('[id="field-name"]', budgetName); await owner.clickText("Preview schedule"); await owner.waitText("Complete current period");
    await owner.page.click('[id="field-acknowledged-disclosure"]'); await owner.waitEnabled("Confirm and create budget");
    await owner.clickText("Confirm and create budget"); await owner.waitText("No categories yet");
    budgetId = new URL(owner.page.url()).pathname.split("/").at(-1);
  });

  await t.test("the members page lists the Primary Owner; the owner invites a Collaborator and the simulated delivery renders the link and the challenge", async () => {
    await owner.clickText("Members"); await owner.page.waitForFunction(() => document.querySelectorAll('[data-testid="member-row"]').length === 1);
    await owner.waitText("Primary Owner"); await owner.accessibility();
    await owner.clickText("Invitations"); await owner.waitText("No invitations yet");
    await owner.fill("#invite-destination", "Invitee@Example.com"); await owner.clickText("Send invitation");
    await owner.waitText("Invitation sent to i***@example.com as Collaborator.");
    await owner.waitText("Sent, awaiting a response"); await owner.accessibility();
    const deliveries = await owner.page.evaluate(async () => (await fetch("/v1/local/invitation-deliveries")).json());
    assert.equal(deliveries.fidelityLabel, "simulated");
    const delivered = deliveries.deliveries.find(row => row.destinationMasked === "i***@example.com");
    assert.ok(delivered, JSON.stringify(deliveries));
    ({ code, channelChallenge: challenge } = delivered);
    assert.match(code, /^[A-Za-z0-9_-]{43}\.[0-9a-f]{64}$/u); assert.match(challenge, /^\d{6}$/u);
  });

  await t.test("the link holder resolves the link in a second browser, gets the first-party ceremony cookie, and proves the channel after one wrong code", async () => {
    await invitee.page.goto(`${origin}/invitation#code=${encodeURIComponent(code)}`);
    await invitee.page.waitForFunction(() => location.pathname.startsWith("/invitation/ceremony/"));
    await invitee.waitText("Prove you received this invitation");
    const ceremony = (await inviteeContext.cookies()).find(cookie => cookie.name === "__Host-mp_invitation_ceremony");
    assert.ok(ceremony, "the __Host- cookie the API set through the same-origin proxy is first-party to the web origin");
    assert.ok(ceremony.httpOnly && ceremony.secure && ceremony.sameSite === "Strict" && ceremony.path === "/", JSON.stringify({ ...ceremony, value: "(redacted)" }));
    assert.equal(ceremony.domain.replace(/^\./u, ""), "localhost");
    await invitee.accessibility();
    const wrong = challenge === "000000" ? "000001" : "000000";
    await invitee.fill("#channel-code", wrong); await invitee.clickText("Check code");
    await invitee.waitText("That code did not match. 4 attempts remain.");
    await invitee.fill("#channel-code", challenge); await invitee.clickText("Check code");
    await invitee.waitText("Sign in or create your MoneyPact account"); await invitee.accessibility();
  });

  await t.test("the invitee signs in as subject-b from the ceremony page, returns to it, is attached, reads the approved disclosure with no default choice, and accepts", async () => {
    await invitee.clickText("Sign in or create your MoneyPact account"); await invitee.choose("subject-b");
    await invitee.page.waitForFunction(() => location.pathname.startsWith("/invitation/ceremony/"));
    await invitee.waitText("Before you accept");
    assert.ok((await invitee.text()).includes("join a budget space as a Collaborator"));
    await invitee.waitText("Existing members will see your display name");
    assert.equal(await invitee.page.$eval("#choice-accept", node => node.checked), false);
    assert.equal(await invitee.page.$eval("#choice-decline", node => node.checked), false);
    await invitee.accessibility();
    await invitee.page.click("#choice-accept"); await invitee.page.click("#acknowledged-disclosure");
    await invitee.waitEnabled("Record my acceptance"); await invitee.clickText("Record my acceptance");
    await invitee.waitText("Your acceptance is recorded"); await invitee.accessibility();
    await invitee.page.goto(`${origin}/budgets`); await invitee.page.waitForFunction(() => /No budgets yet|Create a budget/u.test(document.querySelector("main")?.textContent ?? ""));
    assert.ok(!(await invitee.text()).includes(budgetName), "not a member before the confirm");
  });

  await t.test("the owner confirms the acceptance; both members see the members list; the invitee sees the budget; the notices reach the right person (PK8-F01)", async () => {
    // MSG-73-050 reached the owner as a live row; the read stamp is set once and stays.
    await owner.page.goto(`${origin}/notices`); await owner.waitText("Someone accepted an invitation to one of your budget spaces.");
    await owner.page.waitForSelector('[data-testid="notice-row"][data-read="unread"]'); await owner.accessibility();
    await owner.clickText("Mark as read"); await owner.page.waitForSelector('[data-testid="notice-row"][data-read="read"]');
    await owner.page.reload(); await owner.page.waitForSelector('[data-testid="notice-row"][data-read="read"]');
    assert.ok(!(await owner.text()).includes("You joined a budget space"), "the invitee's rows are not the owner's");
    await owner.page.goto(`${origin}/budgets/${budgetId}/invitations`); await owner.waitText("Acceptance awaiting your confirmation");
    await owner.clickText("Confirm acceptance from i***@example.com");
    await owner.waitText("Acceptance confirmed: the person joined as Collaborator.");
    await owner.waitText("Accepted and confirmed");
    await owner.clickText("Members"); await owner.page.waitForFunction(() => document.querySelectorAll('[data-testid="member-row"]').length === 2);
    await owner.waitText("Collaborator"); await owner.accessibility();
    await invitee.page.goto(`${origin}/budgets`); await invitee.waitText(budgetName);
    await invitee.page.goto(`${origin}/budgets/${budgetId}/members`); await invitee.page.waitForFunction(() => document.querySelectorAll('[data-testid="member-row"]').length === 2);
    // The real API writes MSG-73-015 at the confirm (MSG-73-051 is the disclosure view's confirmation notice code, not a row).
    await invitee.page.goto(`${origin}/notices`); await invitee.waitText("You joined a budget space.");
    assert.ok(!(await invitee.text()).includes("Someone accepted an invitation"), "the owner's MSG-73-050 row is not the invitee's");
    await invitee.accessibility();
  });

  await t.test("the Primary Owner proposes the transfer to the Collaborator, who reads the approved disclosure and accepts", async () => {
    await owner.page.goto(`${origin}/budgets/${budgetId}/transfer`); await owner.waitText("Propose a transfer");
    await owner.page.select("#transfer-recipient", await owner.page.$eval("#transfer-recipient option:nth-child(2)", node => node.value));
    await owner.clickText("Propose transfer");
    await owner.page.waitForFunction(() => /\/transfer\/[0-9a-f-]{36}$/u.test(location.pathname));
    transferUrl = owner.page.url();
    await owner.waitText("Proposed, awaiting the recipient"); await owner.waitText("Before you confirm this transfer of primary ownership");
    await owner.accessibility();
    // PK8-F01 and F04: the recipient is never handed the id. The MSG-73-040 notice opens the space's transfer page, whose live
    // read (party-scoped) offers the status view.
    await invitee.page.goto(`${origin}/notices`); await invitee.waitText("You have been proposed as the next Primary Owner of a budget space.");
    await invitee.clickText("Open the transfer"); await invitee.waitText("You are proposed as the next Primary Owner"); await invitee.accessibility();
    await invitee.clickText("Open the transfer");
    await invitee.page.waitForFunction(url => location.href === url, {}, transferUrl);
    await invitee.waitText("Before you accept primary ownership");
    await invitee.waitText("(you)"); await invitee.accessibility();
    await invitee.page.click("#recipient-acknowledged"); await invitee.waitEnabled("Accept primary ownership");
    await invitee.clickText("Accept primary ownership"); await invitee.waitText("Acceptance recorded");
    await invitee.waitText("Accepted by the recipient, awaiting the Primary Owner's confirmation");
  });

  await t.test("the Primary Owner runs the step-up on the hosted chooser immediately before the confirm; the confirm names the live transfer id and commits; roles swap", async () => {
    const posted = [];
    owner.page.on("request", request => { if (request.method() === "POST" && new URL(request.url()).pathname.startsWith("/v1/")) posted.push({ url: new URL(request.url()).pathname, body: request.postData() ?? "" }); });
    await owner.clickText("Refresh transfer"); await owner.waitText("Accepted by the recipient"); await owner.waitText("required before confirming");
    await owner.page.click("#outgoing-acknowledged"); await owner.waitEnabled("Continue to the identity check");
    await owner.clickText("Continue to the identity check"); await owner.choose("subject-a");
    await owner.waitText("Back from the identity check");
    await owner.page.waitForFunction(() => location.search === "" && /\/transfer\/[0-9a-f-]{36}$/u.test(location.pathname));
    await owner.waitText("returned from the check"); await owner.accessibility();
    await owner.page.click("#outgoing-acknowledged"); await owner.waitEnabled("Confirm the transfer");
    await owner.clickText("Confirm the transfer");
    await owner.waitText("Transfer committed"); await owner.accessibility();
    const begin = posted.find(entry => entry.url === "/v1/identity/step-up/begin"); const confirm = posted.find(entry => entry.url.endsWith("/confirm"));
    assert.deepEqual(JSON.parse(begin.body), { action: "29.transfer_primary_ownership", budgetSpaceId: budgetId, postResultDestinationId: "budgets" });
    assert.ok(confirm.url.endsWith(`/${transferUrl.split("/").at(-1)}/confirm`));
    // PK8-F03: the claim of the outgoing disclosure the page showed, and nothing else: no reference, no ledger.
    assert.deepEqual(Object.keys(JSON.parse(confirm.body)), ["acknowledgedDisclosure"]);
    assert.equal(JSON.parse(confirm.body).acknowledgedDisclosure.kind, "primary_transfer_outgoing");
    assert.match(JSON.parse(confirm.body).acknowledgedDisclosure.digest, /^[0-9a-f]{64}$/u);
    assert.ok(posted.indexOf(begin) < posted.indexOf(confirm));
    assert.equal(posted.filter(entry => entry.url.endsWith("/confirm")).length, 1);
    await owner.clickText("Refresh transfer"); await owner.waitText("Committed");
    await owner.page.goto(`${origin}/budgets/${budgetId}/members`); await owner.page.waitForFunction(() => document.querySelectorAll('[data-testid="member-row"]').length === 2);
    const roles = await owner.page.$$eval('[data-testid="member-row"] dd', nodes => nodes.map(node => node.textContent));
    assert.ok(roles.includes("Co-owner") && roles.includes("Primary Owner"), roles.join(","));
    // The former Primary Owner may no longer propose; the transfer page says so.
    await owner.page.goto(`${origin}/budgets/${budgetId}/transfer`); await owner.waitText("Only the Primary Owner can propose a transfer");
  });

  assert.ok(begins.length <= BEGIN_BUDGET, `identity-ceremony budget: ${begins.length} begins in one composed process (${begins.join(", ")})`);
  assert.deepEqual(errors, []);
  console.log(`PK8-01 live journey: ${begins.length} identity begins (${begins.join(", ")}); API requests: ${[...new Set(requests)].join(", ")}`);
});
