import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { installConsumer } from "../../src/installer/index.ts";
import { doctor, validateInstallation } from "../../src/cli/diagnostics.ts";

test("consumer initialization is idempotent and preserves existing files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "aw-install-"));
  await writeFile(path.join(root, "package.json"), "{}\n");
  await (await import("node:fs/promises")).mkdir(path.join(root, ".claude"));
  await writeFile(path.join(root, ".claude", "settings.json"), JSON.stringify({ permissions: { allow: ["Read"] }, hooks: { SessionStart: [{ hooks: [{ type: "command", command: "existing-hook" }] }] } }));
  await writeFile(path.join(root, "AGENTS.md"), "# Existing instructions\n\nKeep this text.\n");
  const first = await installConsumer(root);
  const configBefore = await readFile(path.join(root, ".agent-workflow", "config.json"), "utf8");
  const second = await installConsumer(root);
  assert.ok(first.created.length > 0);
  assert.ok(second.preserved.some((item) => item.endsWith("config.json")));
  assert.equal(await readFile(path.join(root, ".agent-workflow", "config.json"), "utf8"), configBefore);
  assert.equal((await readFile(path.join(root, ".gitignore"), "utf8")).match(/^\.agent-state\/$/gm)?.length, 1);
  const claude = await readFile(path.join(root, ".claude", "settings.json"), "utf8");
  assert.match(claude, /existing-hook/);
  assert.match(claude, /provider claude hook/);
  assert.match(await readFile(path.join(root, "AGENTS.md"), "utf8"), /Keep this text[\s\S]*Agent Workflow CLI Integration/);
  assert.match(await readFile(path.join(root, "CLAUDE.md"), "utf8"), /Agent Workflow Manager Integration[\s\S]*must not ask the Executive/);
  const report = await doctor(root);
  assert.equal(report.healthy, true);
  assert.deepEqual(report.integrations, { claude: true, codex: true });
  assert.equal(report.capabilities.hooks.claude.PreToolUse.level, "enforced");
  assert.match(report.capabilities.hooks.claude.PreToolUse.reason, /connected to workflow authorization/);
  assert.equal(report.capabilities.controls.brokered_raw_response_capture.level, "enforced");
});

test("validation detects missing contracts and generated role drift", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "aw-install-drift-"));
  await writeFile(path.join(root, "package.json"), "{}\n");
  await installConsumer(root);
  await writeFile(path.join(root, ".claude", "agents", "implementation.md"), "drifted\n");
  await rm(path.join(root, ".agent-workflow", "contracts", "MANAGER.md"));
  const report = await validateInstallation(root);
  assert.equal(report.valid, false);
  assert.ok(report.contracts.missing.includes("MANAGER.md"));
  assert.ok(report.roles.drift.includes(".claude/agents/implementation.md"));
});
