import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { checkUpgradeCompatibility, doctor } from "../../src/cli/diagnostics.ts";
import { installConsumer } from "../../src/installer/index.ts";

test("installer uses pinned binary and configured state directory", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "aw-portable-install-"));
  await writeFile(path.join(root, "package.json"), "{}\n");
  await installConsumer(root);
  const configPath = path.join(root, ".agent-workflow", "config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  config.state = { directory: ".local-agent-state" };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await installConsumer(root);
  const hooks = await readFile(path.join(root, ".claude", "settings.json"), "utf8");
  assert.match(hooks, /npx --no-install agent-workflow provider claude hook/);
  assert.doesNotMatch(hooks, /packages\/agent-workflow\/src/);
  assert.match(await readFile(path.join(root, ".gitignore"), "utf8"), /^\.local-agent-state\/$/m);
  const report = await doctor(root);
  assert.equal(report.stateRoot, path.join(root, ".local-agent-state"));
  assert.equal(report.hookInspection.claude.missing.length, 0);
});

test("upgrade compatibility API rejects major changes and unsupported schemas", () => {
  assert.equal(checkUpgradeCompatibility({ currentVersion: "0.1.0", targetVersion: "0.2.0", recordSchemaVersion: "1.0" }).compatible, true);
  assert.equal(checkUpgradeCompatibility({ currentVersion: "0.1.0", targetVersion: "1.0.0" }).migrationRequired, true);
  assert.equal(checkUpgradeCompatibility({ targetVersion: "0.2.0", eventSchemaVersion: "2.0" }).compatible, false);
});
