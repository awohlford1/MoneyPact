import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { URL, fileURLToPath } from "node:url";
import { it } from "node:test";

/**
 * Crash-safe scratch space for the self-tests that must break approval
 * evidence to prove the guard catches it (F-BFIX-03 item 1).
 *
 * The rule this enforces is that a self-test writes NOTHING inside the
 * repository, so there is no restore to be interrupted: a run killed at any
 * instant leaves the working tree exactly as it found it, and the next run
 * cannot fail because of this one. Three things make that true rather than
 * merely intended.
 *
 *  1. `scratch()` refuses any path that resolves inside the repository, so a
 *     later edit cannot quietly reintroduce an in-tree mutate-and-restore.
 *  2. The temp directory is removed in `finally` and again on process exit and
 *     on SIGINT/SIGTERM, so an interrupted run leaves no residue even outside
 *     the tree.
 *  3. `assertRegistryUntouched()` digests every config/rate-limit file before
 *     and after the mutating test. A write that escaped 1 and 2 fails the
 *     guard's own suite instead of surfacing as an unexplained exit 1 on
 *     somebody else's branch a day later.
 */
const REPOSITORY_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const REGISTRY_DIRECTORY = join(REPOSITORY_ROOT, "config", "rate-limit");
const scratchDirectories = new Set();

function removeScratchDirectories() {
  for (const directory of scratchDirectories) rmSync(directory, { recursive: true, force: true });
  scratchDirectories.clear();
}
process.once("exit", removeScratchDirectories);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => { removeScratchDirectories(); process.exit(130); });
}

/** A temp directory the run owns, proven to be outside the repository. */
function scratch(prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  const inside = relative(REPOSITORY_ROOT, directory);
  assert.ok(inside.startsWith("..") || inside.includes(`..${sep}`) || resolve(directory) !== resolve(REPOSITORY_ROOT, inside),
    `scratch space must be outside the repository, got ${directory}`);
  assert.ok(!resolve(directory).startsWith(REPOSITORY_ROOT + sep), `scratch space must be outside the repository, got ${directory}`);
  scratchDirectories.add(directory);
  return directory;
}

/** Digest of every approved-record file, so a stray write is named by this suite. */
function registryDigests() {
  return readdirSync(REGISTRY_DIRECTORY).sort().map((name) =>
    `${name}:${createHash("sha256").update(readFileSync(join(REGISTRY_DIRECTORY, name))).digest("hex")}`);
}
import { checkInventory, printReport } from "./check-rate-limit-registry.mjs";
import { loadPrototypeRegistry, loadRegistrations, seal, validateRegistry, prototypeApprovalContext } from "../packages/rate-limit/src/index.ts";

it("prints all six sorted diagnostic sections, fails deliberate omissions, then passes restored inventory", () => {
  const registrations = loadRegistrations(); const registry = loadPrototypeRegistry();
  const discovered = registrations.map((r) => ({ id: r.registration_id, source: r.source_locator }));
  const output = []; const write = (line) => output.push(line);
  assert.equal(printReport(checkInventory([...discovered, { id: "api:GET:/negative", source: "negative-api-fixture" }, { id: "job:worker:negative:1", source: "negative-worker-fixture" }], registrations, registry), write), false);
  assert.ok(output.some((line) => line.includes("api:GET:/negative")));
  assert.ok(output.some((line) => line.includes("job:worker:negative:1")));
  assert.equal(printReport(checkInventory(discovered, registrations, registry), write), true);
  assert.equal(output.filter((line) => /^[A-Z_]+ \(/.test(line)).length, 12);
});
it("fails stale, duplicate, unknown and pending parameter bindings", () => {
  const registry = loadPrototypeRegistry(); const registrations = loadRegistrations();
  const bounded = { ...registrations[0], registration_id: "api:POST:/new", surface_id: "surf-266-budget-mutation", parameter_record_id: "rlp-266-mutation-v1", authorization_metadata_id: "test-only" };
  const report = checkInventory([], [...registrations, bounded, { ...bounded, surface_id: "surf-266-unknown" }], registry);
  assert.ok(report.UNKNOWN_SURFACES.length); assert.ok(report.MISSING_OR_UNAPPROVED_PARAMETER_RECORDS.length); assert.ok(report.STALE_REGISTRATIONS.length);
  const duplicates = checkInventory([{ id: "api:POST:/new", source: "fixture" }], [bounded, bounded], registry);
  assert.ok(duplicates.DUPLICATE_REGISTRATIONS.length);
});

it("rejects a route bound to an explicitly pending record", () => {
  const records = loadPrototypeRegistry().records.map((r) => seal({ ...r, product_owner_approval: { ...r.product_owner_approval, status: "pending" } }));
  const registry = validateRegistry(records, prototypeApprovalContext());
  const registration = { registration_id: "api:GET:/pending", executor_kind: "api_route", source_locator: "fixture.ts#pending", surface_id: "surf-266-budget-read", parameter_record_id: "rlp-266-authenticated-read-v1", registration_lifecycle: "active", introduced_by: "test", authorization_metadata_id: "test" };
  const report = checkInventory([{ id: registration.registration_id, source: registration.source_locator }], [registration], registry);
  assert.deepEqual(report.MISSING_OR_UNAPPROVED_PARAMETER_RECORDS, [registration.registration_id]);
});

it("guard fails a changed approval digest and passes restored evidence, writing nothing inside the repository", () => {
  const before = registryDigests();
  const dir = scratch("rate-limit-guard-"); const path = join(dir, "approvals.json");
  const original = readFileSync(new URL("../config/rate-limit/approvals.json", import.meta.url), "utf8");
  const registrations = loadRegistrations();
  const discovered = registrations.map((r) => ({ id: r.registration_id, source: r.source_locator }));
  try {
    const evidence = JSON.parse(original); evidence[0].candidateDigests[0] = "0".repeat(64);
    writeFileSync(path, JSON.stringify(evidence));
    const broken = loadPrototypeRegistry(path);
    assert.equal(printReport(checkInventory(discovered, registrations, broken)), false);
    assert.ok(broken.diagnostics.some((d) => d.code === "approval_evidence_invalid"));
    writeFileSync(path, original);
    const restored = loadPrototypeRegistry(path);
    assert.equal(printReport(checkInventory(discovered, registrations, restored)), true);
    // Five prototype sets plus rlp-266-identity-session-v1 and rlp-266-identity-ceremony-v1, projected next
    // to rlp-266-bootstrap-v1 on a disjoint stage set (CBD266-IDENTITY-RECORDS-001, CBD266-SURFACE-STAGES-001),
    // plus the six invitation records of CBD266-INVITATION-RECORDS-001 (PK-6): rlp-266-invitation-ceremony-v1
    // on surf-266-invitation-accept and the projected create, resend, cancel, inspect and local-delivery records.
    assert.equal(restored.approved.size, 13);
    console.log("Restored approval evidence: approved=13");
  } finally { rmSync(dir, { recursive: true, force: true }); scratchDirectories.delete(dir); }
  // F-BFIX-03 item 1: nothing under config/rate-limit changed, so no restore
  // of a repository file could have been interrupted.
  assert.deepEqual(registryDigests(), before, "the self-test must leave config/rate-limit byte-identical");
});
