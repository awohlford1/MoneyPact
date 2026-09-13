/**
 * The PostgreSQL major-version pin (CBD-117-AC03).
 *
 * The pin is written in exactly one place: the `image: postgres:<major>` line
 * of compose.yaml at the repository root, because that is the line that
 * starts the local server, and a pin that the server does not start from is
 * documentation, not a pin. This module reads that line and compares it with
 * what a running server reports, so that a tool pointed at any other server --
 * a Homebrew install, a stale container, a hosted instance after an upgrade --
 * refuses to touch it and names both versions.
 *
 * Why the tool checks rather than trusting compose: compose only guarantees
 * the container it started. The migration runner connects to whatever the
 * environment says, and the environment is exactly what is wrong when someone
 * is about to migrate the wrong server.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { repositoryRoot } from "./policy.ts";

export const composeFile = join(repositoryRoot, "compose.yaml");

/**
 * One `image: postgres:<major>` line, optionally with a minor version or a
 * variant suffix, optionally quoted, optionally followed by a comment. The
 * major is what the pin means; a minor or a variant does not change it.
 */
const IMAGE_LINE = /^\s*image:\s*["']?postgres:(\d+)(?:[.-][^\s"'#]*)?["']?\s*(?:#.*)?$/gmu;

export function readPinnedMajor(compose: string): number {
  const matches = [...compose.matchAll(IMAGE_LINE)];
  if (matches.length !== 1) {
    throw new Error(
      `compose.yaml must pin the PostgreSQL major exactly once as "image: postgres:<major>"; `
        + `found ${matches.length} such line(s)`,
    );
  }
  const major = Number(matches[0]?.[1]);
  if (!Number.isSafeInteger(major) || major < 10) {
    throw new Error(`compose.yaml pins an implausible PostgreSQL major: ${String(matches[0]?.[1])}`);
  }
  return major;
}

export function loadPinnedMajor(path = composeFile): number {
  return readPinnedMajor(readFileSync(path, "utf8"));
}

/**
 * Both settings in one row: the number is what the comparison uses, the text
 * is what the message shows. `server_version_num` is major * 10000 + minor
 * since PostgreSQL 10.
 */
export const serverVersionScript =
  "SELECT current_setting('server_version_num') || '|' || current_setting('server_version');\n";

export type ServerVersion = { readonly major: number; readonly version: string };

export function parseServerVersion(stdout: string): ServerVersion {
  const line = stdout.split(/\r?\n/u).map((entry) => entry.trim()).find((entry) => entry !== "");
  const match = line === undefined ? null : /^(\d+)\|(.+)$/u.exec(line);
  if (!match) throw new Error(`unrecognised server version from psql: ${line ?? "<empty>"}`);
  return { major: Math.floor(Number(match[1]) / 10000), version: (match[2] ?? "").trim() };
}

/**
 * The refusal, worded once. Names both versions (AC03) and says where the pin
 * is, because the person reading it either started the wrong server or
 * changed the host and needs to know which line to edit.
 */
export function mismatchMessage(server: ServerVersion, pinnedMajor: number): string {
  return `refusing to continue: the server is PostgreSQL ${server.version} (major ${server.major}) `
    + `but compose.yaml pins major ${pinnedMajor}. Either this is not the local database `
    + "(run npm run db:up --workspace=@cobudget/migrations) or the host moved and the pin must move with it.";
}
