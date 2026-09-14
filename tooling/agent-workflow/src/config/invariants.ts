import type { FrameworkConfiguration } from "../contracts/configuration.ts";
import { AgentWorkflowError } from "../contracts/errors.ts";

export interface FrameworkInvariant {
  id: string;
  description: string;
  validate(config: FrameworkConfiguration): boolean;
}

export const MANDATORY_INVARIANTS: readonly FrameworkInvariant[] = [
  {
    id: "AWI-001",
    description: "Permanent archive deletion is unavailable in Phase 1.",
    validate: (config) => config.retention.permanentArchiveDeletion === false,
  },
  {
    id: "AWI-002",
    description: "A graceful operation never escalates to force automatically.",
    validate: (config) => config.execution.automaticForceEscalation === false,
  },
  {
    id: "AWI-003",
    description: "All state operations remain constrained to the state root.",
    validate: (config) => config.security.stateRootContainment === true,
  },
  {
    id: "AWI-004",
    description: "Known secrets are redacted before persistence.",
    validate: (config) => config.security.secretRedaction === true,
  },
  {
    id: "AWI-005",
    description: "Record content is data and is never executed as instructions.",
    validate: (config) => config.security.executeRecordContent === false,
  },
] as const;

export function assertMandatoryInvariants(config: FrameworkConfiguration): void {
  for (const invariant of MANDATORY_INVARIANTS) {
    if (!invariant.validate(config)) {
      throw new AgentWorkflowError({
        code: "CONFIG_INVARIANT_VIOLATION",
        message: invariant.description,
        details: { invariantId: invariant.id },
      });
    }
  }
}
