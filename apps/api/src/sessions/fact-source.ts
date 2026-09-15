/**
 * The API's composed `FactSourceAdapter` (PROTO-WIRE-01/02).
 *
 *   session_store  -> `buildSessionFactSourceAdapter` (CBD-191): the opaque
 *                     cookie value resolves to `subject.accountSubjectId`,
 *                     `subject.sessionRef`, `subject.sessionVersion`, or null.
 *   datastore      -> the resolved subject's own lifecycle/version and its
 *                     one active financial profile, read through the
 *                     transaction-scoped client when the boundary supplies
 *                     one (commit-time recheck) and the root client otherwise.
 *                     Budget-space, membership, consent, resource and
 *                     bootstrap leaves are not produced here; the package
 *                     that owns them layers its reader through `extend`.
 *   idp_evidence   -> the acting session's assurance. `"session"` unless a
 *                     completed step-up (PK-4, CBD-234 design section 10.4)
 *                     left an unconsumed, unexpired
 *                     `account_session_fresh_assurance` grant bound to
 *                     exactly this request's action and acting space, in
 *                     which case `{ level: "fresh", boundAction,
 *                     boundSpaceId, expiresAt }` -- the four leaves
 *                     `decide` re-proves for a protected cell
 *                     (packages/contracts evaluate.ts section 8.2). The
 *                     match is equality on both dimensions, so a grant for
 *                     another action or another space is not a weaker fact
 *                     here, it is simply absent and the level stays
 *                     `session`.
 *
 * A subject whose lifecycle is disabled or security-blocked has no
 * `subject.subjectState` leaf at all: the p1 vocabulary cannot name those
 * states, so the assembler's provenance check denies as `input_invalid`
 * rather than this adapter inventing a value.
 */
import type { DataAccessClient } from "@cobudget/data-access";
import { findUsableFreshAssurance } from "@cobudget/sessions";
import type { MinimalFactSourceAdapter } from "@cobudget/sessions";
import type { FactLookup, FactSourceAdapter } from "../authorization/facts.js";
import type { FactSource } from "@cobudget/contracts/authorization";
import { findSubject, listProfiles } from "../identity/store.ts";

export type FactReader = (source: FactSource, lookup: FactLookup, client: DataAccessClient) => Promise<Readonly<Record<string, unknown>> | null>;

function subjectStateLeaf(lifecycle: string): "active" | "deletion_requested" | "deleted" | undefined {
  if (lifecycle === "active") return "active";
  if (lifecycle === "deletion_pending") return "deletion_requested";
  if (lifecycle === "deleted") return "deleted";
  return undefined;
}

export interface ApiFactSourceOptions {
  readonly sessions: MinimalFactSourceAdapter;
  readonly client: DataAccessClient;
  /** Clock for the grant's expiry comparison; the assembler's own clock in composition. */
  readonly now?: (() => Date) | undefined;
  /** Additional datastore leaves supplied by another package (budget space, membership, bootstrap state). Merged after the subject/profile leaves. */
  readonly extend?: FactReader | undefined;
}

/**
 * PK-4. The `idp_evidence` leaves for the acting session.
 *
 * This is a pure read. Consuming the grant is not done here and must not be:
 * `AuthorizationBoundary.execute` assembles the facts a second time inside
 * the mutation transaction and requires the second decision's `inputDigest`
 * to equal the precheck's, so a fact source that changed state as it read
 * would make the two reads disagree. The grant is spent where the allow
 * actually happens -- the boundary discharges the cell's own
 * `fresh_assurance` obligation, inside the same transaction, after the
 * commit-time re-decision allowed (`transaction-store.ts`). A rolled-back
 * effect rolls the consumption back with it.
 *
 * A request that names no acting space (a subject-scoped cell, or the
 * bootstrap action) can hold no space-bound grant, so it reports `session`
 * without reading anything.
 */
async function readAssurance(options: ApiFactSourceOptions, lookup: FactLookup, transaction?: unknown): Promise<Readonly<Record<string, unknown>>> {
  const sessionAssurance = { "assurance.level": "session" } as const;
  const sessionRef = lookup.identity?.["subject.sessionRef"];
  const action = lookup.operation.action;
  const spaceId = lookup.operation.actingSpaceId;
  if (typeof sessionRef !== "string" || !sessionRef || !action || typeof spaceId !== "string" || !spaceId) return sessionAssurance;
  const client = (transaction as DataAccessClient | undefined) ?? options.client;
  const now = (options.now ?? (() => new Date()))();
  const grant = await findUsableFreshAssurance(client, { sessionRef, boundAction: action, boundSpaceId: spaceId, now }).catch(() => undefined);
  if (!grant) return sessionAssurance;
  return {
    "assurance.level": "fresh",
    "assurance.boundAction": grant.boundAction,
    "assurance.boundSpaceId": grant.boundSpaceId,
    "assurance.expiresAt": grant.expiresAt.toISOString(),
  };
}

export function createApiFactSource(options: ApiFactSourceOptions): FactSourceAdapter {
  return {
    async read(source, lookup, transaction) {
      if (source === "session_store") {
        // The opaque cookie value only; the sessions adapter resolves it.
        const value = lookup.credential;
        return options.sessions.read(source, { credential: value }, transaction);
      }
      const subjectId = lookup.identity?.["subject.accountSubjectId"];
      if (typeof subjectId !== "string" || subjectId.length === 0) return null;
      if (source === "idp_evidence") return readAssurance(options, lookup, transaction);
      if (source !== "datastore") return null;
      const client = (transaction as DataAccessClient | undefined) ?? options.client;
      const subject = await findSubject(client, subjectId);
      if (!subject) return null;
      const facts: Record<string, unknown> = { "subject.subjectVersion": subject.lifecycleVersion };
      const state = subjectStateLeaf(subject.lifecycleState);
      if (state) facts["subject.subjectState"] = state;
      const profiles = await listProfiles(client, subjectId);
      const active = profiles.filter((profile) => profile.profileState === "active");
      if (active.length === 1) {
        facts["profile.profileId"] = active[0]!.profileId;
        facts["profile.profileState"] = "active";
        facts["profile.profileVersion"] = active[0]!.version;
      } else if (profiles.length === 0) {
        facts["profile.profileState"] = "absent";
      }
      if (options.extend) {
        const extra = await options.extend(source, lookup, client);
        if (extra) Object.assign(facts, extra);
      }
      return facts;
    },
  };
}
