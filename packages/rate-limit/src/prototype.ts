import records from "../../../config/rate-limit/records.json" with { type: "json" };
import registrations from "../../../config/rate-limit/registrations.json" with { type: "json" };
import { validateRegistry } from "./registry.ts";
import type { Registration } from "./types.ts";

// Set approval is preserved in prototype-sets.json. No actor identity or durable
// digest projection is invented here. Unresolved projections stay review-only.
export function loadPrototypeRegistry() {
  // Static JSON imports bind the immutable release into the application bundle;
  // runtime lookup must not depend on the deployment's current directory.
  return validateRegistry(records, {
    now: new Date().toISOString(), environment: "local-prototype", singleProcess: true, resolve: () => undefined,
  });
}
export function loadRegistrations(): Registration[] {
  const value: unknown = structuredClone(registrations);
  if (!Array.isArray(value)) throw new Error("registrations_invalid"); return value as Registration[];
}
