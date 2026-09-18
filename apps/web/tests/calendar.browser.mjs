/**
 * UI-P06 (CBD-323, event contract CBD-321; UI-BUILD-PLAN.md section 4.6): the financial calendar at
 * `/budgets/[id]/calendar` in headless Chrome against the mock. Not a test file of its own -- `browser.test.mjs`
 * starts the one development server and calls `calendarJourney` with its browser, exactly as it calls
 * `reportsJourney`.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const axeSource = readFileSync(fileURLToPath(import.meta.resolve("axe-core/axe.min.js")), "utf8");

function driver(page, errors, name) {
  page.setDefaultTimeout(20000);
  page.on("pageerror", error => errors.push(error.message));
  const text = async () => page.$eval("main", node => node.textContent);
  const waitText = async value => {
    try { await page.waitForFunction(value => document.querySelector("main")?.textContent.includes(value), {}, value); }
    catch { await page.screenshot({ path: `${root}/.next/${name}-failure.png`, fullPage: true }); assert.fail(`Expected ${JSON.stringify(value)}; route ${new URL(page.url()).pathname}; visible synthetic test content: ${await text()}`); }
  };
  const clickText = async label => {
    try { await page.waitForFunction(label => [...document.querySelectorAll("button, a")].some(node => node.textContent.trim() === label), {}, label); }
    catch { await page.screenshot({ path: `${root}/.next/${name}-failure.png`, fullPage: true }); assert.fail(`Missing control: ${label}; route ${new URL(page.url()).pathname}; visible synthetic test content: ${await text()}`); }
    const handles = await page.$$("button, a");
    for (const handle of handles) if ((await handle.evaluate(node => node.textContent.trim())) === label) { await handle.scrollIntoView(); await handle.click(); return; }
    assert.fail(`Missing control: ${label}`);
  };
  const accessibility = async () => {
    await page.evaluate(axeSource);
    const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector("main"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })));
    assert.deepEqual(violations, [], `axe on ${new URL(page.url()).pathname}`);
  };
  /** CBD-323-AC05: 320 px reflow, no two-dimensional page scrolling. */
  const narrow = async () => {
    await page.setViewport({ width: 320, height: 800 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${new URL(page.url()).pathname} scrolls horizontally at 320px`);
    await accessibility();
    await page.setViewport({ width: 1280, height: 900 });
  };
  const zoomed = async () => {
    await page.setViewport({ width: 320, height: 225, deviceScaleFactor: 4 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${new URL(page.url()).pathname} scrolls horizontally at 320x225 dsf4`);
    // REV-UIP06-4: axe at 320x225@dsf4 too, matching `narrow()`'s own 320px pass -- the plan requires all
    // three viewports (default/320/320x225@dsf4), and this call was missing.
    await accessibility();
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  };
  return { page, text, waitText, clickText, accessibility, narrow, zoomed };
}

/** Signs in and creates a budget under the *real* device clock and time zone, returning its id -- deliberately
 * separate from navigating to the calendar route, so a caller that wants to emulate a different device clock
 * for the calendar page itself (CBD-323-AC02) does not also apply that emulation to the creation form, which
 * has its own, unrelated schedule preview that a faked `Date` breaks. */
async function createBudgetAs(origin, page, d, name) {
  await page.goto(`${origin}/sign-in`); await d.clickText("Continue to sign in");
  await page.waitForFunction(() => location.pathname === "/budgets");
  await d.clickText("Create a budget"); await d.waitText("Budget and schedule");
  await page.type('[id="field-name"]', name); await d.waitText("Complete current period");
  await page.click('[id="field-acknowledged-disclosure"]');
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some(node => node.textContent === "Confirm and create budget" && !node.disabled));
  await d.clickText("Confirm and create budget"); await d.waitText("No categories yet");
  return new URL(page.url()).pathname.split("/").pop();
}

async function goToCalendar(origin, page, d, budgetSpaceId) {
  await page.goto(`${origin}/budgets/${budgetSpaceId}/calendar`);
  await d.waitText("Go to month");
}

export async function calendarJourney(t, { browser, origin, errors }) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const d = driver(page, errors, "calendar");

  let todayCellDate;

  await t.test("CBD-323-AC01/AC04: the calendar opens on the current month, the current date is identified in text, and the grid is a real table with no keyboard trap", async () => {
    const budgetSpaceId = await createBudgetAs(origin, page, d, "Calendar household");
    await goToCalendar(origin, page, d, budgetSpaceId);
    // CBD-35: Calendar is a real destination in BudgetTabs's registry.
    assert.ok(await page.$('nav[aria-label="Budget sections"]'));
    assert.equal(await page.$$eval('nav[aria-label="Budget sections"] [aria-current="page"]', nodes => nodes.length), 1);
    assert.equal(await page.$eval('nav[aria-label="Budget sections"] [aria-current="page"]', node => node.textContent.trim()), "Calendar");

    await page.waitForSelector('table[role="grid"]');
    const current = await page.waitForSelector('[aria-current="date"]');
    todayCellDate = await current.evaluate(node => node.getAttribute("data-testid").replace("calendar-cell-", ""));
    const label = await current.evaluate(node => node.getAttribute("aria-label"));
    assert.match(label, /Today/, "the current date names itself as Today in text, not only by style");

    // Roving tabindex: exactly one date button is Tab-reachable at a time.
    const tabbable = await page.$$eval('table[role="grid"] button[tabindex="0"]', nodes => nodes.length);
    assert.equal(tabbable, 1, "exactly one grid cell carries tabindex 0 (roving tabindex)");

    // No grid trap: Tab from the focused cell leaves the grid entirely.
    await current.evaluate(node => node.focus());
    await page.keyboard.press("Tab");
    const stillInGrid = await page.evaluate(() => Boolean(document.activeElement?.closest('table[role="grid"]')));
    assert.equal(stillInGrid, false, "Tab must leave the calendar grid rather than moving to the next cell");
  });

  await t.test("CBD-323-AC04: arrow keys move within the grid, Enter opens the date's detail, and focus returns to the originating cell on close", async () => {
    const current = await page.$(`[data-testid="calendar-cell-${todayCellDate}"]`);
    await current.evaluate(node => node.focus());
    await page.keyboard.press("ArrowRight");
    const active = await page.evaluate(() => document.activeElement?.getAttribute("data-testid"));
    assert.notEqual(active, `calendar-cell-${todayCellDate}`, "ArrowRight moved focus to a different date cell");

    await page.keyboard.press("ArrowLeft"); // back onto today's cell
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector("dialog[open]") !== null);
    assert.ok(await page.$("dialog[open]"));
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelector("dialog[open]") === null);
    const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-testid"));
    assert.equal(focused, `calendar-cell-${todayCellDate}`, "closing the dialog returns focus to the originating cell");
  });

  await t.test("CBD-323-AC01: switching to Agenda shows the same events, and Today survives the switch", async () => {
    // Every event kind's label the month grid currently shows -- the agenda must show the exact same set,
    // never more or fewer, since both are two projections of the one already-fetched `events` array
    // (`monthGridCells`/`agendaGroups` in `../../../../../api/calendar`, unit-tested directly in
    // `calendar.test.ts`'s CBD-323-AC01 case). Today itself need not appear in the agenda: the agenda lists
    // only dates that carry an event, and today carries one only when a period boundary or payday lands on it.
    const gridEventLabels = (await page.$$eval('table[role="grid"] button span.text-xs', nodes => nodes.map(node => node.textContent))).sort();
    await d.clickText("Agenda");
    await page.waitForSelector('ol[aria-label="Agenda"]');
    const agendaEventLabels = (await page.$$eval('ol[aria-label="Agenda"] li > ul > li', nodes => nodes.map(node => node.textContent.split(" · ")[0]))).sort();
    assert.deepEqual(agendaEventLabels, gridEventLabels, "the agenda shows exactly the events the month grid showed");
    await d.clickText("Month");
    await page.waitForSelector('table[role="grid"]');
    assert.ok(await page.$(`[data-testid="calendar-cell-${todayCellDate}"][aria-current="date"]`), "Today is still marked after switching presentations and back");
    await d.accessibility(); await d.narrow(); await d.zoomed();
  });

  await context.close();

  // CBD-323-AC02: Today must not move under a different device time zone and clock offset. A second, isolated
  // browser context creates its own budget under the *real* device clock (the creation form's own schedule
  // preview needs a real `Date`, unrelated to this proof), then emulates a device time zone far from the
  // budget's own (America/New_York, the creation form's default) and a clock pushed 400 days into the future
  // only for the fresh navigation to the calendar route -- the calendar reads `today` from the server's
  // response, never `Date.now()`/`new Date()` (CBD-323-AC02's own unit-test grep in `calendar.test.ts`), so the
  // two contexts must land on the same Today.
  const emulatedContext = await browser.createBrowserContext();
  const emulatedPage = await emulatedContext.newPage();
  const emulatedDriver = driver(emulatedPage, errors, "calendar-emulated");
  await t.test("CBD-323-AC02: Today does not move under an emulated device time zone and a 400-day clock offset", async () => {
    const budgetSpaceId = await createBudgetAs(origin, emulatedPage, emulatedDriver, "Calendar household, emulated clock");
    await emulatedPage.emulateTimezone("Pacific/Kiritimati"); // UTC+14, and far from the budget's America/New_York
    await emulatedPage.evaluateOnNewDocument(() => {
      const offsetMs = 400 * 24 * 60 * 60 * 1000;
      const RealDate = Date;
      class EmulatedDate extends RealDate {
        constructor(...args) {
          super(...(args.length === 0 ? [RealDate.now() + offsetMs] : args));
        }
        static now() { return RealDate.now() + offsetMs; }
      }
      window.Date = EmulatedDate;
    });
    await goToCalendar(origin, emulatedPage, emulatedDriver, budgetSpaceId);
    const current = await emulatedPage.waitForSelector('[aria-current="date"]');
    const emulatedTodayDate = await current.evaluate(node => node.getAttribute("data-testid").replace("calendar-cell-", ""));
    assert.equal(emulatedTodayDate, todayCellDate, "the emulated device's time zone and clock offset must not move Today");
  });
  await emulatedContext.close();
}
