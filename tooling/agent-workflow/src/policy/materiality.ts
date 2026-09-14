import type { FrameworkConfiguration } from "../contracts/configuration.ts";
import type { PolicyDecision } from "./decisions.ts";

export interface ChangeAssessmentInput { paths: string[]; rationale: string; priorNonmaterialChangeCount: number }
export interface MaterialityAssessment extends PolicyDecision {
  classification: "material" | "nonmaterial" | "ambiguous";
  affectedPaths: string[]; cumulativeCount: number; holdAffectedWork: boolean;
}

export function assessMateriality(input: ChangeAssessmentInput, config: FrameworkConfiguration["materiality"]): MaterialityAssessment {
  if (input.paths.length === 0 || input.rationale.trim() === "") {
    return { allowed: false, code: "MATERIALITY_AMBIGUOUS", reason: "Change paths and rationale are required", classification: "ambiguous", affectedPaths: input.paths, cumulativeCount: input.priorNonmaterialChangeCount, holdAffectedWork: true };
  }
  if (input.paths.some((path) => config.alwaysMaterial.includes(path))) {
    return { allowed: false, code: "MATERIAL_CHANGE", reason: "Change affects an always-material boundary", classification: "material", affectedPaths: input.paths, cumulativeCount: input.priorNonmaterialChangeCount, holdAffectedWork: true };
  }
  const allDelegated = input.paths.every((path) => config.delegatedChanges.includes(path));
  if (!allDelegated) {
    return { allowed: false, code: "MATERIALITY_AMBIGUOUS", reason: "Change is not classified by deterministic policy", classification: "ambiguous", affectedPaths: input.paths, cumulativeCount: input.priorNonmaterialChangeCount, holdAffectedWork: true };
  }
  const cumulativeCount = input.priorNonmaterialChangeCount + 1;
  if (cumulativeCount >= config.cumulativeChangeThreshold) {
    return { allowed: false, code: "CUMULATIVE_MATERIALITY_THRESHOLD", reason: "Cumulative delegated changes reached the materiality threshold", classification: "material", affectedPaths: input.paths, cumulativeCount, holdAffectedWork: true };
  }
  return { allowed: true, code: "NONMATERIAL_CHANGE", reason: input.rationale, classification: "nonmaterial", affectedPaths: input.paths, cumulativeCount, holdAffectedWork: false };
}
