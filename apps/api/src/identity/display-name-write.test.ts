/**
 * `DI-91-065`/`SEC-PK2-F08` unit proof for `packages/data-access/src/financial-profile.ts`'s
 * `readDisplayIdentity`/`writeDisplayName` (CBD-236 p6, `PROTO-CONTRACTS-P6-IMPL-001`), the
 * port `apps/api/src/identity/http.ts#setDisplayName` calls. Isolated from the SERIALIZABLE
 * transaction and `recheck_at_commit` machinery the real route runs inside -- that machinery
 * re-reads `profile.profileVersion` immediately before the handler runs, in the same
 * transaction, which is why `writeDisplayName`'s own `null` (version-mismatch) return is
 * proven here directly rather than raced through HTTP: `http.test.ts`'s p6 test and
 * `display-name.live.test.ts` cover the route end to end, but under SERIALIZABLE isolation
 * plus the recheck, a version mismatch inside one committed transaction is not reachable
 * from outside it through ordinary sequential requests.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { financialProfileDisplayStatements, MAX_DISPLAY_NAME_LENGTH, readDisplayIdentity, writeDisplayName } from "../../../../packages/data-access/src/financial-profile.ts";
import type { ProfileStatementClient } from "../../../../packages/data-access/src/financial-profile.ts";
import type { ProfileSelectQuery, ProfileUpdateQuery } from "../../../../packages/data-access/src/profile.ts";

interface Row { profile_id: string; account_subject_id: string; profile_state: string; display_name: string | null; version: number }

function fakeClient(initial: Row): { client: ProfileStatementClient; row: () => Row } {
  let row: Row = { ...initial };
  const client: ProfileStatementClient = {
    profileSelect: async (query: ProfileSelectQuery) => {
      if (query.accountSubjectId !== row.account_subject_id) return { rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] };
      return { rows: [{ ...row }], rowCount: 1, command: "SELECT", oid: 0, fields: [] };
    },
    profileUpdate: async (query: ProfileUpdateQuery) => {
      if (query.accountSubjectId !== row.account_subject_id) return { rowCount: 0, rows: [], command: "UPDATE", oid: 0, fields: [] };
      const matches = (query.conditions ?? []).every((c) => (row as unknown as Record<string, unknown>)[c.column] === c.value);
      if (!matches) return { rowCount: 0, rows: [], command: "UPDATE", oid: 0, fields: [] };
      row = { ...row, ...(query.set as Partial<Row>) };
      return { rowCount: 1, rows: [], command: "UPDATE", oid: 0, fields: [] };
    },
  };
  return { client, row: () => row };
}

describe("CBD-236 p6: writeDisplayName / readDisplayIdentity (DI-91-065, SEC-PK2-F08)", () => {
  it("trims, writes display_name, and advances version by exactly one", async () => {
    const { client, row } = fakeClient({ profile_id: "profile-1", account_subject_id: "subject-1", profile_state: "active", display_name: null, version: 1 });
    const next = await writeDisplayName(client, "subject-1", "  Alex W.  ", 1);
    assert.equal(next, 2);
    assert.equal(row().display_name, "Alex W.");
    assert.equal(row().version, 2);
    const read = await readDisplayIdentity(client, "subject-1");
    assert.deepEqual(read, { profile_id: "profile-1", account_subject_id: "subject-1", profile_state: "active", display_name: "Alex W.", version: 2 });
  });

  it("returns null (no write) when expectedVersion does not match the row's current version", async () => {
    const { client, row } = fakeClient({ profile_id: "profile-1", account_subject_id: "subject-1", profile_state: "active", display_name: "Existing", version: 5 });
    const result = await writeDisplayName(client, "subject-1", "New Name", 4);
    assert.equal(result, null, "the compare-and-set found nothing at version 4");
    assert.equal(row().display_name, "Existing", "nothing written");
    assert.equal(row().version, 5, "version unchanged");
  });

  it("rejects a 0-length or all-whitespace name with a RangeError naming the 1..80 bound, and writes nothing", async () => {
    const { client, row } = fakeClient({ profile_id: "profile-1", account_subject_id: "subject-1", profile_state: "active", display_name: null, version: 1 });
    await assert.rejects(() => writeDisplayName(client, "subject-1", "   ", 1), RangeError);
    assert.equal(row().version, 1, "nothing written");
  });

  it(`rejects a name over ${MAX_DISPLAY_NAME_LENGTH} code points and accepts exactly ${MAX_DISPLAY_NAME_LENGTH}`, async () => {
    const { client, row } = fakeClient({ profile_id: "profile-1", account_subject_id: "subject-1", profile_state: "active", display_name: null, version: 1 });
    await assert.rejects(() => writeDisplayName(client, "subject-1", "x".repeat(MAX_DISPLAY_NAME_LENGTH + 1), 1), RangeError);
    assert.equal(row().version, 1);
    const next = await writeDisplayName(client, "subject-1", "y".repeat(MAX_DISPLAY_NAME_LENGTH), 1);
    assert.equal(next, 2);
    assert.equal(row().display_name!.length, MAX_DISPLAY_NAME_LENGTH);
  });

  it("clears the name with null and still advances version", async () => {
    const { client, row } = fakeClient({ profile_id: "profile-1", account_subject_id: "subject-1", profile_state: "active", display_name: "Alex", version: 3 });
    const next = await writeDisplayName(client, "subject-1", null, 3);
    assert.equal(next, 4);
    assert.equal(row().display_name, null);
  });

  it("financialProfileDisplayStatements binds the same two functions to one client", async () => {
    const { client, row } = fakeClient({ profile_id: "profile-1", account_subject_id: "subject-1", profile_state: "active", display_name: null, version: 1 });
    const statements = financialProfileDisplayStatements(client);
    await statements.writeDisplayName("subject-1", "Bound", 1);
    assert.equal(row().display_name, "Bound");
    assert.deepEqual(await statements.readDisplayIdentity("subject-1"), { profile_id: "profile-1", account_subject_id: "subject-1", profile_state: "active", display_name: "Bound", version: 2 });
  });
});
