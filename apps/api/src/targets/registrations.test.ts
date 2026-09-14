import "reflect-metadata";
import assert from "node:assert/strict";
import { it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { loadPrototypeRegistry, loadRegistrations, registrationErrors } from "../../../../packages/rate-limit/src/index.ts";
import type { Registration } from "../../../../packages/rate-limit/src/index.ts";
import { AppModule } from "../app.module.js";
import { unavailableApiAuthorization } from "../authorization/http.js";
import { testHistory } from "../authorization/test-support.js";
import { loadApiConfigFrom } from "../config.js";
import { installedRoutes } from "../rate-limit/inventory.js";
import { targetsHttp, unavailableTargetsDependencies } from "./http.js";

const here = dirname(fileURLToPath(import.meta.url));
const proposed = JSON.parse(readFileSync(join(here, "registrations.json"), "utf8")) as Registration[];
const config = loadApiConfigFrom({ API_PORT: "3001", LOG_LEVEL: "info", NODE_ENV: "test", SERVICE_VERSION: "targets-registrations", COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local", COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: Buffer.alloc(32, 7).toString("base64"), COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "test-v1" });

it("CBD-266: the proposed registrations are schema-valid, bound to catalogued surfaces and existing parameter records, and match the installed routes exactly", async () => {
  for (const registration of proposed) assert.deepEqual(registrationErrors(registration), [], registration.registration_id);
  const registry = loadPrototypeRegistry();
  for (const registration of proposed) {
    assert.ok(registry.records.some((r) => r.record_id === registration.parameter_record_id && r.surface_id === registration.surface_id), registration.registration_id);
  }
  const existing = new Set(loadRegistrations().map((r) => r.registration_id));
  for (const registration of proposed) assert.equal(existing.has(registration.registration_id), false, `${registration.registration_id} already registered: retire this fixture`);
  const module = await Test.createTestingModule({ imports: [AppModule.register(config, () => undefined, { ...unavailableApiAuthorization(() => undefined), modules: [targetsHttp(unavailableTargetsDependencies()).module] }, testHistory)] }).compile();
  const app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { logger: false });
  try {
    await app.init(); const server = app.getHttpAdapter().getInstance(); await server.ready();
    const installed = installedRoutes(server).map((r) => r.id).filter((id) => id.includes("/v1/budget-spaces/")).sort();
    assert.deepEqual(installed, proposed.map((r) => r.registration_id).sort());
    // Composed without a database and without approval, every route denies.
    for (const route of proposed) {
      const [, method, ...path] = route.registration_id.split(":");
      const response = await app.inject({ method: method as "GET", url: path.join(":").replace("{budgetSpaceId}", "11111111-1111-4111-8111-111111111111") });
      assert.equal(response.statusCode, 503, route.registration_id);
    }
  } finally { await app.close(); }
});
