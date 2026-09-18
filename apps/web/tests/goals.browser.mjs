/**
 * UI-P05 (CBD-341 AC01-AC05): savings goals at `/budgets/[id]/goals` in headless Chrome against the mock. Not
 * a test file of its own -- `browser.test.mjs` starts the one development server and calls `goalsJourney` with
 * its browser, exactly as it calls `reportsJourney`.
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
    catch { await page.screenshot({ path: `${root}/.next/goals-failure.png`, fullPage: true }); assert.fail(`Expected ${JSON.stringify(value)}; route ${new URL(page.url()).pathname}; visible synthetic test content: ${await text()}`); }
  };
  const clickText = async label => {
    try { await page.waitForFunction(label => [...document.querySelectorAll("button, a")].some(node => node.textContent.trim() === label), {}, label); }
    catch { await page.screenshot({ path: `${root}/.next/goals-failure.png`, fullPage: true }); assert.fail(`Missing control: ${label}; route ${new URL(page.url()).pathname}; visible synthetic test content: ${await text()}`); }
    const handles = await page.$$("button, a");
    for (const handle of handles) if ((await handle.evaluate(node => node.textContent.trim())) === label) { await handle.scrollIntoView(); await handle.click(); return; }
    assert.fail(`Missing control: ${label}`);
  };
  // Waits for a control to appear, the same way `clickText` does internally, but only to assert presence --
  // used where a re-render (a mutation's own refresh) can lag the state check by a tick, which an immediate
  // `page.evaluate` right after `waitText` can lose the race against.
  const controlPresent = async label => {
    try { await page.waitForFunction(label => [...document.querySelectorAll("button, a")].some(node => node.textContent.trim() === label), {}, label); return true; }
    catch { return false; }
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
  const narrow = async () => {
    await page.setViewport({ width: 320, height: 800 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${new URL(page.url()).pathname} scrolls horizontally at 320px`);
    await accessibility();
    await page.setViewport({ width: 1280, height: 900 });
  };
  const zoomed = async () => {
    await page.setViewport({ width: 320, height: 225, deviceScaleFactor: 4 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${new URL(page.url()).pathname} scrolls horizontally at 320x225 dsf4`);
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  };
  return { page, text, waitText, clickText, controlPresent, fill, accessibility, narrow, zoomed };
}

export async function goalsJourney(t, { browser, origin, errors }) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const d = driver(page, errors);

  await t.test("CBD-341-AC01/AC04: an empty goals surface, then a created goal shows every figure as a labelled value with a text progress statement", async () => {
    await page.goto(`${origin}/sign-in`); await d.clickText("Continue to sign in");
    await page.waitForFunction(() => location.pathname === "/budgets");
    await d.clickText("Create a budget"); await d.waitText("Budget and schedule");
    await page.type('[id="field-name"]', "Goals household"); await d.waitText("Complete current period");
    await page.click('[id="field-acknowledged-disclosure"]');
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some(node => node.textContent === "Confirm and create budget" && !node.disabled));
    await d.clickText("Confirm and create budget"); await d.waitText("No categories yet");

    assert.ok(await page.$('nav[aria-label="Budget sections"]'));
    await d.clickText("Goals"); await d.waitText("No savings goals yet");
    await page.waitForFunction(() => document.title.includes("Goals"));
    assert.equal(await page.$$eval('nav[aria-label="Budget sections"] [aria-current="page"]', nodes => nodes.length), 1, "exactly one Budget sections tab must be current on the goals page");
    assert.equal(await page.$eval('nav[aria-label="Budget sections"] [aria-current="page"]', node => node.textContent.trim()), "Goals");
    await d.accessibility();

    await d.fill("#goal-create-label", "Emergency fund");
    await d.fill("#goal-create-target", "500.00");
    await d.clickText("Add goal");
    await d.waitText("Emergency fund");
    await d.waitText("500.00 USD"); // the target, rendered as its own labelled value
    await d.waitText("In progress");
    await d.accessibility(); await d.narrow(); await d.zoomed();
  });

  await t.test("REV-UIP05-1/12: a validation error on the create-goal form focuses the invalid field and preserves the rest", async () => {
    await d.fill("#goal-create-label", "");
    await d.fill("#goal-create-target", "250.00");
    await d.clickText("Add goal");
    await d.waitText("Enter a name between 1 and 120 characters.");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "goal-create-label", "focus must move to the invalid field");
    assert.equal(await page.$eval("#goal-create-target", node => node.value), "250.00", "an untouched field must keep its entered value");
    await d.accessibility();
    await d.fill("#goal-create-label", ""); await d.fill("#goal-create-target", "");
  });

  await t.test("CBD-341-AC02/AC03: recording a contribution carries the standing intent sentence, updates progress and the ledger, without ever reporting an unsaved mutation as saved", async () => {
    await d.clickText("Open Emergency fund"); await d.waitText("Goal detail");
    await d.waitText("Recording a contribution records your intent. MoneyPact moves no money.");
    await d.fill("#contribution-amount", "142.00");
    await d.clickText("Record a contribution");
    await d.waitText("142.00 of 500.00 USD saved; 358.00 USD remaining");
    await d.waitText("Contribution recorded.");
    await d.waitText("Contributions recorded for Emergency fund");
    await d.accessibility();
  });

  await t.test("CBD-341-AC01/AC04: a contribution past the target names the excess as its own labelled value and the state becomes completed", async () => {
    await d.fill("#contribution-amount", "400.00");
    await d.clickText("Record a contribution");
    await d.waitText("exceeded by 42.00 USD");
    await d.waitText("Completed");
    await d.accessibility();
  });

  await t.test("CBD-341-AC04: reversing a contribution shows exact before/after values and the ledger keeps the entry, marked reversed", async () => {
    await d.clickText("Reverse");
    await d.waitText("Reverse this contribution?");
    await d.clickText("Reverse contribution");
    await d.waitText("Progress after: 142.00 USD of 500.00 USD.");
    await d.waitText("Reversed");
    await d.waitText("In progress");
    await d.accessibility();
  });

  await t.test("CBD-341-AC04: a target reduction below current progress is confirmed before it lands", async () => {
    await d.fill("#goal-edit-target", "100.00");
    await d.clickText("Save goal");
    await d.waitText("Set a lower target than what is already saved?");
    await d.clickText("Set the lower target");
    await d.waitText("exceeded by 42.00 USD");
    await d.accessibility();
  });

  await t.test("archiving and restoring a goal keeps its ledger and names what is kept", async () => {
    // REV-UIP05-12: a fresh, unreversed contribution before archiving, so the Reverse-hidden assertion below
    // actually tests the archive-hides-it fix -- without one, the only other unreversed entry could already
    // be gone by this point in the journey, and the control's absence would prove nothing in particular.
    await d.fill("#contribution-amount", "10.00");
    await d.clickText("Record a contribution");
    await d.waitText("Contribution recorded.");
    assert.equal(await d.controlPresent("Reverse"), true, "a live goal with an unreversed contribution offers Reverse");

    await d.clickText("Archive Emergency fund");
    await d.waitText("Archive Emergency fund?");
    await d.clickText("Archive goal");
    await d.waitText("Archived");
    assert.equal(await page.$("#contribution-amount"), null, "an archived goal offers no contribution control");
    // REV-UIP05-3/12: the same unreversed contribution recorded above is still in the ledger (it is only
    // marked reversed, never removed) -- its Reverse control disappearing here is the archive-hides-it fix,
    // not a coincidence of every contribution already being reversed.
    assert.equal(await page.evaluate(() => [...document.querySelectorAll("button")].some(node => node.textContent.trim() === "Reverse")), false, "an archived goal hides the Reverse control even though an unreversed contribution still exists");
    await d.clickText("Restore Emergency fund");
    await d.waitText("Restore Emergency fund?");
    await d.clickText("Restore goal");
    // The target was reduced below progress in an earlier sub-test, so this goal restores as completed, not
    // active -- restoring changes only `archivedAt`, never the target/progress figures that decide the rest.
    await d.waitText("Completed");
    assert.equal(await d.controlPresent("Reverse"), true, "restoring brings the Reverse control back for the still-unreversed contribution");
    // REV-UIP05-10: the same triple every other site in this file (and accounts.browser.mjs/reports.browser.mjs)
    // uses -- default-viewport axe, then 320px reflow, then the 400%-zoom-equivalent reflow. A prior round
    // replaced this call instead of adding to it, dropping the default-viewport pass; restored here.
    await d.accessibility(); await d.narrow(); await d.zoomed();
  });

  await t.test("CBD-341-AC04: keyboard-only reach into the create-goal form on the list page", async () => {
    await page.goto(`${origin}/budgets/${new URL(page.url()).pathname.split("/")[2]}/goals`); await d.waitText("Your goals");
    await page.evaluate(() => document.getElementById("app-main")?.focus());
    let reached = false;
    for (let step = 0; step < 60; step++) {
      await page.keyboard.press("Tab");
      if (await page.evaluate(() => document.activeElement?.id === "goal-create-label")) { reached = true; break; }
    }
    assert.ok(reached, "the add-goal form must be reachable by keyboard alone in DOM order");
  });

  await context.close();
}
