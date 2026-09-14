import { NestFactory } from "@nestjs/core";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

import { AppModule } from "./app.module.js";
import { readReleaseHistory } from "./authorization/compatibility.js";
import type { ApiConfig } from "./config.js";
import { configureHttpSecurity, FASTIFY_SERVER_OPTIONS } from "./http-security.js";
import { composeApiRuntime } from "./sessions/runtime.ts";
import type { ComposedApiRuntime, RuntimeOverrides } from "./sessions/runtime.ts";
import type { ReliabilitySink } from "./telemetry.js";

export interface ApiApplication {
  readonly app: NestFastifyApplication;
  readonly runtime: ComposedApiRuntime;
}

/**
 * PROTO-WIRE-02: `AppModule.register` receives the composed authorization
 * options -- the real CBD-191 session fact source, the CBD-246 transaction
 * store and the identity module -- from here. `unavailableApiAuthorization`
 * is used only when the identity provider is explicitly unavailable
 * (`composeApiRuntime`), never as a silent default.
 */
export async function createApiApplication(
  config: ApiConfig,
  sink: ReliabilitySink,
  history: unknown = readReleaseHistory(),
  overrides?: RuntimeOverrides,
): Promise<NestFastifyApplication> {
  return (await createComposedApiApplication(config, sink, history, overrides)).app;
}

/** Same as `createApiApplication`, also returning the composed runtime for tests that inspect evidence or the local issuer. */
export async function createComposedApiApplication(
  config: ApiConfig,
  sink: ReliabilitySink,
  history: unknown = readReleaseHistory(),
  overrides?: RuntimeOverrides,
): Promise<ApiApplication> {
  const runtime = composeApiRuntime(config, sink, overrides);
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(config, sink, runtime.authorization, history),
    new FastifyAdapter(FASTIFY_SERVER_OPTIONS),
    { logger: false },
  );

  await configureHttpSecurity(app, config);
  runtime.identity.install(app.getHttpAdapter().getInstance());

  const openApi = new DocumentBuilder()
    .setTitle("CoBudget API")
    .setDescription("CoBudget's HTTP API contract.")
    .setVersion("0.1.0")
    .build();
  const documentFactory = () => SwaggerModule.createDocument(app, openApi);

  SwaggerModule.setup("docs", app, documentFactory, {
    jsonDocumentUrl: "openapi.json",
    raw: ["json"],
    ui: false,
  });

  return { app, runtime };
}
