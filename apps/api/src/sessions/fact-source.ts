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
 *   idp_evidence   -> `assurance.level: "session"` for a resolved subject.
 *                     Fresh assurance is not issued by this packet, so the
 *                     minimum level is asserted and never a stronger one.
 *
 * A subject whose lifecycle is disabled or security-blocked has no
 * `subject.subjectState` leaf at all: the p1 vocabulary cannot name those
 * states, so the assembler's provenance check denies as `input_invalid`
 * rather than this adapter inventing a value.
 */
import type { DataAccessClient } from "@cobudget/data-access";
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
  /** Additional datastore leaves supplied by another package (budget space, membership, bootstrap state). Merged after the subject/profile leaves. */
  readonly extend?: FactReader | undefined;
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
      if (source === "idp_evidence") return { "assurance.level": "session" };
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
