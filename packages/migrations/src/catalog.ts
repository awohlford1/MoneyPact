/**
 * Reading a directory of migration files.
 *
 * The catalog keeps files whose names it could not parse instead of dropping
 * them. A migration tool that silently ignores a file it does not recognise is
 * the worst failure mode available to it: the developer sees "nothing to
 * apply", the schema is wrong, and nothing anywhere says why. `check` turns
 * every unparsed entry into a failure, and `apply` refuses to run until
 * `check` passes.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { compareNames, parseName } from "./naming.ts";
import type { Policy } from "./policy.ts";

export type MigrationFile = {
  readonly fileName: string;
  readonly ordinal: string;
  readonly slug: string;
  readonly path: string;
  /** Decoded as UTF-8. Encoding problems are reported by `check`, from `bytes`. */
  readonly source: string;
  readonly bytes: Buffer;
  /** sha256 of the raw bytes, hex. The ledger stores this. */
  readonly checksum: string;
};

export type Catalog = {
  readonly directory: string;
  readonly files: readonly MigrationFile[];
  /** Entries in the directory whose names the pattern did not accept. */
  readonly unparsed: readonly string[];
};

/**
 * The checksum the ledger stores.
 *
 * Over normalised text, not raw bytes. The repository is developed on Windows
 * and checked on Linux; with git's line-ending translation the same reviewed
 * migration is CRLF in one checkout and LF in the other. A raw-byte checksum
 * would report every applied migration as modified the first time the tool ran
 * on the other platform, and "modified after it was applied" is the one signal
 * that has to mean something. A byte order mark is stripped for the same
 * reason.
 */
export function normalizeForChecksum(bytes: Buffer): string {
  return bytes
    .toString("utf8")
    .replace(/^﻿/u, "")
    .replaceAll("\r\n", "\n");
}

export function checksumOf(bytes: Buffer): string {
  return createHash("sha256").update(normalizeForChecksum(bytes), "utf8").digest("hex");
}

export function readCatalog(directory: string, policy: Policy): Catalog {
  const entries = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();

  const files: MigrationFile[] = [];
  const unparsed: string[] = [];

  for (const fileName of entries) {
    const name = parseName(fileName, policy.fileName.pattern);
    if (!name) {
      unparsed.push(fileName);
      continue;
    }
    const path = join(directory, fileName);
    const bytes = readFileSync(path);
    files.push({
      fileName,
      ordinal: name.ordinal,
      slug: name.slug,
      path,
      source: bytes.toString("utf8"),
      bytes,
      checksum: checksumOf(bytes),
    });
  }

  files.sort(compareNames);
  return { directory, files, unparsed };
}
