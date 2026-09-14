import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeStateRoot, writeJsonAtomic } from "../storage/index.ts";
import { loadEffectiveConfiguration } from "../config/index.ts";
import { loadRoleCatalogue, renderClaude, renderCodex } from "../roles/generate.ts";

export interface InstallResult {
  projectRoot: string;
  created: string[];
  preserved: string[];
  legacyDetected: boolean;
  receipt: string;
}

async function exists(filename: string): Promise<boolean> {
  try { await access(filename); return true; } catch { return false; }
}

export async function findConsumerRoot(start = process.cwd()): Promise<string> {
  let cursor = path.resolve(start);
  while (true) {
    if (await exists(path.join(cursor, "package.json")) || await exists(path.join(cursor, ".git"))) return cursor;
    const parent = path.dirname(cursor);
    if (parent === cursor) throw new Error(`No project root found from ${start}`);
    cursor = parent;
  }
}

async function writeIfMissing(filename: string, content: string, created: string[], preserved: string[]): Promise<void> {
  if (await exists(filename)) { preserved.push(filename); return; }
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, content, { encoding: "utf8", flag: "wx" });
  created.push(filename);
}

export const PINNED_AGENT_WORKFLOW_COMMAND = "npx --no-install agent-workflow";
const CLAUDE_HOOK_COMMAND = `${PINNED_AGENT_WORKFLOW_COMMAND} provider claude hook`;
const LEGACY_SOURCE_HOOK_COMMAND = "node packages/agent-workflow/src/cli/index.ts provider claude hook";
const CODEX_MARKER = "## Agent Workflow CLI Integration";
const CLAUDE_MARKER = "## Agent Workflow Manager Integration";

function replaceLegacyHookCommand(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(replaceLegacyHookCommand);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, replaceLegacyHookCommand(item)]));
  return value === LEGACY_SOURCE_HOOK_COMMAND ? CLAUDE_HOOK_COMMAND : value;
}

async function installClaudeHooks(filename: string, template: { hooks: Record<string, unknown> }, created: string[], preserved: string[]): Promise<void> {
  const current: Record<string, unknown> = await readFile(filename, "utf8").then((text) => JSON.parse(text) as Record<string, unknown>).catch((error: NodeJS.ErrnoException | SyntaxError) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`Cannot safely reconcile ${filename}: ${error.message}`);
  });
  const hooks = current.hooks === undefined ? {} : current.hooks;
  if (typeof hooks !== "object" || hooks === null || Array.isArray(hooks)) throw new Error(`Cannot safely reconcile ${filename}: hooks must be an object`);
  const mergedHooks = { ...(hooks as Record<string, unknown>) };
  let changed = false;
  for (const [eventName, desired] of Object.entries(template.hooks)) {
    const existing = mergedHooks[eventName];
    if (existing !== undefined && !Array.isArray(existing)) throw new Error(`Cannot safely reconcile ${filename}: hooks.${eventName} must be an array`);
    const entries = existing === undefined ? [] : (replaceLegacyHookCommand([...existing]) as unknown[]);
    if (existing !== undefined && JSON.stringify(entries) !== JSON.stringify(existing)) changed = true;
    const alreadyInstalled = entries.some((entry) => JSON.stringify(entry).includes(CLAUDE_HOOK_COMMAND));
    if (!alreadyInstalled) { entries.push(...desired as unknown[]); changed = true; }
    mergedHooks[eventName] = entries;
  }
  if (!changed && current.hooks !== undefined) { preserved.push(`${filename}#agent-workflow-hooks`); return; }
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, `${JSON.stringify({ ...current, hooks: mergedHooks }, null, 2)}\n`, "utf8");
  created.push(`${filename}#agent-workflow-hooks`);
}

async function installCodexReference(filename: string, created: string[], preserved: string[]): Promise<void> {
  const current = await readFile(filename, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  if (current.includes(CODEX_MARKER)) { preserved.push(`${filename}#agent-workflow-reference`); return; }
  const reference = `${CODEX_MARKER}\n\nFollow the provider-neutral manager instructions in \`.agent-workflow/codex-manager.md\`. Use the pinned Agent Workflow CLI for canonical state changes and treat provider process identifiers as provenance only.\n`;
  await writeFile(filename, `${current}${current === "" || current.endsWith("\n") ? "" : "\n"}\n${reference}`, "utf8");
  created.push(`${filename}#agent-workflow-reference`);
}

async function installClaudeReference(filename: string, created: string[], preserved: string[]): Promise<void> {
  const current = await readFile(filename, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  if (current.includes(CLAUDE_MARKER)) { preserved.push(`${filename}#agent-workflow-reference`); return; }
  const reference = `${CLAUDE_MARKER}\n\nFollow the provider-neutral manager instructions in \`.agent-workflow/codex-manager.md\`. The Manager owns framework IDs and must not ask the Executive to provide them.\n`;
  await writeFile(filename, `${current}${current === "" || current.endsWith("\n") ? "" : "\n"}\n${reference}`, "utf8");
  created.push(`${filename}#agent-workflow-reference`);
}

export async function installConsumer(projectRoot: string): Promise<InstallResult> {
  const root = path.resolve(projectRoot);
  const created: string[] = [];
  const preserved: string[] = [];
  const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
  const defaultConfig = await readFile(path.join(packageRoot, "defaults", "project-config.example.json"), "utf8");
  await writeIfMissing(path.join(root, ".agent-workflow", "config.json"), defaultConfig, created, preserved);
  const effective = await loadEffectiveConfiguration({ projectRoot: root, requireProjectConfig: true });
  await mkdir(path.join(root, ".agent-workflow", "overrides"), { recursive: true });
  const claudeTemplate = await readFile(path.join(packageRoot, "integrations", "claude", "hooks.template.json"), "utf8");
  const hooks = JSON.parse(claudeTemplate.replaceAll("{{agentWorkflowCommand}} provider claude hook", CLAUDE_HOOK_COMMAND)) as { hooks: Record<string, unknown> };
  await installClaudeHooks(path.join(root, ".claude", "settings.json"), hooks, created, preserved);
  const codexTemplate = await readFile(path.join(packageRoot, "integrations", "codex", "MANAGER.template.md"), "utf8");
  await writeIfMissing(path.join(root, ".agent-workflow", "codex-manager.md"), codexTemplate, created, preserved);
  for (const contract of ["README.md", "MANAGER.md", "CONTRACTS.md", "ROLES.md"]) {
    await writeIfMissing(path.join(root, ".agent-workflow", "contracts", contract), await readFile(path.join(packageRoot, "contracts", contract), "utf8"), created, preserved);
  }
  for (const role of (await loadRoleCatalogue()).roles) {
    await writeIfMissing(path.join(root, ".claude", "agents", `${role.id}.md`), renderClaude(role), created, preserved);
    await writeIfMissing(path.join(root, ".codex", "agents", `${role.id}.toml`), renderCodex(role), created, preserved);
  }
  await installCodexReference(path.join(root, "AGENTS.md"), created, preserved);
  await installClaudeReference(path.join(root, "CLAUDE.md"), created, preserved);
  const ignorePath = path.join(root, ".gitignore");
  const ignore = await readFile(ignorePath, "utf8").catch(() => "");
  const state = await initializeStateRoot(root, effective.config.state.directory);
  const ignoredStateDirectory = `${path.relative(root, state.stateRoot).split(path.sep).join("/").replace(/\/+$/, "")}/`;
  if (!ignore.split(/\r?\n/).some((line) => line.trim().replace(/^\//, "") === ignoredStateDirectory)) {
    await writeFile(ignorePath, `${ignore}${ignore.endsWith("\n") || ignore === "" ? "" : "\n"}\n# Agent Workflow local runtime state\n${ignoredStateDirectory}\n`, "utf8");
    created.push(`${ignorePath}#agent-workflow-entry`);
  } else preserved.push(`${ignorePath}#agent-workflow-entry`);
  const legacyDetected = await exists(path.join(state.stateRoot, "manager-ledger.json")) || await exists(path.join(root, "docs", "agent-operations", "operating-contracts"));
  const receiptRelative = path.join(".runtime", "installation.json");
  const receipt = await writeJsonAtomic(state.stateRoot, receiptRelative, {
    schema_version: "1.0", framework_version: "0.1.0", installed_at: new Date().toISOString(),
    project_root: root, legacy_detected: legacyDetected, created: created.map((item) => path.relative(root, item)),
  });
  return { projectRoot: root, created, preserved, legacyDetected, receipt };
}
