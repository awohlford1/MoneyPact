import type { EffectClass, Role } from "./input.ts";
import type { ReasonClass } from "./reason.ts";

export interface PolicyAuditEvent {
  eventId: string; occurredAt: string; decisionId: string; outcome: "allow" | "deny"; reasonClass: ReasonClass;
  policyVersion: string; policyDigest: string; inputSchemaVersion: number; actionCode: string; effectClass?: EffectClass;
  authorityMode: "user_delegated" | "service"; capturedVersions?: Readonly<Record<string, number | string>>;
  cellRef?: string; correlationId: string; sequence: number; previousEventDigest: string; eventDigest: string;
  audienceClass: "restricted_security_evidence"; sensitivityClass: "authorization_metadata";
  retentionClass: string; deletionPolicyVersion: string; obligations: readonly string[];
  accountSubjectId?: string; membershipId?: string; role?: Role; spaceId?: string; resourceType?: string;
  targetRef?: string; bootstrapAttemptRef?: string; servicePurpose?: string;
}

const common = [
  "eventId", "occurredAt", "decisionId", "outcome", "reasonClass",
  "policyVersion", "policyDigest", "inputSchemaVersion", "actionCode", "effectClass",
  "capturedVersions", "cellRef", "correlationId", "sequence",
  "previousEventDigest", "eventDigest", "audienceClass", "sensitivityClass",
  "retentionClass", "deletionPolicyVersion", "obligations", "authorityMode",
] as const;
const variants = {
  ordinary: ["accountSubjectId", "membershipId", "role", "spaceId", "resourceType", "targetRef"],
  bootstrap: ["accountSubjectId", "bootstrapAttemptRef"],
  service: ["servicePurpose", "spaceId", "resourceType", "targetRef"],
} as const;

export function policyAuditEvent(value: Record<string, unknown>, variant: keyof typeof variants): Partial<PolicyAuditEvent> {
  const allowed = new Set<string>([...common, ...variants[variant]]);
  return Object.fromEntries(Object.entries(value).filter(([key, item]) => allowed.has(key) && item !== undefined)) as Partial<PolicyAuditEvent>;
}
