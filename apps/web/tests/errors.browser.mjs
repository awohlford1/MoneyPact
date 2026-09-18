/**
 * UI-P07 (gap G12, OQ-UI-18): the shared `(app)`/`(public)` route-level failure boundaries --
 * `not-found.tsx` and `error.tsx`, both built on `../src/ui/resource.tsx`'s `classifyFailure`/
 * `PageUnavailable`/`DeniedState` -- against a real navigation in headless Chrome.
 *
 * Five cases: a genuine 404, a permission-shaped denial (a thrown 403) textually and visually identical
 * to the 404 (no existence leak, CBD-306-AC05, CBD-243-AC07); a thrown 500 (recoverable, offers "Try
 * again"); a thrown 401 (session loss routes to sign-in, with no leaked destination text); and the uniform
 * throttled response (429) with its own honest, distinct label. The `(public)` group's own `not-found.tsx`
 * is proven too.
 *
 * None of this needs a signed-in session: every target here (`/diagnostics/*`, `/mission/*`) sits outside
 * `/budgets` and `/notices`, the only two subtrees `SessionProvider` wraps (`apps/web/src/app/(app)/budgets/
 * layout.tsx`, `.../notices/layout.tsx`).
 *
 * Not a test file of its own: `browser.test.mjs` starts the one `next dev` server and calls
 * `errorsJourney` with its browser, exactly as it calls `accountsJourney`.
 */
import assert from "node:assert/strict";

export async function errorsJourney(t, { browser, origin, errors }) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", error => errors.push(error.message));

  const text = async () => page.$eval("main", node => node.textContent);
  const waitText = async value => {
    try { await page.waitForFunction(value => document.querySelector("main")?.textContent.includes(value), {}, value); }
    catch { assert.fail(`Expected ${JSON.stringify(value)}; route ${new URL(page.url()).pathname}; visible content: ${await text()}`); }
  };
  const hasButton = async label => {
    const handles = await page.$$("button");
    for (const handle of handles) if ((await handle.evaluate(node => node.textContent.trim())) === label) return true;
    return false;
  };

  let notFoundHtml;
  await t.test("UI-P07-AC01: a genuine 404 (an unmatched route inside (app), reached through Next's own notFound()) renders the shared uniform sentence", async () => {
    await page.goto(`${origin}/diagnostics/does-not-exist`);
    await waitText("Page unavailable");
    await waitText("This page is no longer here, or it is not yours to open.");
    notFoundHtml = await page.$eval("main", node => node.innerHTML);
  });

  await t.test("UI-P07-AC02: a permission-shaped denial (a thrown 403) renders byte-identical markup to the 404 -- no existence leak", async () => {
    await page.goto(`${origin}/diagnostics/boundary?status=403`);
    await waitText("Page unavailable");
    const deniedHtml = await page.$eval("main", node => node.innerHTML);
    assert.equal(deniedHtml, notFoundHtml, "a literal 404 and a permission-shaped denial must render identical markup");
  });

  await t.test("UI-P07-AC03: the uniform throttled response (429) gets its own honest label, distinct from the uniform denial and from a plain error", async () => {
    await page.goto(`${origin}/diagnostics/boundary?status=429`);
    await waitText("Too many requests");
    await waitText("Try again in a moment");
    const current = await text();
    assert.equal(current.includes("Page unavailable"), false, "a throttle is not the uniform not-here sentence");
    assert.equal(current.includes("Unable to load this page"), false, "a throttle is not a plain recoverable error either");
  });

  await t.test("UI-P07-AC03: a thrown 500 uses the existing recoverable classification and offers Try again", async () => {
    await page.goto(`${origin}/diagnostics/boundary?status=500`);
    await waitText("Unable to load this page");
    assert.ok(await hasButton("Try again"), "a recoverable failure must offer Try again");
  });

  await t.test("UI-P07: a thrown 401 (session loss) routes to sign-in, with no leaked destination text", async () => {
    await page.goto(`${origin}/diagnostics/boundary?status=401`);
    await page.waitForFunction(() => location.pathname === "/sign-in");
    assert.equal((await text()).includes("diagnostics"), false, "the sign-in destination must carry no leaked route text");
  });

  await t.test("UI-P07: an unmatched top-level URL reaches the (public) group's own not-found (a real visitor's default, not just (app)'s)", async () => {
    await page.goto(`${origin}/no-such-public-page-at-all`);
    await waitText("Page unavailable");
    await waitText("This page is no longer here, or it is not yours to open.");
  });

  assert.deepEqual(errors, []);
}
