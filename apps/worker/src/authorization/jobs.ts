import { surfaceOutcome } from "../../../../packages/rate-limit/src/index.ts";
import { WorkerRateLimits } from "../rate-limit/jobs.js";
import type { WorkerSurfaceGate } from "../rate-limit/jobs.js";
import type { KeyObject } from "node:crypto";
import { sha256, verifyLocalDecision } from "@cobudget/contracts/authorization";
import type { CapturedVersions, EffectClass, TransportedPolicyDecision } from "@cobudget/contracts/authorization";
import { AuthorizationBoundary } from "./boundary.js";
import { AuthorizationDenied } from "./boundary.js";
import { unavailableTransactions } from "./boundary.js";
import type { EffectContext } from "./boundary.js";
import { absentFactSource, FactAssembler } from "./facts.js";
import type { Operation } from "./facts.js";

export interface JobEnvelope {
  jobType: string;
  producerRef: string;
  operation: Operation;
  claimedVersions: CapturedVersions;
  claimedEffectClass: EffectClass;
  idempotencyKey: string;
  transportedDecision?: TransportedPolicyDecision;
}
export interface RegisteredJob {
  action: string;
  purpose: string;
  queueContractRef: string;
  run(context: EffectContext): Promise<unknown>;
}
export interface WorkerAuthorizationOptions {
  boundary: AuthorizationBoundary;
  rateLimit?: WorkerSurfaceGate;
  jobs: Readonly<Record<string, RegisteredJob>>;
  authenticateProducer(producerRef: string): Promise<unknown | null>;
  /** Durable unique receiver-owned relation, in the effect's transaction. */
  consumeTransport(context: EffectContext, envelope: TransportedPolicyDecision): Promise<boolean>;
  /** Durable material-effect identity, separate from transport consumption. */
  claimEffect(context: EffectContext, idempotencyKey: string): Promise<boolean>;
  localTransport?: { environment: "local"; publicKey: KeyObject; issuer: string; audience: string; maximumLifetimeMs: number };
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function text(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 256; }
function validTransport(value: unknown): boolean {
  if (!record(value)) return false;
  const keys = ["decision", "action", "targetBinding", "claimedEffectClass", "issuer", "audience", "issuedAt", "expiresAt", "oneUseId", "algorithm", "signature"];
  if (Object.keys(value).sort().join() !== keys.sort().join()) return false;
  if (!keys.filter((key) => key !== "decision").every((key) => text(value[key])) || !record(value.decision)) return false;
  const decisionKeys = ["outcome", "effectClass", "reasonClass", "policyVersion", "policyDigest", "cellRef", "inputDigest", "capturedVersions", "obligations", "decisionId", "evaluatedAt"];
  return value.algorithm === "Ed25519" && value.decision.outcome === "allow"
    && Object.keys(value.decision).sort().join() === decisionKeys.sort().join()
    && record(value.decision.capturedVersions) && record(value.decision.cellRef) && Array.isArray(value.decision.obligations);
}
function validEnvelope(value: unknown): value is JobEnvelope {
  if (!record(value)) return false;
  const required = ["jobType", "producerRef", "operation", "claimedVersions", "claimedEffectClass", "idempotencyKey"];
  if (!required.every((key) => Object.hasOwn(value, key)) || Object.keys(value).some((key) => ![...required, "transportedDecision"].includes(key))) return false;
  if (![value.jobType, value.producerRef, value.idempotencyKey].every(text) || !record(value.operation) || !record(value.claimedVersions)) return false;
  const operation = value.operation;
  const allowed = ["action", "resourceType", "resourceId", "actingSpaceId", "actingMembershipId", "delegationRef", "purpose", "mode", "fieldSet"];
  if (Object.keys(operation).some((key) => !allowed.includes(key))) return false;
  if (![operation.action, operation.resourceType, operation.resourceId, operation.actingSpaceId, operation.purpose].every(text)) return false;
  if (!(operation.mode === "user_delegated" || operation.mode === "service")) return false;
  if (operation.mode === "user_delegated" && ![operation.actingMembershipId, operation.delegationRef].every(text)) return false;
  if (operation.mode === "service" && (operation.actingMembershipId !== undefined || operation.delegationRef !== undefined)) return false;
  if (!(operation.fieldSet === "default" || (Array.isArray(operation.fieldSet) && operation.fieldSet.length <= 100 && operation.fieldSet.every(text)))) return false;
  const common = ["spaceLifecycleVersion", "targetVersion", "policyVersion", "policyDigest", "inputSchemaVersion"];
  const versions = operation.mode === "service"
    ? ["workloadIdentityVersion", "servicePolicyVersion", "sourceVersion", "scheduleConfigurationVersion", "ruleReferenceDataVersion", ...common]
    : ["delegationVersion", "subjectVersion", "profileVersion", "authorizationVersion", "consentDisclosureVersion", "primaryOwnershipVersion", ...common];
  if (Object.keys(value.claimedVersions).sort().join() !== versions.sort().join()) return false;
  for (const [key, item] of Object.entries(value.claimedVersions)) {
    if (key === "policyVersion" ? item !== "p5" : key === "policyDigest" ? typeof item !== "string" || !/^[a-f0-9]{64}$/.test(item) : !Number.isSafeInteger(item) || (item as number) < 0) return false;
  }
  if (!["read", "mutate", "export", "acknowledge", "comment", "lifecycle", "protected"].includes(String(value.claimedEffectClass))) return false;
  return value.transportedDecision === undefined || validTransport(value.transportedDecision);
}

export class AuthorizedJobs {
  readonly #options: WorkerAuthorizationOptions;
  readonly #rateLimit: WorkerSurfaceGate;
  constructor(options: WorkerAuthorizationOptions) {
    const jobs = Object.fromEntries(Object.entries(options.jobs).map(([name, job]) => {
      if (![name, job.action, job.purpose, job.queueContractRef].every(text) || typeof job.run !== "function") throw new Error("unregistered_job");
      return [name, Object.freeze({ ...job })];
    }));
    this.#options = { ...options, jobs: Object.freeze(jobs) };
    this.#rateLimit = options.rateLimit ?? new WorkerRateLimits("cbd266-prototype-v1");
  }
  inventory(): readonly { jobType: string; action: string; purpose: string; queueContractRef: string }[] {
    return Object.entries(this.#options.jobs).map(([jobType, job]) => ({ jobType, action: job.action, purpose: job.purpose, queueContractRef: job.queueContractRef }));
  }
  async run(value: unknown): Promise<{ outcome: "completed"; value: unknown } | { outcome: "denied"; terminal: true }> {
    let release: (() => Promise<void>) | undefined;
    try {
      if (!validEnvelope(value)) return await this.#options.boundary.reject();
      const envelope = structuredClone(value);
      const job = Object.hasOwn(this.#options.jobs, envelope.jobType) ? this.#options.jobs[envelope.jobType] : undefined;
      if (!job || job.action !== envelope.operation.action || job.purpose !== envelope.operation.purpose) return await this.#options.boundary.reject();
      const credential = await this.#options.authenticateProducer(envelope.producerRef);
      if (credential === null || credential === undefined) return await this.#options.boundary.reject("not_authenticated");
      const rateEvidence = this.#rateLimit.evidence(envelope.jobType);
      const rateDecision = await this.#rateLimit.enforce(envelope.jobType, credential).catch(() => ({ outcome: "deny_counter_unavailable" as const }));
      if (rateDecision.outcome !== "allow") return await this.#options.boundary.rejectEnforcement(surfaceOutcome(rateEvidence, rateDecision.outcome));
      release = rateDecision.release;
      const transported = envelope.transportedDecision;
      if (transported) {
        const local = this.#options.localTransport;
        if (!local || local.environment !== "local" || !verifyLocalDecision(transported, local.publicKey, { ...local, now: new Date().toISOString() }) || !text(transported.oneUseId)) return await this.#options.boundary.reject();
      }
      const context = await this.#options.boundary.authorize({ operation: envelope.operation, credential }, rateEvidence);
      if (envelope.claimedEffectClass !== context.decision.effectClass || sha256(envelope.claimedVersions) !== sha256(context.decision.capturedVersions)) return await this.#options.boundary.reject("stale_version");
      if (transported && (transported.decision.outcome !== "allow" || transported.action !== context.input.request.action
        || transported.targetBinding !== context.input.resource?.id || transported.claimedEffectClass !== context.decision.effectClass
        || transported.decision.inputDigest !== context.decision.inputDigest || transported.decision.policyDigest !== context.decision.policyDigest
        || transported.decision.policyVersion !== context.decision.policyVersion || sha256(transported.decision.capturedVersions) !== sha256(context.decision.capturedVersions))) return await this.#options.boundary.reject();
      const result = await this.#options.boundary.execute(context, async (effect) => {
        if (transported) {
          const local = this.#options.localTransport;
          if (!local || !verifyLocalDecision(transported, local.publicKey, { ...local, now: new Date().toISOString() })
            || !await this.#options.consumeTransport(effect, transported)) throw new Error("denied");
        }
        if (!await this.#options.claimEffect(effect, envelope.idempotencyKey)) throw new Error("denied");
        return job.run(effect);
      });
      return { outcome: "completed", value: result };
    } catch (error) {
      if (!(error instanceof AuthorizationDenied)) {
        try { await this.#options.boundary.reject(); } catch { /* Remains terminal. */ }
      }
      return { outcome: "denied", terminal: true };
    } finally { if (release) { try { await release(); } catch { /* No reset or retry. */ } } }
  }
}

export function unavailableJobs(failure: () => void): AuthorizedJobs {
  return new AuthorizedJobs({
    boundary: new AuthorizationBoundary(new FactAssembler("worker", absentFactSource), unavailableTransactions, undefined, failure),
    jobs: {}, authenticateProducer: async () => null, consumeTransport: async () => false, claimEffect: async () => false,
  });
}
