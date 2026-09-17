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

  it("SEC-F06-OBS1: rejects a name containing a Unicode control or format character with a RangeError, and writes nothing", async () => {
    const { client, row } = fakeClient({ profile_id: "profile-1", account_subject_id: "subject-1", profile_state: "active", display_name: null, version: 1 });
    for (const [label, name] of [
      ["U+202E right-to-left override", "Alex \u202EW."],
      ["U+200B zero width space", "Alex\u200B W."],
      ["U+0009 tab inside the name", "Alex\tW."],
      ["U+000A line feed inside the name", "Alex\nW."],
      ["U+00AD soft hyphen", "Al\u00ADex"],
      ["U+FEFF byte order mark", "Alex\uFEFF W."],
      ["U+2066 left-to-right isolate", "\u2066Alex\u2069"],
      ["ZWNJ adjacent to U+202E", "\u0645\u06CC\u200C\u202E\u062E"],
      ["ZWJ at string start", "\u200D\u0D15\u0D4D\u0D37"],
      ["ZWNJ at string end", "\u0645\u06CC\u200C"],
      ["ZWNJ next to a space", "\u0645\u06CC\u200C \u062E\u0648\u0627\u0647\u0645"],
      ["ZWJ next to a space", "\u0D15\u0D4D \u200D\u0D37"],
      ["doubled ZWNJ between letters", "\u0645\u06CC\u200C\u200C\u062E"],
      ["doubled ZWJ between letters", "\u0D15\u0D4D\u200D\u200D\u0D37"],
      ["tag-sequence flag", "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F} Kim"],
    ] as const) {
      await assert.rejects(() => writeDisplayName(client, "subject-1", name, 1), RangeError, label);
      assert.equal(row().version, 1, `nothing written for ${label}`);
      assert.equal(row().display_name, null, `nothing written for ${label}`);
    }
  });

  it("SEC-F06-OBS1 / REV-NS-2: accents, CJK, Arabic, ZWJ-joined emoji, Persian ZWNJ and Malayalam/Sinhala ZWJ conjuncts still pass", async () => {
    for (const name of ["Zo\u00EB M\u00FCller", "\u5C71\u7530\u592A\u90CE", "\u0645\u062D\u0645\u062F", "Alex \u{1F468}\u200D\u{1F469}\u200D\u{1F467}", "\u{1F469}\u{1F3FD}\u200D\u{1F4BB} Sam", "\u2764\uFE0F\u200D\u{1F525} Kim", "\u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645", "\u0D15\u0D4D\u200D\u0D37 Nair", "\u0DC3\u0DD2\u0D82\u0DC4\u0DBD \u0D9A\u0DCA\u200D\u0DBB"]) {
      const { client, row } = fakeClient({ profile_id: "profile-1", account_subject_id: "subject-1", profile_state: "active", display_name: null, version: 1 });
      assert.equal(await writeDisplayName(client, "subject-1", name, 1), 2, name);
      assert.equal(row().display_name, name);
    }
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
