import { randomUUID } from "node:crypto";
import { decide, externalDenial, sha256 } from "@cobudget/contracts/authorization";
import type { AuthorizedEffect, Obligation, PolicyDecision, PolicyInput, ReasonClass } from "@cobudget/contracts/authorization";
import type { RestrictedAudit } from "./audit.js";
import { FactAssembler, FactFailure } from "./facts.js";
import type { FactLookup } from "./facts.js";

export class AuthorizationDenied extends Error {
  readonly response = externalDenial();
  constructor() { super("denied"); }
}
export interface AuthorizationTransactionStore {
  /** Resolve only after durable commit. Reject only after rollback/containment.
   * The session/delegation/workload and every authority row must stay locked or
   * be conditional-write predicates until commit. No nontransactional effects.
   */
  transaction<T>(work: (transaction: unknown) => Promise<T>): Promise<T>;
  /** Enforce the exact obligation in this transaction; bootstrap discharges by
   * inserting the candidate's sole Primary membership, with uniqueness checks.
   * Unimplemented obligations return false. Notices use a transactional outbox.
   */
  discharge(transaction: unknown, input: PolicyInput, obligation: Obligation): Promise<boolean>;
  /** Check the persisted postconditions before commit. Bootstrap must contain
   * the candidate space and exactly its one Primary membership for the subject;
   * a handler omitting or changing either insert must fail this verification.
   */
  verify(transaction: unknown, input: PolicyInput, obligations: readonly Obligation[]): Promise<boolean>;
}
export interface AuthorizedContext {
  readonly input: PolicyInput;
  readonly decision: PolicyDecision;
}
export interface EffectContext extends AuthorizedContext {
  readonly effect: AuthorizedEffect;
  readonly transaction: unknown;
}
interface PrivateContext { lookup: FactLookup; input: PolicyInput; decision: PolicyDecision; correlationId: string }

function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
  return value;
}
function deny(reason: ReasonClass): PolicyDecision {
  return { ...decide({} as PolicyInput), reasonClass: reason };
}

/** The mutation seam mirrored in both process adapters and checked for parity. No framework,
 * write client, session implementation, or token constructor is exported here.
 */
export class AuthorizationBoundary {
  readonly #assembler: FactAssembler;
  readonly #store: AuthorizationTransactionStore;
  readonly #audit: RestrictedAudit | undefined;
  readonly #failure: () => void;
  readonly #contexts = new WeakMap<AuthorizedContext, PrivateContext>();
  readonly #effects = new WeakMap<AuthorizedEffect, { transaction: unknown; binding: string }>();

  constructor(assembler: FactAssembler, store: AuthorizationTransactionStore, audit?: RestrictedAudit, failure: () => void = () => undefined) {
    this.#assembler = assembler; this.#store = store; this.#audit = audit; this.#failure = failure;
  }
  async #recordDeny(decision: PolicyDecision, input: PolicyInput | undefined, correlationId: string): Promise<never> {
    try {
      if (!this.#audit) throw new Error("audit_unavailable");
      await this.#audit.emit(decision, input, correlationId);
    } catch { try { this.#failure(); } catch { /* An operations sink cannot allow. */ } }
    throw new AuthorizationDenied();
  }
  async reject(reason: ReasonClass = "input_invalid"): Promise<never> {
    return this.#recordDeny(deny(reason), undefined, randomUUID());
  }
  async authorize(lookup: FactLookup): Promise<AuthorizedContext> {
    const correlationId = randomUUID();
    let input: PolicyInput | undefined;
    let decision = deny("input_invalid");
    try {
      const privateLookup: FactLookup = { ...structuredClone(lookup), ...(lookup.operation.action === "space.create" ? { candidates: this.#assembler.candidates() } : {}) };
      input = await this.#assembler.assemble(privateLookup);
      decision = decide(input);
      if (decision.outcome === "allow" && this.#audit) {
        const context = freeze({ input: structuredClone(input), decision: structuredClone(decision) });
        this.#contexts.set(context, { lookup: privateLookup, input: structuredClone(input), decision: structuredClone(decision), correlationId });
        return context;
      }
      if (decision.outcome === "allow") decision = deny("input_invalid");
    } catch (error) { decision = deny(error instanceof FactFailure ? error.reason : "input_invalid"); }
    return this.#recordDeny(decision, input, correlationId);
  }

  /** Reject forged, reused or expired tokens at the lower-level write adapter. */
  assertEffect(effect: AuthorizedEffect, transaction: unknown, input: PolicyInput): void {
    const issued = this.#effects.get(effect);
    if (!issued || issued.transaction !== transaction || issued.binding !== sha256(input)) throw new AuthorizationDenied();
  }

  async execute<T>(context: AuthorizedContext, work: (context: EffectContext) => Promise<T>): Promise<T> {
    const captured = this.#contexts.get(context);
    this.#contexts.delete(context);
    if (!captured) return this.reject();
    let current = captured.input;
    let decision = captured.decision;
    try {
      return await this.#store.transaction(async (transaction) => {
        if (decision.effectClass !== "read") {
          if (!decision.capturedVersions) throw new AuthorizationDenied();
          current = await this.#assembler.assemble(captured.lookup, transaction, decision.capturedVersions);
          decision = decide(current);
          if (decision.outcome !== "allow") throw new AuthorizationDenied();
          if (decision.inputDigest !== captured.decision.inputDigest
            || decision.policyVersion !== captured.decision.policyVersion || decision.policyDigest !== captured.decision.policyDigest
            || sha256(decision.capturedVersions) !== sha256(captured.decision.capturedVersions)) {
            decision = deny("stale_version"); throw new AuthorizationDenied();
          }
        }
        for (const obligation of decision.obligations) {
          if (obligation.kind === "audit" || obligation.kind === "recheck_at_commit") continue;
          if (!await this.#store.discharge(transaction, current, obligation)) throw new AuthorizationDenied();
        }
        if (!this.#audit) throw new AuthorizationDenied();
        const input = freeze(structuredClone(current));
        const frozenDecision = freeze(structuredClone(decision));
        const effect = Object.freeze({ decision: frozenDecision }) as AuthorizedEffect;
        this.#effects.set(effect, { transaction, binding: sha256(input) });
        try {
          this.assertEffect(effect, transaction, input);
          const result = await work({ input, decision: frozenDecision, effect, transaction });
          if (!await this.#store.verify(transaction, current, decision.obligations)) throw new AuthorizationDenied();
          await this.#audit.emit(decision, current, captured.correlationId, transaction);
          return result;
        } finally { this.#effects.delete(effect); }
      });
    } catch {
      // transaction() must have rolled back before the separate attempt record.
      if (decision.outcome === "allow") decision = deny("input_invalid");
      return this.#recordDeny(decision, current, captured.correlationId);
    }
  }
}

export const unavailableTransactions: AuthorizationTransactionStore = {
  transaction: async () => { throw new AuthorizationDenied(); },
  discharge: async () => false,
  verify: async () => false,
};
