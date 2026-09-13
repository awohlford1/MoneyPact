import { NestFactory } from "@nestjs/core";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

import { AppModule } from "./app.module.js";
import { readReleaseHistory } from "./authorization/compatibility.js";
import type { ApiConfig } from "./config.js";
import { configureHttpSecurity, FASTIFY_SERVER_OPTIONS } from "./http-security.js";
import type { ReliabilitySink } from "./telemetry.js";

export async function createApiApplication(
  config: ApiConfig,
  sink: ReliabilitySink,
  history: unknown = readReleaseHistory(),
): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(config, sink, undefined, history),
    new FastifyAdapter(FASTIFY_SERVER_OPTIONS),
    { logger: false },
  );

  await configureHttpSecurity(app, config);

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

  return app;
}
