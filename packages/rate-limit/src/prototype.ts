import { readFileSync } from "node:fs";
import { instant, isObject, parseRegistryJson } from "./schema.ts";
import records from "../../../config/rate-limit/records.json" with { type: "json" };
import registrations from "../../../config/rate-limit/registrations.json" with { type: "json" };
import { validateRegistry } from "./registry.ts";
import type { ApprovalContext, ApprovalEvidence, Registration } from "./types.ts";

export const PROTOTYPE_APPROVALS_PATH = new URL("../../../config/rate-limit/approvals.json", import.meta.url);

// Re-read evidence on every lookup so revocation closes an existing registry.
export function prototypeApprovalContext(path: string | URL = PROTOTYPE_APPROVALS_PATH,
  environment: ApprovalContext["environment"] = "local-prototype"): ApprovalContext {
  return {
    now: new Date().toISOString(), environment, singleProcess: true,
    resolve(id): ApprovalEvidence | undefined {
      if (environment !== "local-prototype") return undefined;
      try {
        const entries = parseRegistryJson(readFileSync(path, "utf8"));
        if (!Array.isArray(entries) || !entries.every((e: unknown) => isObject(e)
          && typeof e.approvalId === "string" && typeof e.actorId === "string" && e.actorId.length > 0
          && Array.isArray(e.candidateDigests) && e.candidateDigests.length > 0
          && e.candidateDigests.every((d: unknown) => typeof d === "string" && /^[a-f0-9]{64}$/.test(d))
          && Array.isArray(e.conditions) && e.conditions.every((c: unknown) => typeof c === "string")
          && instant(e.decidedAt) && (e.expiresAt === null || instant(e.expiresAt))
          && typeof e.revoked === "boolean" && typeof e.decisionRecord === "string" && e.decisionRecord.length > 0)) return undefined;
        if (new Set(entries.map((e) => e.approvalId)).size !== entries.length) return undefined;
        return entries.find((e) => e.approvalId === id) as ApprovalEvidence | undefined;
      } catch { return undefined; }
    },
  };
}
export function loadPrototypeRegistry(path: string | URL = PROTOTYPE_APPROVALS_PATH) {
  return validateRegistry(records, prototypeApprovalContext(path));
}
export function loadRegistrations(): Registration[] {
  const value: unknown = structuredClone(registrations);
  if (!Array.isArray(value)) throw new Error("registrations_invalid"); return value as Registration[];
}
