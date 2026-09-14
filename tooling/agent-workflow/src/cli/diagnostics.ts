import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEffectiveConfiguration } from "../config/index.ts";
import { PINNED_AGENT_WORKFLOW_COMMAND } from "../installer/index.ts";
import { CLAUDE_HOOK_EVENTS, ClaudeProviderAdapter } from "../providers/claude/index.ts";
import { CodexProviderAdapter } from "../providers/codex/index.ts";
import { coreSchemaRegistry } from "../registries/index.ts";
import { resolveStatePaths } from "../storage/index.ts";
import { generateRoles, loadRoleCatalogue } from "../roles/generate.ts";

export const FRAMEWORK_VERSION = "0.1.6";
export const SUPPORTED_SCHEMA_VERSION = "1.0";

async function exists(filename: string): Promise<boolean> { try { await access(filename); return true; } catch { return false; } }
async function count(directory: string): Promise<number> { try { return (await readdir(directory)).length; } catch { return 0; } }

export interface ClaudeHookInspection { valid: boolean; missing: string[]; mismatched: string[] }

export async function inspectClaudeHooks(filename: string): Promise<ClaudeHookInspection> {
  const missing: string[] = []; const mismatched: string[] = [];
  try {
    const value = JSON.parse(await readFile(filename, "utf8")) as { hooks?: Record<string, unknown> };
    for (const eventName of CLAUDE_HOOK_EVENTS) {
      const entries = value.hooks?.[eventName];
      if (!Array.isArray(entries) || !JSON.stringify(entries).includes("provider claude hook")) missing.push(eventName);
      else if (!JSON.stringify(entries).includes(PINNED_AGENT_WORKFLOW_COMMAND)) mismatched.push(eventName);
    }
  } catch { missing.push(...CLAUDE_HOOK_EVENTS); }
  return { valid: missing.length === 0 && mismatched.length === 0, missing, mismatched };
}

async function hasCodexIntegration(filename: string): Promise<boolean> {
  return readFile(filename, "utf8").then((text) => text.includes("Agent Workflow CLI Integration") && text.includes("pinned Agent Workflow CLI")).catch(() => false);
}

async function staleJsonCount(directory: string): Promise<number> {
  const now = Date.now(); let stale = 0;
  for (const name of await readdir(directory).catch(() => [])) {
    const filename = path.join(directory, name, name.endsWith(".lock") ? "lock.json" : "");
    try { const value = JSON.parse(await readFile(filename, "utf8")) as { expiresAt?: string }; if (value.expiresAt && Date.parse(value.expiresAt) <= now) stale += 1; }
    catch { /* malformed entries are reported by state validation */ }
  }
  return stale;
}

function semver(value: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(value);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}
function compareVersions(left: string, right: string): number {
  const a = semver(left); const b = semver(right); if (!a || !b) return Number.NaN;
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}

export interface UpgradeCompatibilityInput { currentVersion?: string; targetVersion: string; configurationSchemaVersion?: string; recordSchemaVersion?: string; eventSchemaVersion?: string }
export function checkUpgradeCompatibility(input: UpgradeCompatibilityInput) {
  const currentVersion = input.currentVersion ?? FRAMEWORK_VERSION;
  const current = semver(currentVersion); const target = semver(input.targetVersion); const reasons: string[] = [];
  if (!current || !target) reasons.push("Framework versions must use semantic versioning.");
  const schemas = [input.configurationSchemaVersion, input.recordSchemaVersion, input.eventSchemaVersion].filter(Boolean);
  if (schemas.some((version) => version !== SUPPORTED_SCHEMA_VERSION)) reasons.push("One or more persisted schema versions are unsupported by this runtime.");
  const comparison = compareVersions(input.targetVersion, currentVersion);
  const migrationRequired = Boolean(current && target && current[0] !== target[0]);
  if (Number.isFinite(comparison) && comparison < 0) reasons.push("Downgrades require an explicit migration plan.");
  return { compatible: reasons.length === 0 && !migrationRequired, currentVersion, targetVersion: input.targetVersion, migrationRequired, reasons };
}

export async function capabilityReport(options: { claudeBlockingHook?: boolean; claudeWorkflowAuthorizationConnected?: boolean } = {}) {
  const claudeAdapter = new ClaudeProviderAdapter({
    blockingPreToolHook: options.claudeBlockingHook ?? false,
    workflowAuthorizationConnected: options.claudeWorkflowAuthorizationConnected ?? false,
  });
  const claude = await claudeAdapter.capabilities();
  const codex = await new CodexProviderAdapter().capabilities();
  return { controls: {
    schema_validation: { level: "enforced", reason: "The shared runtime rejects invalid canonical records." },
    state_transitions: { level: "enforced", reason: "Managed commands reject illegal transitions." },
    intent_pipeline: { level: "enforced", reason: "Managed consequential operations require durable intent." },
    local_cli_process_control: { level: "enforced", reason: "Broker-launched Codex and Claude CLI children are PID-tracked, interruptible, and require a durable receiver acknowledgement before ownership handover." },
    brokered_raw_response_capture: { level: "enforced", reason: "Broker-launched Codex and Claude CLI workers persist redacted request and response records with a linked, deduplicated response-captured event." },
    direct_shell_compliance: { level: "instructed", reason: "Provider actions outside hooks and the CLI cannot be blocked universally." },
    live_cross_provider_handover: { level: "unsupported", reason: "The broker only transfers work after the tracked process has stopped; it never transfers a live process between providers." },
  }, providers: { claude, codex }, hooks: { claude: claudeAdapter.hookCapabilities() } };
}

export async function doctor(projectRoot: string) {
  const errors: string[] = []; const warnings: string[] = []; const info: string[] = [];
  let effective;
  try { effective = await loadEffectiveConfiguration({ projectRoot, requireProjectConfig: true }); } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  let stateRoot = path.join(projectRoot, ".agent-state");
  try { stateRoot = (await resolveStatePaths(projectRoot, effective?.config.state.directory)).stateRoot; } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  const claudeHooks = await inspectClaudeHooks(path.join(projectRoot, ".claude", "settings.json"));
  const codexIntegrated = await hasCodexIntegration(path.join(projectRoot, "AGENTS.md"));
  if ((effective?.config.providers.claude?.enabled ?? false) && !claudeHooks.valid) warnings.push(`Claude hook integration is incomplete (missing: ${claudeHooks.missing.join(", ") || "none"}; unpinned: ${claudeHooks.mismatched.join(", ") || "none"}).`);
  if ((effective?.config.providers.codex?.enabled ?? false) && !codexIntegrated) warnings.push("Codex manager instructions do not reference the pinned Agent Workflow CLI.");
  const requiredContracts = ["README.md", "MANAGER.md", "CONTRACTS.md", "ROLES.md"];
  const missingContracts = (await Promise.all(requiredContracts.map(async (name) => await exists(path.join(projectRoot, ".agent-workflow", "contracts", name)) ? undefined : name))).filter((name): name is string => name !== undefined);
  if (missingContracts.length) errors.push(`Installed workflow contracts are missing: ${missingContracts.join(", ")}.`);
  const catalogue = await loadRoleCatalogue();
  const knownRoles = new Set(catalogue.roles.map((role) => role.id));
  const configuredRoles = effective?.config.roles.enabled ?? [];
  const unknownRoles = configuredRoles.filter((role) => !knownRoles.has(role));
  if (unknownRoles.length) errors.push(`Configured roles are not in the canonical catalogue: ${unknownRoles.join(", ")}.`);
  const missingRoleAdapters: string[] = [];
  for (const role of configuredRoles) {
    if (!await exists(path.join(projectRoot, ".claude", "agents", `${role}.md`))) missingRoleAdapters.push(`.claude/agents/${role}.md`);
    if (!await exists(path.join(projectRoot, ".codex", "agents", `${role}.toml`))) missingRoleAdapters.push(`.codex/agents/${role}.toml`);
  }
  if (missingRoleAdapters.length) errors.push(`Enabled role adapters are missing: ${missingRoleAdapters.join(", ")}.`);
  const roleGeneration = await generateRoles(projectRoot, true);
  if (!roleGeneration.valid) errors.push(`Provider role adapters have drifted from the canonical catalogue: ${roleGeneration.mismatches.join(", ")}.`);
  const rawCaptureProviders = Object.entries(effective?.config.providers ?? {}).filter(([, value]) => value.captureRawResponses === true).map(([name]) => name);
  if (rawCaptureProviders.length) warnings.push(`Raw provider response capture is enabled for ${rawCaptureProviders.join(", ")}; captured data is heuristic-redacted and retained locally.`);
  const approvalPolicy = effective?.config.security.executiveApproval;
  if (approvalPolicy?.mode === "record_only") warnings.push("Executive approvals are recorded but are not cryptographically authenticated; CLI callers can self-assert executive identity.");
  if (approvalPolicy?.mode === "signed_ed25519" && Object.keys(approvalPolicy.trustedPublicKeys).length === 0) errors.push("Signed executive approval is enabled but no trusted public keys are configured.");
  const gitignore = await readFile(path.join(projectRoot, ".gitignore"), "utf8").catch(() => "");
  const ignoredPath = `${path.relative(projectRoot, stateRoot).split(path.sep).join("/").replace(/\/+$/, "")}/`;
  const stateRootIgnored = gitignore.split(/\r?\n/).some((line) => line.trim().replace(/^\//, "") === ignoredPath);
  if (!stateRootIgnored) errors.push(`The configured state directory ${ignoredPath} is not ignored by Git.`);
  const minimumVersion = effective?.config.framework.minimumVersion;
  if (minimumVersion && compareVersions(FRAMEWORK_VERSION, minimumVersion) < 0) errors.push(`Framework ${FRAMEWORK_VERSION} does not satisfy minimum version ${minimumVersion}.`);
  const registryComplete = coreSchemaRegistry.recordTypes().length > 0 && coreSchemaRegistry.eventTypes().length > 0;
  if (!registryComplete) errors.push("The core schema registry is incomplete.");
  const legacyDetected = await exists(path.join(stateRoot, "manager-ledger.json")) || await exists(path.join(projectRoot, "docs", "agent-operations", "operating-contracts"));
  if (legacyDetected) warnings.push("Legacy records were detected and left unchanged for Phase 2 migration.");
  const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
  const packageRelative = path.relative(projectRoot, packageRoot);
  const normalizedPackageRelative = packageRelative.split(path.sep).join("/");
  const installedFromNodeModules = normalizedPackageRelative === "node_modules/@agent-workflow/cli" || normalizedPackageRelative.startsWith("node_modules/@agent-workflow/cli/");
  if (packageRelative === "" || (!packageRelative.startsWith("..") && !path.isAbsolute(packageRelative) && !installedFromNodeModules)) warnings.push("The active Agent Workflow CLI is workspace-linked and mutable; create a pinned packaged installation before treating the integration as release-ready.");
  info.push("Local ignored state is not a backup.", "Live cross-provider process takeover is unsupported.");
  const capabilities = await capabilityReport({ claudeBlockingHook: claudeHooks.valid, claudeWorkflowAuthorizationConnected: claudeHooks.valid });
  return {
    healthy: errors.length === 0, frameworkVersion: FRAMEWORK_VERSION, configurationSchemaVersion: SUPPORTED_SCHEMA_VERSION, recordSchemaVersion: SUPPORTED_SCHEMA_VERSION, eventSchemaVersion: SUPPORTED_SCHEMA_VERSION,
    configurationDigest: effective?.digest, stateRoot, stateRootSafety: { contained: !path.relative(projectRoot, stateRoot).startsWith(".."), gitignored: stateRootIgnored, ignoredPath },
    enabledProviders: Object.entries(effective?.config.providers ?? {}).filter(([, value]) => value.enabled).map(([name]) => name).sort(),
    integrations: { claude: claudeHooks.valid, codex: codexIntegrated }, hookInspection: { claude: claudeHooks }, capabilities,
    contracts: { valid: missingContracts.length === 0, missing: missingContracts },
    roles: { valid: unknownRoles.length === 0 && missingRoleAdapters.length === 0 && roleGeneration.valid, configured: configuredRoles, unknown: unknownRoles, missingAdapters: missingRoleAdapters, drift: roleGeneration.mismatches },
    schemas: { registryComplete, recordTypes: coreSchemaRegistry.recordTypes().length, eventTypes: coreSchemaRegistry.eventTypes().length, extensions: Object.keys(effective?.extensions ?? {}) },
    counts: { pending: await count(path.join(stateRoot, "pending")), quarantine: await count(path.join(stateRoot, "quarantine")), awaitingValidation: await count(path.join(stateRoot, "awaiting-validation")) },
    stale: { operationLocks: await staleJsonCount(path.join(stateRoot, "locks", "operations")), ownershipLeases: await staleJsonCount(path.join(stateRoot, "locks", "ownership")) },
    maintenance: { cleanupOperations: await count(path.join(stateRoot, "cleanup", ".operations")), archiveOperations: await count(path.join(stateRoot, "archive", ".operations")) },
    legacyDetected, errors, warnings, info,
  };
}

export async function validateInstallation(projectRoot: string) {
  const report = await doctor(projectRoot);
  const requiredIntegrationsValid = (!report.enabledProviders.includes("claude") || report.hookInspection.claude.valid) && (!report.enabledProviders.includes("codex") || report.integrations.codex);
  return { valid: report.healthy && requiredIntegrationsValid && report.contracts.valid && report.roles.valid, configurationDigest: report.configurationDigest, integration: { claude: report.integrations.claude, codex: report.integrations.codex }, errors: report.errors, warnings: report.warnings, schemas: report.schemas, contracts: report.contracts, roles: report.roles };
}
