import "reflect-metadata";
import { pathToFileURL } from "node:url";
import type { FastifyInstance } from "fastify";
import { apiIdentity } from "../../../../packages/rate-limit/src/index.ts";
import { createApiApplication } from "../application.js";
import { ApiAuthorizationBoundary } from "../authorization/http.js";
import { loadApiConfigFrom } from "../config.js";
import { loadWorkerConfigFrom } from "../../../worker/src/config.js";
import { startWorker } from "../../../worker/src/runtime.js";

export function installedRoutes(server: FastifyInstance): { id: string; source: string }[] {
  // Parameter descendants remain nested even with commonPrefix:false.
  const tree = server.printRoutes({ commonPrefix: false });
  const result: { id: string; source: string }[] = [];
  const parents: { indent: number; path: string }[] = [];
  for (const line of tree.split("\n")) {
    const match = /(\/\S*)\s+\(([A-Z, ]+)\)/.exec(line);
    if (!match) continue;
    const indent = match.index;
    while (parents.length && parents.at(-1)!.indent >= indent) parents.pop();
    const path = (parents.at(-1)?.path ?? "") + match[1]!;
    parents.push({ indent, path });
    for (const method of match[2]!.split(",").map((item) => item.trim())) result.push({ id: apiIdentity(method, path), source: "apps/api/src/application.ts#createApiApplication/installed-fastify-route" });
  }
  if (!result.length) throw new Error("installed_route_inventory_empty");
  return result;
}
/**
 * PROTO-ACTIVATION-001: discovery runs under the local identity provider so the identity, budget-creation,
 * budget-space and targets modules are composed and inventoried exactly as `npm run dev` mounts them. Every
 * value is a deterministic non-secret fixture; composition opens no database connection (the data-access
 * client is lazy) and the discovered process is closed before returning.
 */
export const INVENTORY_ENVIRONMENT: Readonly<Record<string, string>> = Object.freeze({
  API_PORT: "3001", NODE_ENV: "test", LOG_LEVEL: "info", SERVICE_VERSION: "cbd266-inventory",
  COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local", COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: Buffer.alloc(32, 7).toString("base64"), COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "inventory-fixture",
  COBUDGET_SESSION_PEPPER: Buffer.alloc(32, 11).toString("base64"),
  COBUDGET_SESSION_IDLE_TIMEOUT_SECONDS: "900", COBUDGET_SESSION_ABSOLUTE_LIFETIME_SECONDS: "3600", COBUDGET_SESSION_FRESH_ASSURANCE_WINDOW_SECONDS: "300",
  COBUDGET_SESSION_REVOCATION_PROPAGATION_TARGET_SECONDS: "60", COBUDGET_SESSION_PROVIDER_MAX_FUTURE_SKEW_SECONDS: "30",
  COBUDGET_SESSION_REJECTION_TIMING_FLOOR_MS: "1", COBUDGET_SESSION_REJECTION_TIMING_JITTER_MS: "1", COBUDGET_SESSION_REJECTION_TIMING_SAMPLE_COUNT: "10",
  COBUDGET_SESSION_REJECTION_TIMING_TIMEOUT_BUCKET_MS: "1", COBUDGET_SESSION_REJECTION_TIMING_MAX_DIFFERENTIAL_MS: "50",
  COBUDGET_SESSION_ENVELOPE_KEY_PROVIDER: "local", COBUDGET_SESSION_ENVELOPE_KEY: Buffer.alloc(32, 13).toString("base64"), COBUDGET_SESSION_ENVELOPE_KEY_VERSION: "inventory-fixture",
  COBUDGET_IDENTITY_PROVIDER: "local", COBUDGET_IDENTITY_ENVIRONMENT_ID: "test", COBUDGET_IDENTITY_ISSUER: "http://127.0.0.1:3001/v1/identity/local", COBUDGET_IDENTITY_CLIENT_ID: "cobudget-local-web",
  COBUDGET_IDENTITY_APPLICATION_ORIGIN: "http://localhost:3000", COBUDGET_IDENTITY_CEREMONY_ORIGIN: "http://127.0.0.1:3001", COBUDGET_IDENTITY_CALLBACK_URI: "http://localhost:3000/v1/identity/callback",
  COBUDGET_IDENTITY_CHALLENGE_LIFETIME_SECONDS: "600", COBUDGET_IDENTITY_EXCHANGE_LIFETIME_MS: "2000", COBUDGET_IDENTITY_MAPPING_MAX_ATTEMPTS: "4",
  COBUDGET_IDENTITY_HANDOFF_LIFETIME_SECONDS: "120", COBUDGET_IDENTITY_CLOCK_SKEW_SECONDS: "30",
});
export async function discoverExecutableSurfaces() {
  const environment = INVENTORY_ENVIRONMENT;
  const app = await createApiApplication(loadApiConfigFrom(environment), () => undefined);
  const worker = startWorker(loadWorkerConfigFrom(environment), { readiness: () => undefined, reliability: () => undefined });
  try {
    await app.init(); const server = app.getHttpAdapter().getInstance() as FastifyInstance; await server.ready();
    const routes = installedRoutes(server);
    for (const missing of app.get(ApiAuthorizationBoundary).inventory()) {
      const [method, ...path] = missing.split(" "); const id = apiIdentity(method!, path.join(" "));
      if (!routes.some((r) => r.id === id)) routes.push({ id, source: "apps/api/src/authorization/http.ts#ApiAuthorizationBoundary.inventory" });
    }
    return [...routes, ...worker.jobs.inventory().map((job) => ({ id: `job:worker:${job.jobType}:1`, source: `apps/worker/src/authorization/jobs.ts#${job.jobType}` }))];
  } finally { await app.close(); await worker.stop(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(`CBD266_INVENTORY=${JSON.stringify(await discoverExecutableSurfaces())}`);
