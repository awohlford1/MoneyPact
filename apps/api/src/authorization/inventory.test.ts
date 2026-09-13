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
it("refuses real API and worker process startup before readiness with the unreleased policy", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
  for (const app of ["api", "worker"]) {
    const result = spawnSync(process.execPath, ["--import=tsx", "src/main.ts"], {
      cwd: join(root, "apps", app), timeout: 30_000, encoding: "utf8",
      env: { NODE_ENV: "test", LOG_LEVEL: "info", SERVICE_VERSION: "unreleased-policy-test", API_PORT: "3001" },
    });
    assert.equal(result.error, undefined); assert.equal(result.status, 1, app);
    assert.equal(result.stdout.includes('"operation":"startup"'), false, app);
    assert.equal(result.stdout.includes('"status":"ready"'), false, app);
  }
});
