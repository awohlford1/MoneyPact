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
  // commonPrefix:false prints each complete installed path instead of fragments.
  const tree = server.printRoutes({ commonPrefix: false });
  const result: { id: string; source: string }[] = [];
  for (const line of tree.split("\n")) {
    const match = /(\/\S*)\s+\(([A-Z, ]+)\)/.exec(line);
    if (!match) continue;
    for (const method of match[2]!.split(",").map((item) => item.trim())) result.push({ id: apiIdentity(method, match[1]!), source: "apps/api/src/application.ts#createApiApplication/installed-fastify-route" });
  }
  if (!result.length) throw new Error("installed_route_inventory_empty");
  return result;
}
export async function discoverExecutableSurfaces() {
  const environment = { API_PORT: "3001", NODE_ENV: "test", LOG_LEVEL: "info", SERVICE_VERSION: "cbd266-inventory", COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local", COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: Buffer.alloc(32, 7).toString("base64"), COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "inventory-fixture" };
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
