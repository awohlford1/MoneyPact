import assert from "node:assert/strict";
import { bootstrapFixture, expectedProvenance, sha256 } from "@cobudget/contracts/authorization";
import type { FactSource, PolicyAuditEvent, PolicyInput } from "@cobudget/contracts/authorization";
import { RestrictedAudit } from "./audit.js";
import { AuthorizationBoundary } from "./boundary.js";
import type { AuthorizationTransactionStore } from "./boundary.js";
import { SUPPORTED_POLICY_TUPLES } from "./compatibility.js";
import { FactAssembler } from "./facts.js";
import type { FactLookup, FactSourceAdapter, Operation } from "./facts.js";

/** Synthetic approvals for isolated tests only; never a runtime release row. */
export const testHistory = [{ version: "p6", digest: SUPPORTED_POLICY_TUPLES[0]!.expectedDigest, schemaVersion: 1, releaseCommit: "test-only", productApprovalRef: "test-only-product", securityApprovalRef: "test-only-security" }];
export const testGovernance = { retentionClass: "test-only", deletionPolicyVersion: "test-only", retentionApprovalRef: "test-only", reasonVocabularyApprovalRef: "test-only" };
export interface TestState {
  spaces: string[]; memberships: string[]; effects: string[]; derived: string[]; notifications: string[]; versions: number[];
  primaryOwners: Record<string, string[]>;
  audits: Partial<PolicyAuditEvent>[]; consumed: string[]; effectIds: string[];
}
export const emptyState = (): TestState => ({ spaces: [], memberships: [], primaryOwners: {}, effects: [], derived: [], notifications: [], versions: [], audits: [], consumed: [], effectIds: [] });
function leaf(input: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined, input);
}
export function operationFor(input: PolicyInput): Operation {
  return { action: input.request.action, purpose: input.request.purpose, mode: input.authority.mode, fieldSet: input.request.fieldSet,
    ...(input.resource && input.space ? { resourceType: input.resource.type, resourceId: input.resource.id, actingSpaceId: input.space.spaceId } : {}),
    ...(input.membership ? { actingMembershipId: input.membership.membershipId } : {}),
    // p2 subject-scoped variant: route metadata names the scope and, for a subject-target cell, the subject-owned row.
    ...(input.environment ? { scope: "subject" as const, ...(input.resource ? { resourceType: input.resource.type, resourceId: input.resource.id } : {}) } : {}),
    ...(input.subject?.delegationRef ? { delegationRef: input.subject.delegationRef } : {}),
  };
}
export class Harness {
  input: PolicyInput;
  state = emptyState();
  order: string[] = [];
  reads: { source: FactSource; transaction: boolean }[] = [];
  missing: FactSource | undefined;
  corrupt: ((source: FactSource, facts: Record<string, unknown>) => void) | undefined;
  failAudit = false;
  obligations = true;
  failCommit = false;
  operationsFailures = 0;
  readonly source: FactSourceAdapter;
  readonly store: AuthorizationTransactionStore;
  readonly audit: RestrictedAudit;
  readonly boundary: AuthorizationBoundary;
  #tail = Promise.resolve();
  constructor(input: PolicyInput = bootstrapFixture()) {
    this.input = structuredClone(input);
    this.source = { read: async (source, lookup, transaction) => {
      this.reads.push({ source, transaction: transaction !== undefined });
      if (source === this.missing || !lookup.credential) return null;
      const result: Record<string, unknown> = {};
      for (const [path, producer] of Object.entries(expectedProvenance(this.input))) if (producer === source) result[path] = structuredClone(leaf(this.input, path));
      if (source === "datastore" && lookup.candidates) {
        const state = transaction as TestState | undefined ?? this.state;
        result["bootstrap.spaceState"] = state.spaces.includes(lookup.candidates.spaceId) ? "present" : "absent";
        result["bootstrap.primaryMembershipState"] = state.memberships.includes(lookup.candidates.membershipId) ? "present" : "absent";
      }
      this.corrupt?.(source, result);
      return result;
    } };
    this.store = {
      transaction: async <T>(work: (transaction: unknown) => Promise<T>): Promise<T> => {
        const previous = this.#tail;
        let release: () => void = () => undefined;
        this.#tail = new Promise<void>((resolve) => { release = resolve; });
        await previous;
        const draft = structuredClone(this.state); this.order.push("begin");
        try {
          const result = await work(draft);
          if (this.failCommit) throw new Error("conditional write failed");
          this.state = draft; this.order.push("commit"); return result;
        } catch (error) { this.order.push("rollback"); throw error; }
        finally { release(); }
      },
      discharge: async (transaction, current, obligation) => {
        if (!this.obligations) return false;
        if (obligation.kind === "create_primary_owner_membership" && current.bootstrap) {
          const state = transaction as TestState;
          if (state.spaces.includes(current.bootstrap.candidateSpaceId) || state.memberships.includes(current.bootstrap.candidatePrimaryMembershipId)) return false;
          state.memberships.push(current.bootstrap.candidatePrimaryMembershipId);
          state.primaryOwners[current.bootstrap.candidateSpaceId] = [current.bootstrap.candidatePrimaryMembershipId];
          return true;
        }
        return obligation.kind === "fresh_assurance";
      },
      verify: async (transaction, current) => {
        if (!current.bootstrap) return true;
        const state = transaction as TestState;
        return state.spaces.filter((id) => id === current.bootstrap!.candidateSpaceId).length === 1
          && state.memberships.filter((id) => id === current.bootstrap!.candidatePrimaryMembershipId).length === 1
          && JSON.stringify(state.primaryOwners[current.bootstrap.candidateSpaceId]) === JSON.stringify([current.bootstrap.candidatePrimaryMembershipId]);
      },
    };
    this.audit = new RestrictedAudit({ append: async (build, transaction) => {
      const state = transaction as TestState | undefined ?? this.state;
      const prior = state.audits.at(-1);
      if (prior) { const { eventDigest, ...body } = prior; assert.equal(eventDigest, sha256(body)); }
      const event = build(state.audits.length + 1, prior?.eventDigest ?? "0".repeat(64));
      if (this.failAudit) throw new Error("audit unavailable");
      state.audits.push(event); this.order.push(event.outcome === "deny" ? "deny-audit" : "allow-audit");
    } }, testGovernance);
    // The configured environment (runtime_configuration) is the fixture's own environment, as a real process would stamp it from its configuration.
    const runtime = input.environment ? { environmentId: input.environment.environmentId } : undefined;
    this.boundary = new AuthorizationBoundary(new FactAssembler(input.evaluation.adapter, this.source, () => new Date(input.evaluation.evaluatedAt), 5_000, undefined, runtime), this.store, this.audit, () => { this.operationsFailures++; });
  }
  lookup(): FactLookup { return { operation: operationFor(this.input), credential: "opaque" }; }
}
