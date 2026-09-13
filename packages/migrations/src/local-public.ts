/**
 * Public entry for the local-database contract other workspaces consume
 * (CBD-246's data-access seam): the three fixed roles and the shared
 * configuration loader. Everything else in local.ts is the db:* command
 * surface and stays package-private.
 */
export { roles } from "./local.ts";
export type { Role } from "./local.ts";
export { loadLocalDatabaseConfig } from "./local-config.ts";
export type { LocalDatabaseConfig } from "./local-config.ts";
