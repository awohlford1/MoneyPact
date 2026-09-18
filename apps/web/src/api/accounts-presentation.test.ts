import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "./client.ts";
import { accountAnnouncement, accountStateLabel, accountTypeLabel, reportAccountError } from "./accounts-presentation.ts";

test("CBD-198-AC03: accountTypeLabel names every mock account type and passes an unknown one through", () => {
  assert.equal(accountTypeLabel("checking"), "Checking");
  assert.equal(accountTypeLabel("savings"), "Savings");
  assert.equal(accountTypeLabel("cash"), "Cash");
  assert.equal(accountTypeLabel("credit-card"), "Credit card");
  assert.equal(accountTypeLabel("other"), "Other");
  assert.equal(accountTypeLabel("brokerage"), "brokerage");
});

test("CBD-198-AC03: accountStateLabel distinguishes active from archived in words", () => {
  assert.equal(accountStateLabel({ archived: false }), "Active");
  assert.equal(accountStateLabel({ archived: true }), "Archived");
});

test("CBD-198-AC02/AC03 (CBD-72 row 36): accountAnnouncement names the account and, for archive, what is kept", () => {
  assert.equal(accountAnnouncement("added", "Everyday"), "Everyday added.");
  assert.equal(accountAnnouncement("edited", "Everyday"), "Everyday updated.");
  assert.equal(accountAnnouncement("restored", "Everyday"), "Everyday restored.");
  const archived = accountAnnouncement("archived", "Everyday");
  assert.ok(archived.startsWith("Everyday archived."));
  assert.match(archived, /history is kept/u);
  assert.match(archived, /no longer appears in ordinary views, search, reports or totals/u);
});

test("CBD-198-AC02: a 400 with the server's own field errors reports as validation, field messages intact", () => {
  const error = new ApiError(400, "label_invalid", [{ path: "label", code: "label_invalid", message: "Enter a name between 1 and 120 characters." }]);
  const report = reportAccountError(error);
  assert.equal(report.kind, "validation");
  assert.deepEqual(report.fields, { label: "Enter a name between 1 and 120 characters." });
  assert.equal(report.summary, "Enter a name between 1 and 120 characters.");
});

test("CBD-198-AC02: a 400 with no field errors of its own is mapped through fieldErrorFor's canonical code", () => {
  const error = new ApiError(400, "account_type_unsupported");
  const report = reportAccountError(error);
  assert.equal(report.kind, "validation");
  assert.deepEqual(report.fields, { accountType: "Choose one of the listed account types." });
});

test("CBD-198-AC02: every 409 an account write can return is a conflict, never a validation error to blindly resubmit", () => {
  for (const code of ["label_taken", "account_archived", "account_not_archived"]) {
    const report = reportAccountError(new ApiError(409, code));
    assert.equal(report.kind, "conflict", `${code} must report as a conflict`);
    assert.ok(Object.keys(report.fields).length > 0, `${code} still names a field so the message can be shown near it`);
    assert.ok(report.summary.length > 0);
  }
});

test("CBD-198-AC02: 401 and 403 report as denied, uniform and uninformative (CBD-243-AC07)", () => {
  for (const status of [401, 403] as const) {
    const report = reportAccountError(new ApiError(status, "authorization_denied"));
    assert.equal(report.kind, "denied");
    assert.deepEqual(report.fields, {});
    assert.equal(report.summary, "Your current session cannot do this here.");
  }
});

test("CBD-198-AC02: a second 429 after the client's own retry reports as in_flight with the standing sentence", () => {
  const report = reportAccountError(new ApiError(429, "in_flight"));
  assert.equal(report.kind, "in_flight");
  assert.match(report.summary, /still saving/u);
});

test("CBD-198-AC02: a lost response (no ApiError) reports as other, with no field named", () => {
  const report = reportAccountError(new TypeError("network failure"));
  assert.equal(report.kind, "other");
  assert.deepEqual(report.fields, {});
  assert.ok(report.summary.length > 0);
});
