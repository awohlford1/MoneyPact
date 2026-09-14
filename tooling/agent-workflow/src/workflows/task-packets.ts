import type { ArtifactRef } from "../contracts/records.ts";

export interface ModelSelection { provider: string; model: string; reasoning_effort?: string }
export interface AcceptanceCriterion { id: string; text: string }
export interface TaskPacketInput {
  task_id: string; execution_id: string; assignment_id: string; parent_task_id?: string;
  objective: string; purpose?: string; scope: string[]; exclusions: string[];
  acceptance_criteria: AcceptanceCriterion[]; authoritative_inputs?: ArtifactRef[]; starting_point?: string;
  permissions: string[]; constraints: string[]; dependencies?: ArtifactRef[]; expected_outputs: string[];
  evidence_requirements?: string[]; escalation_conditions?: string[]; stopping_conditions?: string[];
  requested_model: ModelSelection; actual_model?: ModelSelection;
}

export interface TaskPacket extends TaskPacketInput {
  schema_version: "1.0"; record_id: string; record_type: "task-packet"; created_at: string;
}

function nonEmpty(value: string, name: string): void { if (value.trim() === "") throw new Error(`${name} must not be empty`); }
function unique(values: string[], name: string): void {
  values.forEach((value) => nonEmpty(value, name));
  if (new Set(values).size !== values.length) throw new Error(`${name} must contain unique values`);
}

export function buildTaskPacket(input: TaskPacketInput, now = new Date()): TaskPacket {
  nonEmpty(input.objective, "objective");
  unique(input.scope, "scope"); unique(input.exclusions, "exclusions"); unique(input.permissions, "permissions");
  unique(input.constraints, "constraints"); unique(input.expected_outputs, "expected_outputs");
  if (input.acceptance_criteria.length === 0) throw new Error("acceptance_criteria must not be empty");
  const criterionIds = input.acceptance_criteria.map((criterion) => criterion.id);
  unique(criterionIds, "acceptance criterion IDs");
  input.acceptance_criteria.forEach((criterion) => nonEmpty(criterion.text, "acceptance criterion text"));
  nonEmpty(input.requested_model.provider, "requested provider"); nonEmpty(input.requested_model.model, "requested model");
  // A task packet and its task are distinct canonical records. The packet is
  // execution-specific, so using the task ID as its record ID creates a
  // duplicate canonical identity and prevents later aggregate saves.
  return { schema_version: "1.0", record_id: `pkt-${input.execution_id}`, record_type: "task-packet", created_at: now.toISOString(), ...input };
}
