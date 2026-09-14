import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { storageError } from "../storage/errors.ts";
import { assertContainedStatePath, assertPortableId } from "../storage/layout.ts";

export interface OperationLock {
  resource: string;
  ownerId: string;
  token: string;
  acquiredAt: string;
  expiresAt: string;
  path: string;
}

export interface AcquireLockOptions {
  stateRoot: string;
  resource: string;
  ownerId: string;
  leaseMs?: number;
  timeoutMs?: number;
  retryMs?: number;
  now?: () => Date;
}

export interface AssignmentWriteLockOptions extends Omit<AcquireLockOptions, "resource"> {
  assignmentId: string;
  /** Set false only while creating a new assignment that cannot already exist. */
  requireActive?: boolean;
}

const delay = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function renameDirectory(source: string, destination: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try { await rename(source, destination); return; }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!["EPERM", "EACCES"].includes(code ?? "") || attempt >= 19) throw error;
      await delay((attempt + 1) * 5);
    }
  }
}

async function readLock(directory: string): Promise<OperationLock | undefined> {
  try { return JSON.parse(await readFile(path.join(directory, "lock.json"), "utf8")) as OperationLock; }
  catch (error) {
    if (error instanceof SyntaxError) return undefined;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EPERM" || code === "EACCES") return undefined;
    throw error;
  }
}

async function writeLock(lock: OperationLock): Promise<void> {
  await writeFile(path.join(lock.path, "lock.json"), `${JSON.stringify(lock)}\n`, { encoding: "utf8", mode: 0o600 });
}

export function assignmentWriteLockResource(assignmentId: string): string {
  assertPortableId(assignmentId, "assignment ID");
  return `assignment-${assignmentId}`;
}

export async function assertOperationLockOwned(lock: OperationLock): Promise<void> {
  const current = await readLock(lock.path);
  if (current?.token !== lock.token || current.ownerId !== lock.ownerId) {
    throw storageError("LOCK_NOT_OWNED", `Operation lock is not owned by ${lock.ownerId}`, { resource: lock.resource });
  }
}

export async function renewOperationLock(lock: OperationLock, leaseMs = 30_000, now: () => Date = () => new Date()): Promise<OperationLock> {
  await assertOperationLockOwned(lock);
  const renewedAt = now();
  const renewed = { ...lock, expiresAt: new Date(renewedAt.getTime() + leaseMs).toISOString() };
  await writeLock(renewed);
  await assertOperationLockOwned(renewed);
  Object.assign(lock, renewed);
  return lock;
}

export async function acquireOperationLock(options: AcquireLockOptions): Promise<OperationLock> {
  assertPortableId(options.resource, "lock resource");
  assertPortableId(options.ownerId, "lock owner");
  const lockPath = await assertContainedStatePath(options.stateRoot, path.join("locks", "operations", `${options.resource}.lock`));
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? 15_000;
  const leaseMs = options.leaseMs ?? 120_000;
  const now = options.now ?? (() => new Date());
  while (true) {
    const acquiredAt = now();
    const lock: OperationLock = {
      resource: options.resource,
      ownerId: options.ownerId,
      token: randomUUID(),
      acquiredAt: acquiredAt.toISOString(),
      expiresAt: new Date(acquiredAt.getTime() + leaseMs).toISOString(),
      path: lockPath,
    };
    try {
      await mkdir(lockPath);
      await writeFile(path.join(lockPath, "lock.json"), `${JSON.stringify(lock)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
      return lock;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        await rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
      const existing = await readLock(lockPath);
      if (existing !== undefined && Date.parse(existing.expiresAt) <= now().getTime()) {
        const claimedPath = `${lockPath}.stale-${randomUUID()}`;
        try { await renameDirectory(lockPath, claimedPath); }
        catch (claimError) {
          if (!["ENOENT", "EACCES", "EPERM"].includes((claimError as NodeJS.ErrnoException).code ?? "")) throw claimError;
          continue;
        }
        const claimed = await readLock(claimedPath);
        if (claimed?.token === existing.token && Date.parse(claimed.expiresAt) <= now().getTime()) {
          await rm(claimedPath, { recursive: true, force: true });
          continue;
        }
        try { await renameDirectory(claimedPath, lockPath); }
        catch (restoreError) {
          if ((restoreError as NodeJS.ErrnoException).code !== "EEXIST") throw restoreError;
          await rm(claimedPath, { recursive: true, force: true });
        }
      }
      if (Date.now() - started >= timeoutMs) throw storageError("LOCK_TIMEOUT", `Timed out acquiring lock: ${options.resource}`);
      await delay(options.retryMs ?? 10);
    }
  }
}

export async function releaseOperationLock(lock: OperationLock): Promise<void> {
  await assertOperationLockOwned(lock);
  // Windows cannot reliably rename a directory while contenders briefly open
  // lock.json. Removal is safe while this unexpired token remains authoritative;
  // stale takeover uses the atomic rename protocol above.
  await rm(lock.path, { recursive: true, maxRetries: 20, retryDelay: 10 });
}

export async function withOperationLock<T>(options: AcquireLockOptions, operation: (lock: OperationLock) => Promise<T>): Promise<T> {
  const lock = await acquireOperationLock(options);
  const leaseMs = options.leaseMs ?? 120_000;
  let renewalFailure: unknown;
  let renewal = Promise.resolve();
  const timer = setInterval(() => {
    renewal = renewal.then(async () => {
      if (renewalFailure === undefined) await renewOperationLock(lock, leaseMs, options.now);
    }).catch((error) => { renewalFailure ??= error; });
  }, Math.max(5, Math.floor(leaseMs / 3)));
  timer.unref();
  try {
    const result = await operation(lock);
    await renewal;
    if (renewalFailure !== undefined) throw renewalFailure;
    await assertOperationLockOwned(lock);
    return result;
  } finally {
    clearInterval(timer);
    await renewal;
    await releaseOperationLock(lock).catch((error) => {
      if (renewalFailure === undefined) throw error;
    });
  }
}

export async function withAssignmentWriteLock<T>(options: AssignmentWriteLockOptions, operation: (lock: OperationLock) => Promise<T>): Promise<T> {
  const { assignmentId, requireActive: _requireActive, ...lockOptions } = options;
  return withOperationLock({ ...lockOptions, resource: assignmentWriteLockResource(assignmentId) }, async (lock) => {
    if (options.requireActive !== false) {
      const assignmentRoot = await assertContainedStatePath(options.stateRoot, path.join("assignments", assignmentId));
      const active = await stat(assignmentRoot).then((value) => value.isDirectory()).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return false;
        throw error;
      });
      if (!active) throw storageError("STATE_RECORD_NOT_FOUND", `Active assignment not found: ${assignmentId}`, { assignmentId });
    }
    return operation(lock);
  });
}
