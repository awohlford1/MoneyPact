/**
 * The approved consent disclosure registry, as the API reads it
 * (CBD236-CONSENT-SEMANTICS-001 item 3;
 * docs/cbd-236-consent-facts-proposal.md SS5 `CF-236-005`).
 *
 * STARTUP GUARD. `loadConsentDisclosureRegistry` is called once while the
 * budget modules are composed, before any listener effect, and throws when the
 * registry does not reproduce: a missing file, a malformed entry, a content
 * file whose canonical digest is not the one pinned beside it, or a kind the
 * running routes need that is not registered. The process then fails to start,
 * exactly as an unsupported policy version does for the policy release history
 * (CBD-236 SS6). A disclosure text that was edited after approval must never
 * be shown to anyone, and must never be cited by a consent row as though it
 * were the approved text.
 *
 * The digest is taken over the parsed content's canonical (key-sorted) form,
 * so a reformatted file with the same content still reproduces, while a
 * changed word does not. `scripts/check-consent-disclosure-registry.mjs`
 * applies the same rule at build time, plus the append-only rule that only a
 * git history can express.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PRIMARY_OWNER_SELF_DISCLOSURE } from "../../../../packages/budget-application/src/creation-confirmation/disclosure.ts";
import type { ConsentDisclosure, ConsentDisclosureSource } from "../../../../packages/budget-application/src/creation-confirmation/disclosure.ts";

const REGISTRY_PATH = "config/consent-disclosure-registry.json";
/** Every disclosure kind the API's routes can present or record. A kind the registry does not carry fails startup. */
export const REQUIRED_DISCLOSURE_KINDS: readonly string[] = [PRIMARY_OWNER_SELF_DISCLOSURE];

export class ConsentDisclosureRegistryError extends Error {}

/** Key-sorted serialization; the same canonical form the build-time guard digests. */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(",")}}`;
}
const digestOf = (value: unknown): string => createHash("sha256").update(canonicalize(value)).digest("hex");

/** Walks up to the checkout root, the same way the policy release history is located. */
export function repositoryRootFrom(start: string): string {
  let directory = start;
  while (!existsSync(join(directory, REGISTRY_PATH))) {
    const parent = dirname(directory);
    if (parent === directory) throw new ConsentDisclosureRegistryError(`consent_disclosure_registry_not_found: ${REGISTRY_PATH}`);
    directory = parent;
  }
  return directory;
}

interface RegistryEntry { kind?: unknown; version?: unknown; digest?: unknown; text_ref?: unknown }

/**
 * Builds the source from already-parsed inputs. Exported so the startup guard's
 * failures can be driven in a unit test without a checkout on disk.
 * `contents` maps a `text_ref` to the parsed content file.
 */
export function buildConsentDisclosureSource(entries: unknown, contents: Readonly<Record<string, unknown>>, requiredKinds: readonly string[] = REQUIRED_DISCLOSURE_KINDS): ConsentDisclosureSource {
  if (!Array.isArray(entries)) throw new ConsentDisclosureRegistryError("consent_disclosure_registry_malformed");
  const current = new Map<string, ConsentDisclosure>();
  const byVersion = new Map<string, ConsentDisclosure>();
  for (const [index, value] of entries.entries()) {
    const entry = value as RegistryEntry;
    const { kind, version, digest, text_ref: reference } = entry ?? {};
    if (typeof kind !== "string" || !kind || !Number.isSafeInteger(version) || (version as number) < 1
      || typeof digest !== "string" || !/^[0-9a-f]{64}$/u.test(digest) || typeof reference !== "string" || !reference) {
      throw new ConsentDisclosureRegistryError(`consent_disclosure_registry_entry_malformed: index ${index}`);
    }
    const content = contents[reference];
    if (content === undefined) throw new ConsentDisclosureRegistryError(`consent_disclosure_content_missing: ${reference}`);
    if (digestOf(content) !== digest) throw new ConsentDisclosureRegistryError(`consent_disclosure_digest_mismatch: ${reference}`);
    const text = content as { kind?: unknown; version?: unknown; heading?: unknown; items?: unknown; acknowledgement?: unknown };
    if (text.kind !== kind || text.version !== version) throw new ConsentDisclosureRegistryError(`consent_disclosure_content_mismatch: ${reference}`);
    if (typeof text.heading !== "string" || !text.heading || !Array.isArray(text.items) || text.items.length === 0
      || typeof text.acknowledgement !== "string" || !text.acknowledgement) {
      throw new ConsentDisclosureRegistryError(`consent_disclosure_content_incomplete: ${reference}`);
    }
    const previous = current.get(kind);
    // Append-only and dense from 1, so the highest version is the current one and no stored flag can disagree.
    if ((previous?.version ?? 0) + 1 !== version) throw new ConsentDisclosureRegistryError(`consent_disclosure_version_not_dense: ${kind} version ${version}`);
    const disclosure: ConsentDisclosure = Object.freeze({ kind, version: version as number, digest,
      text: Object.freeze({ heading: text.heading, items: Object.freeze([...text.items] as ConsentDisclosure["text"]["items"]), acknowledgement: text.acknowledgement }) });
    current.set(kind, disclosure);
    // Every approved version the file still carries, not only each kind's
    // highest -- what `at(kind, version)` (`GAPS-F03` follow-up, `TCF-02`)
    // answers, so a view can still show the text a party actually read after
    // the registry's current version moved past it, as long as this loader's
    // one authoritative file still keeps that entry.
    byVersion.set(`${kind}:${version as number}`, disclosure);
  }
  for (const kind of requiredKinds) {
    if (!current.has(kind)) throw new ConsentDisclosureRegistryError(`consent_disclosure_kind_unregistered: ${kind}`);
  }
  return {
    current(kind: string): ConsentDisclosure {
      const disclosure = current.get(kind);
      if (!disclosure) throw new ConsentDisclosureRegistryError(`consent_disclosure_kind_unregistered: ${kind}`);
      return disclosure;
    },
    at(kind: string, version: number): ConsentDisclosure | null {
      return byVersion.get(`${kind}:${version}`) ?? null;
    },
  };
}

/** Reads and verifies the registry from the checkout. Throws on anything that does not reproduce. */
export function loadConsentDisclosureRegistry(start: string = dirname(fileURLToPath(import.meta.url))): ConsentDisclosureSource {
  const root = repositoryRootFrom(start);
  const entries: unknown = JSON.parse(readFileSync(join(root, REGISTRY_PATH), "utf8"));
  const contents: Record<string, unknown> = {};
  for (const entry of Array.isArray(entries) ? entries : []) {
    const reference = (entry as RegistryEntry)?.text_ref;
    if (typeof reference !== "string" || Object.hasOwn(contents, reference)) continue;
    try { contents[reference] = JSON.parse(readFileSync(join(root, reference), "utf8")); }
    catch { /* Reported as a missing content file by the builder, with the reference named. */ }
  }
  return buildConsentDisclosureSource(entries, contents);
}
