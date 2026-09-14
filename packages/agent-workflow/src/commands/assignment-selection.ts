import type { AssignmentState, AssignmentSummary, WorkflowRepository } from "./types.ts";

export interface AssignmentCandidate extends AssignmentSummary {}

export class AssignmentSelectionError extends Error {
  readonly code: "ASSIGNMENT_CONTEXT_NOT_FOUND" | "ASSIGNMENT_SELECTION_REQUIRED";
  readonly candidates: AssignmentCandidate[];
  constructor(code: AssignmentSelectionError["code"], message: string, candidates: AssignmentCandidate[]) {
    super(message);
    this.name = "AssignmentSelectionError";
    this.code = code;
    this.candidates = candidates;
  }
}

function applies(command: string, lifecycle: AssignmentState): boolean {
  if (command === "resume") return ["paused", "handover_ready", "blocked"].includes(lifecycle);
  if (command === "reopen") return lifecycle === "closed";
  return lifecycle !== "closed";
}

/** Resolve an omitted internal ID without making the Executive manage UUIDs. */
export async function resolveAssignmentReference(input: {
  repository: WorkflowRepository;
  command: string;
  managerInstanceId: string;
  assignmentId?: string;
}): Promise<string> {
  if (input.assignmentId?.trim()) return input.assignmentId;
  if (!input.repository.listAssignments) throw new AssignmentSelectionError("ASSIGNMENT_CONTEXT_NOT_FOUND", "The repository cannot discover assignment context.", []);

  const owned = (await input.repository.listAssignments())
    .filter((candidate) => candidate.managerInstanceId === input.managerInstanceId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  let candidates: AssignmentCandidate[];
  if (["status", "ask"].includes(input.command)) {
    const open = owned.filter((candidate) => candidate.lifecycle !== "closed");
    candidates = open.length > 0 ? open : owned;
  } else candidates = owned.filter((candidate) => applies(input.command, candidate.lifecycle));

  if (candidates.length === 1) return candidates[0]!.assignmentId;
  if (candidates.length === 0) {
    throw new AssignmentSelectionError(
      "ASSIGNMENT_CONTEXT_NOT_FOUND",
      `No applicable assignment is owned by manager ${input.managerInstanceId}. Do not ask the Executive for an assignment ID.`,
      owned,
    );
  }
  throw new AssignmentSelectionError(
    "ASSIGNMENT_SELECTION_REQUIRED",
    "Multiple assignments apply. Ask the Executive to choose by objective and lifecycle; do not ask for an assignment ID.",
    candidates,
  );
}
