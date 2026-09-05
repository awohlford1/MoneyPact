import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { inventory, root, sources, scanJavaScript, validateInventory } from "./check-environment.mjs";
import { python } from "./python-runtime.mjs";

const template = readFileSync(join(root, ".env.example"), "utf8");
const files = sources();

describe("environment contract", () => {
  it("excludes isolated dependency caches but still scans first-party tooling", () => {
    const fixture = mkdtempSync(join(tmpdir(), "cbd115-environment-"));
    try {
      mkdirSync(join(fixture, ".cache"));
      mkdirSync(join(fixture, "scripts"));
      writeFileSync(join(fixture, ".cache", "dependency.py"), "# third-party fixture");
      writeFileSync(join(fixture, "scripts", "tool.py"), "# first-party fixture");
      assert.deepEqual(Object.keys(sources(fixture)), ["scripts/tool.py"]);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
  it("accepts the complete repository inventory", () => {
    assert.deepEqual(validateInventory(inventory, template, files), []);
  });
  for (const variable of inventory.variables.filter(v => v.template === "included")) {
    it(`rejects the isolated removal of ${variable.name} from the template`, () => {
      const changed = template.split(/\r?\n/).filter(line => !line.startsWith(`${variable.name}=`)).join("\n");
      assert.ok(validateInventory(inventory, changed, files).some(f => f.includes(`${variable.name}: missing template`)));
    });
  }
  it("rejects an orphan, duplicate, undocumented, or unsafe template value", () => {
    for (const change of [template + "\nORPHAN=value\n", template + "\nAPI_PORT=3001\n",
      template.replace("CONFLUENCE_API_TOKEN=", "CONFLUENCE_API_TOKEN=synthetic-secret"),
      template.replace(/# TCP port[^\n]*\r?\n/, "")]) {
      assert.ok(validateInventory(inventory, change, files).length > 0);
    }
  });
  it("rejects schema drift and a stale consumer", () => {
    const changed = structuredClone(inventory);
    changed.variables.find(v => v.name === "API_PORT").validation.max = 65536;
    assert.ok(validateInventory(changed, template, files).some(f => f.includes("API_PORT: inventory validation differs")));
    changed.variables.find(v => v.name === "LOG_LEVEL").consumer.push("scripts/check-environment.mjs");
    assert.ok(validateInventory(changed, template, files).some(f => f.includes("LOG_LEVEL: stale consumer")));
  });
  it("requires all platform/test classifications and rejects a new environment schema consumer", () => {
    for (const name of ["CI", "SCARF_ANALYTICS", "TZ"]) {
      const changed = { ...inventory, variables: inventory.variables.filter(v => v.name !== name) };
      assert.ok(validateInventory(changed, template, files).some(f => f.includes(name)));
    }
    assert.ok(scanJavaScript('loadConfigFromEnvironment({EXTRA: {kind: "string", required: true}})', "apps/new/config.ts").length);
  });
  it("fails the production guard for undeclared JS and Python fixtures", () => {
    for (const [path, source] of [["apps/fixture.ts", "process.env.CBD_113_UNDECLARED"],
      ["scripts/fixture.py", 'import os\nos.environ.get("CBD_113_UNDECLARED")']]) {
      const errors = validateInventory(inventory, template, { ...files, [path]: source });
      assert.ok(errors.some(f => f.includes("CBD_113_UNDECLARED")));
    }
  });
  it("rejects computed, destructured, imported and aliased reads", () => {
    for (const source of ['process["env"]["UNKNOWN"]', "process.env[name]", "const {env} = process",
      "const e = process.env", 'import {env as e} from "node:process"', 'require("process").env',
      "const p = process; p.env.X", "globalThis.process.env.X", "process[key]",
      "const read = loadConfigFromEnvironment; read(schema)", "const read = config.loadConfigFromEnvironment"]) {
      assert.ok(scanJavaScript(source, "apps/fixture.ts").length, source);
    }
    assert.deepEqual(scanJavaScript('// process.env.COMMENT\nconst s = "process.env.STRING"', "apps/fixture.ts"), []);
  });
  it("runs isolated Python configuration, scanner and pre-effect tests", () => {
    const result = python([join(root, "scripts/test_tool_config.py")]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
  it("rejects the review bypasses through the production inventory validator", () => {
    const javascript = [
      "console.log((process).env.CBD_113_UNDECLARED)",
      "let p; p = process; console.log(p.env.CBD_113_UNDECLARED)",
      "const p = {runtime: process}; console.log(p.runtime.env.CBD_113_UNDECLARED)",
      'const p = await import("node:process"); console.log(p.env.CBD_113_UNDECLARED)',
      "console.log((process as NodeJS.Process).env.CBD_113_UNDECLARED)",
      "console.log(process!.env.CBD_113_UNDECLARED)",
      "function getProcess() { return process; }",
      'const p = await import(moduleName); console.log(p.env.CBD_113_UNDECLARED)',
      'console.log(process.getBuiltinModule("process").env.CBD_113_UNDECLARED)',
      'export {env} from "node:process"',
      'const p = require("node:" + "process"); console.log(p.env.CBD_113_UNDECLARED)',
      'const load = require; console.log(load("process").env.CBD_113_UNDECLARED)',
      'const {"process": p} = globalThis; console.log(p.env.CBD_113_UNDECLARED)',
      'import {createRequire as load} from "node:module"; load(import.meta.url)("process").env.CBD_113_UNDECLARED',
    ];
    const pythonSources = [
      'import os\nx = os.__dict__["environ"].get("CBD_113_UNDECLARED")',
      'import importlib\nx = importlib.import_module("os").getenv("CBD_113_UNDECLARED")',
      'import importlib as lib\nx = lib.import_module("os").getenv("CBD_113_UNDECLARED")',
      'from importlib import import_module as load\nx = load("os").getenv("CBD_113_UNDECLARED")',
      'x = __import__("os").getenv("CBD_113_UNDECLARED")',
      'import importlib\nload = importlib.import_module\nx = load(module_name)',
      'import importlib as lib\nalias = lib\nx = alias.import_module("os").getenv("CBD_113_UNDECLARED")',
      'from builtins import __import__ as load\nx = load("os").getenv("CBD_113_UNDECLARED")',
      'from os import __dict__ as d\nx = d["environ"].get("CBD_113_UNDECLARED")',
      '__import__("os.path").getenv("CBD_113_UNDECLARED")',
      '__import__("importlib").import_module("os").getenv("CBD_113_UNDECLARED")',
    ];
    for (const [extension, inputs] of [["ts", javascript], ["py", pythonSources]]) {
      for (const source of inputs) {
        const path = `scripts/review-fixture.${extension}`;
        assert.ok(validateInventory(inventory, template, { ...files, [path]: source }).some(f => f.includes(path)), source);
      }
    }
  });
  it("permits non-environment process uses and static unrelated imports", () => {
    assert.deepEqual(scanJavaScript('const policy = {process: "readonly"}; process.stdout.write("ok");', "scripts/fixture.mjs"), []);
    assert.deepEqual(scanJavaScript('const fs = await import("node:fs");', "scripts/fixture.mjs"), []);
  });
  it("rejects diagnostic-report and platform-module environment access", () => {
    const cases = [
      ["mjs", "console.log(process.report.getReport().environmentVariables.CBD_113_UNDECLARED)"],
      ["mjs", 'process["report"]["getReport"]().environmentVariables.CBD_113_UNDECLARED'],
      ["mjs", "const report = process.report; report.getReport()"],
      ["mjs", "const {getReport} = process.report; getReport()"],
      ["mjs", "process.report.writeReport()"],
    ];
    for (const module of ["nt", "posix"]) {
      cases.push(
        ["py", `import ${module}\n${module}.environ.get("CBD_113_UNDECLARED")`],
        ["py", `import ${module} as platform\nplatform.environ.get("CBD_113_UNDECLARED")`],
        ["py", `from ${module} import environ as env\nenv.get("CBD_113_UNDECLARED")`],
        ["py", `from ${module} import *\nenviron.get("CBD_113_UNDECLARED")`],
      );
    }
    for (const [extension, source] of cases) {
      const path = `scripts/platform-environment-fixture.${extension}`;
      assert.ok(validateInventory(inventory, template, { ...files, [path]: source }).some(f => f.includes(path)), source);
    }
  });
  it("rejects malformed tooling rules and defaults at build time", () => {
    for (const validation of [null, {}, { kind: "unknown" }, { kind: "https-origin", extra: true },
      { kind: "https-origin", default: "http://bad.invalid/path" },
      { kind: "https-origin", default: "https://example.invalid#" },
      { kind: "https-origin", default: 42 }, { kind: "https-origin", default: "" }]) {
      const changed = structuredClone(inventory);
      changed.variables.find(v => v.name === "JIRA_BASE_URL").validation = validation;
      assert.ok(validateInventory(changed, template, files).some(f => f.includes("JIRA_BASE_URL")));
    }
  });
});
