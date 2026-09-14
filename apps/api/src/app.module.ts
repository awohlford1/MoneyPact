import type { DynamicModule } from "@nestjs/common";
import { Module } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR, DiscoveryModule } from "@nestjs/core";
import { assertPolicyCompatibility, readReleaseHistory } from "./authorization/compatibility.js";
import { API_AUTHORIZATION } from "./authorization/http.js";
import { ApiAuthorizationBoundary } from "./authorization/http.js";
import { unavailableApiAuthorization } from "./authorization/http.js";
import type { ApiAuthorizationOptions } from "./authorization/http.js";

import type { ApiConfig } from "./config.js";
import { HealthController } from "./health.controller.js";
import { ShutdownReporter } from "./shutdown-reporter.js";
import type { ReliabilitySink } from "./telemetry.js";
import { API_CONFIG, RELIABILITY_SINK } from "./tokens.js";
export { TargetsAuthorizationStore, dataAccessTargetsDependencies, targetsHttp } from "./targets/http.js"; // CBD-153 (PROTO-TARGETS-001): re-export only; the composition that owns register()'s authorization wiring passes targetsHttp(dataAccessTargetsDependencies(client)).module through authorization.modules and dispatches its transaction store to TargetsAuthorizationStore for the three target actions.
export { buildSessionFactSourceAdapter } from "./sessions/index.js"; // CBD-191 (CBD191-IMPL-001): re-export only; apps/api/src/authorization and application.ts own register()'s authorization wiring.

@Module({})
export class AppModule {
  static register(config: ApiConfig, sink: ReliabilitySink, authorization?: ApiAuthorizationOptions, history: unknown = readReleaseHistory()): DynamicModule {
    assertPolicyCompatibility(history);
    return {
      module: AppModule,
      imports: [DiscoveryModule, ...(authorization?.modules ?? [])],
      controllers: [HealthController],
      providers: [
        { provide: API_AUTHORIZATION, useValue: authorization ?? unavailableApiAuthorization(() => sink({ service: "api", version: config.SERVICE_VERSION, operation: "request", outcome: "error" })) },
        ApiAuthorizationBoundary,
        { provide: APP_GUARD, useExisting: ApiAuthorizationBoundary },
        { provide: APP_INTERCEPTOR, useExisting: ApiAuthorizationBoundary },
        { provide: API_CONFIG, useValue: config },
        { provide: RELIABILITY_SINK, useValue: sink },
        ShutdownReporter,
      ],
    };
  }
}
