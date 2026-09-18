/**
 * CBD-198 (AC01-AC05), verification concerns CBD-195: the manual accounts lifecycle in headless Chrome
 * against the mock that speaks the merged API's wire shapes -- add an account, see it listed, edit its
 * label, submit an invalid label and prove the other fields kept their values and focus landed on the
 * invalid field, archive with confirmation, prove the polite announcement, restore, toggle archived
 * visibility, drive a genuine 409 conflict, and 403/503 through the request-interception fixture; axe at
 * default and at 320 px and the 400%-zoom-equivalent viewport.
 *
 * Not a test file of its own: `browser.test.mjs` starts the one `next dev` server and calls
 * `accountsJourney` with its browser, exactly as it calls `pk8Journey`.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const axeSource = readFileSync(fileURLToPath(import.meta.resolve("axe-core/axe.min.js")), "utf8");

function driver(page, errors) {
  page.setDefaultTimeout(20000);
  page.on("pageerror", error => errors.push(error.message));
  const text = async () => page.$eval("main", node => node.textContent);
  const waitText = async value => {
    try { await page.waitForFunction(value => document.querySelector("main")?.textContent.includes(value), {}, value); }
    catch { await page.screenshot({ path: `${root}/.next/accounts-failure.png`, fullPage: true }); assert.fail(`Expected ${JSON.stringify(value)}; route ${new URL(page.url()).pathname}; visible synthetic test content: ${await text()}`); }
  };
  const clickText = async label => {
    const handles = await page.$$("button, a");
    for (const handle of handles) if ((await handle.evaluate(node => node.textContent.trim())) === label) { await handle.scrollIntoView(); await handle.click(); return; }
    assert.fail(`Missing control: ${label}`);
  };
  const findControl = async label => {
    const handles = await page.$$("button, a");
    for (const handle of handles) if ((await handle.evaluate(node => node.textContent.trim())) === label) return handle;
    return null;
  };
  const fill = async (selector, value) => {
    await page.waitForSelector(selector);
    await page.focus(selector);
    await page.keyboard.down("Control"); await page.keyboard.press("KeyA"); await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await page.type(selector, value);
    assert.equal(await page.$eval(selector, node => node.value), value, `Typing into ${selector} did not take`);
  };
  // Next updates `document.title` from the route's `metadata` export slightly after the DOM commit a
  // client-side navigation makes visible, so a title check races `waitText`'s own commit-driven poll.
  // Poll the title itself instead of reading it once.
  const waitTitle = async value => {
    try { await page.waitForFunction(value => document.title.includes(value), {}, value); }
    catch { assert.fail(`Expected the page title to include ${JSON.stringify(value)}; it is ${JSON.stringify(await page.title())}`); }
  };
  const accessibility = async () => {
    await page.evaluate(axeSource);
    const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector("main"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })));
    assert.deepEqual(violations, [], `axe on ${new URL(page.url()).pathname}`);
  };
  const narrow = async () => {
    await page.setViewport({ width: 320, height: 800 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${new URL(page.url()).pathname} scrolls horizontally at 320px`);
    await accessibility();
    // 1280x900 physical pixels at 400%: 320x225 CSS pixels, including media queries.
    await page.setViewport({ width: 320, height: 225, deviceScaleFactor: 4 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${new URL(page.url()).pathname} scrolls horizontally at 400% zoom`);
    await accessibility();
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  };
  const signIn = async () => {
    await page.goto(`${page.origin}/sign-in`); await clickText("Continue to sign in");
    await page.waitForFunction(() => location.pathname === "/budgets");
  };
  return { page, text, waitText, waitTitle, clickText, findControl, fill, accessibility, narrow, signIn };
}

export async function accountsJourney(t, { browser, origin, errors }) {
  const context = await browser.createBrowserContext();
  const driven = driver(await context.newPage(), errors); driven.page.origin = origin;
  let budgetId;

  await t.test("CBD-198: sign in, create a budget, reach the Accounts tab from BudgetTabs", async () => {
    await driven.signIn(); await driven.waitText("No budgets yet");
    await driven.clickText("Create a budget"); await driven.waitText("Budget and schedule");
    await driven.page.type('[id="field-name"]', "Accounts journey"); await driven.waitText("Complete current period");
    await driven.page.click('[id="field-acknowledged-disclosure"]');
    await driven.page.waitForFunction(() => [...document.querySelectorAll("button")].some(node => node.textContent === "Confirm and create budget" && !node.disabled));
    await driven.clickText("Confirm and create budget"); await driven.waitText("No categories yet");
    budgetId = new URL(driven.page.url()).pathname.split("/").at(-1);
    assert.ok(await driven.page.$('nav[aria-label="Budget sections"]'), "BudgetTabs must render on the dashboard");
    await driven.clickText("Accounts"); await driven.waitText("Manual accounts");
    assert.equal(await driven.page.$$eval('nav[aria-label="Budget sections"] [aria-current="page"]', nodes => nodes.map(node => node.textContent.trim())).then(labels => labels.includes("Accounts")), true, "the Accounts tab must be current on its own route");
  });

  await t.test("CBD-198-AC03: true-empty state, then populated after adding one", async () => {
    await driven.waitText("No manual accounts yet");
    await driven.accessibility();
    await driven.fill("#account-create-label", "Everyday checking");
    await driven.clickText("Add account");
    await driven.waitText("Everyday checking added.");
    // REV-UIP02-5: the submit button blurs the instant the request starts and the list refresh unmounts
    // the whole form while it reloads, so a successful add must not leave focus on <body> either.
    assert.equal(await driven.page.evaluate(() => document.activeElement?.id), "accounts-heading", "focus must land on the list page's own heading after a successful add, not on <body>");
    assert.ok(await driven.page.$("table"), "a table must replace the empty state");
    await driven.waitText("Checking");
    await driven.waitText("Active");
    await driven.accessibility();
  });

  await t.test("CBD-198-AC02: a validation error focuses the invalid field and preserves the rest of the form", async () => {
    await driven.fill("#account-create-label", "");
    await driven.fill("#account-create-opening", "12.34");
    await driven.clickText("Add account");
    await driven.waitText("Enter a name between 1 and 120 characters.");
    assert.equal(await driven.page.evaluate(() => document.activeElement?.id), "account-create-label", "focus must move to the invalid field");
    assert.equal(await driven.page.$eval("#account-create-opening", node => node.value), "12.34", "an untouched field must keep its entered value");
    assert.equal(await driven.page.$eval("#account-create-label", node => node.getAttribute("aria-invalid")), "true");
    await driven.accessibility();
    await driven.fill("#account-create-label", "");
    await driven.fill("#account-create-opening", "0");
  });

  await t.test("CBD-198-AC02/AC03: edit the account's name from its detail page", async () => {
    await driven.clickText("Edit Everyday checking"); await driven.waitText("Account detail");
    await driven.waitTitle("Account detail");
    await driven.fill("#account-edit-label", "Everyday");
    await driven.clickText("Save name"); await driven.waitText("Everyday updated.");
    await driven.accessibility();
    // REV-UIP02-3: the narrow/400%-zoom-equivalent + axe pass ran only on the list route before; the
    // detail route (its own editor form and archive/restore controls) needs the same proof.
    await driven.narrow();
  });

  await t.test("CBD-198-AC02/AC03 (CBD-72 row 36, REV-UIP02-1): archive with confirmation names what is kept, then restore, and focus lands on a stable target after each", async () => {
    await driven.clickText("Archive Everyday"); await driven.waitText("Archive Everyday?");
    await driven.waitText("transaction and audit history is kept");
    await driven.accessibility();
    // Focus returns to the button that opened the dialog when it is dismissed without confirming (native
    // <dialog> behaviour); proven before the confirming path, so a false pass from the confirm's own
    // subsequent DOM change cannot be mistaken for this.
    await driven.clickText("Cancel");
    assert.equal(await driven.page.evaluate(() => document.activeElement?.textContent?.trim()), "Archive Everyday", "focus must return to the control that opened the dialog");
    await driven.clickText("Archive Everyday"); await driven.clickText("Archive account");
    await driven.waitText("Everyday archived.");
    await driven.waitText("This account is archived. Restore it to change its name.");
    // REV-UIP02-1: a successful confirm on the detail route must not leave focus on <body>. The dialog's
    // own trigger button is gone after this reload (the editor it belonged to is no longer rendered for an
    // archived account), so focus must have moved explicitly to the page's own stable heading.
    assert.equal(await driven.page.evaluate(() => document.activeElement?.id), "account-detail-heading", "focus must land on the detail page's own heading after a successful archive, not on <body>");
    await driven.accessibility();
    await driven.clickText("Restore Everyday"); await driven.clickText("Restore account");
    await driven.waitText("Everyday restored.");
    assert.equal(await driven.page.evaluate(() => document.activeElement?.id), "account-detail-heading", "focus must land on the detail page's own heading after a successful restore, not on <body>");
    await driven.accessibility();
  });

  await t.test("CBD-198-AC03/REV-UIP02-1: all-archived-empty is distinct from true-empty, the toggle reveals archived rows, and focus lands on a stable target on the list route too", async () => {
    await driven.clickText("Back to accounts"); await driven.waitText("Your accounts");
    await driven.clickText("Archive Everyday"); await driven.clickText("Archive account");
    await driven.waitText("Every account here is archived.");
    // REV-UIP02-1: on the list route, a successful archive can hide the very row (and its trigger button)
    // the confirm dialog belonged to -- when "Show archived" is off, the row disappears outright. Focus
    // must have moved explicitly to the list page's own heading, not fallen to <body>.
    assert.equal(await driven.page.evaluate(() => document.activeElement?.id), "accounts-heading", "focus must land on the list page's own heading after a successful archive, not on <body>");
    assert.equal(await driven.page.$eval("#accounts-show-archived", node => node.checked), true, "the toggle must already be on when every account is archived");
    await driven.waitText("Everyday");
    await driven.accessibility();
    await driven.clickText("Restore Everyday"); await driven.clickText("Restore account");
    await driven.waitText("Everyday restored.");
    assert.equal(await driven.page.evaluate(() => document.activeElement?.id), "accounts-heading", "focus must land on the list page's own heading after a successful restore, not on <body>");
  });

  await t.test("REV-UIP02-6/7: a denied mutation whose subsequent list re-read succeeds still announces the refusal, not silence", async () => {
    // The prior test's own restore is still reloading the list when its announcement text lands; wait for
    // the row (and its trigger) to actually be back before this test starts clicking it.
    await driven.waitText("Active");
    // The archive write is refused (403) but the list GET that follows it succeeds (200, real data) --
    // exactly the combination that regressed: before this fix the reload wiped the dialog, and with it
    // the only place the refusal was shown, before anyone could read it.
    await driven.page.setRequestInterception(true);
    const denyArchive = request => {
      const url = new URL(request.url());
      if (request.method() === "POST" && /\/accounts\/[^/]+\/archive$/u.test(url.pathname)) {
        void request.respond({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "authorization_denied" }) });
      } else void request.continue();
    };
    driven.page.on("request", denyArchive);
    try {
      await driven.clickText("Archive Everyday"); await driven.clickText("Archive account");
      await driven.waitText("Your current session cannot do this here.");
      // The refusal must persist in the page-level status region after the reload, not vanish with the
      // dialog it was raised in.
      assert.equal(await driven.page.$eval('[data-testid="accounts-status"]', node => node.textContent.trim()), "Your current session cannot do this here.", "the refusal must be visible in the status region after the reload completes");
      // The account is still live -- the write never took effect -- and the archive control is still
      // there to try again, since this session's permissions did not actually change; only this one
      // write was refused (an intercepted single request, not the mock's own authorize() gate).
      await driven.waitText("Active");
      assert.notEqual(await driven.page.evaluate(() => document.activeElement === document.body), true, "focus must not fall to <body> on a denied mutation either");
      assert.equal(await driven.page.evaluate(() => document.activeElement?.id), "accounts-heading", "focus must land on the page's own heading after a denied mutation, the same target a successful one uses");
    } finally {
      driven.page.off("request", denyArchive);
      await driven.page.setRequestInterception(false);
    }
  });

  await t.test("CBD-198-AC02/AC03: a genuine 409 conflict is reported distinctly from a validation error, with no silent overwrite", async () => {
    // A second live account with a name this session is about to try to reuse via PATCH -- reproducing the
    // "someone changed this first" race without a second browser context, by racing the mock's own state
    // directly: rename Everyday to a name another live account already holds.
    const outcome = await driven.page.evaluate(async id => {
      const csrf = (await (await fetch("/api/mock/v1/identity/me")).json()).csrfValue;
      const post = (path, method, body) => fetch(`/api/mock${path}`, { method, headers: { "content-type": "application/json", "x-cobudget-csrf": csrf }, body: JSON.stringify(body) }).then(async response => ({ status: response.status, body: await response.json().catch(() => null) }));
      const created = await post(`/v1/budget-spaces/${id}/accounts`, "POST", { label: "Second account", accountType: "savings", currencyCode: "USD", openingBalanceMinorUnits: 0 });
      return created;
    }, budgetId);
    assert.equal(outcome.status, 201);
    await driven.page.reload(); await driven.waitText("Second account");
    await driven.clickText("Edit Everyday"); await driven.waitText("Account detail");
    await driven.fill("#account-edit-label", "Second account");
    await driven.clickText("Save name");
    await driven.waitText("Another live account already uses this name.");
    // A 409 is a conflict, not a validation error to blindly resubmit: the field still carries the
    // message, but the form does not clear or overwrite the entered value either way.
    assert.equal(await driven.page.$eval("#account-edit-label", node => node.value), "Second account", "the attempted value must be preserved, not silently discarded");
    await driven.accessibility();
    await driven.fill("#account-edit-label", "Everyday");
    await driven.clickText("Save name"); await driven.waitText("Everyday updated.");
  });

  const listResponse = await driven.page.evaluate(async id => (await fetch(`/api/mock/v1/budget-spaces/${id}/accounts`)).json(), budgetId);
  let scenario = null;
  await driven.page.setRequestInterception(true);
  driven.page.on("request", request => {
    if (scenario && new URL(request.url()).pathname === `/api/mock/v1/budget-spaces/${budgetId}/accounts`) {
      const selected = scenario;
      void (async () => { try { await request.respond({ status: selected.status ?? 200, contentType: "application/json", body: JSON.stringify(selected.body ?? listResponse) }); } catch { /* A cancelled navigation discards this response. */ } })();
    } else void request.continue();
  });

  await t.test("CBD-198-AC02/AC03: permission-denied removes the controls, it does not merely disable them", async () => {
    scenario = { status: 403, body: { error: "authorization_denied" } };
    await driven.page.goto(`${origin}/budgets/${budgetId}/accounts`); await driven.waitText("Access unavailable");
    assert.equal(await driven.findControl("Add account"), null, "the Add control must be absent, not present-and-disabled, under denial");
    await driven.accessibility();
  });

  await t.test("CBD-198-AC03: a recoverable failure offers Try again", async () => {
    scenario = { status: 503, body: { error: "recoverable" } };
    await driven.page.goto(`${origin}/budgets/${budgetId}/accounts`); await driven.waitText("Unable to load accounts");
    await driven.accessibility();
    scenario = null; await driven.clickText("Try again"); await driven.waitText("Your accounts");
  });

  await t.test("CBD-198-AC04: keyboard-only reach, 320px and 400%-zoom-equivalent reflow", async () => {
    await driven.page.goto(`${origin}/budgets/${budgetId}/accounts`); await driven.waitText("Your accounts");
    await driven.page.evaluate(() => document.getElementById("app-main")?.focus());
    let reachedAdd = false;
    for (let step = 0; step < 40; step++) {
      await driven.page.keyboard.press("Tab");
      if (await driven.page.evaluate(() => document.activeElement?.id === "account-create-label")) { reachedAdd = true; break; }
    }
    assert.ok(reachedAdd, "the add-account form must be reachable by keyboard alone in DOM order");
    await driven.narrow();
  });

  assert.deepEqual(errors, []);
}
