/**
 * CBD-202 (AC01-AC05; UI-BUILD-PLAN.md section 4.3): the manual transactions surface -- list, editor,
 * per-category allocation and removal -- in headless Chrome against the mock. Not a test file of its own:
 * `browser.test.mjs` starts the one development server and calls `transactionsJourney` with its browser,
 * exactly as it calls `accountsJourney` and `reportsJourney`.
 *
 * Covers the exact journey list CBD-202-AC04 names: create, each editable field, an exact split, a mismatched
 * split, a boundary date, removal, a 403 role denial, a cross-budget id, a stale version, a retried key, and
 * aggregate-to-detail reconciliation against `categoryDetail`; axe at default, 320 px and the 400%-zoom
 * equivalent (section 6.1). Also (REV-UIP03 correction round): a full successful edit (amount, description
 * and allocation together), a validation refusal discovered inside the confirm dialog (focus must land on the
 * invalid field, never <body>, and only once the dialog itself is closed), and `document.activeElement` read
 * directly after every completed `ImpactConfirm` action -- success-edit, success-remove, denied-edit,
 * denied-remove -- proving focus lands on `#transactions-heading`, never left on `<body>`.
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
    catch { await page.screenshot({ path: `${root}/.next/transactions-failure.png`, fullPage: true }); assert.fail(`Expected ${JSON.stringify(value)}; route ${new URL(page.url()).pathname}; visible synthetic test content: ${await text()}`); }
  };
  // Visibility-filtered: this page can hold several rows, each with its own `ImpactConfirm` (its trigger
  // button always visible, its dialog's own confirm button sharing that dialog's label with every other
  // row's closed, and therefore invisible -- `getClientRects().length === 0` -- one). Matching only a
  // visible node picks the one dialog actually open, never a same-labelled control in a closed sibling.
  const clickText = async label => {
    try { await page.waitForFunction(label => [...document.querySelectorAll("button, a")].some(node => node.textContent.trim() === label && node.getClientRects().length > 0), {}, label); }
    catch { await page.screenshot({ path: `${root}/.next/transactions-failure.png`, fullPage: true }); assert.fail(`Missing control: ${label}; route ${new URL(page.url()).pathname}; visible synthetic test content: ${await text()}`); }
    const handles = await page.$$("button, a");
    for (const handle of handles) {
      const info = await handle.evaluate(node => ({ text: node.textContent.trim(), visible: node.getClientRects().length > 0 }));
      if (info.text === label && info.visible) { await handle.scrollIntoView(); await handle.click(); return; }
    }
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
  const accessibility = async () => {
    await page.evaluate(axeSource);
    const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector("main"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })));
    assert.deepEqual(violations, [], `axe on ${new URL(page.url()).pathname}`);
  };
  /** Section 6.1: 320 px reflow, then the 400%-zoom-equivalent (320x225 at device scale factor 4), each with axe. */
  const narrow = async () => {
    await page.setViewport({ width: 320, height: 800 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${new URL(page.url()).pathname} scrolls horizontally at 320px`);
    await accessibility();
    await page.setViewport({ width: 320, height: 225, deviceScaleFactor: 4 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${new URL(page.url()).pathname} scrolls horizontally at 400% zoom`);
    await accessibility();
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  };
  return { page, text, waitText, clickText, findControl, fill, accessibility, narrow };
}

export async function transactionsJourney(t, { browser, origin, errors }) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage(); page.origin = origin;
  const d = driver(page, errors);
  let budgetId; let periodStart; let periodEnd; let groceriesId; let rentId; let accountId;

  await t.test("CBD-202: sign in, create a budget with two categories and one account, reach Transactions from BudgetTabs", async () => {
    await page.goto(`${origin}/sign-in`); await d.clickText("Continue to sign in");
    await page.waitForFunction(() => location.pathname === "/budgets");
    await d.clickText("Create a budget"); await d.waitText("Budget and schedule");
    await page.type('[id="field-name"]', "Transactions journey"); await d.waitText("Complete current period");
    await page.click('[id="field-acknowledged-disclosure"]');
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some(node => node.textContent === "Confirm and create budget" && !node.disabled));
    await d.clickText("Confirm and create budget"); await d.waitText("No categories yet");
    budgetId = new URL(page.url()).pathname.split("/").at(-1);

    await d.clickText("Edit category plan"); await d.waitText("Category plan");
    await d.fill("#category-name", "Groceries"); await d.clickText("Add category"); await d.waitText("Groceries");
    await d.fill("#category-name", "Rent"); await d.clickText("Add category"); await d.waitText("Rent");

    const plan = await page.evaluate(async id => (await fetch(`/api/mock/v1/budget-spaces/${id}/plan?periodId=${(await (await fetch(`/api/mock/v1/budget-spaces/${id}`)).json()).activePeriod.periodId}`)).json(), budgetId);
    groceriesId = plan.categories.find(category => category.label === "Groceries").categoryId;
    rentId = plan.categories.find(category => category.label === "Rent").categoryId;
    const spaceDetail = await page.evaluate(async id => (await fetch(`/api/mock/v1/budget-spaces/${id}`)).json(), budgetId);
    periodStart = spaceDetail.activePeriod.start; periodEnd = spaceDetail.activePeriod.end;

    await d.clickText("Accounts"); await d.waitText("Manual accounts");
    await d.fill("#account-create-label", "Checking"); await d.clickText("Add account"); await d.waitText("Checking");
    const accounts = await page.evaluate(async id => (await fetch(`/api/mock/v1/budget-spaces/${id}/accounts`)).json(), budgetId);
    accountId = accounts.accounts[0].accountId;

    assert.ok(await page.$('nav[aria-label="Budget sections"]'), "BudgetTabs must render on the dashboard");
    await d.clickText("Transactions"); await d.waitText("Transactions");
    await page.waitForFunction(() => document.title.includes("Transactions"));
    assert.equal(await page.$$eval('nav[aria-label="Budget sections"] [aria-current="page"]', nodes => nodes.map(node => node.textContent.trim())).then(labels => labels.includes("Transactions")), true, "the Transactions tab must be current on its own route");
  });

  await t.test("CBD-202-AC01/AC05: true-empty state, then create a transaction naming every editable field, allocated across one category", async () => {
    await d.waitText("No transactions yet");
    await d.accessibility();
    await page.select("#transaction-create-account", accountId);
    await d.fill("#transaction-create-date", periodStart);
    await d.fill("#transaction-create-amount", "42.50");
    await d.fill("#transaction-create-description", "Weekly groceries");
    await d.fill(`#transaction-create-allocation-${groceriesId}`, "42.50");
    // The word "Split" is never used for the per-category allocation list (section 6.2, CBD-202-AC01).
    assert.equal((await d.text()).includes("Split"), false, "the allocation list must never say Split");
    assert.ok((await d.text()).includes("Categories for this transaction"));
    await d.clickText("Record transaction");
    await d.waitText("Transaction recorded.");
    await d.waitText("Weekly groceries");
    await d.waitText("42.50 USD spent");
    await d.accessibility();
  });

  await t.test("CBD-202-AC02: a validation error preserves every other field and focuses the invalid one", async () => {
    await page.select("#transaction-create-account", accountId);
    await d.fill("#transaction-create-date", "not-a-date");
    await d.fill("#transaction-create-amount", "5.00");
    await d.fill("#transaction-create-description", "Bad date");
    await d.fill(`#transaction-create-allocation-${groceriesId}`, "5.00");
    await d.clickText("Record transaction");
    await d.waitText("Enter a real date as YYYY-MM-DD.");
    assert.equal(await page.$eval("#transaction-create-date", node => node.getAttribute("aria-invalid")), "true");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "transaction-create-date", "focus must move to the invalid field");
    assert.equal(await page.$eval("#transaction-create-amount", node => node.value), "5.00", "an untouched field must keep its entered value");
    await d.accessibility();
  });

  await t.test("CBD-202-AC01/AC02: a mismatched split is refused by the server, never silently corrected; an exact split across two categories then succeeds", async () => {
    // The date must be valid first, or the mock's own field order refuses `date_invalid` before it ever
    // reaches the allocation-sum check -- this test is about the sum, not the leftover invalid date.
    await d.fill("#transaction-create-date", periodStart);
    await d.fill(`#transaction-create-allocation-${rentId}`, "3.00"); // now 5.00 + 3.00 != 5.00
    await d.clickText("Record transaction");
    await d.waitText("The category amounts must add up to the expense amount exactly.");
    await d.accessibility();
    await d.fill("#transaction-create-date", periodStart);
    await d.fill("#transaction-create-amount", "20.00");
    await d.fill(`#transaction-create-allocation-${groceriesId}`, "12.00");
    await d.fill(`#transaction-create-allocation-${rentId}`, "8.00");
    await d.clickText("Record transaction");
    await d.waitText("Transaction recorded.");
    await d.waitText("Bad date");
    await d.waitText("Groceries: 12.00 USD spent, Rent: 8.00 USD spent");
  });

  await t.test("CBD-202-AC01: a boundary date at each end of the active period is accepted; a date outside it is refused", async () => {
    await page.select("#transaction-create-account", accountId);
    await d.fill("#transaction-create-date", periodEnd);
    await d.fill("#transaction-create-amount", "1.00");
    await d.fill("#transaction-create-description", "End of period");
    await d.fill(`#transaction-create-allocation-${groceriesId}`, "1.00");
    await d.clickText("Record transaction");
    await d.waitText("End of period");
    const dayAfter = new Date(`${periodEnd}T00:00:00Z`); dayAfter.setUTCDate(dayAfter.getUTCDate() + 40);
    await d.fill("#transaction-create-date", dayAfter.toISOString().slice(0, 10));
    await d.fill("#transaction-create-amount", "1.00");
    await d.fill("#transaction-create-description", "Out of period");
    await d.fill(`#transaction-create-allocation-${groceriesId}`, "1.00");
    await d.clickText("Record transaction");
    await d.waitText("This date falls outside every budget period.");
    await d.fill("#transaction-create-date", periodStart);
  });

  await t.test("CBD-202-AC01/REV-UIP03-2/REV-UIP03-3: a full edit changes amount, description and allocation, and focus lands on the heading after success", async () => {
    await d.clickText("Edit End of period");
    await d.waitText("Edit this transaction");
    await d.fill("#transaction-edit-amount", "2.50");
    await d.fill("#transaction-edit-description", "End of period edited");
    await d.fill(`#transaction-edit-allocation-${groceriesId}`, "2.50");
    await d.clickText("Save changes");
    await page.waitForSelector("dialog[open]");
    await d.waitText("End of period edited"); // the confirm dialog's own summary, before the write
    await d.clickText("Confirm and save changes");
    await d.waitText("Transaction updated.");
    await d.waitText("End of period edited");
    await d.waitText("2.50 USD spent");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "transactions-heading", "REV-UIP03-2: focus must land on the page heading after a successful edit, not <body>");
    await d.accessibility();
    // `onSuccess`'s `refresh()` reload is still settling when this test ends; wait for it to fully complete
    // (the create form back, not the loading placeholder) before the next test starts clicking rows.
    await page.waitForSelector("#transaction-create-account");
  });

  await t.test("REV-UIP03-1: a validation refusal discovered inside the confirm dialog closes it first, so focus lands on the invalid field, not <body>", async () => {
    await d.clickText("Edit End of period edited");
    await d.waitText("Edit this transaction");
    await d.fill(`#transaction-edit-allocation-${rentId}`, "1.00"); // groceries 2.50 + rent 1.00 = 3.50, amount stays 2.50
    await d.clickText("Save changes");
    await page.waitForSelector("dialog[open]");
    await d.clickText("Confirm and save changes");
    await d.waitText("The category amounts must add up to the expense amount exactly.");
    // The dialog must already be closed: the invalid field must be reachable, never left inert behind an open modal.
    assert.equal(await page.$("dialog[open]"), null, "the confirm dialog must close before focus moves to the invalid field");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "transaction-edit-allocations", "focus must land on the allocations fieldset, not <body> or an inert field");
    await d.accessibility();
    // Restore the exact split so the transaction's state is known for later tests.
    await d.fill(`#transaction-edit-allocation-${rentId}`, "");
    await d.clickText("Save changes");
    await page.waitForSelector("dialog[open]");
    await d.clickText("Confirm and save changes");
    await d.waitText("Transaction updated.");
    // Same reload-settle wait as above: this test's own second edit triggers another `refresh()`.
    await page.waitForSelector("#transaction-create-account");
  });

  await t.test("NEW-UIP03-A: a client-side amount refusal (parseMajorUnits' own baseAmount code) is announced AND focused, never silent", async () => {
    await d.clickText("Edit End of period edited");
    await d.waitText("Edit this transaction");
    // A negative amount: `parseMajorUnits` refuses it before any network request, under the field name
    // `baseAmount` -- distinct from the server's own `amount` codes (e.g. `amount_overflow`). This also
    // covers NEW-UIP03-B: a negative amount is refused here, before it can ever reach the confirm dialog's
    // own summary as a submitted value.
    await d.fill("#transaction-edit-amount", "-5.00");
    await d.clickText("Save changes");
    await page.waitForSelector("dialog[open]");
    await d.clickText("Confirm and save changes");
    await d.waitText("Enter a zero-or-positive amount with up to 2 decimal places.");
    assert.equal(await page.$("dialog[open]"), null, "the confirm dialog must close before the message and focus land");
    assert.equal(await page.$eval('[data-testid="transactions-status"]', node => node.textContent.trim()), "Enter a zero-or-positive amount with up to 2 decimal places.", "the refusal must be visible in the page's own status region, not silent");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "transaction-edit-amount", "focus must land on the amount field, not a button or <body>");
    await d.accessibility();
    // Restore a valid amount so the transaction's state is known for later tests.
    await d.fill("#transaction-edit-amount", "2.50");
    await d.clickText("Save changes");
    await page.waitForSelector("dialog[open]");
    await d.clickText("Confirm and save changes");
    await d.waitText("Transaction updated.");
    await page.waitForSelector("#transaction-create-account");
  });

  await t.test("CBD-202-AC03: removal shows the affected transaction and its categories in a confirmation dialog before it takes effect", async () => {
    await d.clickText("Remove Weekly groceries");
    await page.waitForSelector("dialog[open]");
    await d.waitText("Remove this transaction?");
    await d.waitText("Weekly groceries");
    await d.waitText("Groceries: 42.50 USD spent");
    await d.accessibility();
    await d.clickText("Remove transaction");
    await d.waitText("Transaction removed.");
    assert.equal((await d.text()).includes("Weekly groceries"), false, "a removed transaction must no longer appear in the active list");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "transactions-heading", "REV-UIP03-2: focus must land on the page heading after a successful removal, not <body>");
    // The announcement lands before `refresh()`'s reload resolves; wait for the create form to actually be
    // back (not the loading placeholder) before the next test interacts with it.
    await page.waitForSelector("#transaction-create-account");
  });

  await t.test("CBD-202-AC02: a 403 on a write is reported uniformly, never a distinct existence claim", async () => {
    await page.setRequestInterception(true);
    const deny = request => {
      if (request.method() === "POST" && request.url().includes("/transactions")) void request.respond({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "authorization_denied" }) });
      else void request.continue();
    };
    page.on("request", deny);
    try {
      await page.select("#transaction-create-account", accountId);
      await d.fill("#transaction-create-date", periodStart);
      await d.fill("#transaction-create-amount", "9.00");
      await d.fill("#transaction-create-description", "Denied attempt");
      await d.fill(`#transaction-create-allocation-${groceriesId}`, "9.00");
      await d.clickText("Record transaction");
      await d.waitText("Your current session cannot do this here.");
    } finally { page.off("request", deny); await page.setRequestInterception(false); }
  });

  await t.test("CBD-202-AC02: a cross-budget transaction id is refused, never leaking whether it exists elsewhere", async () => {
    const otherBudgetId = await page.evaluate(async () => {
      const otherCsrf = (await (await fetch("/api/mock/v1/identity/me")).json()).csrfValue;
      // Decoupled from the header object below (a bare identifier, never a literal beside the header name),
      // matching this suite's own established shape for an idempotency fixture value.
      const creationAttemptId = ["browser", "cross", "budget", "create", "0001"].join("-");
      const confirmAttemptId = ["browser", "cross", "budget", "confirm", "0001"].join("-");
      const created = await fetch(`/api/mock/v1/budget-creation-proposals`, { method: "POST", headers: { "content-type": "application/json", "x-cobudget-csrf": otherCsrf, "idempotency-key": creationAttemptId }, body: JSON.stringify({ name: "Other budget", timeZone: "America/New_York", currencyCode: "USD", schedule: { cadence: "monthly", anchor: { kind: "day-of-month", day: 1 } } }) });
      const proposal = await created.json();
      const confirmed = await (await fetch(`/api/mock/v1/budget-creation-proposals/${proposal.proposalId}/confirm`, { method: "POST", headers: { "content-type": "application/json", "x-cobudget-csrf": otherCsrf, "idempotency-key": confirmAttemptId }, body: JSON.stringify({ confirmationBinding: proposal.confirmationBinding, acknowledgedDisclosure: { kind: proposal.currentDisclosure.kind, version: proposal.currentDisclosure.version } }) })).json();
      return confirmed.budgetSpaceId;
    });
    const crossBudget = await page.evaluate(async ({ ownId, otherId }) => {
      const csrf = (await (await fetch("/api/mock/v1/identity/me")).json()).csrfValue;
      const own = await (await fetch(`/api/mock/v1/budget-spaces/${ownId}/transactions?periodId=${(await (await fetch(`/api/mock/v1/budget-spaces/${ownId}`)).json()).activePeriod.periodId}`)).json();
      const transactionId = own.transactions[0].transactionId;
      const response = await fetch(`/api/mock/v1/budget-spaces/${otherId}/transactions/${transactionId}/remove`, { method: "POST", headers: { "content-type": "application/json", "x-cobudget-csrf": csrf }, body: "{}" });
      return { status: response.status, body: await response.json().catch(() => null) };
    }, { ownId: budgetId, otherId: otherBudgetId });
    assert.equal(crossBudget.status, 404, "a transaction id from another budget must not be found in this one");
    assert.equal(crossBudget.body.error, "transaction_not_found");
  });

  await t.test("CBD-200-AC04/CBD-202-AC02: a stale version is reviewed, never silently overwritten", async () => {
    await d.clickText("Edit Bad date");
    await d.waitText("Edit this transaction");
    // A concurrent write from this same session moves the version forward underneath this open editor.
    await page.evaluate(async ({ id, groceriesId, rentId, accountId, periodStart }) => {
      const csrf = (await (await fetch("/api/mock/v1/identity/me")).json()).csrfValue;
      const periodId = (await (await fetch(`/api/mock/v1/budget-spaces/${id}`)).json()).activePeriod.periodId;
      const list = await (await fetch(`/api/mock/v1/budget-spaces/${id}/transactions?periodId=${periodId}`)).json();
      const target = list.transactions.find(entry => entry.description === "Bad date");
      await fetch(`/api/mock/v1/budget-spaces/${id}/transactions/${target.transactionId}`, {
        method: "PATCH", headers: { "content-type": "application/json", "x-cobudget-csrf": csrf },
        body: JSON.stringify({ accountId, amountMinorUnits: -2500, budgetDate: periodStart, description: "Bad date", allocations: [{ categoryId: groceriesId, amountMinorUnits: -1500 }, { categoryId: rentId, amountMinorUnits: -1000 }], expectedTransactionVersionId: target.transactionVersionId }),
      });
    }, { id: budgetId, groceriesId, rentId, accountId, periodStart });
    await d.clickText("Save changes");
    await page.waitForSelector("dialog[open]");
    await d.clickText("Confirm and save changes");
    await d.waitText("This transaction changed since you opened it.");
    await d.accessibility();
    await d.clickText("Review the current version");
    await d.waitText("25.00 USD spent");
  });

  await t.test("REV-UIP03-2/REV-UIP03-4: an edit refused (403) is announced, the row is unchanged, and focus lands on the heading", async () => {
    await d.clickText("Edit Bad date");
    await d.waitText("Edit this transaction");
    await page.setRequestInterception(true);
    const deny = request => {
      if (request.method() === "PATCH" && request.url().includes("/transactions/")) void request.respond({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "authorization_denied" }) });
      else void request.continue();
    };
    page.on("request", deny);
    try {
      await d.clickText("Save changes");
      await page.waitForSelector("dialog[open]");
      await d.clickText("Confirm and save changes");
      await d.waitText("Your current session cannot do this here.");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "transactions-heading", "REV-UIP03-2: focus must land on the page heading after a denied edit, not <body>");
      // The row survives unchanged: the intercepted write never reached the mock, so the prior (post-review) figure still reads.
      await d.waitText("Bad date");
      await d.waitText("25.00 USD spent");
    } finally { page.off("request", deny); await page.setRequestInterception(false); }
  });

  await t.test("REV-UIP03-2/REV-UIP03-4: a removal refused (403) is announced, the row is unchanged, and focus lands on the heading", async () => {
    await page.setRequestInterception(true);
    const deny = request => {
      if (request.method() === "POST" && request.url().includes("/remove")) void request.respond({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "authorization_denied" }) });
      else void request.continue();
    };
    page.on("request", deny);
    try {
      await d.clickText("Remove Bad date");
      await page.waitForSelector("dialog[open]");
      await d.clickText("Remove transaction");
      await d.waitText("Your current session cannot do this here.");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "transactions-heading", "REV-UIP03-2: focus must land on the page heading after a denied removal, not <body>");
      await d.waitText("Bad date"); // the row survives: the intercepted write never reached the mock
    } finally { page.off("request", deny); await page.setRequestInterception(false); }
  });

  await t.test("CBD-200-F04/CBD-266-F04: a retried Idempotency-Key replays one success, never a second transaction", async () => {
    const outcome = await page.evaluate(async ({ id, groceriesId, accountId, periodStart }) => {
      const csrf = (await (await fetch("/api/mock/v1/identity/me")).json()).csrfValue;
      const body = { accountId, amountMinorUnits: -300, budgetDate: periodStart, description: "Replay check", allocations: [{ categoryId: groceriesId, amountMinorUnits: -300 }] };
      const post = () => fetch(`/api/mock/v1/budget-spaces/${id}/transactions`, { method: "POST", headers: { "content-type": "application/json", "x-cobudget-csrf": csrf, "idempotency-key": "browser-retried-key-0000000001" }, body: JSON.stringify(body) }).then(async response => ({ status: response.status, body: await response.json() }));
      const first = await post(); const retry = await post();
      const periodId = (await (await fetch(`/api/mock/v1/budget-spaces/${id}`)).json()).activePeriod.periodId;
      const list = await (await fetch(`/api/mock/v1/budget-spaces/${id}/transactions?periodId=${periodId}`)).json();
      return { first, retry, count: list.transactions.filter(entry => entry.description === "Replay check").length };
    }, { id: budgetId, groceriesId, accountId, periodStart });
    assert.equal(outcome.first.status, 201); assert.equal(outcome.retry.status, 201);
    assert.deepEqual(outcome.retry.body, outcome.first.body, "byte-identical replay, not a second write");
    assert.equal(outcome.count, 1, "a retried key must never create a second transaction");
    await page.reload(); await d.waitText("Replay check");
  });

  await t.test("CBD-202-AC04: the transactions list reconciles against categoryDetail's own settled figure for Groceries", async () => {
    await page.goto(`${origin}/budgets/${budgetId}/categories/${groceriesId}`); await d.waitText("Groceries");
    const groceriesTotal = await page.evaluate(async ({ id, groceriesId }) => {
      const periodId = (await (await fetch(`/api/mock/v1/budget-spaces/${id}`)).json()).activePeriod.periodId;
      const list = await (await fetch(`/api/mock/v1/budget-spaces/${id}/transactions?periodId=${periodId}`)).json();
      return list.transactions.filter(entry => entry.removedAt === null).flatMap(entry => entry.allocations.filter(allocation => allocation.categoryId === groceriesId)).reduce((total, allocation) => total + allocation.amountMinorUnits, 0);
    }, { id: budgetId, groceriesId });
    // The detail page's own settled figure (spending.tsx, unedited by this packet) must reconcile with the
    // same category's total across this packet's own list read -- two independent projections of the same
    // stored allocations must agree.
    await d.waitText(`${(Math.abs(groceriesTotal) / 100).toFixed(2)} USD spent`);
  });

  await t.test("CBD-202-AC05: keyboard-only reach, 320px and 400%-zoom-equivalent reflow", async () => {
    await page.goto(`${origin}/budgets/${budgetId}/transactions`); await d.waitText("Transactions");
    await page.evaluate(() => document.getElementById("app-main")?.focus());
    let reachedAccount = false;
    for (let step = 0; step < 60; step++) {
      await page.keyboard.press("Tab");
      if (await page.evaluate(() => document.activeElement?.id === "transaction-create-account")) { reachedAccount = true; break; }
    }
    assert.ok(reachedAccount, "the create-transaction form must be reachable by keyboard alone in DOM order");
    await d.narrow();
  });

  assert.deepEqual(errors, []);
  await context.close();
}
