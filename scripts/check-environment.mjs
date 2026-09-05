import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import { createRequire } from "node:module";
import { apiConfigSchema } from "../apps/api/src/config.ts";
import { workerConfigSchema } from "../apps/worker/src/config.ts";
import { python } from "./python-runtime.mjs";

// Use the compiler already declared by the contracts workspace being audited.
const ts = createRequire(new URL("../packages/contracts/package.json", import.meta.url))("typescript");

export const root = dirname(dirname(fileURLToPath(import.meta.url)));
export const inventory = JSON.parse(readFileSync(join(root, "config/environment-inventory.json"), "utf8"));
const excluded = new Set(["node_modules", ".git", ".next", "dist", "build", "coverage", "__pycache__", ".confluence-preview", ".codex", ".agents", ".cache"]);
const inheritedTestPaths = new Set(["packages/budget-domain/src/shared/iso-date.test.ts", "packages/budget-domain/src/schedule/period.test.ts"]);
const reviewedFileImports = {
  "packages/contracts/src/barrel.test.ts": ["pathToFileURL(path).href"],
  "packages/budget-domain/src/barrel.test.ts": ['newURL("index.ts",group.directory).href', "newURL(fileName,group.directory).href"],
};
const environmentModules = new Set(["node:process", "process", "node:module", "module"]);

export function sources(directory = root) {
  const result = {};
  function walk(folder) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (excluded.has(entry.name) || entry.isSymbolicLink()) continue;
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(?:[cm]?js|[cm]?ts|tsx|jsx|py)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
        result[relative(directory, path).replaceAll("\\", "/")] = readFileSync(path, "utf8");
      }
    }
  }
  walk(directory);
  return result;
}

function property(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) return node.argumentExpression.text;
  return undefined;
}

export function scanJavaScript(source, path) {
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const failures = [];
  function fail(node, message) {
    failures.push(`${path}:${tree.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${message}`);
  }
  function visit(node) {
    if ((ts.isIdentifier(node) && node.text === "loadConfigFromEnvironment") || property(node) === "loadConfigFromEnvironment") {
      const parent = node.parent;
      const declaration = ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)
        || (ts.isFunctionDeclaration(parent) && parent.name === node);
      const memberName = ts.isPropertyAccessExpression(parent) && parent.name === node;
      const call = ts.isCallExpression(parent) && parent.expression === node;
      if (!declaration && !memberName && !call) fail(node, "environment loader references must be direct calls");
    }
    if (ts.isImportSpecifier(node) && (node.propertyName?.text ?? node.name.text) === "loadConfigFromEnvironment"
        && node.propertyName) fail(node, "environment loader aliases are unsupported");
    if (ts.isCallExpression(node) && (node.expression.text === "loadConfigFromEnvironment" || property(node.expression) === "loadConfigFromEnvironment")) {
      const expected = { "apps/api/src/config.ts": "apiConfigSchema", "apps/worker/src/config.ts": "workerConfigSchema" }[path];
      if (!expected || node.arguments.length !== 1 || node.arguments[0].getText(tree) !== expected) {
        fail(node, "environment schema consumer is not registered in the inventory guard");
      }
    }
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && environmentModules.has(node.moduleSpecifier?.text)) {
      const compilerLoader = path === "scripts/check-environment.mjs" && ts.isImportDeclaration(node)
        && node.moduleSpecifier.text === "node:module" && node.importClause?.namedBindings?.getText(tree) === "{ createRequire }";
      if (!compilerLoader) fail(node, "process/module imports can alias environment access; use the shared loader");
    }
    if (ts.isBindingElement(node) && node.propertyName?.text === "process") fail(node, "destructured process access is unsupported");
    if (ts.isIdentifier(node) && node.text === "require") {
      const parent = node.parent;
      const call = ts.isCallExpression(parent) && parent.expression === node;
      const key = ts.isPropertyAssignment(parent) && parent.name === node;
      if (!key && (!call || !parent.arguments[0] || !ts.isStringLiteralLike(parent.arguments[0])
          || environmentModules.has(parent.arguments[0].text))) {
        fail(node, "aliased, nonliteral, or process require is unsupported");
      }
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      const reviewed = argument && reviewedFileImports[path]?.includes(argument.getText(tree).replaceAll(/\s/g, ""));
      if (!reviewed && (!argument || !ts.isStringLiteralLike(argument) || environmentModules.has(argument.text))) {
        fail(node, "dynamic process or nonliteral module import is unsupported");
      }
    }
    if (property(node) === "process") fail(node, "indirect process access bypasses the shared loader");
    if (ts.isIdentifier(node) && node.text === "process") {
      const parent = node.parent;
      if (ts.isPropertyAssignment(parent) && parent.name === node) return;
      // Other process uses (signals, executable, exit code) are not configuration reads.
      if ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === node) {
        const key = property(parent);
        if (!key) fail(parent, "dynamic process access is unsupported");
        if (key === "report") fail(parent, "process.report can expose environment values; diagnostic reports require a reviewed boundary");
        if (["getBuiltinModule", "mainModule", "binding", "_linkedBinding"].includes(key)) fail(parent, "indirect module access through process is unsupported");
        if (key === "env") {
          const use = parent.parent;
          const loader = path === "packages/contracts/src/config/load.ts" && ts.isCallExpression(use)
            && use.expression.getText(tree) === "loadConfig" && use.arguments.length === 2
            && use.arguments[0].getText(tree) === "schema" && use.arguments[1] === parent;
          const inherited = inheritedTestPaths.has(path) && ts.isSpreadAssignment(use)
            && ts.isObjectLiteralExpression(use.parent) && ts.isPropertyAssignment(use.parent.parent)
            && use.parent.parent.name.getText(tree) === "env";
          if (!loader && !inherited) fail(parent, `${property(use) ?? "dynamic/aliased environment"} bypasses the shared loader`);
        }
      } else {
        // The worker passes process only to the reviewed signal coordinator.
        const signal = path === "apps/worker/src/main.ts" && ts.isCallExpression(parent)
          && parent.expression.getText(tree) === "createShutdownCoordinator";
        if (!signal) fail(node, "wrapped, aliased, or reflective process access is unsupported");
      }
    }
    ts.forEachChild(node, visit);
  }
  if (tree.parseDiagnostics.length) failures.push(`${path}: invalid JavaScript/TypeScript syntax`);
  visit(tree);
  return failures;
}

export function validateInventory(data, template, files) {
  const failures = [], observed = new Set();
  const rows = data.variables;
  if (data.version !== 1 || !Array.isArray(rows)) return ["Invalid environment inventory schema"];
  const names = new Set();
  for (const row of rows) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(row.name) || names.has(row.name)) failures.push("Invalid or duplicate inventory name");
    names.add(row.name);
    for (const key of ["owner", "source", "description"]) if (typeof row[key] !== "string" || !row[key].trim()) failures.push(`${row.name}: missing ${key}`);
    if (!["application", "tooling", "platform", "test"].includes(row.classification)) failures.push(`${row.name}: invalid classification`);
    if (!["secret", "non-secret"].includes(row.sensitivity) || typeof row.required !== "boolean" || !row.validation?.kind) failures.push(`${row.name}: missing validation/required/sensitivity`);
    if (!Array.isArray(row.consumer) || !row.consumer.length) failures.push(`${row.name}: missing consumer`);
    for (const consumer of row.consumer ?? []) if (!(consumer in files) && consumer !== ".github/workflows/ci.yml") failures.push(`${row.name}: missing consumer file ${consumer}`);
    const included = ["application", "tooling"].includes(row.classification);
    if (row.template !== (included ? "included" : "excluded")) failures.push(`${row.name}: wrong template disposition`);
    if (row.sensitivity === "secret" && row.placeholder !== "") failures.push(`${row.name}: secret placeholder must be empty`);
  }
  for (const [name, classification] of [["CI", "platform"], ["SCARF_ANALYTICS", "platform"], ["TZ", "test"]]) {
    const row = rows.find(r => r.name === name);
    if (!row || row.classification !== classification || row.template !== "excluded" || row.required) failures.push(`${name}: missing platform/test classification`);
  }
  for (const row of rows) if (["platform", "test"].includes(row.classification) && !["CI", "SCARF_ANALYTICS", "TZ"].includes(row.name)) {
    failures.push(`${row.name}: platform/test consumer requires a reviewed source mapping`);
  }
  const assignments = new Map();
  const lines = template.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!line.trim() || line.startsWith("#")) return;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) { failures.push(`.env.example:${i + 1}: malformed template entry`); return; }
    const [, name, value] = match;
    if (assignments.has(name)) failures.push(`${name}: duplicate template entry`);
    if (!lines[i - 1]?.startsWith("# ")) failures.push(`${name}: missing template description`);
    assignments.set(name, value);
    const row = rows.find(r => r.name === name);
    if (!row || row.template !== "included") failures.push(`${name}: template has no declared operator consumer`);
    else if (value !== row.placeholder) failures.push(`${name}: template differs from safe placeholder`);
  });
  for (const row of rows) if (row.template === "included" && !assignments.has(row.name)) failures.push(`${row.name}: missing template entry`);
  for (const [path, schema] of [["apps/api/src/config.ts", apiConfigSchema], ["apps/worker/src/config.ts", workerConfigSchema]]) {
    for (const [name, spec] of Object.entries(schema)) {
      observed.add(`${name}:${path}`);
      const row = rows.find(r => r.name === name);
      if (!row || row.classification !== "application" || !row.consumer.includes(path)) { failures.push(`${name}: undeclared application consumer ${path}`); continue; }
      const validation = Object.fromEntries(Object.entries(spec).filter(([key]) => !["description", "required"].includes(key)));
      if (spec.required !== row.required || JSON.stringify(validation) !== JSON.stringify(row.validation)) failures.push(`${name}: inventory validation differs from runtime schema`);
    }
  }
  for (const [path, source] of Object.entries(files)) if (!path.endsWith(".py")) failures.push(...scanJavaScript(source, path));
  const pythonFiles = Object.fromEntries(Object.entries(files).filter(([p]) => p.endsWith(".py")));
  const result = python([join(root, "scripts/check-environment-python.py")], { input: JSON.stringify({ files: pythonFiles, variables: rows }) });
  if (result.status !== 0) failures.push("Python environment scanner failed");
  else {
    const scanned = JSON.parse(result.stdout);
    failures.push(...scanned.failures);
    for (const [name, path] of scanned.consumers) observed.add(`${name}:${path}`);
  }
  for (const row of rows) if (["application", "tooling"].includes(row.classification)) {
    for (const path of row.consumer) if (!observed.has(`${row.name}:${path}`)) failures.push(`${row.name}: stale consumer ${path}`);
  }
  return failures;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const files = sources();
    const failures = validateInventory(inventory, readFileSync(join(root, ".env.example"), "utf8"), files);
    if (failures.length) { console.error(failures.join("\n")); process.exitCode = 1; }
    else console.log(`Environment contract passed: ${inventory.variables.length} classified variables; ${Object.keys(files).length} first-party source files; no unclassified reads or template drift`);
  } catch {
    console.error("Environment contract could not run; verify Python 3 and inventory structure. No environment values were logged.");
    process.exitCode = 1;
  }
}
