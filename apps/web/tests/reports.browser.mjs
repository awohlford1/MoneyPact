/**
 * UI-P04 (CBD-358, contract CBD-355): category and period reports at `/budgets/[id]/reports` in headless Chrome
 * against the mock. Not a test file of its own -- `browser.test.mjs` starts the one development server and
 * calls `reportsJourney` with its browser, exactly as it calls `pk8Journey`.
 *
 * This journey drives the report through a planned category with no recorded activity (accounts and manual
 * transactions are UI-P02/UI-P03's own routes, not yet in this worktree), so "Settled" reads "no activity"
 * throughout; the reconciliation against a non-zero settled figure is exercised instead in `reports.test.ts`,
 * which drives the mock directly and can record an expense through the existing `ApiClient`.
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
    catch { await page.screenshot({ path: `${root}/.next/reports-failure.png`, fullPage: true }); assert.fail(`Expected ${JSON.stringify(value)}; route ${new URL(page.url()).pathname}; visible synthetic test content: ${await text()}`); }
  };
  // Waits for the control to exist before querying for it: this journey runs last, after the rest of the
  // suite's heavy traffic on the one shared development server, and a one-shot query can outrun hydration.
  const clickText = async label => {
    try { await page.waitForFunction(label => [...document.querySelectorAll("button, a")].some(node => node.textContent.trim() === label), {}, label); }
    catch { await page.screenshot({ path: `${root}/.next/reports-failure.png`, fullPage: true }); assert.fail(`Missing control: ${label}; route ${new URL(page.url()).pathname}; visible synthetic test content: ${await text()}`); }
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
  const accessibility = async () => {
    await page.evaluate(axeSource);
    const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector("main"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })));
    assert.deepEqual(violations, [], `axe on ${new URL(page.url()).pathname}`);
  };
  /** CBD-358-AC05: 320 px reflow, no two-dimensional page scrolling. */
  const narrow = async () => {
    await page.setViewport({ width: 320, height: 800 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${new URL(page.url()).pathname} scrolls horizontally at 320px`);
    await accessibility();
    await page.setViewport({ width: 1280, height: 900 });
  };
  /** The 400 %-zoom equivalent the rest of the suite already uses. */
  const zoomed = async () => {
    await page.setViewport({ width: 320, height: 225, deviceScaleFactor: 4 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${new URL(page.url()).pathname} scrolls horizontally at 320x225 dsf4`);
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  };
  return { page, text, waitText, clickText, fill, accessibility, narrow, zoomed };
}

export async function reportsJourney(t, { browser, origin, errors }) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const d = driver(page, errors);

  await t.test("CBD-358-AC01/AC03: a budget with a planned category shows a populated report, every figure server-formatted and labelled in text", async () => {
    await page.goto(`${origin}/sign-in`); await d.clickText("Continue to sign in");
    await page.waitForFunction(() => location.pathname === "/budgets");
    await d.clickText("Create a budget"); await d.waitText("Budget and schedule");
    await page.type('[id="field-name"]', "Reports household"); await d.waitText("Complete current period");
    await page.click('[id="field-acknowledged-disclosure"]');
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some(node => node.textContent === "Confirm and create budget" && !node.disabled));
    await d.clickText("Confirm and create budget"); await d.waitText("No categories yet");

    await d.clickText("Edit category plan"); await d.waitText("Category plan");
    await d.fill("#category-name", "Groceries"); await d.clickText("Add category");
    await d.waitText("Groceries");
    await d.fill('[id^="target-"]', "100.00"); await d.clickText("Save target");
    await d.waitText("Period target: 100.00 USD");

    // CBD-35: Reports is a real destination in BudgetTabs's registry, so the packet order's own extension
    // point is under test here too, not just the surface it points at.
    assert.ok(await page.$('nav[aria-label="Budget sections"]'));
    await d.clickText("Reports"); await d.waitText("Periods");
    await page.waitForFunction(() => document.title.includes("Reports"));
    assert.equal(await page.$$eval('nav[aria-label="Budget sections"] [aria-current="page"]', nodes => nodes.length), 1, "exactly one Budget sections tab must be current on the reports page");
    assert.equal(await page.$eval('nav[aria-label="Budget sections"] [aria-current="page"]', node => node.textContent.trim()), "Reports");

    await d.waitText("Categories");
    await d.waitText("100.00 USD"); // the planned figure, formatted server-side (CBD-358-AC01)
    await d.waitText("no activity"); // CBD-358-AC03: settled is a word, never a bare zero or a colour
    await d.waitText("Data as of");
    await d.waitText("Showing the current period");
    await d.waitText("Showing all 1 category.");
    await d.accessibility(); await d.narrow(); await d.zoomed();
  });

  await t.test("CBD-358-AC02: the category filter states its exact selection and its result scope in text", async () => {
    const options = await page.$$eval("#report-category option", nodes => nodes.map(node => ({ value: node.value, label: node.textContent })));
    const groceries = options.find(option => option.label === "Groceries");
    assert.ok(groceries, "the category filter lists the category by its own label");
    await page.select("#report-category", groceries.value);
    await d.waitText("Showing one category.");
    await page.select("#report-category", "all");
    await d.waitText("Showing all 1 category.");
  });

  await t.test("CBD-358-AC05: a category-read failure keeps the periods region intact, and the filter selection survives retry", async () => {
    const options = await page.$$eval("#report-category option", nodes => nodes.map(node => node.value));
    await page.select("#report-category", options.find(value => value !== "all"));
    await page.setRequestInterception(true);
    const onRequest = request => {
      if (request.url().includes("/reports/categories")) { request.respond({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "recoverable" }) }); return; }
      request.continue();
    };
    page.on("request", onRequest);
    await d.clickText("Refresh reports");
    await d.waitText("Unable to load categories");
    // The periods region is untouched by the categories failure: its own heading and figures are still shown.
    await d.waitText("Periods");
    await d.waitText("100.00 USD");
    page.off("request", onRequest);
    await page.setRequestInterception(false);
    await d.clickText("Try again");
    // "no activity" alone is not conclusive: the periods table already shows it while categories are still
    // failed, so wait for the category filter itself to come back (it is absent for the whole error branch).
    await page.waitForSelector("#report-category");
    // CBD-358-AC02: a recoverable retry preserves the filter selection rather than resetting to "All categories".
    assert.equal(await page.$eval("#report-category", node => node.value), options.find(value => value !== "all"));
  });

  await context.close();
}
