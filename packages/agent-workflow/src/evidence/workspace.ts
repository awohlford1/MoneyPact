import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readFile, readlink, realpath } from "node:fs/promises";
import path from "node:path";

export interface WorkspaceSnapshot {
  digest: string;
  location: "git-working-tree:.";
  capturedAt: string;
}

function git(root: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd: root, encoding: "buffer", maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`Unable to capture git workspace evidence: ${Buffer.from(stderr).toString("utf8").trim() || error.message}`));
      else resolve(Buffer.from(stdout));
    });
  });
}

/** Fingerprint committed identity, tracked changes, and the contents of untracked files. */
export async function captureGitWorkspaceSnapshot(projectRoot: string, now = new Date()): Promise<WorkspaceSnapshot> {
  const root = await realpath(projectRoot);
  const [head, diff, untrackedOutput] = await Promise.all([
    git(root, ["rev-parse", "HEAD"]),
    git(root, ["diff", "--binary", "--no-ext-diff", "HEAD", "--"]),
    git(root, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  const hash = createHash("sha256");
  hash.update("agent-workflow-git-snapshot-v1\0");
  hash.update(head); hash.update("\0"); hash.update(diff); hash.update("\0");
  const untracked = untrackedOutput.toString("utf8").split("\0").filter(Boolean).sort();
  for (const relative of untracked) {
    const target = path.resolve(root, relative);
    const relation = path.relative(root, target);
    if (relation.startsWith("..") || path.isAbsolute(relation)) throw new Error(`Untracked path escapes project root: ${relative}`);
    const info = await lstat(target);
    hash.update(relative); hash.update("\0");
    if (info.isSymbolicLink()) hash.update(await readlink(target));
    else if (info.isFile()) hash.update(await readFile(target));
    hash.update("\0");
  }
  return { digest: `sha256:${hash.digest("hex")}`, location: "git-working-tree:.", capturedAt: now.toISOString() };
}
