import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadPrototypeRegistry, loadRegistrations, parseRegistryJson, PUBLIC_SURFACES, registrationErrors, SURFACE_CATALOG } from "../packages/rate-limit/src/index.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sections = [
  /* API discovery */ "UNREGISTERED_API_ROUTES", /* end diagnostic label */
  "UNREGISTERED_WORKER_JOBS",
  "UNKNOWN_SURFACES",
  "MISSING_OR_UNAPPROVED_PARAMETER_RECORDS",
  "DUPLICATE_REGISTRATIONS",
  "STALE_REGISTRATIONS",
];
export function checkInventory(discovered, registrations, registry) {
  const report = Object.fromEntries(sections.map((section) => [section, []]));
  const active = registrations.filter((r) => r && r.registration_lifecycle === "active");
  for (const [index, r] of registrations.entries()) if (registrationErrors(r).length) report.MISSING_OR_UNAPPROVED_PARAMETER_RECORDS.push(`registration_schema_invalid /${index}`);
  const ids = new Set(discovered.map((surface) => surface.id));
  for (const surface of discovered) {
    const matches = active.filter((r) => r.registration_id === surface.id);
    if (!matches.length) report[surface.id.startsWith("api:") ? sections[0] : sections[1]].push(`${surface.id} ${surface.source}`);
    if (matches.length > 1) report.DUPLICATE_REGISTRATIONS.push(surface.id);
  }
  for (const r of active) {
    if (!SURFACE_CATALOG[r.surface_id] && PUBLIC_SURFACES[r.registration_id] !== r.surface_id) report.UNKNOWN_SURFACES.push(`${r.registration_id} ${r.surface_id}`);
    if (registrationErrors(r).length || (!PUBLIC_SURFACES[r.registration_id] && (!registry.approved.has(r.parameter_record_id) || registry.approved.get(r.parameter_record_id)?.surface_id !== r.surface_id))) report.MISSING_OR_UNAPPROVED_PARAMETER_RECORDS.push(r.registration_id);
    if (!ids.has(r.registration_id)) report.STALE_REGISTRATIONS.push(r.registration_id);
  }
  const seen = new Set();
  for (const surface of discovered) { if (seen.has(surface.id)) report.DUPLICATE_REGISTRATIONS.push(surface.id); seen.add(surface.id); }
  for (const d of registry.diagnostics) {
    report.MISSING_OR_UNAPPROVED_PARAMETER_RECORDS.push(`${d.recordId} ${d.code} ${d.pointer}`);
    if (d.code === "record_reference_invalid" && ["/surface_id", "/record_id"].includes(d.pointer)) report.DUPLICATE_REGISTRATIONS.push(`${d.recordId} ${d.pointer}`);
  }
  for (const section of sections) report[section] = [...new Set(report[section])].sort();
  return report;
}
export function printReport(report, write = console.log) {
  for (const section of sections) { write(`${section} (${report[section].length})`); for (const line of report[section]) write(`  ${line}`); }
  const failed = sections.some((section) => report[section].length);
  write(`Rate-limit registry check ${failed ? "failed" : "passed"}: executable inventory, exact registration, approved parameters`);
  return !failed;
}
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(join(directory, entry.name)) : entry.name.endsWith(".ts") ? [join(directory, entry.name)] : []);
}
/** Same TypeScript AST approach as CBD-236 inventory.test.ts. Runtime discovery
 * remains primary; source inspection makes bypassing either adapter a failure. */
export async function sourceBypasses() {
  const { default: ts } = await import("typescript"); const result = [];
  for (const app of ["api", "worker"]) for (const file of files(join(root, "apps", app, "src"))) {
    const name = relative(root, file).replaceAll("\\", "/");
    if (name.endsWith(".test.ts") || name.includes("/authorization/") || name.endsWith("/rate-limit/inventory.ts")) continue;
    const ast = ts.createSourceFile(name, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ["post", "put", "patch", "delete", "route", "all", "consume", "process", "subscribe", "schedule"].includes(node.expression.name.text)) {
        result.push({ id: `${app === "api" ? "api:UNREGISTERED" : "job:UNREGISTERED"}:${name}:${ast.getLineAndCharacterOfPosition(node.pos).line + 1}`, source: `${name}#${node.expression.name.text}` });
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  return result;
}
async function main() {
  let discovered = []; let failure;
  try {
    for (const file of ["records.json", "registrations.json"]) parseRegistryJson(readFileSync(join(root, "config/rate-limit", file), "utf8"));
    const run = spawnSync(process.execPath, ["--import=tsx", "src/rate-limit/inventory.ts"], { cwd: join(root, "apps/api"), encoding: "utf8", timeout: 30_000 });
    if (run.status !== 0) throw new Error(`executable discovery unavailable (${run.error?.code ?? run.status}): ${run.stderr}`);
    const line = run.stdout.split(/\r?\n/).find((item) => item.startsWith("CBD266_INVENTORY="));
    if (!line) throw new Error("executable discovery returned no inventory");
    discovered = [...JSON.parse(line.slice("CBD266_INVENTORY=".length)), ...await sourceBypasses()];
  } catch (error) { failure = error.message; }
  const registry = loadPrototypeRegistry(); const report = checkInventory(discovered, loadRegistrations(), registry);
  if (failure) report.UNREGISTERED_API_ROUTES.push(`DISCOVERY_UNAVAILABLE ${failure}`);
  console.log(`DISCOVERED_API_ROUTES ${discovered.filter((r) => r.id.startsWith("api:")).length}`);
  console.log(`DISCOVERED_WORKER_JOBS ${discovered.filter((r) => r.id.startsWith("job:")).length}`);
  console.log(`REGISTRY_RELEASE_SET_DIGEST ${registry.releaseSetDigest}`);
  if (!printReport(report)) process.exitCode = 1;
  else console.log(`Rate-limit registry inventory passed: api=${discovered.filter((r) => r.id.startsWith("api:")).length} jobs=${discovered.filter((r) => r.id.startsWith("job:")).length} bounded=${loadRegistrations().filter((r) => !PUBLIC_SURFACES[r.registration_id]).length} public=${loadRegistrations().filter((r) => PUBLIC_SURFACES[r.registration_id]).length} approved=${registry.approved.size} release=${registry.releaseSetDigest}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
