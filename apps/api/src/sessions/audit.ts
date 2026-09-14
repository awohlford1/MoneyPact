/**
 * In-process restricted audit stream for the local prototype
 * (PROTO-IDENTITY-API-001, PROTO-WIRE-02).
 *
 * `AuthorizationBoundary` refuses every allow and records every deny through
 * `RestrictedAudit`, which needs an `AuditStore` that locks the restricted
 * stream, verifies the prior digest, appends and commits atomically -- and
 * that uses a supplied transaction. No migration in the merged baseline
 * creates a restricted audit table (`budget_creation_audit` is a
 * budget-space table owned by CBD-233), so this store keeps the hash chain
 * in process memory, the same single-process custody the CBD-266 counter
 * store and the CBD-190 challenge store use. Restart loses the chain; it is
 * a prototype limitation recorded in the result, not a durable audit claim.
 *
 * Transactional semantics are preserved at the seam that matters: an event
 * appended with a transaction handle is buffered against that handle and
 * becomes part of the chain only when `commit(handle)` runs after the
 * database transaction committed (`ApiTransactionStore` calls it); a
 * rollback discards the buffer (`discard(handle)`). Denial events without a
 * transaction append immediately. Events carry no protected content beyond
 * what `RestrictedAudit` builds (policy metadata and enforcement evidence).
 */
import { sha256 } from "@cobudget/contracts/authorization";
import type { PolicyAuditEvent } from "@cobudget/contracts/authorization";
import type { AuditStore } from "../authorization/audit.js";

type Build = (sequence: number, previousEventDigest: string) => Partial<PolicyAuditEvent>;

export class InProcessRestrictedAuditStore implements AuditStore {
  readonly #events: Partial<PolicyAuditEvent>[] = [];
  readonly #pending = new WeakMap<object, Build[]>();
  readonly #capacity: number;
  #tail: Promise<void> = Promise.resolve();

  constructor(capacity = 100_000) {
    this.#capacity = capacity;
  }

  get length(): number { return this.#events.length; }

  /** Read-only view for tests and operators; never exported to a customer surface. */
  snapshot(): readonly Readonly<Partial<PolicyAuditEvent>>[] {
    return this.#events.map((event) => structuredClone(event));
  }

  #appendNow(build: Build): void {
    if (this.#events.length >= this.#capacity) throw new Error("audit_capacity_unavailable");
    const prior = this.#events.at(-1);
    if (prior) {
      const { eventDigest, ...body } = prior;
      if (eventDigest !== sha256(body)) throw new Error("audit_integrity_unavailable");
    }
    const event = build(this.#events.length + 1, prior?.eventDigest ?? "0".repeat(64));
    this.#events.push(event);
  }

  async append(build: Build, transaction?: unknown): Promise<void> {
    if (transaction !== undefined && transaction !== null && typeof transaction === "object") {
      const pending = this.#pending.get(transaction) ?? [];
      pending.push(build);
      this.#pending.set(transaction, pending);
      return;
    }
    await this.#serialize(async () => { this.#appendNow(build); });
  }

  /** Called by the transaction store after the database COMMIT succeeded. */
  async commit(transaction: object): Promise<void> {
    const pending = this.#pending.get(transaction);
    this.#pending.set(transaction, []);
    if (!pending?.length) return;
    await this.#serialize(async () => { for (const build of pending) this.#appendNow(build); });
  }

  discard(transaction: object): void {
    this.#pending.set(transaction, []);
  }

  async #serialize(work: () => Promise<void>): Promise<void> {
    const previous = this.#tail;
    let release: () => void = () => undefined;
    this.#tail = new Promise<void>((resolve) => { release = resolve; });
    try {
      await previous;
      await work();
    } finally {
      release();
    }
  }
}
