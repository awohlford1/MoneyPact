import type { CapturedVersions, EffectClass, PolicyVersion, Role, ServicePurpose } from "./input.ts";
import type { ReasonClass } from "./reason.ts";

export type Obligation =
  | { kind: "audit"; eventClass: "policy_decision" }
  | { kind: "recheck_at_commit"; capturedVersions: CapturedVersions }
  | { kind: "fresh_assurance"; actionClass: string; spaceId: string }
  | { kind: "create_primary_owner_membership" }
  | { kind: "mask"; fieldSet: "default" | readonly string[] }
  | { kind: "label_partial_view" }
  | { kind: "bind_cache_key"; dimensions: readonly string[] }
  | { kind: "notify"; class: "safe_authorization_change" }
  | { kind: "confirm"; targetDescriptor: "authorized_target"; consequenceClass: "governed_change" }
  | { kind: "invalidate"; artifactClasses: readonly string[] }
  | { kind: "preserve"; recordClasses: readonly string[] }
  | { kind: "secure_package"; allowlist: "authorized_fields"; recipientBinding: "acting_subject"; retentionClass: "policy_defined" };

export type CellRef =
  | { kind: "user"; permission: string; role: Role }
  | { kind: "bootstrap"; action: "space.create" }
  | { kind: "service"; purpose: ServicePurpose; operation: string };
export interface PolicyDecision {
  outcome: "allow" | "deny"; effectClass?: EffectClass; reasonClass: ReasonClass; policyVersion: PolicyVersion;
  policyDigest: string; cellRef?: CellRef; inputDigest: string; capturedVersions?: CapturedVersions;
  obligations: readonly Obligation[]; decisionId: string; evaluatedAt: string;
}

declare const authorizedEffectBrand: unique symbol;
export type AuthorizedEffect = Readonly<{ decision: PolicyDecision; [authorizedEffectBrand]: true }>;
