import type { ReliabilitySink } from "./telemetry.js";
import type { ApiConfig } from "./config.js";
import { resolveApiListenAddress } from "./config.js";
import { resolveApiIdentityConfiguration } from "./sessions/runtime.ts";

interface StartupApplication {
  enableShutdownHooks(signals: string[], options: { useProcessExit: boolean }): unknown;
  listen(port: number, address: string): Promise<unknown>;
}

export interface StartupDependencies {
  loadConfig(): ApiConfig;
  /**
   * Resolves the S4 field-encryption provider (CBD246-SECURITY-002 finding
   * 1). Called as a pre-effect startup dependency, after configuration
   * validation and before any application or listener effect, so a missing
   * key, missing key version, unconfigured KMS client, or a local-provider
   * selection outside NODE_ENV=development/test fails startup closed. The
   * resolved provider is not otherwise used yet -- no route reaches it --
   * so the return type is deliberately opaque here.
   */
  resolveEncryptionProvider(config: ApiConfig): unknown;
  /**
   * Resolves the CBD-190 identity configuration and, under the local
   * adapter, the CBD-191 session pepper and delivery-envelope key
   * (PROTO-IDENTITY-API-001, CBD-190-AC05). Pre-effect like the encryption
   * provider: a cross-environment value, a local selection outside
   * NODE_ENV=development/test, or missing session material fails startup
   * before any application or listener effect. Defaults to the real resolver
   * so `main.ts` and its derived process fixture stay unchanged.
   */
  resolveIdentityConfiguration?: ((config: ApiConfig) => unknown) | undefined;
  createApplication(config: ApiConfig, sink: ReliabilitySink): Promise<StartupApplication>;
  sink: ReliabilitySink;
}

/** Validation must finish before invoking any application or listener effect. */
export async function runApiBootstrap(dependencies: StartupDependencies): Promise<void> {
  const config = dependencies.loadConfig();
  dependencies.resolveEncryptionProvider(config);
  (dependencies.resolveIdentityConfiguration ?? resolveApiIdentityConfiguration)(config);
  const app = await dependencies.createApplication(config, dependencies.sink);
  app.enableShutdownHooks(["SIGINT", "SIGTERM"], { useProcessExit: true });
  await app.listen(config.API_PORT, resolveApiListenAddress(config));
  dependencies.sink({ service: "api", version: config.SERVICE_VERSION, operation: "startup", outcome: "ok" });
}
