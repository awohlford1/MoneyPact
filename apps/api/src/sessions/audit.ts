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
 *
 * PROTO-IDENTITY-API-001 correction C3 (review R03 / security S03): a
 * capacity or integrity failure must never surface after the database has
 * already committed. `AuthorizationBoundary.execute` calls `audit.emit(...,
 * transaction, ...)` *inside* the work callback `ApiTransactionStore.transaction`
 * passes to `client.transaction(...)`, i.e. strictly before that transaction's
 * COMMIT. `append()` now reserves a capacity slot and validates the current
 * chain's integrity synchronously at that buffering call, so a store at
 * capacity (or a corrupted chain) throws there and the thrown error
 * propagates out of the scoped work function, which aborts the database
 * transaction before it can commit (`ApiTransactionStore` then calls
 * `discard()`, releasing the reservation). `commit()` only flushes
 * already-reserved events after a real commit, so it can no longer fail on
 * capacity for anything it was told about at buffer time.
 */
import { sha256 } from "@cobudget/contracts/authorization";
import type { PolicyAuditEvent } from "@cobudget/contracts/authorization";
import type { AuditStore } from "../authorization/audit.js";

type Build = (sequence: number, previousEventDigest: string) => Partial<PolicyAuditEvent>;

export class InProcessRestrictedAuditStore implements AuditStore {
  readonly #events: Partial<PolicyAuditEvent>[] = [];
  readonly #pending = new WeakMap<object, Build[]>();
  readonly #capacity: number;
  /** Slots reserved for buffered-but-not-yet-committed events, so a later `commit()` cannot fail on capacity. */
  #reserved = 0;
  #tail: Promise<void> = Promise.resolve();

  constructor(capacity = 100_000) {
    this.#capacity = capacity;
  }

  get length(): number { return this.#events.length; }
  /** Test/evidence only: reserved-but-unflushed capacity slots. */
  get reserved(): number { return this.#reserved; }

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

  /** Capacity/integrity precondition for the *next* real append, checked without mutating `#events`. */
  #checkAdmissible(): void {
    if (this.#events.length + this.#reserved >= this.#capacity) throw new Error("audit_capacity_unavailable");
    const prior = this.#events.at(-1);
    if (prior) {
      const { eventDigest, ...body } = prior;
      if (eventDigest !== sha256(body)) throw new Error("audit_integrity_unavailable");
    }
  }

  async append(build: Build, transaction?: unknown): Promise<void> {
    if (transaction !== undefined && transaction !== null && typeof transaction === "object") {
      // C3 (R03/S03): reserve the slot and validate the chain now, before the
      // caller's database transaction can commit -- not later at `commit()`,
      // which would be after the commit already happened.
      await this.#serialize(async () => {
        this.#checkAdmissible();
        this.#reserved += 1;
        const pending = this.#pending.get(transaction) ?? [];
        pending.push(build);
        this.#pending.set(transaction, pending);
      });
      return;
    }
    await this.#serialize(async () => { this.#checkAdmissible(); this.#appendNow(build); });
  }

  /** Called by the transaction store after the database COMMIT succeeded. Every event here was already reserved at `append()` time, so this cannot fail on capacity. */
  async commit(transaction: object): Promise<void> {
    const pending = this.#pending.get(transaction);
    this.#pending.set(transaction, []);
    if (!pending?.length) return;
    await this.#serialize(async () => {
      for (const build of pending) { this.#appendNow(build); this.#reserved = Math.max(0, this.#reserved - 1); }
    });
  }

  discard(transaction: object): void {
    const pending = this.#pending.get(transaction);
    this.#pending.set(transaction, []);
    if (pending?.length) this.#reserved = Math.max(0, this.#reserved - pending.length);
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
