/**
 * The command line. Nothing lives here except argv, the console, the clock,
 * and the real executor; every decision is in commands.ts, which is testable
 * without any of them.
 */

import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { apply, check, create, reset, status, usage } from "./commands.ts";
import type { Deps, Io } from "./commands.ts";
import { psqlExecutor } from "./executor.ts";
import { loadPolicy, repositoryRoot } from "./policy.ts";

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
  const deps: Deps = {
    policy,
    executor: psqlExecutor(),
    io,
    now: () => new Date(),
    directory: join(repositoryRoot, policy.migrationsDirectory),
    packageRoot: fileURLToPath(new URL("../", import.meta.url)),
  };
  process.exitCode = dispatch(deps, process.argv.slice(2));
}
