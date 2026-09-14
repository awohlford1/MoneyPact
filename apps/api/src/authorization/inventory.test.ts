import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "node:test";
import ts from "typescript";

function violations(source: string): string[] {
  const result: string[] = [];
  const ast = ts.createSourceFile("inventory.ts", source, ts.ScriptTarget.Latest, true);
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const name = node.moduleSpecifier.text;
      if (/^(?:pg(?:-|$)|postgres$|knex$|@prisma\/|typeorm$|drizzle-orm$)|authorization\/(?:evaluate|decision|transport)\.|test-support|process-fixture|authorization\/fixtures/.test(name)) result.push(`unregistered import: ${name}`);
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const name = node.expression.name.text;
      // Nest decorators supply the inventoried route registration. Raw HTTP,
      // queue consumers and write clients require an explicit boundary adapter.
      if (["post", "put", "patch", "delete", "route", "all", "query", "execute", "consume", "process"].includes(name)) result.push(`unregistered call: ${name}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast); return result;
}
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(join(directory, entry.name)) : entry.name.endsWith(".ts") ? [join(directory, entry.name)] : []);
}
it("inventories raw route/job/write entry points outside authorization modules", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
  for (const app of ["api", "worker"]) {
    const src = join(root, "apps", app, "src");
    for (const file of files(src)) {
      const name = relative(src, file).replaceAll("\\", "/");
      if (name.startsWith("authorization/") || name.endsWith(".test.ts")) continue;
      assert.deepEqual(violations(readFileSync(file, "utf8")), [], name);
    }
  }
});
it("deliberately rejects raw write paths, private imports, and fixture-backed authority", () => {
  for (const source of [
    'server.post("/unguarded", handler)', 'client.query("write")', 'queue.consume(handler)',
    'import { decide } from "@cobudget/contracts/authorization/evaluate.ts"',
    'import { Harness } from "./authorization/test-support.js"', 'import pg from "pg"',
  ]) assert.ok(violations(source).length > 0, source);
  assert.deepEqual(violations('import { decide } from "@cobudget/contracts/authorization"'), []);
});
it("prevents drift in the common enforcement code across deployment units", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
  for (const name of ["audit.ts", "boundary.ts", "compatibility.ts", "facts.ts", "test-support.ts"]) {
    const api = readFileSync(join(root, "apps/api/src/authorization", name), "utf8").replaceAll("\r\n", "\n");
    const worker = readFileSync(join(root, "apps/worker/src/authorization", name), "utf8").replaceAll("\r\n", "\n");
    assert.equal(worker, api, name);
    assert.notEqual(worker + "\n// deliberate drift", api, name);
  }
});
it("limits lifecycle test launchers to release fixtures and a signal-only process bridge", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
  for (const app of ["api", "worker"]) {
    const src = join(root, "apps", app, "src");
    const main = readFileSync(join(src, "main.ts"), "utf8").replaceAll("\r\n", "\n").replaceAll('from "./', 'from "../');
    const bridge = 'import { EventEmitter } from "node:events";\nconst signalSource = new EventEmitter();\nprocess.on("SIGINT", () => signalSource.emit("SIGINT"));\nprocess.on("SIGTERM", () => signalSource.emit("SIGTERM"));\n';
    const expected = 'import { testHistory } from "./test-support.js";\n' + (app === "api"
      ? main.replace("createApplication: createApiApplication,", "createApplication: (config, sink) => createApiApplication(config, sink, testHistory),")
      : bridge + main.replace("startWorker(config, stdoutWorkerEventSink)", "startWorker(config, stdoutWorkerEventSink, undefined, testHistory)").replace("createShutdownCoordinator(process)", "createShutdownCoordinator(signalSource)"));
    assert.equal(readFileSync(join(src, "authorization/process-fixture.ts"), "utf8").replaceAll("\r\n", "\n"), expected);
  }
});
it("real API and worker processes start on the released policy p2 and refuse an empty history", () => {
  // The two real processes are spawned under tsx while the rest of the workspace
  // suites run in parallel; 15 s was not enough on a loaded machine and the
  // test flaked for three separate agents. The processes exit on their own
  // (the fixture only asserts the startup line), so a wide deadline costs nothing.
  // CBD236-P1-RELEASE-001 released p1, so the checked-in history now admits
  // startup; the fail-closed branch is proven through the injected history in
  // the process fixture and the unit tests above.
  const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
  for (const app of ["api", "worker"]) {
    const result = spawnSync(process.execPath, ["--import=tsx", "src/main.ts"], {
      cwd: join(root, "apps", app), timeout: 60_000, encoding: "utf8", killSignal: "SIGTERM",
      env: { NODE_ENV: "test", LOG_LEVEL: "info", SERVICE_VERSION: "released-policy-test", API_PORT: "3001", COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local", COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: Buffer.alloc(32, 7).toString("base64"), COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "test-v1" },
    });
    assert.equal(result.error?.name === "Error" && (result.error as NodeJS.ErrnoException).code !== "ETIMEDOUT" ? result.error : undefined, undefined, app);
    assert.equal(result.stdout.includes('"operation":"startup"'), true, `${app} startup line`);
    assert.equal(result.stdout.includes('policy_version_unsupported'), false, app);
  }
});

// --- HO-236-08: decideUnderRegisteredVersion is a fixture seam for evaluating a
// registered-but-not-current policy version. It must never reach a request path,
// so production code in apps/api and apps/worker may not reach it through any
// import form; tests and test-support may. Begin delimited block. ---
const BANNED_SYMBOL = "decideUnderRegisteredVersion";
const BANNED_SPECIFIER = /^@cobudget\/contracts(?:\/|$)/;

function registeredVersionViolations(source: string): string[] {
  const result: string[] = [];
  const ast = ts.createSourceFile("inventory.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const namespaceBindings = new Set<string>();

  function isBannedSpecifier(expr: ts.Expression): boolean {
    return ts.isStringLiteralLike(expr) && BANNED_SPECIFIER.test(expr.text);
  }
  function bindingPatternHasBannedSymbol(name: ts.BindingName): boolean {
    if (ts.isObjectBindingPattern(name)) {
      return name.elements.some((element) => (element.propertyName ?? element.name).getText() === BANNED_SYMBOL);
    }
    return false;
  }
  function registerNamespaceIfIdentifier(name: ts.BindingName): void {
    if (ts.isIdentifier(name)) namespaceBindings.add(name.text);
  }

  function visit(node: ts.Node): void {
    // Named import: import { decideUnderRegisteredVersion [as x] } from "@cobudget/contracts..."
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier) && isBannedSpecifier(node.moduleSpecifier) && node.importClause?.namedBindings) {
      const bindings = node.importClause.namedBindings;
      if (ts.isNamedImports(bindings) && bindings.elements.some((el) => (el.propertyName ?? el.name).text === BANNED_SYMBOL)) {
        result.push(`named import: ${BANNED_SYMBOL}`);
      }
      // Namespace import: import * as ns from "@cobudget/contracts..." — track ns for later property access.
      if (ts.isNamespaceImport(bindings)) namespaceBindings.add(bindings.name.text);
    }
    // Re-export: export { decideUnderRegisteredVersion } / export * / export * as ns from "@cobudget/contracts..."
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier) && isBannedSpecifier(node.moduleSpecifier)) {
      if (!node.exportClause) result.push("blanket re-export: export *");
      else if (ts.isNamedExports(node.exportClause) && node.exportClause.elements.some((el) => (el.propertyName ?? el.name).text === BANNED_SYMBOL)) result.push(`re-export: ${BANNED_SYMBOL}`);
      else if (ts.isNamespaceExport(node.exportClause)) result.push(`namespace re-export: export * as ${node.exportClause.name.text}`);
    }
    // require("@cobudget/contracts...")
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require" && node.arguments[0] && isBannedSpecifier(node.arguments[0])) {
      const parent = node.parent;
      if (ts.isVariableDeclaration(parent)) {
        if (bindingPatternHasBannedSymbol(parent.name)) result.push(`require destructure: ${BANNED_SYMBOL}`);
        else registerNamespaceIfIdentifier(parent.name);
      } else if (ts.isPropertyAccessExpression(parent) && parent.name.text === BANNED_SYMBOL) {
        result.push(`require(...).${BANNED_SYMBOL}`);
      }
    }
    // Dynamic import: await import("@cobudget/contracts...") / import(...).then(...)
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && isBannedSpecifier(node.arguments[0])) {
      let parent: ts.Node = node.parent;
      if (ts.isAwaitExpression(parent)) parent = parent.parent;
      if (ts.isVariableDeclaration(parent)) {
        if (bindingPatternHasBannedSymbol(parent.name)) result.push(`dynamic import destructure: ${BANNED_SYMBOL}`);
        else registerNamespaceIfIdentifier(parent.name);
      } else if (ts.isPropertyAccessExpression(parent) && parent.name.text === BANNED_SYMBOL) {
        result.push(`dynamic import member: ${BANNED_SYMBOL}`);
      } else if (ts.isPropertyAccessExpression(parent) && parent.name.text === "then" && ts.isCallExpression(parent.parent)) {
        const callback = parent.parent.arguments[0];
        if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
          const first = callback.parameters[0];
          if (first) {
            if (bindingPatternHasBannedSymbol(first.name)) result.push(`dynamic import .then destructure: ${BANNED_SYMBOL}`);
            else registerNamespaceIfIdentifier(first.name);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);

  function visitAccess(node: ts.Node): void {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && namespaceBindings.has(node.expression.text) && node.name.text === BANNED_SYMBOL) {
      result.push(`namespace access: ${node.expression.text}.${BANNED_SYMBOL}`);
    }
    if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && namespaceBindings.has(node.expression.text) && ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === BANNED_SYMBOL) {
      result.push(`namespace access: ${node.expression.text}["${BANNED_SYMBOL}"]`);
    }
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.initializer) && namespaceBindings.has(node.initializer.text) && bindingPatternHasBannedSymbol(node.name)) {
      result.push(`namespace destructure: ${BANNED_SYMBOL}`);
    }
    ts.forEachChild(node, visitAccess);
  }
  visitAccess(ast);

  return result;
}

it("rejects every import form of decideUnderRegisteredVersion from production code in apps/api and apps/worker", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
  for (const app of ["api", "worker"]) {
    const src = join(root, "apps", app, "src");
    for (const file of files(src)) {
      const name = relative(src, file).replaceAll("\\", "/");
      if (name.endsWith(".test.ts") || name.endsWith("test-support.ts") || name.includes("/test-support/") || name.includes("/fixtures/")) continue;
      assert.deepEqual(registeredVersionViolations(readFileSync(file, "utf8")), [], name);
    }
  }
});

it("deliberately rejects every named, namespace, re-export, dynamic-import and require form of decideUnderRegisteredVersion", () => {
  for (const source of [
    `import { decideUnderRegisteredVersion } from "@cobudget/contracts/authorization"`,
    `import { decideUnderRegisteredVersion as decide2 } from "@cobudget/contracts/authorization"`,
    `import * as contracts from "@cobudget/contracts/authorization"; contracts.decideUnderRegisteredVersion(v, i)`,
    `import * as contracts from "@cobudget/contracts/authorization"; const { decideUnderRegisteredVersion } = contracts`,
    `export { decideUnderRegisteredVersion } from "@cobudget/contracts/authorization"`,
    `export * from "@cobudget/contracts/authorization"`,
    `export * as contracts from "@cobudget/contracts/authorization"`,
    `const { decideUnderRegisteredVersion } = await import("@cobudget/contracts/authorization")`,
    `const mod = await import("@cobudget/contracts/authorization"); mod.decideUnderRegisteredVersion(v, i)`,
    `import("@cobudget/contracts/authorization").then((m) => m.decideUnderRegisteredVersion(v, i))`,
    `const { decideUnderRegisteredVersion } = require("@cobudget/contracts/authorization")`,
    `require("@cobudget/contracts/authorization").decideUnderRegisteredVersion(v, i)`,
  ]) assert.ok(registeredVersionViolations(source).length > 0, source);
  // Everything else from the same module stays allowed.
  assert.deepEqual(registeredVersionViolations('import { decide, sha256 } from "@cobudget/contracts/authorization"'), []);
  assert.deepEqual(registeredVersionViolations('import * as contracts from "@cobudget/contracts/authorization"; contracts.decide(i)'), []);
});
// --- End HO-236-08 delimited block ---
