import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { storageError } from "./errors.ts";

export const ASSIGNMENT_CATEGORIES = [
  "assignment", "plans", "checkpoints", "work-items", "tasks", "task-packets",
  "executions", "actions", "results", "assessments", "approvals",
  "decisions", "evidence",
] as const;

export const STATE_DIRECTORIES = [
  "assignments", "shared/approvals", "shared/decisions", "shared/evidence",
  "events", "pending", "awaiting-validation", "quarantine", "raw-responses",
  "validations", "locks/operations", "locks/ownership", "ledger", "archive",
  "cleanup", "legacy", ".runtime/event-receipts",
  "control/processes", "control/receipts", "control/outputs",
] as const;

const PORTABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function assertPortableId(value: string, label = "identifier"): string {
  if (!PORTABLE_ID.test(value) || value === "." || value === "..") {
    throw storageError("STATE_INVALID_IDENTIFIER", `Invalid ${label}: ${value}`, { value, label });
  }
  return value;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function rejectLinksBetween(root: string, target: string): Promise<void> {
  const relative = path.relative(root, target);
  let cursor = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    try {
      const stat = await lstat(cursor);
      if (stat.isSymbolicLink()) {
        throw storageError("STATE_LINK_REJECTED", `Symbolic link or junction is not allowed in state path: ${cursor}`, { path: cursor });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

export interface StatePaths {
  projectRoot: string;
  stateRoot: string;
}

export async function resolveStatePaths(projectRoot: string, stateDirectory = ".agent-state"): Promise<StatePaths> {
  const project = path.resolve(projectRoot);
  const root = path.resolve(project, stateDirectory);
  if (!isInside(project, root) || root === project) {
    throw storageError("STATE_PATH_ESCAPE", "State root must be a child of the project root", { projectRoot: project, stateRoot: root });
  }
  const actualProject = await realpath(project);
  await rejectLinksBetween(project, root);
  try {
    const actualRoot = await realpath(root);
    if (!isInside(actualProject, actualRoot)) {
      throw storageError("STATE_PATH_ESCAPE", "Resolved state root escapes the project root", { stateRoot: actualRoot });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return { projectRoot: actualProject, stateRoot: root };
}

export async function assertContainedStatePath(stateRoot: string, relativePath: string): Promise<string> {
  if (path.isAbsolute(relativePath)) {
    throw storageError("STATE_PATH_ESCAPE", "State paths must be relative", { relativePath });
  }
  const root = path.resolve(stateRoot);
  const target = path.resolve(root, relativePath);
  if (!isInside(root, target) || target === root) {
    throw storageError("STATE_PATH_ESCAPE", "Path escapes the state root", { relativePath });
  }
  await rejectLinksBetween(root, target);
  return target;
}

export async function initializeStateRoot(projectRoot: string, stateDirectory = ".agent-state"): Promise<StatePaths> {
  const paths = await resolveStatePaths(projectRoot, stateDirectory);
  await mkdir(paths.stateRoot, { recursive: true });
  for (const directory of STATE_DIRECTORIES) {
    await mkdir(await assertContainedStatePath(paths.stateRoot, directory), { recursive: true });
  }
  return paths;
}

export async function initializeAssignmentLayout(stateRoot: string, assignmentId: string): Promise<string> {
  assertPortableId(assignmentId, "assignment ID");
  const root = await assertContainedStatePath(stateRoot, path.join("assignments", assignmentId));
  for (const category of ASSIGNMENT_CATEGORIES) await mkdir(path.join(root, category), { recursive: true });
  return root;
}
