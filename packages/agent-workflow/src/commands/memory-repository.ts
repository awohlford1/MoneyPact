import type { AssignmentAggregate, AssignmentSummary, OwnershipLeaseState, WorkflowEvent, WorkflowRepository, WorkflowTransaction } from "./types.ts";
export class MemoryWorkflowRepository implements WorkflowRepository {
  readonly events: WorkflowEvent[] = [];
  private readonly records = new Map<string, AssignmentAggregate>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly leases = new Map<string, OwnershipLeaseState>();
  async get(id: string): Promise<AssignmentAggregate | undefined> { return this.records.get(id); }
  async save(value: AssignmentAggregate): Promise<void> { this.records.set(value.assignmentId, structuredClone(value)); }
  async append(event: WorkflowEvent): Promise<void> { this.events.push(structuredClone(event)); }
  async listAssignments(): Promise<AssignmentSummary[]> { return [...this.records.values()].map((item) => ({ assignmentId: item.assignmentId, objective: item.objective, lifecycle: item.lifecycle, managerInstanceId: item.managerInstanceId, updatedAt: item.executionAuthority.updatedAt })); }
  async transaction<T>(assignmentId: string, operation: (transaction: WorkflowTransaction) => Promise<T>): Promise<T> {
    const prior = this.queues.get(assignmentId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    this.queues.set(assignmentId, prior.then(() => gate));
    await prior;
    const original = this.records.get(assignmentId);
    let staged = original === undefined ? undefined : structuredClone(original);
    const stagedEvents: WorkflowEvent[] = [];
    try {
      const result = await operation({
        get: async () => staged === undefined ? undefined : structuredClone(staged),
        save: async (value) => { staged = structuredClone(value); },
        append: async (event) => { stagedEvents.push(structuredClone(event)); },
      });
      if (staged !== undefined) this.records.set(assignmentId, structuredClone(staged));
      this.events.push(...stagedEvents);
      return result;
    } finally { release(); }
  }
  async acquireOwnership(assignmentId: string, managerInstanceId: string, now = new Date()): Promise<OwnershipLeaseState> {
    const current = this.leases.get(assignmentId);
    if (current && Date.parse(current.expiresAt) > now.getTime() && current.managerInstanceId !== managerInstanceId) throw new Error("OWNERSHIP_REQUIRED: assignment has another live owner");
    const lease = { token: current?.managerInstanceId === managerInstanceId ? current.token : `lease-${randomUUID()}`, managerInstanceId, acquiredAt: current?.managerInstanceId === managerInstanceId ? current.acquiredAt : now.toISOString(), renewedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 300_000).toISOString() };
    this.leases.set(assignmentId, lease); return structuredClone(lease);
  }
  async renewOwnership(assignmentId: string, managerInstanceId: string, token: string, now = new Date()): Promise<OwnershipLeaseState> {
    await this.validateOwnership(assignmentId, managerInstanceId, token, now);
    const current = this.leases.get(assignmentId)!; const lease = { ...current, renewedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 300_000).toISOString() };
    this.leases.set(assignmentId, lease); return structuredClone(lease);
  }
  async validateOwnership(assignmentId: string, managerInstanceId: string, token: string | undefined, now = new Date()): Promise<OwnershipLeaseState> {
    const lease = this.leases.get(assignmentId);
    if (!lease || lease.managerInstanceId !== managerInstanceId || token === undefined || token !== lease.token || Date.parse(lease.expiresAt) <= now.getTime()) throw new Error("OWNERSHIP_REQUIRED: current ownership fencing token required");
    return structuredClone(lease);
  }
  async transferOwnership(assignmentId: string, fromManagerInstanceId: string, receiverManagerInstanceId: string, token: string, now = new Date()): Promise<OwnershipLeaseState> {
    await this.validateOwnership(assignmentId, fromManagerInstanceId, token, now);
    const lease = { token: `lease-${randomUUID()}`, managerInstanceId: receiverManagerInstanceId, acquiredAt: now.toISOString(), renewedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 300_000).toISOString() };
    this.leases.set(assignmentId, lease); return structuredClone(lease);
  }
}
import { randomUUID } from "node:crypto";
