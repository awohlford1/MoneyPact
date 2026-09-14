import type { ActorRef } from "./actors.ts";

export const ENFORCEMENT_LEVELS = [
  "enforced",
  "observed",
  "instructed",
  "unsupported",
] as const;

export type EnforcementLevel = (typeof ENFORCEMENT_LEVELS)[number];

export const PROVIDER_CAPABILITIES = [
  "graceful_pause",
  "force_interrupt",
  "subagent_interrupt",
  "subagent_resume",
  "message_acknowledgement",
  "raw_response_capture",
  "session_recovery",
  "durable_handover",
  "live_process_handover",
] as const;

export type ProviderCapability = (typeof PROVIDER_CAPABILITIES)[number];

export interface CapabilityEvidence {
  level: EnforcementLevel;
  reason: string;
}

export interface CapabilityReport {
  provider: string;
  adapterVersion: string;
  capabilities: Readonly<Partial<Record<ProviderCapability, CapabilityEvidence>>>;
}

export interface ProviderContext {
  provider: string;
  actor: ActorRef;
  providerSessionId?: string;
  providerThreadId?: string;
  providerTaskId?: string;
  providerProcessId?: string;
  managerInstanceId?: string;
  metadata: Readonly<Record<string, string | number | boolean | null>>;
}

export interface ProviderAdapter {
  readonly provider: string;
  capabilities(): Promise<CapabilityReport>;
  normalizeContext(input: unknown): Promise<ProviderContext>;
}
