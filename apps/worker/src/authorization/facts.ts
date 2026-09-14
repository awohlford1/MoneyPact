import { randomUUID } from "node:crypto";
import { expectedProvenance } from "@cobudget/contracts/authorization";
import type { CapturedVersions, FactSource, PolicyInput, ResourceType } from "@cobudget/contracts/authorization";

export interface Operation {
  readonly action: string;
  readonly resourceType?: ResourceType;
  readonly resourceId?: string;
  readonly actingSpaceId?: string;
  readonly actingMembershipId?: string;
  readonly delegationRef?: string;
  readonly purpose: string;
  readonly mode: "user_delegated" | "service";
  readonly fieldSet: "default" | readonly string[];
  /** Opaque server-resolved reference; never populated from request fields. */
  readonly proposalReference?: string;
  /** Route metadata: the CBD-236 v0.5 subject-scoped variant (section 4.4). `resourceType`/`resourceId` name the
   * subject-owned target row for a subject-target cell; no acting space or membership exists in this scope. */
  readonly scope?: "subject";
}
export type CreationCandidates = Readonly<{ spaceId: string; membershipId: string }>;
/** Trusted composition supplies persisted candidates for a resolved proposal. */
export type ProposalCandidateProvider = (operation: Operation) => Promise<CreationCandidates>;
export interface FactLookup {
  readonly operation: Operation;
  readonly credential: unknown;
  readonly identity?: Readonly<Record<string, unknown>>;
  readonly candidates?: Readonly<{ spaceId: string; membershipId: string }>;
  readonly signal?: AbortSignal;
}
/** Trusted server adapters return leaf values from the named producer only.
 * They must enforce subject/profile/membership associations in their queries.
 * Transactional reads must lock or condition every authority row through commit.
 * No request body or complete client-supplied PolicyInput enters this interface.
 */
export interface FactSourceAdapter {
  read(source: FactSource, lookup: FactLookup, transaction?: unknown): Promise<Readonly<Record<string, unknown>> | null>;
}
/** Trusted runtime configuration of the receiving process (section 4.4): the configured environment
 * stamped with `runtime_configuration` provenance. Never read from a request, cookie or row. */
export interface AssemblerRuntime { readonly environmentId: string }
export class FactFailure extends Error {
  readonly reason: "not_authenticated" | "input_invalid";
  constructor(reason: "not_authenticated" | "input_invalid") { super(reason); this.reason = reason; }
}

const paths = (value: string): string[] => value.trim().split(/\s+/);
const datastore = paths(`
  subject.subjectState subject.subjectVersion profile.profileId profile.profileState profile.profileVersion
  space.spaceId space.lifecycle space.lifecycleVersion space.primaryOwnerMembershipId
  membership.membershipId membership.role membership.status membership.authorizationVersion
  membership.viewerProfile.type membership.viewerProfile.groupIds membership.viewerProfile.version
  consent.consentId consent.disclosureVersion consent.state resource.owningSpaceId resource.version
  resource.lifecycle resource.authorizerSubjectId resource.authorSubjectId
  resource.owningSubjectId resource.environmentId
  bootstrap.spaceState bootstrap.primaryMembershipState
`);
/** Leaves a subject-scoped input may carry from the datastore: the subject and profile rows, plus the subject-owned target row. */
const SUBJECT_SCOPED_DATASTORE = /^(subject|profile)\.|^resource\.(owningSpaceId|version|lifecycle|owningSubjectId|environmentId)$/;
const assurance = ["assurance.level", "assurance.boundAction", "assurance.boundSpaceId", "assurance.expiresAt"];
const producers: Partial<Record<FactSource, readonly string[]>> = {
  session_store: ["subject.accountSubjectId", "subject.sessionRef", "subject.sessionVersion"],
  delegation_store: ["subject.accountSubjectId", "subject.delegationRef", "subject.delegationVersion", "authority.mode", "request.purpose", ...assurance],
  workload_identity: paths("authority.mode authority.servicePurpose authority.serviceIdentity authority.workloadIdentityVersion"),
  datastore,
  idp_evidence: assurance,
  server_policy_store: paths("authority.servicePolicyVersion authority.sourceVersion serviceSource.scheduleConfigurationVersion serviceSource.ruleReferenceDataVersion serviceSource.sourceState request.purpose"),
};

function put(record: Record<string, unknown>, path: string, value: unknown): void {
  const [section, field] = path.split(".");
  if (!section || !field) throw new FactFailure("input_invalid");
  const parts = path.split(".");
  let target = record;
  for (const part of parts.slice(0, -1)) {
    target[part] ??= {};
    target = target[part] as Record<string, unknown>;
  }
  target[parts.at(-1)!] = structuredClone(value);
}

function validLeaf(path: string, value: unknown): boolean {
  if (/(?:Id|Ref)$/.test(path)) return typeof value === "string" && value.length > 0 && value.length <= 256;
  if (/(?:Version|\.version)$/.test(path)) return Number.isSafeInteger(value) && (value as number) >= 0;
  return value !== undefined && value !== null;
}

export class FactAssembler {
  readonly #source: FactSourceAdapter;
  readonly #adapter: "api" | "worker";
  readonly #clock: () => Date;
  readonly #timeoutMs: number;
  readonly #proposalCandidates: ProposalCandidateProvider | undefined;
  readonly #runtime: AssemblerRuntime | undefined;
  constructor(adapter: "api" | "worker", source: FactSourceAdapter, clock: () => Date = () => new Date(), timeoutMs = 5_000, proposalCandidates?: ProposalCandidateProvider, runtime?: AssemblerRuntime) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5_000) throw new Error("invalid_fact_deadline");
    if (runtime !== undefined && !validLeaf("environmentId", runtime.environmentId)) throw new Error("invalid_runtime_environment");
    this.#adapter = adapter; this.#source = source; this.#clock = clock; this.#timeoutMs = timeoutMs;
    this.#proposalCandidates = proposalCandidates; this.#runtime = runtime;
  }
  async candidates(operation: Operation): Promise<CreationCandidates> {
    if (operation.proposalReference === undefined) return { spaceId: randomUUID(), membershipId: randomUUID() };
    if (!this.#proposalCandidates || operation.action !== "space.create" || this.#adapter !== "api") throw new FactFailure("input_invalid");
    const candidates = await this.#proposalCandidates(operation);
    if (!validLeaf("spaceId", candidates.spaceId) || !validLeaf("membershipId", candidates.membershipId)) throw new FactFailure("input_invalid");
    return { spaceId: candidates.spaceId, membershipId: candidates.membershipId };
  }

  async #read(source: FactSource, lookup: FactLookup, transaction?: unknown): Promise<Readonly<Record<string, unknown>> | null> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.#source.read(source, { ...lookup, signal: controller.signal }, transaction),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new FactFailure(source === "session_store" ? "not_authenticated" : "input_invalid")); }, this.#timeoutMs);
        }),
      ]);
    } finally { clearTimeout(timer); controller.abort(); }
  }

  /** Prerequisite identity read only; no metadata, resource lookup or policy evaluation. */
  async resolveSession(credential: unknown): Promise<string> {
    const identity = await this.#read("session_store", { credential, operation: { action: "", purpose: "user_delegated", mode: "user_delegated", fieldSet: "default" } });
    const actor = identity?.["subject.accountSubjectId"];
    if (typeof actor !== "string" || !actor.length || actor.length > 256) throw new FactFailure("not_authenticated");
    return actor;
  }

  async assemble(lookup: FactLookup, transaction?: unknown, captured?: CapturedVersions): Promise<PolicyInput> {
    const { operation } = lookup;
    const bootstrap = operation.action === "space.create";
    // Section 4.4: the subject-scoped variant exists only on the api adapter, only for user-delegated
    // authority, never for the bootstrap action, and only when the process configuration names an environment.
    const subjectScoped = operation.scope === "subject";
    if (subjectScoped && (this.#adapter !== "api" || bootstrap || operation.mode !== "user_delegated" || !this.#runtime)) throw new FactFailure("input_invalid");
    if ((this.#adapter === "api" && operation.mode !== "user_delegated") || (bootstrap && this.#adapter !== "api")) throw new FactFailure("input_invalid");
    const first: FactSource = operation.mode === "service" ? "workload_identity" : this.#adapter === "api" ? "session_store" : "delegation_store";
    let identity: Readonly<Record<string, unknown>> | null;
    try { identity = await this.#read(first, lookup, transaction); }
    catch { throw new FactFailure(first === "session_store" ? "not_authenticated" : "input_invalid"); }
    const id = identity?.[operation.mode === "service" ? "authority.serviceIdentity" : "subject.accountSubjectId"];
    if (!identity || typeof id !== "string" || id.length === 0) throw new FactFailure(first === "session_store" ? "not_authenticated" : "input_invalid");
    const request: Record<string, unknown> = { action: operation.action, fieldSet: operation.fieldSet };
    const input: Record<string, unknown> = {
      request, authority: {}, versions: { policyVersion: "p3", ...(captured ? { capturedAtPrecheck: structuredClone(captured) } : {}) },
      evaluation: { adapter: this.#adapter, inputSchemaVersion: 1, evaluatedAt: this.#clock().toISOString() },
    };
    const selected = [first, "datastore", ...(this.#adapter === "api" ? ["idp_evidence"] : []), ...(operation.mode === "service" ? ["server_policy_store"] : [])] as FactSource[];
    const provenance: Record<string, FactSource> = {};
    for (const source of selected) {
      const facts = source === first ? identity : await this.#read(source, { ...lookup, identity }, transaction);
      if (!facts) throw new FactFailure("input_invalid");
      for (const path of producers[source] ?? []) {
        if (bootstrap && /^(space|membership|consent|resource)\./.test(path)) continue;
        if (!bootstrap && path.startsWith("bootstrap.")) continue;
        if (subjectScoped && source === "datastore" && !SUBJECT_SCOPED_DATASTORE.test(path)) continue;
        if (subjectScoped && operation.resourceType === undefined && path.startsWith("resource.")) continue;
        if (!subjectScoped && /^resource\.(owningSubjectId|environmentId)$/.test(path)) continue;
        if (operation.mode === "service" && /^(subject|profile|membership|consent)\./.test(path)) continue;
        if (Object.hasOwn(facts, path)) {
          if (!validLeaf(path, facts[path])) throw new FactFailure(source === "session_store" ? "not_authenticated" : "input_invalid");
          put(input, path, facts[path]); provenance[path] = source;
        }
      }
    }
    if (this.#adapter === "api") {
      request.purpose = "user_delegated";
      input.authority = { mode: "user_delegated" };
    }
    if (bootstrap) {
      if (!lookup.candidates) throw new FactFailure("input_invalid");
      put(input, "bootstrap.candidateSpaceId", lookup.candidates.spaceId);
      put(input, "bootstrap.candidatePrimaryMembershipId", lookup.candidates.membershipId);
    } else if (subjectScoped) {
      // The configured environment is a runtime fact; the target row (when the cell names one) was loaded by the
      // datastore through a statement keyed on environment and acting subject, and carries its own owner and
      // environment columns for `decide` to re-prove. An absent row leaves `resource` without its datastore leaves,
      // which fails the provenance comparison below (`input_invalid`) without any identifier-only lookup.
      if (operation.actingSpaceId !== undefined || operation.actingMembershipId !== undefined || operation.delegationRef !== undefined) throw new FactFailure("input_invalid");
      put(input, "environment.environmentId", this.#runtime!.environmentId);
      if (operation.resourceType !== undefined) {
        if (!operation.resourceId) throw new FactFailure("input_invalid");
        put(input, "resource.id", operation.resourceId); put(input, "resource.type", operation.resourceType);
        const resource = input.resource as Record<string, unknown>;
        if (resource.owningSpaceId !== "none" || !Object.hasOwn(resource, "owningSubjectId") || !Object.hasOwn(resource, "environmentId")) throw new FactFailure("input_invalid");
      } else if (operation.resourceId !== undefined || input.resource !== undefined) throw new FactFailure("input_invalid");
    } else {
      if (!operation.resourceId || !operation.resourceType || !operation.actingSpaceId) throw new FactFailure("input_invalid");
      put(input, "resource.id", operation.resourceId); put(input, "resource.type", operation.resourceType);
      const space = input.space as Record<string, unknown> | undefined;
      if (space?.spaceId !== operation.actingSpaceId) throw new FactFailure("input_invalid");
      if (operation.mode === "user_delegated" && (input.membership as Record<string, unknown> | undefined)?.membershipId !== operation.actingMembershipId) throw new FactFailure("input_invalid");
    }
    if ((input.authority as Record<string, unknown>).mode !== operation.mode || request.purpose !== operation.purpose) throw new FactFailure("input_invalid");
    if (first === "delegation_store" && (input.subject as Record<string, unknown>).delegationRef !== operation.delegationRef) throw new FactFailure("input_invalid");
    const assembled = input as unknown as PolicyInput;
    const expected = expectedProvenance(assembled);
    // Check producers actually used before stamping package-owned/locator leaves.
    for (const [path, source] of Object.entries(expected)) {
      if (producers[source] && provenance[path] !== source) throw new FactFailure("input_invalid");
    }
    return { ...assembled, provenance: expected };
  }
}

export const absentFactSource: FactSourceAdapter = { read: async () => null };
