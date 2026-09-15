/**
 * CBD-236 consent landing (CBD236-CONSENT-SEMANTICS-001 item 4;
 * docs/cbd-236-consent-facts-proposal.md section 8, `CF-236-007`).
 *
 * The assembler reads consent from `budget_space_consent` and derives nothing.
 * These tests drive the real `FactAssembler` and the real released policy, so
 * what they assert is what an ordinary cell actually decides:
 *
 *  * a `current` consent row for the acting membership and subject is emitted
 *    verbatim -- identifier, disclosure version and state are the row's own
 *    columns -- and the Primary Owner is allowed;
 *  * a space with no consent row for the membership emits no consent fact and
 *    every ordinary cell denies `input_invalid`;
 *  * a row that has left `current` is emitted with its stored state, so the
 *    denial is the contract's `consent_not_current` rather than a fabricated
 *    `current`;
 *  * nothing about the membership row -- its role, its
 *    `authorization_version`, who created it, or the runtime the process
 *    happens to be in -- can produce a consent fact. The interim derivation of
 *    section 9 is deleted, and the last block proves its identifiers are gone
 *    from the source rather than merely unused.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { decide } from "@cobudget/contracts/authorization";
import type { DataAccessClient } from "@cobudget/data-access";
import { FactAssembler, FactFailure } from "../authorization/facts.js";
import { budgetFactReader, ceremonyFactReader, consentFactsOf, currentConsentRow } from "./budget-facts.ts";
import { createApiFactSource } from "./fact-source.ts";

const SPACE = "11111111-1111-4111-8111-111111111111";
const MEMBERSHIP = "22222222-2222-4222-8222-222222222222";
const SUBJECT = "33333333-3333-4333-8333-333333333333";
const CONSENT = "88888888-8888-4888-8888-888888888888";

const owner = () => ({ membership_id: MEMBERSHIP, role: "primary_owner", status: "active", authorization_version: 1 });
const consentRow = (overrides: Record<string, unknown> = {}) => ({
  consent_id: CONSENT, disclosure_version: 1, state: "current", recorded_at: "2026-09-14T12:00:00.000Z", ...overrides,
});

describe("row selection and the consent leaves (section 8 steps 2 and 3)", () => {
  it("prefers the single current row", () => {
    const superseded = consentRow({ consent_id: "old", state: "superseded", recorded_at: "2026-09-14T13:00:00.000Z" });
    assert.equal(currentConsentRow([superseded, consentRow()])?.consent_id, CONSENT);
  });
  it("falls back to the most recently recorded terminal row, with its own state", () => {
    const older = consentRow({ consent_id: "older", state: "superseded", recorded_at: "2026-09-13T00:00:00.000Z" });
    const newer = consentRow({ consent_id: "newer", state: "ended", recorded_at: "2026-09-14T00:00:00.000Z" });
    const chosen = currentConsentRow([older, newer]);
    assert.equal(chosen?.consent_id, "newer");
    assert.equal(consentFactsOf(chosen)?.["consent.state"], "ended", "the stored state, never a substituted current");
  });
  it("emits nothing when there is no row, and never invents a value", () => {
    assert.equal(currentConsentRow([]), undefined);
    assert.equal(consentFactsOf(undefined), undefined);
    assert.equal(consentFactsOf(consentRow({ consent_id: "" })), undefined);
    assert.equal(consentFactsOf(consentRow({ disclosure_version: 0 })), undefined);
    assert.equal(consentFactsOf(consentRow({ state: "" })), undefined);
  });
  it("refuses two current rows rather than choosing one", () => {
    assert.equal(currentConsentRow([consentRow(), consentRow({ consent_id: "second" })]), undefined);
  });
});

describe("through the real fact assembler and the released policy", () => {
  function assembler(membership: Record<string, unknown> | undefined, consents: readonly Record<string, unknown>[]) {
    const client = {
      tenantSelect: async (query: { table: string; budgetSpaceId: string; conditions?: { column: string; value: unknown }[] }) => {
        assert.equal(query.budgetSpaceId, SPACE);
        if (query.table === "budget_space") return { rows: [{ budget_space_id: SPACE, lifecycle: "live", lifecycle_version: 1, primary_owner_membership_id: MEMBERSHIP }] };
        if (query.table === "budget_space_membership") {
          // The reader must ask for the acting subject's own row: (space, membership id, account subject).
          assert.deepEqual(query.conditions?.map((c) => c.column), ["membership_id", "account_subject_id"]);
          return { rows: membership ? [membership] : [] };
        }
        if (query.table === "budget_space_consent") {
          // Tenant-scoped, keyed on the acting membership and the acting subject; never on the space alone.
          assert.deepEqual(query.conditions?.map((c) => c.column), ["membership_id", "account_subject_id"]);
          assert.equal(query.conditions?.[1]?.value, SUBJECT);
          return { rows: consents };
        }
        return { rows: [] };
      },
    } as unknown as DataAccessClient;
    const sessions = { read: async () => ({ "subject.accountSubjectId": SUBJECT, "subject.sessionRef": "session-ref-1", "subject.sessionVersion": 1 }) };
    const source = createApiFactSource({ sessions, client: {
      ...client,
      platformSelect: async (query: { table: string }) => ({ rows: query.table === "account_subject" ? [{ account_subject_id: SUBJECT, lifecycle_state: "active", lifecycle_version: 1 }] : [] }),
      profileSelect: async () => ({ rows: [{ profile_id: "77777777-7777-4777-8777-777777777777", account_subject_id: SUBJECT, profile_state: "active", version: 1 }] }),
    } as unknown as DataAccessClient, extend: budgetFactReader("development") });
    return new FactAssembler("api", source, () => new Date(), 5_000, undefined, { environmentId: "development" });
  }
  const lookup = { credential: "opaque", operation: { action: "1.view_space", purpose: "user_delegated" as const, mode: "user_delegated" as const, fieldSet: "default" as const, resourceType: "space" as const, resourceId: SPACE, actingSpaceId: SPACE, actingMembershipId: MEMBERSHIP } };

  it("the owner with a current consent row assembles the row's own facts and is allowed", async () => {
    const input = await assembler(owner(), [consentRow({ disclosure_version: 4 })]).assemble(lookup);
    assert.equal(input.consent?.consentId, CONSENT);
    assert.equal(input.consent?.disclosureVersion, 4, "the row's disclosure version, not the membership's authorization_version");
    assert.equal(input.consent?.state, "current");
    assert.notEqual(input.consent?.disclosureVersion, input.membership?.authorizationVersion);
    assert.equal(decide(input).outcome, "allow");
  });

  it("a space whose membership has no consent row denies every ordinary cell input_invalid", async () => {
    for (const action of ["1.view_space", "4.edit_category", "2a.edit_target"]) {
      const a = assembler(owner(), []);
      await assert.rejects(a.assemble({ ...lookup, operation: { ...lookup.operation, action } }),
        (error: unknown) => error instanceof FactFailure && error.reason === "input_invalid", action);
    }
  });

  it("a membership whose consent has left current denies consent_not_current, not input_invalid", async () => {
    const input = await assembler(owner(), [consentRow({ state: "ended" })]).assemble(lookup);
    assert.equal(input.consent?.state, "ended");
    const decision = decide(input);
    assert.equal(decision.outcome, "deny");
    assert.equal(decision.reasonClass, "consent_not_current");
  });

  it("no property of the membership row can produce a consent fact", async () => {
    for (const membership of [owner(), { ...owner(), role: "co_owner" }, { ...owner(), status: "pending" }, { ...owner(), authorization_version: 7 }]) {
      const a = assembler(membership, []);
      await assert.rejects(a.assemble(lookup), (error: unknown) => error instanceof FactFailure && error.reason === "input_invalid", JSON.stringify(membership));
    }
  });
});

describe("the interim derivation is deleted, not disabled", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  it("no interim identifier survives anywhere in the API or worker fact path", () => {
    for (const relative of ["./budget-facts.ts", "./runtime.ts", "../authorization/facts.ts", "../../../worker/src/authorization/facts.ts"]) {
      const source = readFileSync(join(here, relative), "utf8");
      for (const identifier of ["interimOwnerSelfConsent", "INTERIM_DISCLOSURE_VERSION", "INTERIM_CONSENT_ID_PREFIX", "INTERIM_CONSENT_SOURCE", "interim-owner-self:", "runtime_prototype_derivation"]) {
        assert.equal(source.includes(identifier), false, `${relative} still carries ${identifier}`);
      }
    }
  });
  it("the reader takes no local-runtime argument that could re-admit a derivation", () => {
    assert.equal(budgetFactReader.length, 1, "budgetFactReader(environmentId) only");
  });
  it("the consent record's own migration is the source of the facts", () => {
    const migration = readFileSync(join(here, "../../../../packages/migrations/migrations/20260914T170000Z__create_budget_space_consent.sql"), "utf8");
    assert.match(migration, /CREATE TABLE budget_space_consent/u);
    assert.match(migration, /CHECK \(state IN \('current', 'superseded', 'ended'\)\)/u);
  });
});

/**
 * PROTO-INCREMENT-B-001: the `p3` and row-9/14 route targets that name a real
 * row. The reader must answer the row's own owning space, version and
 * lifecycle, and must answer nothing at all for a row the acting space does
 * not own -- which is what makes a foreign target an inert `input_invalid`
 * denial rather than a query the handler runs.
 */
describe("row-level resource facts for the increment-B route targets", () => {
  const ACCOUNT = "77777777-7777-4777-8777-777777777771";
  const TRANSACTION = "66666666-6666-4666-8666-666666666661";
  const CATEGORY = "99999999-9999-4999-8999-999999999991";
  const rows: Record<string, Record<string, unknown>[]> = {
    financial_account: [{ budget_space_id: SPACE, version: 5, archived_at: null }],
    manual_transaction: [
      { budget_space_id: SPACE, revision: 1, removed_at: null, superseded_at: "2026-09-15T12:00:00.000Z" },
      { budget_space_id: SPACE, revision: 2, removed_at: null, superseded_at: null },
    ],
    budget_category: [{ budget_space_id: SPACE, archived_at: null, version: 7 }],
  };

  /** Columns the last reader run selected, per table; PROTO-HARDENING-001 asserts what the category read asks for. */
  const selected: Record<string, string[]> = {};

  function reader(present: boolean) {
    const client = {
      tenantSelect: async (query: { table: string; budgetSpaceId: string; columns?: readonly string[] }) => {
        assert.equal(query.budgetSpaceId, SPACE, "every row read is tenant-scoped on the acting space");
        (selected[query.table] ??= []).push(...(query.columns ?? []));
        if (query.table === "budget_space") return { rows: [{ budget_space_id: SPACE, lifecycle: "live", lifecycle_version: 1, primary_owner_membership_id: MEMBERSHIP }] };
        if (query.table === "budget_space_membership") return { rows: [owner()] };
        if (query.table === "budget_space_consent") return { rows: [consentRow()] };
        return { rows: present ? rows[query.table] ?? [] : [] };
      },
    } as unknown as DataAccessClient;
    return (resourceType: string, resourceId: string) => budgetFactReader("development")("datastore", {
      credential: "opaque", identity: { "subject.accountSubjectId": SUBJECT },
      operation: { action: "x", purpose: "user_delegated", mode: "user_delegated", fieldSet: "default", resourceType: resourceType as never, resourceId, actingSpaceId: SPACE, actingMembershipId: MEMBERSHIP },
    }, client);
  }

  it("answers the account's own version and a lifecycle projected from archived_at", async () => {
    const facts = await reader(true)("account", ACCOUNT);
    assert.equal(facts?.["resource.owningSpaceId"], SPACE);
    assert.equal(facts?.["resource.version"], 5, "the account row's version, which recheck_at_commit compares");
    assert.equal(facts?.["resource.lifecycle"], "active");
  });

  it("answers the current transaction version, never a superseded one", async () => {
    const facts = await reader(true)("transaction", TRANSACTION);
    assert.equal(facts?.["resource.version"], 2, "the current version's revision");
    assert.equal(facts?.["resource.lifecycle"], "active");
  });

  it("answers the category row for the CBD-211 drill-down, with the row's own version column", async () => {
    // PROTO-HARDENING-001 (F-INCB-03): this was updated_at projected to whole
    // seconds until 20260915T110000Z added budget_category.version. The reader
    // must select version and must not fall back to a timestamp: a category
    // edited twice inside one second used to carry the same version twice.
    delete selected.budget_category;
    const facts = await reader(true)("category", CATEGORY);
    assert.equal(facts?.["resource.owningSpaceId"], SPACE);
    assert.equal(facts?.["resource.version"], 7, "the category row's own version column");
    assert.equal(Number.isSafeInteger(facts?.["resource.version"]), true);
    const columns: readonly string[] = selected.budget_category ?? [];
    assert.ok(columns.includes("version"), "the category read selects version");
    assert.ok(!columns.includes("updated_at"), "and no longer reads updated_at as a version");
  });

  it("the whole-set target is still the space's own row", async () => {
    for (const type of ["space", "category", "plan", "report", "account", "transaction"]) {
      const facts = await reader(true)(type, SPACE);
      assert.equal(facts?.["resource.owningSpaceId"], SPACE, type);
      assert.equal(facts?.["resource.version"], 1, type);
      assert.equal(facts?.["resource.lifecycle"], "live", type);
    }
  });

  it("produces no resource leaf at all for a row the acting space does not own", async () => {
    for (const [type, id] of [["account", ACCOUNT], ["transaction", TRANSACTION], ["category", CATEGORY]] as const) {
      const facts = await reader(false)(type, id);
      for (const path of Object.keys(facts ?? {})) assert.equal(path.startsWith("resource."), false, `${type} leaked ${path}`);
    }
  });

  it("refuses a target identifier that is not a UUID rather than composing a query with it", async () => {
    for (const type of ["account", "transaction", "category"]) {
      const facts = await reader(true)(type, "not-a-uuid");
      for (const path of Object.keys(facts ?? {})) assert.equal(path.startsWith("resource."), false, `${type} answered for a malformed identifier`);
    }
  });
});

/**
 * PK-6 (CBD-234 design sections 4.4 and 11.3; CBD-236 sections 4.4 and 8.8;
 * `P5-F4`, `HO-236-11`): the invitee's `invitation_ceremony` target through
 * the real assembler and the released p5 policy, and the owner's
 * `invitation` target for the row routes.
 */
describe("PK-6: the ceremony fact reader and the invitation row facts", () => {
  const CEREMONY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const INVITATION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const OTHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const ENV = "development";
  function ceremonyAssembler(row: Record<string, unknown> | undefined, located = true) {
    const asked: { column: string; value: unknown }[][] = [];
    const client = {
      tenantSelect: async (query: { table: string; budgetSpaceId: string; conditions?: { column: string; value: unknown }[] }) => {
        assert.equal(query.budgetSpaceId, SPACE, "the located space scopes every read");
        if (query.table === "budget_space_invitation_ceremony") {
          asked.push(query.conditions ?? []);
          const matches = row && (query.conditions ?? []).every((c) => row[c.column] === c.value);
          return { rows: matches ? [row] : [] };
        }
        if (query.table === "budget_space_invitation") return { rows: [{ state_version: 3 }] };
        return { rows: [] };
      },
      platformSelect: async (query: { table: string }) => ({ rows: query.table === "account_subject" ? [{ account_subject_id: SUBJECT, lifecycle_state: "active", lifecycle_version: 1 }] : [] }),
      profileSelect: async () => ({ rows: [{ profile_id: "77777777-7777-4777-8777-777777777777", account_subject_id: SUBJECT, profile_state: "active", version: 1 }] }),
    } as unknown as DataAccessClient;
    const sessions = { read: async () => ({ "subject.accountSubjectId": SUBJECT, "subject.sessionRef": "session-ref-1", "subject.sessionVersion": 1 }) };
    const locate = async (id: string) => located && id === CEREMONY ? { budgetSpaceId: SPACE } : null;
    const reader = ceremonyFactReader(ENV, locate);
    const source = createApiFactSource({ sessions, client, extend: reader });
    return { assembler: new FactAssembler("api", source, () => new Date(), 5_000, undefined, { environmentId: ENV }), asked };
  }
  const attached = () => ({ ceremony_id: CEREMONY, invitation_id: INVITATION, attached_subject_id: SUBJECT, environment: ENV, state: "open" });
  const lookupFor = (action: string, id = CEREMONY) => ({ credential: "opaque", operation: { action, purpose: "user_delegated" as const, mode: "user_delegated" as const, fieldSet: "default" as const, scope: "subject" as const, resourceType: "invitation_ceremony" as const, resourceId: id } });

  it("the attached invitee assembles the row's own owner, environment, state and the invitation's state_version, and both invitee cells allow", async () => {
    for (const action of ["invitation.read_ceremony", "invitation.accept"]) {
      const { assembler, asked } = ceremonyAssembler(attached());
      const input = await assembler.assemble(lookupFor(action));
      assert.equal(input.resource?.owningSpaceId, "none");
      assert.equal(input.resource?.owningSubjectId, SUBJECT);
      assert.equal(input.resource?.environmentId, ENV);
      assert.equal(input.resource?.lifecycle, "open");
      assert.equal(input.resource?.version, 3, "the owning invitation's state_version is the captured targetVersion");
      assert.equal(input.provenance["resource.owningSubjectId"], "datastore");
      const decision = decide(input);
      assert.equal(decision.outcome, "allow", action);
      assert.deepEqual(decision.cellRef, { kind: "subject", action });
      if (action === "invitation.accept") assert.equal((decision.capturedVersions as { targetVersion?: number } | undefined)?.targetVersion, 3);
      // The statement is keyed on (environment, attached subject, ceremony id) -- never on the identifier alone.
      assert.deepEqual(asked.at(-1)?.map((c) => c.column), ["environment", "attached_subject_id", "ceremony_id"]);
    }
  });

  it("an unattached ceremony, another subject's ceremony, a foreign environment and an unlocatable id all deny input_invalid before any handler", async () => {
    const cases: [string, Record<string, unknown> | undefined, boolean][] = [
      ["unattached", { ...attached(), attached_subject_id: null }, true],
      ["another subject", { ...attached(), attached_subject_id: OTHER }, true],
      ["foreign environment", { ...attached(), environment: "test" }, true],
      ["unlocatable", attached(), false],
    ];
    for (const [name, row, located] of cases) {
      const { assembler } = ceremonyAssembler(row, located);
      await assert.rejects(assembler.assemble(lookupFor("invitation.read_ceremony")), (error: unknown) => error instanceof FactFailure && error.reason === "input_invalid", name);
    }
    const { assembler } = ceremonyAssembler(attached());
    await assert.rejects(assembler.assemble(lookupFor("invitation.read_ceremony", "not-a-uuid")), (error: unknown) => error instanceof FactFailure && error.reason === "input_invalid", "malformed id");
  });

  it("the owner's invitation row answers its own state_version and state; the invitation set answers the space (create)", async () => {
    const client = {
      tenantSelect: async (query: { table: string; budgetSpaceId: string; conditions?: { column: string; value: unknown }[] }) => {
        assert.equal(query.budgetSpaceId, SPACE);
        if (query.table === "budget_space") return { rows: [{ budget_space_id: SPACE, lifecycle: "live", lifecycle_version: 1, primary_owner_membership_id: MEMBERSHIP }] };
        if (query.table === "budget_space_membership") return { rows: [owner()] };
        if (query.table === "budget_space_consent") return { rows: [consentRow()] };
        if (query.table === "budget_space_invitation") return { rows: (query.conditions ?? []).some((c) => c.column === "invitation_id" && c.value === INVITATION) ? [{ budget_space_id: SPACE, state: "awaiting_confirmation", state_version: 4 }] : [] };
        return { rows: [] };
      },
    } as unknown as DataAccessClient;
    const read = (resourceId: string) => budgetFactReader(ENV)("datastore", {
      credential: "opaque", identity: { "subject.accountSubjectId": SUBJECT },
      operation: { action: "24.confirm_acceptance", purpose: "user_delegated", mode: "user_delegated", fieldSet: "default", resourceType: "invitation", resourceId, actingSpaceId: SPACE, actingMembershipId: MEMBERSHIP },
    }, client);
    const row = await read(INVITATION);
    assert.equal(row?.["resource.owningSpaceId"], SPACE); assert.equal(row?.["resource.version"], 4); assert.equal(row?.["resource.lifecycle"], "awaiting_confirmation");
    const set = await read(SPACE);
    assert.equal(set?.["resource.owningSpaceId"], SPACE); assert.equal(set?.["resource.version"], 1); assert.equal(set?.["resource.lifecycle"], "live");
    const foreign = await read(OTHER);
    for (const path of Object.keys(foreign ?? {})) assert.equal(path.startsWith("resource."), false, `a row the space does not own leaked ${path}`);
  });
});
