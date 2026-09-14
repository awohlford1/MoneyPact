import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { writeJsonAtomic } from "../storage/atomic.ts";
import { storageError } from "../storage/errors.ts";
import { assertContainedStatePath, assertPortableId } from "../storage/layout.ts";
import type { JsonValue } from "../storage/types.ts";
import { withOperationLock } from "./locks.ts";

export interface OwnershipLease {
  assignmentId: string;
  managerInstanceId: string;
  token: string;
  acquiredAt: string;
  renewedAt: string;
  expiresAt: string;
  transfer?: { receiverManagerInstanceId: string; requestedAt: string };
}

export interface LeaseOptions {
  stateRoot: string;
  assignmentId: string;
  managerInstanceId: string;
  leaseMs?: number;
  now?: () => Date;
}

function relativeLease(assignmentId: string): string {
  return path.join("locks", "ownership", `${assignmentId}.json`);
}

export async function readOwnershipLease(stateRoot: string, assignmentId: string): Promise<OwnershipLease | undefined> {
  assertPortableId(assignmentId, "assignment ID");
  const filename = await assertContainedStatePath(stateRoot, relativeLease(assignmentId));
  try { return JSON.parse(await readFile(filename, "utf8")) as OwnershipLease; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

export async function acquireOwnershipLease(options: LeaseOptions): Promise<OwnershipLease> {
  assertPortableId(options.assignmentId, "assignment ID");
  assertPortableId(options.managerInstanceId, "manager instance ID");
  return withOperationLock({ stateRoot: options.stateRoot, resource: `lease-${options.assignmentId}`, ownerId: options.managerInstanceId }, async () => {
    const now = (options.now ?? (() => new Date()))();
    const current = await readOwnershipLease(options.stateRoot, options.assignmentId);
    if (current !== undefined && Date.parse(current.expiresAt) > now.getTime() && current.managerInstanceId !== options.managerInstanceId) {
      throw storageError("LEASE_CONFLICT", "Assignment is owned by another manager", { managerInstanceId: current.managerInstanceId });
    }
    const acquiredAt = current?.managerInstanceId === options.managerInstanceId ? current.acquiredAt : now.toISOString();
    const lease: OwnershipLease = {
      assignmentId: options.assignmentId,
      managerInstanceId: options.managerInstanceId,
      token: current?.managerInstanceId === options.managerInstanceId ? current.token : randomUUID(),
      acquiredAt,
      renewedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + (options.leaseMs ?? 300_000)).toISOString(),
    };
    await writeJsonAtomic(options.stateRoot, relativeLease(options.assignmentId), lease as unknown as JsonValue);
    return lease;
  });
}

export async function renewOwnershipLease(options: LeaseOptions & { token: string }): Promise<OwnershipLease> {
  const current = await readOwnershipLease(options.stateRoot, options.assignmentId);
  if (current?.managerInstanceId !== options.managerInstanceId || current.token !== options.token) {
    throw storageError("LEASE_NOT_OWNED", "Cannot renew an ownership lease not held by this manager");
  }
  return acquireOwnershipLease(options);
}

export async function requestOwnershipTransfer(options: LeaseOptions & { token: string; receiverManagerInstanceId: string }): Promise<OwnershipLease> {
  assertPortableId(options.receiverManagerInstanceId, "receiver manager instance ID");
  return withOperationLock({ stateRoot: options.stateRoot, resource: `lease-${options.assignmentId}`, ownerId: options.managerInstanceId }, async () => {
    const current = await readOwnershipLease(options.stateRoot, options.assignmentId);
    if (current?.managerInstanceId !== options.managerInstanceId || current.token !== options.token) {
      throw storageError("LEASE_NOT_OWNED", "Only the current owner may request transfer");
    }
    const currentTime = (options.now ?? (() => new Date()))();
    if (Date.parse(current.expiresAt) <= currentTime.getTime()) throw storageError("LEASE_NOT_OWNED", "Expired ownership cannot be transferred");
    const updated: OwnershipLease = { ...current, transfer: { receiverManagerInstanceId: options.receiverManagerInstanceId, requestedAt: currentTime.toISOString() } };
    await writeJsonAtomic(options.stateRoot, relativeLease(options.assignmentId), updated as unknown as JsonValue);
    return updated;
  });
}

export async function acceptOwnershipTransfer(options: LeaseOptions & { previousToken: string }): Promise<OwnershipLease> {
  return withOperationLock({ stateRoot: options.stateRoot, resource: `lease-${options.assignmentId}`, ownerId: options.managerInstanceId }, async () => {
    const current = await readOwnershipLease(options.stateRoot, options.assignmentId);
    if (current?.token !== options.previousToken || current.transfer?.receiverManagerInstanceId !== options.managerInstanceId) {
      throw storageError("LEASE_TRANSFER_INVALID", "Ownership transfer was not explicitly offered to this manager");
    }
    const now = (options.now ?? (() => new Date()))();
    if (Date.parse(current.expiresAt) <= now.getTime()) throw storageError("LEASE_TRANSFER_INVALID", "Cannot accept an expired ownership transfer");
    const lease: OwnershipLease = {
      assignmentId: options.assignmentId,
      managerInstanceId: options.managerInstanceId,
      token: randomUUID(), acquiredAt: now.toISOString(), renewedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + (options.leaseMs ?? 300_000)).toISOString(),
    };
    await writeJsonAtomic(options.stateRoot, relativeLease(options.assignmentId), lease as unknown as JsonValue);
    return lease;
  });
}

export async function releaseOwnershipLease(options: { stateRoot: string; assignmentId: string; managerInstanceId: string; token: string }): Promise<void> {
  await withOperationLock({ stateRoot: options.stateRoot, resource: `lease-${options.assignmentId}`, ownerId: options.managerInstanceId }, async () => {
    const current = await readOwnershipLease(options.stateRoot, options.assignmentId);
    if (current?.managerInstanceId !== options.managerInstanceId || current.token !== options.token) throw storageError("LEASE_NOT_OWNED", "Cannot release an ownership lease not held by this manager");
    await rm(await assertContainedStatePath(options.stateRoot, relativeLease(options.assignmentId)));
  });
}
