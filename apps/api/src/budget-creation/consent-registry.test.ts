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
import { buildConsentDisclosureSource, ConsentDisclosureRegistryError, loadConsentDisclosureRegistry, repositoryRootFrom } from "./consent-registry.ts";
import { digestOf, validateConsentDisclosureRegistry } from "../../../../scripts/check-consent-disclosure-registry.mjs";
import { PRIMARY_OWNER_SELF_DISCLOSURE } from "../../../../packages/budget-application/src/creation-confirmation/disclosure.ts";

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
  it("registers no kind the API cannot present", () => {
    assert.deepEqual([...new Set(entries.map((entry) => entry.kind))], [PRIMARY_OWNER_SELF_DISCLOSURE]);
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
