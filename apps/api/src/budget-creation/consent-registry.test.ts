/**
 * The consent disclosure registry, at build time and at startup
 * (CBD236-CONSENT-SEMANTICS-001 item 3; docs/cbd-236-consent-facts-proposal.md
 * section 5).
 *
 * Two guards protect the same property from two sides, and both are exercised
 * here, deliberate violation included:
 *
 *  1. `scripts/check-consent-disclosure-registry.mjs` runs as part of this
 *     suite -- which is how the guard reaches `npm run check` without a root
 *     package.json script, that file being a single-writer shared surface.
 *     `npm run check` therefore fails on a tampered registry.
 *  2. `loadConsentDisclosureRegistry` refuses at API startup. A registry whose
 *     digests do not reproduce means the approved text and the text that would
 *     be shown have diverged, and a consent row citing that version would be
 *     evidence of something nobody approved.
 *
 * "A guard is not finished until a deliberate violation has failed it": every
 * `it` below that names a violation mutates the real registry content in
 * memory and asserts the guard rejects it.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { buildConsentDisclosureSource, ConsentDisclosureRegistryError, loadConsentDisclosureRegistry, REQUIRED_DISCLOSURE_KINDS, repositoryRootFrom } from "./consent-registry.ts";
import { digestOf, validateConsentDisclosureRegistry } from "../../../../scripts/check-consent-disclosure-registry.mjs";
import { PRIMARY_OWNER_SELF_DISCLOSURE } from "../../../../packages/budget-application/src/creation-confirmation/disclosure.ts";

/**
 * The kinds registered by the invitations design (INVITATIONS-DESIGN-001 item
 * 5; docs/cbd-234-invitations-consent-design-proposal.md section 6). They are
 * registered and digest-pinned here one packet ahead of the routes that
 * present them, so `REQUIRED_DISCLOSURE_KINDS` still names only
 * `primary_owner_self`: a kind the running routes do not need must not fail
 * startup, and a kind they do need must.
 */
const INVITATION_DISCLOSURE_KINDS = [
  "invitation_collaborator",
  "invitation_co_owner",
  "primary_transfer_recipient",
  "primary_transfer_outgoing",
] as const;

const here = dirname(fileURLToPath(import.meta.url));
const root = repositoryRootFrom(here);
const entries: { kind: string; version: number; digest: string; text_ref: string; approved_by: string; approved_at: string }[] =
  JSON.parse(readFileSync(join(root, "config/consent-disclosure-registry.json"), "utf8"));
const contentsOf = (rows: readonly { text_ref: string }[]): Record<string, unknown> =>
  Object.fromEntries(rows.map((row) => [row.text_ref, JSON.parse(readFileSync(join(root, row.text_ref), "utf8"))]));
const clone = <T>(value: T): T => structuredClone(value);

describe("the registry as it stands", () => {
  it("passes its own build-time guard, run as a real process", () => {
    const output = execFileSync(process.execPath, [join(root, "scripts/check-consent-disclosure-registry.mjs")], { cwd: root, encoding: "utf8" });
    assert.match(output, /Consent disclosure registry check passed/u);
  });
  it("loads at startup and carries the primary_owner_self disclosure the routes need", () => {
    const disclosure = loadConsentDisclosureRegistry(here).current(PRIMARY_OWNER_SELF_DISCLOSURE);
    assert.equal(disclosure.kind, PRIMARY_OWNER_SELF_DISCLOSURE);
    assert.ok(disclosure.version >= 1);
    assert.match(disclosure.digest, /^[0-9a-f]{64}$/u);
    assert.ok(disclosure.text.items.length > 0 && disclosure.text.acknowledgement.length > 0);
  });
  it("registers exactly the approved kinds and nothing else", () => {
    assert.deepEqual([...new Set(entries.map((entry) => entry.kind))], [PRIMARY_OWNER_SELF_DISCLOSURE, ...INVITATION_DISCLOSURE_KINDS]);
  });
  it("still requires only the kinds the running routes present", () => {
    assert.deepEqual([...REQUIRED_DISCLOSURE_KINDS], [PRIMARY_OWNER_SELF_DISCLOSURE]);
  });
  it("carries every invitation and transfer kind at a version the API can read", () => {
    const source = loadConsentDisclosureRegistry(here);
    for (const kind of INVITATION_DISCLOSURE_KINDS) {
      const disclosure = source.current(kind);
      assert.equal(disclosure.kind, kind);
      assert.equal(disclosure.version, 1);
      assert.match(disclosure.digest, /^[0-9a-f]{64}$/u);
      assert.ok(disclosure.text.items.length > 0, `${kind} has no items`);
      // The acknowledgement names the role and the space (section 6).
      assert.match(disclosure.text.acknowledgement, /budget space/u);
    }
  });
  // TCF-02 (GAPS-F03 follow-up): `at(kind, version)` answers the same entry
  // as `current` for the one version every real kind carries today, and
  // `null` -- never a throw -- for a version this file does not have.
  it("at(kind, version) answers the loader's only version and null past it", () => {
    const source = loadConsentDisclosureRegistry(here);
    for (const kind of [PRIMARY_OWNER_SELF_DISCLOSURE, ...INVITATION_DISCLOSURE_KINDS]) {
      assert.deepEqual(source.at?.(kind, 1), source.current(kind));
      assert.equal(source.at?.(kind, 2), null);
      assert.equal(source.at?.(kind, 999), null);
    }
    assert.equal(source.at?.("not_a_registered_kind", 1), null);
  });
});

/**
 * CBD-287-AC06 / `RI-93-016` / CBD-73 section 6 rule 5: the record is evidence
 * of the person's explicit action, never a claim that the product agreed on
 * their behalf. The CBD-75 prohibited-language register is checked against
 * these texts by `npm run check:copy`'s engine; what is asserted here is the
 * positive half the register cannot express -- that every registered
 * invitation and transfer text actually says whose action the record is.
 */
describe("what the approved disclosure texts claim about the record", () => {
  it("says the person acted, and never that agreement was given to them", () => {
    for (const kind of INVITATION_DISCLOSURE_KINDS) {
      const entry = entries.find((row) => row.kind === kind)!;
      const content = JSON.parse(readFileSync(join(root, entry.text_ref), "utf8")) as { items: { text: string }[] };
      const body = content.items.map((item) => item.text).join(" ");
      assert.match(body, /evidence of the action you took/u, `${kind} does not say the record evidences the person's action`);
      assert.match(body, /nothing agrees on your behalf/u, `${kind} does not deny that anything agrees for the person`);
    }
  });
});

describe("deliberate violations the build-time guard must fail", () => {
  const validate = (rows: readonly { text_ref: string }[], contents = contentsOf(rows), base: unknown = entries) =>
    validateConsentDisclosureRegistry({ baseEntries: base, candidateEntries: rows, contents });

  it("accepts the registry unchanged against itself as the base", () => {
    assert.deepEqual(validate(entries), []);
  });
  it("fails when an approved disclosure text is edited without a new version", () => {
    const contents = contentsOf(entries);
    const content = contents[entries[0]!.text_ref] as { items: { text: string }[] };
    content.items[0]!.text = "You become a Viewer of somebody else's budget.";
    const failures = validate(entries, contents);
    assert.ok(failures.some((failure) => /does not reproduce the pinned digest/u.test(failure)), failures.join("; "));
  });
  it("fails when a digest is edited to match an edited text", () => {
    const rows = clone(entries);
    rows[0]!.digest = "0".repeat(64);
    const failures = validate(rows);
    assert.ok(failures.some((failure) => /may not be changed or reordered/u.test(failure)), failures.join("; "));
    assert.ok(failures.some((failure) => /does not reproduce the pinned digest/u.test(failure)), failures.join("; "));
  });
  it("fails when an approved entry is removed", () => {
    const failures = validate([]);
    assert.ok(failures.some((failure) => /append-only and may not be removed/u.test(failure)), failures.join("; "));
  });
  it("fails when an approval field is dropped or emptied", () => {
    const rows = clone(entries);
    rows[0]!.approved_by = "";
    assert.ok(validate(rows).some((failure) => /requires approved_by/u.test(failure)));
    const extra = clone(entries) as unknown as Record<string, unknown>[];
    extra[0]!.note = "ungoverned";
    assert.ok(validate(extra as unknown as typeof entries).some((failure) => /exactly the six governed fields/u.test(failure)));
  });
  it("fails when a version is skipped, repeated or does not start at 1", () => {
    for (const version of [0, 2, 1.5]) {
      const rows = clone(entries);
      rows[0]!.version = version as number;
      assert.ok(validate(rows, contentsOf(rows), []).length > 0, `version ${version}`);
    }
    const repeated = [...clone(entries), ...clone(entries)];
    assert.ok(validate(repeated, contentsOf(repeated), []).some((failure) => /dense and ascending/u.test(failure)));
  });
  // The same three violations, driven once per newly registered kind: a guard
  // that has only ever been broken on the first entry has not been shown to
  // guard the fifth.
  for (const kind of INVITATION_DISCLOSURE_KINDS) {
    const indexOf = () => entries.findIndex((entry) => entry.kind === kind);

    it(`fails when the approved ${kind} text is edited without a new version`, () => {
      const index = indexOf();
      const contents = contentsOf(entries);
      const content = contents[entries[index]!.text_ref] as { items: { text: string }[] };
      content.items[0]!.text = "Somebody has already agreed to this on your behalf.";
      const failures = validate(entries, contents);
      assert.ok(failures.some((failure) => new RegExp(`entry ${index}: .* does not reproduce the pinned digest`, "u").test(failure)), failures.join("; "));
    });
    it(`fails when the approved ${kind} entry is removed`, () => {
      const rows = clone(entries).filter((entry) => entry.kind !== kind);
      const failures = validate(rows, contentsOf(rows));
      assert.ok(failures.some((failure) => /append-only and may not be removed|may not be changed or reordered/u.test(failure)), failures.join("; "));
    });
    it(`fails when ${kind} skips version 1`, () => {
      const rows = clone(entries);
      const index = indexOf();
      rows[index]!.version = 2;
      const contents = contentsOf(rows);
      (contents[rows[index]!.text_ref] as { version: number }).version = 2;
      rows[index]!.digest = digestOf(contents[rows[index]!.text_ref]);
      const failures = validate(rows, contents, []);
      assert.ok(failures.some((failure) => /dense and ascending from 1/u.test(failure)), failures.join("; "));
    });
  }

  it("fails when the content file is missing or declares another version", () => {
    assert.ok(validate(entries, {}).some((failure) => /content file .* is missing/u.test(failure)));
    const contents = contentsOf(entries);
    (contents[entries[0]!.text_ref] as { version: number }).version = 9;
    assert.ok(validate(entries, contents).some((failure) => /declares .* version 9/u.test(failure)));
  });
});

describe("deliberate violations the API startup guard must fail", () => {
  const build = (rows: unknown, contents: Record<string, unknown>) => () => buildConsentDisclosureSource(rows, contents);

  it("refuses a registry whose digest does not reproduce", () => {
    const contents = contentsOf(entries);
    (contents[entries[0]!.text_ref] as { heading: string }).heading = "Tampered heading";
    assert.throws(build(entries, contents), (error: unknown) => error instanceof ConsentDisclosureRegistryError && /digest_mismatch/u.test((error as Error).message));
  });
  it("refuses a registry that does not carry a kind the routes need", () => {
    assert.throws(build([], {}), (error: unknown) => error instanceof ConsentDisclosureRegistryError && /kind_unregistered/u.test((error as Error).message));
  });
  it("refuses a malformed entry rather than reading past it", () => {
    assert.throws(build([{ kind: "primary_owner_self", version: 1 }], {}), /entry_malformed/u);
    assert.throws(build("not an array", {}), /registry_malformed/u);
  });
  it("refuses an incomplete disclosure text", () => {
    const rows = clone(entries);
    const contents = contentsOf(entries);
    const content = contents[rows[0]!.text_ref] as { items: unknown[] };
    content.items = [];
    // The digest is recomputed, so only the incompleteness is under test and not a stale pin.
    rows[0]!.digest = digestOf(content);
    assert.throws(build(rows, contents), /content_incomplete/u);
  });
  for (const kind of INVITATION_DISCLOSURE_KINDS) {
    it(`refuses to start when the ${kind} digest does not reproduce`, () => {
      const contents = contentsOf(entries);
      const entry = entries.find((row) => row.kind === kind)!;
      (contents[entry.text_ref] as { heading: string }).heading = "Tampered heading";
      assert.throws(build(entries, contents), (error: unknown) =>
        error instanceof ConsentDisclosureRegistryError && new RegExp(`digest_mismatch: ${entry.text_ref}`, "u").test((error as Error).message));
    });
    it(`refuses to start when the ${kind} content file is absent`, () => {
      const entry = entries.find((row) => row.kind === kind)!;
      const contents = contentsOf(entries);
      delete contents[entry.text_ref];
      assert.throws(build(entries, contents), (error: unknown) =>
        error instanceof ConsentDisclosureRegistryError && new RegExp(`content_missing: ${entry.text_ref}`, "u").test((error as Error).message));
    });
  }

  it("refuses a kind whose versions are not dense from 1", () => {
    const rows = clone(entries);
    rows[0]!.version = 2;
    const contents = contentsOf(rows);
    const content = contents[rows[0]!.text_ref] as { version: number };
    content.version = 2;
    rows[0]!.digest = digestOf(content);
    assert.throws(build(rows, contents), /version_not_dense/u);
  });
});

/**
 * TCF-02 (GAPS-F03 follow-up): `at(kind, version)` reads the loader's own
 * history rather than only the currently approved version. The real registry
 * has never carried two versions of one kind, so this exercises the append
 * from an in-memory two-version registry, the same way the malformed-input
 * cases above build one without a checkout on disk.
 */
describe("TCF-02: at(kind, version) once a kind has moved past a captured version", () => {
  function content(kind: string, version: number, heading: string): { kind: string; version: number; heading: string; items: { id: string; text: string }[]; acknowledgement: string } {
    return { kind, version, heading, items: [{ id: "1", text: "Body." }], acknowledgement: "I agree." };
  }

  it("still answers an older version's own text once a newer one is current, and null once a version was never carried", () => {
    const kind = "primary_owner_self";
    const v1 = content(kind, 1, "Version one");
    const v2 = content(kind, 2, "Version two");
    const rows = [
      { kind, version: 1, digest: digestOf(v1), text_ref: "v1.json" },
      { kind, version: 2, digest: digestOf(v2), text_ref: "v2.json" },
    ];
    const source = buildConsentDisclosureSource(rows, { "v1.json": v1, "v2.json": v2 }, [kind]);

    // current() moved to the highest version, as it always has.
    assert.equal(source.current(kind).version, 2);
    assert.equal(source.current(kind).text.heading, "Version two");

    // at() still serves the captured (now superseded) version's own text and digest.
    const at1 = source.at?.(kind, 1);
    assert.equal(at1?.version, 1);
    assert.equal(at1?.digest, digestOf(v1));
    assert.equal(at1?.text.heading, "Version one");

    // at() on the current version agrees with current().
    assert.deepEqual(source.at?.(kind, 2), source.current(kind));

    // Moved-and-removed: a version this loader's file never carried is null, never a throw.
    assert.equal(source.at?.(kind, 3), null);
    assert.equal(source.at?.("not_a_registered_kind", 1), null);
  });
});
