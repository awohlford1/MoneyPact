import { createFakeClient, createTestDatabase } from "./fake-client.ts";
import { createSessionStore } from "../store.ts";
import type { SessionConfig } from "../config.ts";
import type { EnvelopeKeyProvider } from "../envelope-key.ts";

export function buildTestHarness() {
  const db = createTestDatabase();
  const client = createFakeClient(db);
  const store = createSessionStore(client);
  return { db, store };
}

export function testEnvelopeKeyProvider(version = "test-v1"): EnvelopeKeyProvider {
  const key = Buffer.alloc(32, 11);
  return {
    currentVersion: version,
    sealingKey: () => key,
    keyFor: (candidateVersion: string) => (candidateVersion === version ? key : undefined),
  };
}

export function testConfig(overrides: Partial<SessionConfig> = {}): SessionConfig {
  return {
    pepper: Buffer.alloc(32, 3),
    idleTimeoutSeconds: 900,
    absoluteLifetimeSeconds: 3600,
    freshAssuranceWindowSeconds: 300,
    revocationPropagationTargetSeconds: 60,
    providerMaxFutureSkewSeconds: 30,
    rejectionTimingFloorMs: 0,
    rejectionTimingJitterMs: 0,
    rejectionTimingSampleCount: 10,
    rejectionTimingTimeoutBucketMs: 0,
    rejectionTimingMaxDifferentialMs: 50,
    ...overrides,
  };
}
