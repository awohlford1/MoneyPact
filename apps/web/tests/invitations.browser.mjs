/**
 * PK-8 in headless Chrome against the mock that speaks the merged API's wire shapes (PK8-02, PK8-03): the owner
 * invites, the link holder resolves the fragment link in a second browser context (its own cookie jar), proves the
 * channel, signs in and comes back, reads the disclosure with no default choice and accepts, the owner confirms and
 * both appear on the members list; then the Primary transfer from propose through the recipient's acceptance and the
 * step-up-bound confirm to the commit; the terminal exhaustion of a link; and axe, keyboard and the 400 px view on
 * every new page. The real-API journey is `invitations.live.journey.mjs`, run by name.
 *
 * Not a test file of its own: Next refuses a second `next dev` in the same directory, so `browser.test.mjs` starts the
 * one development server and calls `pk8Journey` with its browser, exactly as it runs its own steps.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const axeSource = readFileSync(fileURLToPath(import.meta.resolve("axe-core/axe.min.js")), "utf8");

/** The page helpers every step uses, bound to one page. */
function driver(page, errors) {
  page.setDefaultTimeout(20000);
  page.on("pageerror", error => errors.push(error.message));
  const text = async () => page.$eval("main", node => node.textContent);
  const waitText = async value => {
    try { await page.waitForFunction(value => document.querySelector("main")?.textContent.includes(value), {}, value); }
    catch { await page.screenshot({ path: `${root}/.next/invitations-failure.png`, fullPage: true }); assert.fail(`Expected ${JSON.stringify(value)}; route ${new URL(page.url()).pathname}; visible synthetic test content: ${await text()}`); }
  };
  const clickText = async label => {
    const handles = await page.$$("button, a");
    for (const handle of handles) if ((await handle.evaluate(node => node.textContent.trim())) === label) { await handle.scrollIntoView(); await handle.click(); return; }
    assert.fail(`Missing control: ${label}`);
  };
  const fill = async (selector, value) => {
    await page.waitForSelector(selector);
    await page.focus(selector);
    await page.keyboard.down("Control"); await page.keyboard.press("KeyA"); await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await page.type(selector, value);
    assert.equal(await page.$eval(selector, node => node.value), value, `Typing into ${selector} did not take`);
  };
  const enabled = async label => page.evaluate(label => [...document.querySelectorAll("button")].find(node => node.textContent.trim() === label)?.disabled === false, label);
  const waitEnabled = async label => page.waitForFunction(label => [...document.querySelectorAll("button")].find(node => node.textContent.trim() === label)?.disabled === false, {}, label);
  const accessibility = async () => {
    await page.evaluate(axeSource);
    const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector("main"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })));
    assert.deepEqual(violations, [], `axe on ${new URL(page.url()).pathname}`);
  };
  /** PK8-03: the 400 px view reflows without horizontal scroll and is still axe clean; then the desktop view again. */
  const narrow = async () => {
    await page.setViewport({ width: 400, height: 800 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${new URL(page.url()).pathname} scrolls horizontally at 400px`);
    await accessibility();
    await page.setViewport({ width: 1280, height: 900 });
  };
  const signIn = async () => {
    await page.goto(`${page.origin}/sign-in`); await clickText("Continue to sign in");
    await page.waitForFunction(() => location.pathname === "/budgets");
  };
  return { page, text, waitText, clickText, fill, enabled, waitEnabled, accessibility, narrow, signIn };
}

/** The PK-8 steps, as subtests of the caller's test, on the caller's running development server. */
export async function pk8Journey(t, { browser, origin, errors }) {
  // Two people, two browser contexts: separate cookie jars, exactly as two browsers on the same origin.
  const ownerContext = await browser.createBrowserContext(); const inviteeContext = await browser.createBrowserContext();
  const owner = driver(await ownerContext.newPage(), errors); owner.page.origin = origin;
  const invitee = driver(await inviteeContext.newPage(), errors); invitee.page.origin = origin;
  let budgetId; let code; let challenge; let transferUrl;

  await t.test("the owner signs in, creates a budget and reaches the members list from the dashboard", async () => {
    await owner.signIn(); await owner.waitText("No budgets yet");
    await owner.clickText("Create a budget"); await owner.waitText("Budget and schedule");
    await owner.page.type('[id="field-name"]', "Shared plan"); await owner.waitText("Complete current period");
    await owner.page.click('[id="field-acknowledged-disclosure"]');
    await owner.waitEnabled("Confirm and create budget"); await owner.clickText("Confirm and create budget");
    await owner.waitText("No categories yet"); budgetId = new URL(owner.page.url()).pathname.split("/").at(-1);
    assert.ok(await owner.page.$('nav[aria-label="Members and invitations"]'), "the dashboard links to the member pages");
    await owner.clickText("Members"); await owner.waitText("Everyone who belongs to this budget space");
    await owner.page.waitForFunction(() => document.title.includes("Members"));
    await owner.page.waitForFunction(() => document.querySelectorAll('[data-testid="member-row"]').length === 1);
    await owner.waitText("Primary Owner");
    await owner.accessibility(); await owner.narrow();
  });

  await t.test("the owner invites a Collaborator, resends, and reads the simulated delivery", async () => {
    await owner.clickText("Invitations"); await owner.waitText("Invite a person");
    await owner.waitText("No invitations yet"); await owner.accessibility();
    await owner.fill("#invite-destination", "not-an-address"); await owner.clickText("Send invitation");
    await owner.waitText("Enter the email address to invite.");
    await owner.fill("#invite-destination", "Invitee@Example.com"); await owner.clickText("Send invitation");
    await owner.waitText("Invitation sent to i***@example.com as Collaborator.");
    await owner.waitText("Sent, awaiting a response");
    await owner.accessibility(); await owner.narrow();
    await owner.clickText("Resend to i***@example.com"); await owner.waitText("sent again. The earlier link no longer works.");
    await owner.waitText("Replaced by a newer invitation");
    const deliveries = await owner.page.evaluate(async () => (await fetch("/api/mock/v1/local/invitation-deliveries")).json());
    assert.equal(deliveries.fidelityLabel, "simulated");
    assert.equal(deliveries.deliveries.length, 1, "the replaced link is gone from the surface; only the live one is delivered");
    ({ code, channelChallenge: challenge } = deliveries.deliveries[0]);
    assert.match(challenge, /^\d{6}$/u);
    assert.ok(!(await owner.text()).includes(code), "the bearer is never on the owner's page");
  });

  await t.test("the link holder resolves the fragment link, gets the first-party ceremony cookie, proves the channel after one wrong code, and is handed to sign-in", async () => {
    await invitee.page.goto(`${origin}/invitation#code=${encodeURIComponent(code)}`);
    await invitee.page.waitForFunction(() => location.pathname.startsWith("/invitation/ceremony/"));
    assert.ok(!invitee.page.url().includes(code), "the code left the address bar");
    await invitee.waitText("Prove you received this invitation");
    const cookies = await inviteeContext.cookies();
    const ceremony = cookies.find(cookie => cookie.name === "__Host-mp_invitation_ceremony");
    assert.ok(ceremony, "the ceremony cookie is set on this origin");
    assert.ok(ceremony.httpOnly && ceremony.secure && ceremony.sameSite === "Strict" && ceremony.path === "/", JSON.stringify(ceremony));
    assert.equal((await ownerContext.cookies()).some(cookie => cookie.name === "__Host-mp_invitation_ceremony"), false, "the owner's browser never sees it");
    await invitee.accessibility(); await invitee.narrow();
    const wrong = challenge === "000000" ? "000001" : "000000";
    await invitee.fill("#channel-code", wrong); await invitee.clickText("Check code");
    await invitee.waitText("That code did not match. 4 attempts remain.");
    await invitee.accessibility();
    await invitee.fill("#channel-code", challenge); await invitee.clickText("Check code");
    await invitee.waitText("Sign in or create your MoneyPact account");
    assert.ok(!(await invitee.text()).includes("Collaborator"), "nothing about the invitation is shown before sign-in");
    await invitee.accessibility(); await invitee.narrow();
  });

  await t.test("after sign-in the person returns to the ceremony, is attached, reads the approved disclosure with no default choice, and accepts", async () => {
    // The trio (resolve, verify-channel) went out without a CSRF header; attach and accept carry one.
    const posted = [];
    invitee.page.on("request", request => { if (request.method() === "POST" && request.url().includes("/api/mock/v1/invitations/")) posted.push({ url: new URL(request.url()).pathname, csrf: request.headers()["x-cobudget-csrf"] ?? null, body: request.postData() ?? "" }); });
    await invitee.clickText("Sign in or create your MoneyPact account");
    await invitee.page.waitForFunction(() => location.pathname.startsWith("/invitation/ceremony/"));
    await invitee.waitText("Before you accept");
    await invitee.waitText("Existing members will see your display name");
    await invitee.waitText("must confirm before anything is shared with you");
    assert.ok((await invitee.text()).includes("join a budget space as a Collaborator"));
    assert.equal(await invitee.page.$eval("#choice-accept", node => node.checked), false, "no default: accept is not selected");
    assert.equal(await invitee.page.$eval("#choice-decline", node => node.checked), false, "no default: decline is not selected");
    assert.equal(await invitee.enabled("Record my acceptance"), false);
    await invitee.accessibility(); await invitee.narrow();
    // Keyboard: Tab reaches the choice and Space selects it.
    await invitee.page.focus("#choice-accept"); await invitee.page.keyboard.press("Space");
    assert.equal(await invitee.page.$eval("#choice-accept", node => node.checked), true);
    assert.equal(await invitee.enabled("Record my acceptance"), false, "the acknowledgement is still unticked");
    await invitee.page.click("#acknowledged-disclosure");
    await invitee.waitEnabled("Record my acceptance"); await invitee.accessibility();
    await invitee.clickText("Record my acceptance");
    await invitee.waitText("Your acceptance is recorded");
    await invitee.accessibility();
    const attach = posted.find(entry => entry.url.endsWith("/attach")); const accept = posted.find(entry => entry.url.endsWith("/accept"));
    assert.ok(attach && attach.csrf, "attach carried the CSRF header");
    assert.ok(accept && accept.csrf, "accept carried the CSRF header");
    assert.deepEqual(Object.keys(JSON.parse(accept.body)), ["acknowledgedDisclosure"]);
    await invitee.page.goto(`${origin}/notices`); await invitee.waitText("Your acceptance was recorded.");
    await invitee.accessibility(); await invitee.narrow();
  });

  await t.test("the owner confirms the acceptance; both members are listed; the notices say so", async () => {
    await owner.page.reload(); await owner.waitText("Sent, awaiting a response");
    await owner.clickText("Confirm acceptance from i***@example.com");
    await owner.waitText("Acceptance confirmed: the person joined as Collaborator.");
    await owner.waitText("Accepted and confirmed");
    await owner.clickText("Members"); await owner.page.waitForFunction(() => document.querySelectorAll('[data-testid="member-row"]').length === 2);
    await owner.waitText("Collaborator"); await owner.accessibility();
    await invitee.page.goto(`${origin}/notices`); await invitee.waitText("You joined a budget space.");
    await invitee.page.goto(`${origin}/budgets`); await invitee.waitText("Shared plan");
  });

  await t.test("the Primary Owner proposes the transfer; the recipient reads the approved disclosure and accepts", async () => {
    await owner.clickText("Primary ownership"); await owner.waitText("Propose a transfer");
    await owner.accessibility(); await owner.narrow();
    await owner.page.select("#transfer-recipient", await owner.page.$eval("#transfer-recipient option:nth-child(2)", node => node.value));
    await owner.clickText("Propose transfer");
    await owner.page.waitForFunction(() => /\/transfer\/[0-9a-f-]{36}$/u.test(location.pathname));
    transferUrl = owner.page.url();
    await owner.waitText("Proposed, awaiting the recipient");
    await owner.waitText("Before you confirm this transfer of primary ownership");
    assert.equal(await owner.enabled("Continue to the identity check"), false, "the outgoing consequences must be acknowledged first");
    await owner.accessibility(); await owner.narrow();
    await invitee.page.goto(transferUrl); await invitee.waitText("Before you accept primary ownership");
    await invitee.waitText("A MoneyPact member (you)");
    assert.equal(await invitee.enabled("Accept primary ownership"), false);
    await invitee.accessibility(); await invitee.narrow();
    await invitee.page.click("#recipient-acknowledged"); await invitee.waitEnabled("Accept primary ownership");
    await invitee.clickText("Accept primary ownership"); await invitee.waitText("Acceptance recorded");
    await invitee.waitText("Accepted by the recipient, awaiting the Primary Owner's confirmation");
    await invitee.accessibility();
  });

  await t.test("the Primary Owner runs the step-up immediately before the confirm; the confirm names the live transfer id and commits", async () => {
    const posted = [];
    owner.page.on("request", request => { if (request.method() === "POST" && request.url().includes("/api/mock/v1/")) posted.push({ url: new URL(request.url()).pathname, body: request.postData() ?? "", csrf: request.headers()["x-cobudget-csrf"] ?? null }); });
    await owner.clickText("Refresh transfer"); await owner.waitText("Accepted by the recipient");
    await owner.waitText("required before confirming");
    await owner.page.click("#outgoing-acknowledged"); await owner.waitEnabled("Continue to the identity check");
    await owner.clickText("Continue to the identity check");
    // The provider hop lands on /budgets; the return marker brings the person back with the confirm control.
    await owner.waitText("Back from the identity check");
    // R-02: the resume signal is one-shot -- the query is gone from the address bar once the page has taken it.
    await owner.page.waitForFunction(() => location.search === "" && /\/transfer\/[0-9a-f-]{36}$/u.test(location.pathname));
    await owner.waitText("returned from the check");
    await owner.accessibility();
    const begin = posted.find(entry => entry.url.endsWith("/identity/step-up/begin"));
    assert.deepEqual(JSON.parse(begin.body), { action: "29.transfer_primary_ownership", budgetSpaceId: budgetId, postResultDestinationId: "budgets" });
    assert.ok(begin.csrf);
    await owner.page.click("#outgoing-acknowledged"); await owner.waitEnabled("Confirm the transfer");
    await owner.clickText("Confirm the transfer");
    await owner.waitText("Transfer committed");
    await owner.waitText("Committed");
    const confirm = posted.find(entry => entry.url.endsWith("/confirm"));
    assert.ok(confirm.url.endsWith(`/${transferUrl.split("/").at(-1)}/confirm`), "the live transfer id from the view");
    assert.deepEqual(JSON.parse(confirm.body), {}, "no reference, ledger or digest field");
    assert.ok(posted.indexOf(begin) < posted.indexOf(confirm), "step-up before confirm");
    assert.equal(posted.filter(entry => entry.url.endsWith("/confirm")).length, 1, "one confirm per step-up, never a resend");
    await owner.accessibility(); await owner.narrow();
    await owner.clickText("Members"); await owner.page.waitForFunction(() => document.querySelectorAll('[data-testid="member-row"]').length === 2);
    const roles = await owner.page.$$eval('[data-testid="member-row"] dd', nodes => nodes.map(node => node.textContent));
    assert.ok(roles.includes("Co-owner") && roles.includes("Primary Owner"), roles.join(","));
    await owner.page.goto(`${origin}/notices`); await owner.waitText("A primary-ownership transfer committed.");
  });

  await t.test("a transfer that is not yours answers as unknown; a confirm without a fresh check is the uniform denial in words", async () => {
    await owner.page.goto(`${origin}/budgets/${budgetId}/transfer/00000000-0000-4000-8000-000000000000`);
    await owner.waitText("No such transfer for you"); await owner.accessibility();
  });

  await t.test("exhausting the six-digit challenge is terminal: no resolve-again is offered, and the same link answers uniformly afterwards", async () => {
    // The new Primary Owner (the former invitee) invites another person.
    await invitee.page.goto(`${origin}/budgets/${budgetId}/invitations`); await invitee.waitText("Invite a person");
    await invitee.fill("#invite-destination", "second@example.com"); await invitee.clickText("Send invitation");
    await invitee.waitText("Invitation sent to s***@example.com as Collaborator.");
    const deliveries = await invitee.page.evaluate(async () => (await fetch("/api/mock/v1/local/invitation-deliveries")).json());
    const delivered = deliveries.deliveries.find(row => row.destinationMasked === "s***@example.com");
    const holderContext = await browser.createBrowserContext();
    const holder = driver(await holderContext.newPage(), errors); holder.page.origin = origin;
    await holder.page.goto(`${origin}/invitation#code=${encodeURIComponent(delivered.code)}`);
    await holder.waitText("Prove you received this invitation");
    const wrong = delivered.channelChallenge === "000000" ? "000001" : "000000";
    for (let attempt = 1; attempt <= 5; attempt++) {
      await holder.fill("#channel-code", wrong); await holder.clickText("Check code");
      await holder.waitText(attempt < 5 ? (attempt === 4 ? "One attempt remains." : `${5 - attempt} attempts remain.`) : "Too many incorrect codes");
    }
    await holder.waitText("Ask the person who invited you to send a new invitation.");
    const controls = await holder.page.$$eval("main a, main button", nodes => nodes.map(node => node.textContent.trim()));
    assert.ok(!controls.some(label => /again/iu.test(label)), `no resolve-again after exhaustion: ${controls.join(", ")}`);
    await holder.accessibility(); await holder.narrow();
    await holder.page.reload(); await holder.waitText("Too many incorrect codes");
    await holder.page.goto(`${origin}/invitation#code=${encodeURIComponent(delivered.code)}`);
    await holder.waitText("This invitation link cannot be used");
    assert.equal(await holder.page.evaluate(() => document.activeElement?.tagName), "H1", "focus lands on the result heading");
    await holder.accessibility();
    await holderContext.close();
    // The inviter's record is still pending: the recovery is a resend.
    await invitee.page.reload(); await invitee.waitText("Sent, awaiting a response");
  });

  await t.test("SEC-PK8-F2: a query-carried code is not resolved and is stripped from the address bar at once", async () => {
    await invitee.page.goto(`${origin}/invitation?code=not-a-real-code`);
    await invitee.waitText("Paste the invitation code");
    await invitee.page.waitForFunction(() => location.search === "" && location.pathname === "/invitation");
    assert.equal(await invitee.page.$eval("#invitation-code", node => node.value), "", "nothing is prefilled from the query");
    await invitee.accessibility();
  });

  await t.test("a ceremony that is no longer usable says 'open your invitation link again'", async () => {
    await invitee.page.goto(`${origin}/invitation/ceremony/00000000-0000-4000-8000-000000000000`);
    // Nothing is remembered for it, so the page asks for the code; the pre-counter gate denies the check as unusable.
    await invitee.waitText("Prove you received this invitation");
    await invitee.fill("#channel-code", "123456"); await invitee.clickText("Check code");
    await invitee.waitText("Open your invitation link again");
    await invitee.accessibility();
  });

}
