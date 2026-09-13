/**
 * The command line. Nothing lives here except argv, the console, the clock,
 * and the real executors; every decision is in commands.ts and local.ts,
 * which are testable without any of them.
 *
 * `--local` anywhere in argv makes the migration commands run psql inside the
 * local container (CBD-117) instead of on the host; `db <up|stop|destroy|
 * verify>` manages that container. Without `--local` nothing has changed
 * since CBD-116: psql on the host, connection from the libpq environment,
 * which is the hosted path.
 */

import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { apply, check, create, reset, status, usage } from "./commands.ts";
import type { Deps, Io } from "./commands.ts";
import { psqlExecutor } from "./executor.ts";
import { dispatchLocal, localExecutor, runCompose } from "./local.ts";
import type { LocalDeps } from "./local.ts";
import { loadLocalDatabaseConfig } from "./local-config.ts";
import { loadPolicy, repositoryRoot } from "./policy.ts";
import { loadPinnedMajor } from "./version.ts";

export const LOCAL_FLAG = "--local";

export function dispatch(deps: Deps, argv: readonly string[]): number {
  const [command, ...rest] = argv;
  switch (command) {
    case "apply":
      return apply(deps);
    case "status":
      return status(deps);
    case "check":
      return check(deps);
    case "create":
      return create(deps, rest.join(" "));
    case "reset":
      return reset(deps, rest);
    case undefined:
    case "help":
    case "--help":
    case "-h":
      deps.io.out(usage(deps.policy));
      return command === undefined ? 1 : 0;
    default:
      deps.io.err(`unknown command "${command}"`);
      deps.io.out(usage(deps.policy));
      return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const policy = loadPolicy();
  const io: Io = { out: (line) => console.log(line), err: (line) => console.error(line) };
  const pinnedMajor = loadPinnedMajor();
  const localConfig = loadLocalDatabaseConfig();
  const argv = process.argv.slice(2);
  const local = argv.includes(LOCAL_FLAG);
  const rest = argv.filter((argument) => argument !== LOCAL_FLAG);

  if (rest[0] === "db") {
    const localDeps: LocalDeps = {
      io,
      pinnedMajor,
      databaseName: localConfig.database,
      compose: runCompose,
      executorFor: (role) => localExecutor(role, localConfig.database),
    };
    process.exitCode = dispatchLocal(localDeps, rest.slice(1));
  } else {
    const deps: Deps = {
      policy,
      executor: local ? localExecutor("migration", localConfig.database) : psqlExecutor(),
      io,
      now: () => new Date(),
      directory: join(repositoryRoot, policy.migrationsDirectory),
      packageRoot: fileURLToPath(new URL("../", import.meta.url)),
      pinnedMajor,
    };
    process.exitCode = dispatch(deps, rest);
  }
}
