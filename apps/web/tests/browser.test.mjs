import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";
import { pk8Journey } from "./invitations.browser.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const axeSource = readFileSync(fileURLToPath(import.meta.resolve("axe-core/axe.min.js")), "utf8");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const server = createServer(); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
test("authenticated web journey, dashboard states, stale responses, keyboard and accessibility", { timeout: 240000 }, async t => {
  const port = await freePort(); const origin = `http://localhost:${port}`;
  const server = spawn(process.execPath, [fileURLToPath(import.meta.resolve("next/dist/bin/next")), "dev", "--port", String(port)], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; server.stdout.on("data", data => { output = (output + data).slice(-12000); }); server.stderr.on("data", data => { output = (output + data).slice(-12000); });
  let browser;
  t.after(async () => {
    await browser?.close();
    server.kill("SIGTERM");
    server.stdout.destroy(); server.stderr.destroy(); server.unref();
  });
  for (let attempt = 0; attempt < 120; attempt++) {
    if (server.exitCode !== null) assert.fail(`Development server failed: ${output}`);
    try { if ((await fetch(`${origin}/sign-in`)).ok) break; } catch { /* Wait for startup. */ }
    await pause(500);
    if (attempt === 119) assert.fail(`Development server not ready: ${output}`);
  }
  const executablePath = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
  browser = await puppeteer.launch({ ...(executablePath ? { executablePath } : {}), headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage(); page.setDefaultTimeout(20000);
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  const text = async () => page.$eval("main", node => node.textContent);
  const waitText = async value => {
    try { await page.waitForFunction(value => document.querySelector("main")?.textContent.includes(value), {}, value); }
    catch { await page.screenshot({ path: `${root}/.next/journey-failure.png`, fullPage: true }); assert.fail(`Expected ${value}; route ${new URL(page.url()).pathname}; visible synthetic test content: ${await text()}`); }
  };
  async function clickText(label) {
    const handles = await page.$$("button, a");
    for (const handle of handles) if ((await handle.evaluate(node => node.textContent.trim())) === label) {
      await handle.scrollIntoView();
      await handle.click(); return;
    }
    assert.fail(`Missing control: ${label}`);
  }
  // Types into a freshly queried control and proves the value landed, so a re-render between the
  // query and the keystrokes cannot silently leave a field empty.
  async function fill(selector, value) {
    await page.waitForSelector(selector);
    await page.focus(selector);
    await page.keyboard.down("Control"); await page.keyboard.press("KeyA"); await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await page.type(selector, value);
    assert.equal(await page.$eval(selector, node => node.value), value, `Typing into ${selector} did not take`);
  }
  async function accessibility() {
    await page.evaluate(axeSource);
    const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector("main"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })));
    assert.deepEqual(violations, []);
  }
  await t.test("PROTO-SIGNIN-01: protected route redirects and API ceremony returns", async () => {
    await page.goto(`${origin}/budgets`); await page.waitForFunction(() => location.pathname === "/sign-in");
    await clickText("Continue to sign in"); await waitText("No budgets yet");
    assert.equal(new URL(page.url()).pathname, "/budgets"); await accessibility();
  });
  let budgetId;
  await t.test("CBD-242-AC06: refresh, restored draft, back/forward and duplicate tab require new previews", async () => {
    // Every accepted preview response is recorded the moment its headers arrive, as a promise of its
    // body. The page renders "Complete current period" as soon as the body reaches it, and reading
    // that body back over the devtools protocol is a separate round trip that loses the race under
    // load; recording the promise synchronously and settling every body before an assertion makes
    // the observed preview independent of that timing. Each step also proves a NEW preview was
    // requested, so a page that silently reused a token fails on the count, not on a timeout.
    const issued = [];
    const capture = response => {
      if (response.request().method() === "POST" && response.url().endsWith("/budget-creation-proposals") && response.ok()) {
        const body = response.json(); body.catch(() => { /* Surfaced by latestPreview. */ }); issued.push(body);
      }
    };
    const latestPreview = async () => (await Promise.all(issued)).at(-1);
    const previewAfter = async (step, before) => {
      assert.ok(issued.length > before, `${step}: no new preview was requested (previews issued: ${issued.length})`);
      return latestPreview();
    };
    page.on("response", capture);
    await clickText("Create a budget"); await waitText("Budget and schedule");
    await page.type('[id="field-name"]', "Restored draft"); await waitText("Complete current period");
    // CBD-236: the confirm control stays disabled until the disclosure is explicitly acknowledged.
    assert.equal(await page.$eval('[id="field-acknowledged-disclosure"]', node => node.checked), false, "no box is ticked by default");
    await page.click('[id="field-acknowledged-disclosure"]');
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some(node => node.textContent === "Confirm and create budget" && !node.disabled));
    const first = (await previewAfter("typing a name", 0)).proposalId;
    let count = issued.length;
    await page.reload(); await waitText("Complete current period");
    assert.equal(await page.$eval('[id="field-name"]', node => node.value), "Restored draft");
    const refreshed = (await previewAfter("reload", count)).proposalId;
    assert.notEqual(refreshed, first);
    count = issued.length;
    await clickText("Your budgets"); await waitText("No budgets yet");
    await page.goBack(); await waitText("Complete current period");
    assert.notEqual((await previewAfter("back navigation", count)).proposalId, refreshed);
    await page.goForward(); await waitText("No budgets yet");
    await page.goBack(); await waitText("Complete current period");
    const copiedStorage = await page.evaluate(() => Object.entries(sessionStorage));
    assert.equal(copiedStorage.some(([, value]) => value.includes("confirmationBinding") || value.includes("proposalId")), false);
    const duplicate = await browser.newPage();
    await duplicate.evaluateOnNewDocument(entries => { for (const [key, value] of entries) sessionStorage.setItem(key, value); }, copiedStorage);
    const newProposal = duplicate.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/budget-creation-proposals") && response.ok());
    await duplicate.goto(`${origin}/budgets/new`);
    const duplicated = await (await newProposal).json();
    assert.notEqual(duplicated.proposalId, (await latestPreview()).proposalId);
    assert.equal(duplicated.supersedesProposalId, null);
    await duplicate.close();
    await page.bringToFront(); await waitText("Budget and schedule");
    page.off("response", capture);
    await clickText("Your budgets"); await waitText("No budgets yet");
    await page.evaluate(() => { for (const key of Object.keys(sessionStorage)) if (key.startsWith("cobudget.draft.creation.")) sessionStorage.removeItem(key); });
  });
  await t.test("CBD-242-AC01/AC02/AC03/AC04: field errors, server review, bound confirm", async () => {
    await clickText("Create a budget"); await waitText("Budget and schedule");
    assert.equal(await page.evaluate(() => [...document.querySelectorAll("button")].find(node => node.textContent === "Confirm and create budget")?.disabled), true);
    await clickText("Preview schedule"); await waitText("Enter a budget name.");
    assert.equal(await page.$eval('[id="field-timeZone"]', node => node.value), "America/New_York");
    assert.equal(await page.$eval('[id="field-name"]', node => node.getAttribute("aria-invalid")), "true");
    await page.type('[id="field-name"]', "Our household"); await waitText("Complete current period");
    // CBD-236 (CBD236-CONSENT-SEMANTICS-001 item 1): the disclosure is presented above the confirm
    // control, no box is ticked for the person, and confirming is impossible until they tick it.
    await waitText("Before you create this budget");
    assert.equal(await page.$eval('[id="field-acknowledged-disclosure"]', node => node.checked), false);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll("button")].find(node => node.textContent === "Confirm and create budget")?.disabled), true);
    await page.click('[id="field-acknowledged-disclosure"]');
    await page.waitForFunction(() => [...document.querySelectorAll("button")].find(node => node.textContent === "Confirm and create budget")?.disabled === false);
    assert.equal(await page.$$eval("ol li", nodes => nodes.length), 4); await accessibility();
    const confirmationRequest = page.waitForRequest(request => request.url().endsWith("/confirm") && request.method() === "POST");
    await clickText("Confirm and create budget");
    const request = await confirmationRequest;
    const body = JSON.parse(request.postData());
    assert.deepEqual(Object.keys(body).sort(), ["acknowledgedDisclosure", "confirmationBinding"]);
    assert.equal(body.acknowledgedDisclosure.kind, "primary_owner_self");
    assert.ok(Number.isSafeInteger(body.acknowledgedDisclosure.version) && body.acknowledgedDisclosure.version >= 1);
    await waitText("No categories yet"); budgetId = new URL(page.url()).pathname.split("/").at(-1);
  });
  // A budget id is the product of the creation step above. Later steps drive routes built from it,
  // so without one they would each wait 20 s on /budgets/undefined; failing here names the cause.
  const requireBudget = () => assert.ok(budgetId, "no budget was created by CBD-242-AC01/AC02/AC03/AC04, so this step cannot run");
  await t.test("CBD-218-AC01: plan editing persists across reload and uses server identities", async () => {
    requireBudget(); assert.ok((await text()).includes(budgetId));
    await clickText("Edit category plan"); await waitText("Add category");
    await page.type("#category-name", "Groceries"); await clickText("Add category"); await waitText("Base target for Groceries");
    const input = await page.$('[id^="target-"]'); await input.click({ clickCount: 3 }); await input.type("450.00"); await clickText("Save target");
    await waitText("Period target: 450.00 USD"); await page.reload(); await waitText("Period target: 450.00 USD"); await accessibility();
  });
  // --- PROTO-INCREMENT-B-001 -------------------------------------------------------------------
  // CBD-196/200/209/211 in headless Chrome, against the mock that speaks the merged API's wire
  // shapes: add an account, record one expense split across two categories, read spent and
  // remaining, open the itemized detail, edit and remove the expense and watch the figures return,
  // and reload to see the same. Every step is driven through the rendered controls only.
  await t.test("CBD-196/CBD-200/CBD-209/CBD-211: account, split expense, progress, detail, edit and removal", async () => {
    requireBudget(); await page.goto(`${origin}/budgets/${budgetId}/plan`); await waitText("Add category");
    await page.type("#category-name", "Transport"); await clickText("Add category"); await waitText("Base target for Transport");
    // Submitting from inside the control posts that category's own form; the shared button label
    // would otherwise match the first row's button.
    const targetIds = await page.$$eval('input[id^="target-"]', nodes => nodes.map(node => `#${node.id}`));
    await fill(targetIds.at(-1), "200.00");
    await page.keyboard.press("Enter");
    await waitText("Period target: 200.00 USD");

    await page.goto(`${origin}/budgets/${budgetId}`); await waitText("Accounts and spending");
    await waitText("No accounts yet");
    await accessibility();

    await fill("#account-name", "Everyday"); await clickText("Add account");
    await waitText("Added Everyday.");
    await waitText("checking · opening balance 0.00 USD");

    // The active period's inclusive dates are on the page; the expense is dated to its first day.
    const periodStart = (await text()).match(/(\d{4}-\d{2}-\d{2}) through/)[1];
    const allocationIds = await page.$$eval('input[id^="allocation-"]', nodes => nodes.map(node => `#${node.id}`));
    assert.equal(allocationIds.length, 2, "one allocation input per live category");
    const expense = async (groceries, transport) => {
      await fill("#expense-date", periodStart);
      await fill("#expense-amount", "12.50");
      await fill("#expense-description", "Corner shop");
      await fill(allocationIds[0], groceries);
      await fill(allocationIds[1], transport);
      await clickText("Record expense");
    };

    // The exact-sum rule is the server's, and its refusal lands on the allocation fieldset.
    await expense("8.00", "4.00");
    await waitText("The category amounts must add up to the expense amount exactly.");
    await accessibility();

    await expense("8.00", "4.50");
    await waitText("Expense recorded.");
    // CBD-211-AC01: each row carries the API's four values under the API's names, each a
    // magnitude with its sign as a word; nothing is merged into one unlabelled number.
    const row = async label => page.$$eval('[data-testid="progress-row"]', (rows, label) => rows.find(node => node.querySelector("h4")?.textContent.trim() === label)?.textContent.replace(/\s+/gu, " ").trim(), label);
    const waitRow = async (label, ...snippets) => {
      try { await page.waitForFunction((label, snippets) => { const node = [...document.querySelectorAll('[data-testid="progress-row"]')].find(row => row.querySelector("h4")?.textContent.trim() === label); const text = node?.textContent.replace(/\s+/gu, " ") ?? ""; return snippets.every(snippet => text.includes(snippet)); }, {}, label, snippets); }
      catch { await page.screenshot({ path: `${root}/.next/journey-failure.png`, fullPage: true }); assert.fail(`Expected the ${label} row to read ${JSON.stringify(snippets)}; it reads "${await row(label)}"; route ${new URL(page.url()).pathname}`); }
    };
    await waitRow("Groceries", "Target 450.00 USD", "Settled actual: 8.00 USD spent", "Pending provisional impact: 0.00 USD, none", "Remaining after settled: 442.00 USD", "Remaining after pending: 442.00 USD");
    await waitRow("Transport", "Target 200.00 USD", "Settled actual: 4.50 USD spent", "Pending provisional impact: 0.00 USD, none", "Remaining after settled: 195.50 USD", "Remaining after pending: 195.50 USD");
    await accessibility();

    // The figures survive a reload, because they are the server's and not the browser's.
    await page.reload(); await waitRow("Groceries", "Settled actual: 8.00 USD spent");

    const controls = async () => page.$$eval("button", nodes => nodes.map(node => node.textContent.trim()));

    await clickText("Groceries"); await waitText("Transactions in this category");
    assert.ok((await page.title()).includes("Category detail"));
    await waitText("Corner shop");
    // CBD-211-AC03: the item carries its sign as a word and the header speaks the same four values as the row.
    await waitText("8.00 USD spent · Everyday");
    assert.equal(await page.$eval('[data-testid="detail-settled"]', node => node.textContent.trim()), "8.00 USD spent");
    assert.equal(await page.$eval('[data-testid="detail-pending"]', node => node.textContent.trim()), "0.00 USD, none");
    assert.equal(await page.$eval('[data-testid="detail-remaining-settled"]', node => node.textContent.trim()), "442.00 USD");
    assert.equal(await page.$eval('[data-testid="detail-remaining-pending"]', node => node.textContent.trim()), "442.00 USD");

    // BFIX-01 (F-REVB-01): this row is the Groceries SHARE of a 12.50 expense split 8.00/4.50.
    // The in-place edit rewrites the whole transaction with one allocation, so offering it here
    // would silently take 4.50 away from Transport. The page refuses it and says why; removal is
    // still offered, and its label says it removes the whole expense.
    await waitText("This expense is split across 2 categories");
    assert.equal((await controls()).includes("Edit this expense"), false, "a share of a split expense offers no in-place edit");
    assert.equal((await controls()).includes("Remove this whole expense"), true);
    await accessibility();

    // A single-category expense is the whole expense, so it does edit in place.
    await clickText("Back to the budget"); await waitText("Accounts and spending");
    await fill("#expense-date", periodStart);
    await fill("#expense-amount", "3.00");
    await fill("#expense-description", "Milk");
    await fill(allocationIds[0], "3.00");
    await clickText("Record expense"); await waitText("Expense recorded.");
    await waitRow("Groceries", "Settled actual: 11.00 USD spent", "Remaining after settled: 439.00 USD");

    await clickText("Groceries"); await waitText("Transactions in this category");
    await waitText("Milk");
    await clickText("Edit this expense");
    const amountId = await page.$eval('input[id^="edit-amount-"]', node => `#${node.id}`);
    await fill(amountId, "20.00");
    await clickText("Save expense"); await waitText("Expense updated.");
    await waitText("20.00 USD spent · Everyday");
    // The split share is untouched by that edit: it is still there, and still 8.00.
    await waitText("8.00 USD spent · Everyday");
    await accessibility();

    await clickText("Remove this expense"); await waitText("Expense removed.");
    await clickText("Remove this whole expense"); await waitText("Expense removed.");
    await waitText("Nothing has been recorded against this category for the active period.");
    await accessibility();

    await clickText("Back to the budget"); await waitText("Accounts and spending");
    // CBD-211-AC04: a category with nothing recorded against it says so in words.
    await waitRow("Groceries", "Settled actual: 0.00 USD, no activity", "Remaining after settled: 450.00 USD", "Remaining after pending: 450.00 USD");

    // CBD-196-AC04: archival is lifecycle, and restore brings the account back.
    await clickText("Archive Everyday"); await waitText("Archived Everyday.");
    await waitText("Everyday · Archived");
    await clickText("Restore Everyday"); await waitText("Restored Everyday.");
    await accessibility();
    assert.deepEqual(errors, []);
  });

  // CBD-200-F03/CBD-266-F04 (WF3-02): the mock models the CBD-200 precondition and the 429 the live
  // API has, so the browser suite can exercise the client paths against it directly -- a stale basis,
  // a repeated Idempotency-Key, and a second in-flight write by the same session -- through the same
  // in-browser fetch the production client issues, on this same signed-in session.
  await t.test("CBD-200-F03/CBD-266-F04: the mock answers stale_version, a repeated key replays, and a second in-flight write is 429", async () => {
    requireBudget();
    const outcome = await page.evaluate(async (id) => {
      const csrf = (await (await fetch("/api/mock/v1/identity/me")).json()).csrfValue;
      const write = (path, method, body, idempotencyKey) => fetch(`/api/mock${path}`, {
        method, headers: { "content-type": "application/json", "x-cobudget-csrf": csrf, ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
        body: JSON.stringify(body),
      }).then(async (response) => ({ status: response.status, retryAfter: response.headers.get("Retry-After"), body: await response.json().catch(() => null) }));

      const detail = await (await fetch(`/api/mock/v1/budget-spaces/${id}`)).json();
      const periodId = detail.activePeriod.periodId; const periodStart = detail.activePeriod.start;
      const plan = await (await fetch(`/api/mock/v1/budget-spaces/${id}/plan?periodId=${periodId}`)).json();
      const categoryId = plan.categories[0].categoryId;
      const accounts = await (await fetch(`/api/mock/v1/budget-spaces/${id}/accounts`)).json();
      const accountId = accounts.accounts[0].accountId;
      const body = { accountId, amountMinorUnits: -700, budgetDate: periodStart, description: "WF3-02 precondition check", allocations: [{ categoryId, amountMinorUnits: -700 }] };

      // A repeated Idempotency-Key answers the stored first result: same transaction, same version, both 201.
      const first = await write(`/v1/budget-spaces/${id}/transactions`, "POST", body, "wf3-02-replay-key");
      const replay = await write(`/v1/budget-spaces/${id}/transactions`, "POST", body, "wf3-02-replay-key");
      const transactionId = first.body.current.version.transactionId; const versionId = first.body.current.version.transactionVersionId;

      // A stale basis is refused 409 stale_version, with the current version in the error and nothing written.
      const stale = await write(`/v1/budget-spaces/${id}/transactions/${transactionId}`, "PATCH", { ...body, expectedTransactionVersionId: "not-the-current-version" });
      const readBack = await (await fetch(`/api/mock/v1/budget-spaces/${id}/periods/${periodId}/progress/${categoryId}`)).json();
      const untouchedRevision = readBack.items.find((item) => item.transactionId === transactionId)?.amountMinorUnits;

      // The stated basis is admitted, and the edit takes effect.
      const admitted = await write(`/v1/budget-spaces/${id}/transactions/${transactionId}`, "PATCH", { ...body, amountMinorUnits: -750, allocations: [{ categoryId, amountMinorUnits: -750 }], expectedTransactionVersionId: versionId });

      // A second, genuinely concurrent write from this same session is 429 in_flight with Retry-After while the first is still in progress.
      const raceBody = { accountId, amountMinorUnits: -100, budgetDate: periodStart, description: "WF3-02 race", allocations: [{ categoryId, amountMinorUnits: -100 }] };
      const [raceA, raceB] = await Promise.all([
        write(`/v1/budget-spaces/${id}/transactions`, "POST", raceBody, "wf3-02-race-a"),
        write(`/v1/budget-spaces/${id}/transactions`, "POST", raceBody, "wf3-02-race-b"),
      ]);
      return { first, replay, transactionId, stale, untouchedRevision, admitted, raceA, raceB };
    }, budgetId);

    assert.equal(outcome.first.status, 201);
    assert.equal(outcome.replay.status, 201);
    assert.equal(outcome.replay.body.current.version.transactionId, outcome.transactionId, "the repeated key answers the stored first result");
    assert.deepEqual(outcome.replay.body, outcome.first.body, "byte-identical replay, not a second write");

    assert.equal(outcome.stale.status, 409);
    assert.equal(outcome.stale.body.error, "stale_version");
    assert.equal(typeof outcome.stale.body.current?.transactionVersionId, "string");
    assert.equal(outcome.stale.body.current.revision, 1);
    assert.equal(outcome.untouchedRevision, -700, "the stale write left the stored amount unchanged");

    assert.equal(outcome.admitted.status, 200);
    assert.equal(outcome.admitted.body.current.version.revision, 2);

    const statuses = [outcome.raceA.status, outcome.raceB.status].sort();
    assert.deepEqual(statuses, [201, 429], "exactly one of the two concurrent writes is admitted");
    const loser = outcome.raceA.status === 429 ? outcome.raceA : outcome.raceB;
    assert.deepEqual(loser.body, { outcome: "retry", reason: "in_flight" });
    assert.equal(loser.retryAfter, "1");
  });

  const detailResponse = await page.evaluate(async id => (await fetch(`/api/mock/v1/budget-spaces/${id}`)).json(), budgetId);
  let scenario = null;
  await page.setRequestInterception(true);
  page.on("request", request => {
    if (scenario && new URL(request.url()).pathname === `/api/mock/v1/budget-spaces/${budgetId}`) {
      const selected = scenario;
      void (async () => {
        if (selected.delay) await pause(selected.delay);
        try { await request.respond({ status: selected.status ?? 200, contentType: "application/json", body: JSON.stringify(selected.body ?? detailResponse) }); } catch { /* A cancelled navigation discards this response. */ }
      })();
    } else void request.continue();
  });
  // The merged API detail carries no staleness signal (API-ASSUMPTIONS.md), so the stale shell state is not reachable from a response;
  // a partial response is one missing a required section (here the schedule version).
  for (const [label, body, expected] of [
    ["empty", { ...detailResponse, activePeriod: null }, "No active period"],
    ["partial", { ...detailResponse, scheduleVersion: null }, "Budget details are incomplete"],
  ]) await t.test(`CBD-218-AC02/AC03: ${label}`, async () => {
    requireBudget(); scenario = { body }; await clickText("Refresh budget"); await waitText(expected); await accessibility();
    if (label !== "empty") assert.equal(await page.$("#plan-heading"), null);
  });
  for (const [label, status, expected] of [["denied", 403, "Access unavailable"], ["recoverable", 503, "Unable to load this budget"], ["terminal", 404, "Budget unavailable"]]) await t.test(`CBD-218-AC02: ${label}`, async () => {
    requireBudget(); scenario = { status, body: { error: label } }; await clickText("Refresh budget"); await waitText(expected); await accessibility();
  });
  await t.test("CBD-218-AC02: loading, refreshed and success", async () => {
    requireBudget(); scenario = { delay: 1000 }; await clickText("Refresh budget"); await waitText("Loading the active budget period");
    await waitText("Budget refreshed."); scenario = null; await page.reload(); await waitText("The active budget period is ready.");
  });
  await t.test("CBD-218-AC04: navigation discards a slow response from another budget", async () => {
    requireBudget(); scenario = { delay: 1200, body: { ...detailResponse, space: { ...detailResponse.space, name: "Stale response marker" } } };
    await clickText("Refresh budget"); await waitText("Loading the active budget period");
    await clickText("Your budgets"); await waitText("Create a budget"); await pause(1400);
    assert.equal((await text()).includes("Stale response marker"), false); scenario = null;
  });
  await t.test("CBD-218-AC05: keyboard, title, main focus, 320px reflow", async () => {
    requireBudget(); await clickText("Our household"); await waitText("The active budget period is ready.");
    assert.ok((await page.title()).includes("Budget dashboard"));
    assert.equal(await page.evaluate(() => document.activeElement?.id), "app-main");
    assert.equal(await page.$$eval("main", nodes => nodes.length), 1);
    assert.ok(await page.$('nav[aria-label="Budgets"]'));
    assert.ok((await page.$$eval('[role="status"]', nodes => nodes.map(node => node.textContent))).some(value => value.includes("active budget period is ready")));
    await page.keyboard.press("Tab"); assert.notEqual(await page.evaluate(() => document.activeElement?.tagName), "BODY");
    await page.setViewport({ width: 320, height: 800 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await accessibility();
    // 1280x900 physical pixels at 400%: 320x225 CSS pixels, including media queries.
    await page.setViewport({ width: 320, height: 225, deviceScaleFactor: 4 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await accessibility();
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    scenario = { status: 503, body: { error: "recoverable" } };
    await clickText("Refresh budget"); await waitText("Unable to load this budget");
    await page.evaluate(() => document.getElementById("app-main").focus());
    for (let step = 0; step < 30; step++) {
      await page.keyboard.press("Tab");
      if (await page.evaluate(() => document.activeElement?.textContent === "Try again")) break;
    }
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Try again");
    scenario = null; await page.keyboard.press("Enter"); await waitText("Budget refreshed.");
  });
  await t.test("PROTO-SIGNIN-01: sign-out returns to public landing and denies refresh", async () => {
    await clickText("Sign out"); await page.waitForFunction(() => location.pathname === "/");
    await page.goto(`${origin}/budgets`); await page.waitForFunction(() => location.pathname === "/sign-in");
    await page.goto(`${origin}/identity/result?outcome=untrusted-provider-detail`);
    await waitText("Sign-in did not complete");
    assert.equal((await text()).includes("untrusted-provider-detail"), false); await accessibility();
  });
  // JOURNEY REGISTRY -- append-only. Each entry is an async journey(t, {browser, origin, errors}) awaited in
  // order on this same development server, after the shared setup above. Next packet: add your journey as the
  // next entry.
  const JOURNEY_REGISTRY = [
    // PK-8: the invitation ceremony, members, notices and the Primary transfer.
    pk8Journey,
  ];
  for (const journey of JOURNEY_REGISTRY) await journey(t, { browser, origin, errors });
  assert.deepEqual(errors, []);
});
