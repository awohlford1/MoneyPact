/**
 * CBD-196 acceptance criteria at the application layer. The live-Postgres
 * half -- that the same rules hold against the real schema -- is
 * `../persistence/increment-a.live.test.ts`.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ACCOUNT_TYPES,
  AccountError,
  archiveAccount,
  createAccount,
  editAccount,
  listAccounts,
  parseAccountCreateRequest,
  parseAccountEditRequest,
  readAccount,
  restoreAccount,
} from "./index.ts";
import type { AccountCreateRequest, AccountErrorCode } from "./index.ts";
import { ACCOUNT_SPACE_A, ACCOUNT_SPACE_B, ACCOUNT_SUBJECT_1, ACCOUNT_SUBJECT_2, accountWorld } from "./support.ts";

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { accountType: "checking", label: "Everyday", currencyCode: "USD", openingBalanceMinorUnits: 125_000, ...overrides };
}

function request(overrides: Record<string, unknown> = {}): AccountCreateRequest {
  return parseAccountCreateRequest(validBody(overrides), ACCOUNT_SUBJECT_1);
}

async function refuses(code: AccountErrorCode, work: () => unknown): Promise<void> {
  await assert.rejects(async () => { await work(); }, (error: unknown) => error instanceof AccountError && error.code === code, code);
}

function refusesSync(code: AccountErrorCode, work: () => unknown): void {
  assert.throws(work, (error: unknown) => error instanceof AccountError && error.code === code, code);
}

describe("CBD-196-AC01: creating a valid manual account", () => {
  it("persists exactly one canonical record with every required field", async () => {
    const world = accountWorld();
    const { account, previousVersion } = await createAccount(world.deps, ACCOUNT_SPACE_A, ACCOUNT_SUBJECT_1, request());
    assert.equal(previousVersion, null);
    assert.equal(world.repository.accounts.size, 1);
    assert.equal(account.budgetSpaceId, ACCOUNT_SPACE_A);
    assert.equal(account.origin, "manual");
    assert.equal(account.accountType, "checking");
    assert.equal(account.currencyCode, "USD");
    assert.equal(account.minorUnitPrecision, 2);
    assert.equal(account.openingBalanceMinorUnits, 125_000);
    assert.equal(Number.isSafeInteger(account.openingBalanceMinorUnits), true);
    assert.equal(account.ownerSubjectId, ACCOUNT_SUBJECT_1);
    assert.equal(account.createdBySubjectId, ACCOUNT_SUBJECT_1);
    assert.equal(account.archivedAt, null);
    assert.equal(account.version, 1);
    assert.match(account.accountId, /^[0-9a-f-]{36}$/u);
  });

  it("creates nothing else: the repository port has no budget, period, schedule, transaction or assignment to write", async () => {
    const world = accountWorld();
    await createAccount(world.deps, ACCOUNT_SPACE_A, ACCOUNT_SUBJECT_1, request());
    assert.deepEqual(
      Object.getOwnPropertyNames(Object.getPrototypeOf(world.repository)).filter((name) => name !== "constructor").sort(),
      ["insertAccount", "listAccounts", "readAccount", "updateAccount"],
      "the accounts repository surface is exactly four account operations",
    );
    assert.equal(world.repository.accounts.size, 1);
  });

  it("a credit card may open with a negative balance", async () => {
    const world = accountWorld();
    const { account } = await createAccount(world.deps, ACCOUNT_SPACE_A, ACCOUNT_SUBJECT_1, request({ accountType: "credit-card", openingBalanceMinorUnits: -45_000 }));
    assert.equal(account.openingBalanceMinorUnits, -45_000);
  });

  it("an account of one budget is unreachable through another budget's identifier", async () => {
    const world = accountWorld();
    const { account } = await createAccount(world.deps, ACCOUNT_SPACE_A, ACCOUNT_SUBJECT_1, request());
    assert.equal(await world.repository.readAccount(ACCOUNT_SPACE_B, account.accountId), null);
    await refuses("account_not_found", () => readAccount(world.deps, ACCOUNT_SPACE_B, account.accountId));
  });
});

describe("CBD-196-AC02: every invalid input fails atomically with a stable error", () => {
  const cases: readonly (readonly [string, AccountErrorCode, Record<string, unknown>])[] = [
    ["missing label", "label_invalid", { label: undefined }],
    ["blank label", "label_invalid", { label: "   " }],
    ["over-long label", "label_invalid", { label: "x".repeat(121) }],
    ["non-string label", "label_invalid", { label: 7 }],
    ["missing type", "account_type_unsupported", { accountType: undefined }],
    ["unsupported type", "account_type_unsupported", { accountType: "crypto" }],
    ["missing currency", "currency_unsupported", { currencyCode: undefined }],
    ["malformed currency", "currency_unsupported", { currencyCode: "usd" }],
    ["unknown currency", "currency_unsupported", { currencyCode: "ZZZ" }],
    ["unsupported precision", "currency_precision_unsupported", { currencyCode: "CLF" }],
    ["fractional minor units", "amount_not_integer", { openingBalanceMinorUnits: 125_000.5 }],
    ["string amount", "amount_not_integer", { openingBalanceMinorUnits: "125000" }],
    ["NaN amount", "amount_not_integer", { openingBalanceMinorUnits: Number.NaN }],
    ["overflow amount", "amount_overflow", { openingBalanceMinorUnits: 1e300 }],
    ["infinite amount", "amount_overflow", { openingBalanceMinorUnits: Number.POSITIVE_INFINITY }],
    ["malformed owner", "owner_invalid", { ownerSubjectId: "not-a-uuid" }],
  ];

  for (const [name, code, overrides] of cases) {
    it(`${name} fails as ${code} and writes nothing`, async () => {
      const world = accountWorld();
      refusesSync(code, () => parseAccountCreateRequest(validBody(overrides), ACCOUNT_SUBJECT_1));
      assert.equal(world.repository.accounts.size, 0, "no account and no success record");
    });
  }

  it("a non-object body is invalid_request", () => {
    refusesSync("invalid_request", () => parseAccountCreateRequest("nope", ACCOUNT_SUBJECT_1));
    refusesSync("invalid_request", () => parseAccountCreateRequest(null, ACCOUNT_SUBJECT_1));
    refusesSync("invalid_request", () => parseAccountCreateRequest([], ACCOUNT_SUBJECT_1));
  });

  it("a duplicate live label is refused and leaves the first account alone", async () => {
    const world = accountWorld();
    await createAccount(world.deps, ACCOUNT_SPACE_A, ACCOUNT_SUBJECT_1, request());
    await refuses("label_taken", () => createAccount(world.deps, ACCOUNT_SPACE_A, ACCOUNT_SUBJECT_1, request({ label: "everyday" })));
    assert.equal(world.repository.accounts.size, 1);
  });

  it("the same label is free in another budget", async () => {
    const world = accountWorld();
    await createAccount(world.deps, ACCOUNT_SPACE_A, ACCOUNT_SUBJECT_1, request());
    await createAccount(world.deps, ACCOUNT_SPACE_B, ACCOUNT_SUBJECT_1, request());
    assert.equal(world.repository.accounts.size, 2);
  });
});

describe("CBD-196-AC03: editing changes only the requested fields and exposes both versions", () => {
  it("changes the named field, retains identity and references, and reports previous and resulting version", async () => {
    const world = accountWorld();
    const created = await createAccount(world.deps, ACCOUNT_SPACE_A, ACCOUNT_SUBJECT_1, request());
    world.now = "2026-09-16T09:00:00.000Z";
    const edited = await editAccount(world.deps, ACCOUNT_SPACE_A, created.account.accountId, parseAccountEditRequest({ label: "Everyday checking" }));
    assert.equal(edited.previousVersion, 1);
    assert.equal(edited.account.version, 2);
    assert.equal(edited.account.accountId, created.account.accountId);
    assert.equal(edited.account.label, "Everyday checking");
    assert.equal(edited.account.updatedAt, "2026-09-16T09:00:00.000Z");
    for (const field of ["accountType", "currencyCode", "minorUnitPrecision", "openingBalanceMinorUnits", "ownerSubjectId", "createdBySubjectId", "createdAt", "origin", "archivedAt"] as const) {
      assert.deepEqual(edited.account[field], created.account[field], field);
    }
  });

  it("a balance correction is an edit like any other and still advances the version", async () => {
    const world = accountWorld();
    const created = await createAccount(world.deps, ACCOUNT_SPACE_A, ACCOUNT_SUBJECT_1, request());
    const edited = await editAccount(world.deps, ACCOUNT_SPACE_A, created.account.accountId, parseAccountEditRequest({ openingBalanceMinorUnits: -1 }));
    assert.equal(edited.account.openingBalanceMinorUnits, -1);
    assert.equal(edited.account.label, created.account.label);
    assert.equal(edited.previousVersion, 1);
    assert.equal(edited.account.version, 2);
  });

  it("refuses to edit a field that is not editable, rather than ignoring it", () => {
    for (const body of [{ accountId: "x" }, { currencyCode: "EUR" }, { version: 5 }, { origin: "imported" }, { archivedAt: null }]) {
      refusesSync("invalid_request", () => parseAccountEditRequest(body));
    }
    refusesSync("invalid_request", () => parseAccountEditRequest({}));
  });

  it("refuses an edit whose fields are themselves invalid, and writes nothing", async () => {
    const world = accountWorld();
    const created = await createAccount(world.deps, ACCOUNT_SPACE_A, ACCOUNT_SUBJECT_1, request());
    refusesSync("amount_not_integer", () => parseAccountEditRequest({ openingBalanceMinorUnits: 0.5 }));
    refusesSync("account_type_unsupported", () => parseAccountEditRequest({ accountType: "brokerage" }));
    assert.equal((await readAccount(world.deps, ACCOUNT_SPACE_A, created.account.accountId)).version, 1);
  });

  it("refuses an edit to an unknown account, or to one of another budget", async () => {
    const world = accountWorld();
    const created = await createAccount(world.deps, ACCOUNT_SPACE_A, ACCOUNT_SUBJECT_1, request());
    await refuses("account_not_found", () => editAccount(world.deps, ACCOUNT_SPACE_B, created.account.accountId, parseAccountEditRequest({ label: "stolen" })));
    await refuses("invalid_request", () => editAccount(world.deps, ACCOUNT_SPACE_A, "not-a-uuid", parseAccountEditRequest({ label: "x" })));
  });

  it("reassigning the owner is an ordinary edit", async () => {
    const world = accountWorld();
    const created = await createAccount(world.deps, ACCOUNT_SPACE_A, ACCOUNT_SUBJECT_1, request());
    const edited = await editAccount(world.deps, ACCOUNT_SPACE_A, created.account.accountId, parseAccountEditRequest({ ownerSubjectId: ACCOUNT_SUBJECT_2 }));
    assert.equal(edited.account.ownerSubjectId, ACCOUNT_SUBJECT_2);
    assert.equal(edited.account.createdBySubjectId, ACCOUNT_SUBJECT_1);
  });
});

describe("CBD-196-AC04: archive and restore change only lifecycle availability", () => {
  it("archiving changes archivedAt and the version, and nothing else", async () => {
    const world = accountWorld();
    const created = await createAccount(world.deps, ACCOUNT_SPACE_A, ACCOUNT_SUBJECT_1, request());
    world.now = "2026-09-20T00:00:00.000Z";
    const archived = await archiveAccount(world.deps, ACCOUNT_SPACE_A, created.account.accountId);
    assert.equal(archived.previousVersion, 1);
    assert.equal(archived.account.archivedAt, "2026-09-20T00:00:00.000Z");
    assert.deepEqual(
      { ...archived.account, archivedAt: null, version: 1, updatedAt: created.account.updatedAt },
      created.account,
      "only lifecycle, version and updatedAt differ",
    );
  });

  it("an archived account stays queryable by identity and in the default listing", async () => {
    const world = accountWorld();
    const created = await createAccount(world.deps, ACCOUNT_SPACE_A, ACCOUNT_SUBJECT_1, request());
    await archiveAccount(world.deps, ACCOUNT_SPACE_A, created.account.accountId);
    const found = await readAccount(world.deps, ACCOUNT_SPACE_A, created.account.accountId);
    assert.equal(found.openingBalanceMinorUnits, 125_000, "balance still readable");
    assert.equal((await listAccounts(world.deps, ACCOUNT_SPACE_A)).length, 1);
    assert.equal((await listAccounts(world.deps, ACCOUNT_SPACE_A, { liveOnly: true })).length, 0);
  });

  it("restoring is the exact inverse and round trips", async () => {
    const world = accountWorld();
    const created = await createAccount(world.deps, ACCOUNT_SPACE_A, ACCOUNT_SUBJECT_1, request());
    await archiveAccount(world.deps, ACCOUNT_SPACE_A, created.account.accountId);
    const restored = await restoreAccount(world.deps, ACCOUNT_SPACE_A, created.account.accountId);
    assert.equal(restored.previousVersion, 2);
    assert.equal(restored.account.version, 3);
    assert.equal(restored.account.archivedAt, null);
    assert.deepEqual(
      { ...restored.account, version: 1, updatedAt: created.account.updatedAt },
      created.account,
      "a restore returns every field to what it was",
    );
  });

  it("archiving twice, and restoring a live account, are refused", async () => {
    const world = accountWorld();
    const created = await createAccount(world.deps, ACCOUNT_SPACE_A, ACCOUNT_SUBJECT_1, request());
    await refuses("account_not_archived", () => restoreAccount(world.deps, ACCOUNT_SPACE_A, created.account.accountId));
    await archiveAccount(world.deps, ACCOUNT_SPACE_A, created.account.accountId);
    await refuses("account_archived", () => archiveAccount(world.deps, ACCOUNT_SPACE_A, created.account.accountId));
    await refuses("account_archived", () => editAccount(world.deps, ACCOUNT_SPACE_A, created.account.accountId, parseAccountEditRequest({ label: "x" })));
  });

  it("an archived label is reusable, and the restore that would collide is refused", async () => {
    const world = accountWorld();
    const first = await createAccount(world.deps, ACCOUNT_SPACE_A, ACCOUNT_SUBJECT_1, request());
    await archiveAccount(world.deps, ACCOUNT_SPACE_A, first.account.accountId);
    await createAccount(world.deps, ACCOUNT_SPACE_A, ACCOUNT_SUBJECT_1, request());
    await refuses("label_taken", () => restoreAccount(world.deps, ACCOUNT_SPACE_A, first.account.accountId));
  });
});

describe("CBD-196-AC05: every supported type, every boundary, and the round trips", () => {
  for (const accountType of ACCOUNT_TYPES) {
    it(`creates and round trips a ${accountType} account`, async () => {
      const world = accountWorld();
      const created = await createAccount(world.deps, ACCOUNT_SPACE_A, ACCOUNT_SUBJECT_1, request({ accountType, label: accountType }));
      assert.equal(created.account.accountType, accountType);
      const archived = await archiveAccount(world.deps, ACCOUNT_SPACE_A, created.account.accountId);
      const restored = await restoreAccount(world.deps, ACCOUNT_SPACE_A, created.account.accountId);
      assert.equal(archived.account.accountType, accountType);
      assert.equal(restored.account.accountType, accountType);
      assert.equal(restored.account.archivedAt, null);
    });
  }

  for (const [currencyCode, precision] of [["USD", 2], ["JPY", 0], ["KWD", 3]] as const) {
    it(`sizes the minor unit for ${currencyCode} as ${precision}`, () => {
      assert.equal(parseAccountCreateRequest(validBody({ currencyCode }), ACCOUNT_SUBJECT_1).minorUnitPrecision, precision);
    });
  }

  it("accepts the label and amount boundaries exactly", async () => {
    const world = accountWorld();
    const created = await createAccount(world.deps, ACCOUNT_SPACE_A, ACCOUNT_SUBJECT_1, request({ label: "x".repeat(120), openingBalanceMinorUnits: 0 }));
    assert.equal(created.account.label.length, 120);
    assert.equal(created.account.openingBalanceMinorUnits, 0);
    const extreme = await createAccount(world.deps, ACCOUNT_SPACE_A, ACCOUNT_SUBJECT_1, request({ label: "extreme", openingBalanceMinorUnits: Number.MAX_SAFE_INTEGER }));
    assert.equal(extreme.account.openingBalanceMinorUnits, Number.MAX_SAFE_INTEGER);
  });

  it("serialises and reads back identically", async () => {
    const world = accountWorld();
    const created = await createAccount(world.deps, ACCOUNT_SPACE_A, ACCOUNT_SUBJECT_1, request());
    const stored = await readAccount(world.deps, ACCOUNT_SPACE_A, created.account.accountId);
    assert.equal(JSON.stringify(stored), JSON.stringify(created.account));
    assert.deepEqual(JSON.parse(JSON.stringify(stored)), created.account);
  });

  it("listing is deterministic under insertion order", async () => {
    const world = accountWorld();
    for (const label of ["Zeta", "alpha", "Mid"]) {
      await createAccount(world.deps, ACCOUNT_SPACE_A, ACCOUNT_SUBJECT_1, request({ label }));
    }
    assert.deepEqual((await listAccounts(world.deps, ACCOUNT_SPACE_A)).map((a) => a.label), ["alpha", "Mid", "Zeta"]);
  });
});
