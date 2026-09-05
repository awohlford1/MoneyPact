import { python } from "./python-runtime.mjs";

const result = python(["scripts/check-publication.py"], { timeout: 300000 });
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
process.exitCode = result.status === 0 ? 0 : 1;
