#!/usr/bin/env node
// Local Executive utility. Keep the private key outside this repository.
import { randomUUID, createPrivateKey, sign } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const keyId = option("key-id");
const executiveId = option("executive-id");
const privateKeyPath = option("private-key");
const expiresInSeconds = Number(option("expires-in-seconds") ?? "600");
const pending = process.argv.includes("--pending");
const decision = option("decision");
const objective = option("objective");
if (!keyId || !executiveId || !privateKeyPath || !Number.isInteger(expiresInSeconds) || expiresInSeconds < 1 || expiresInSeconds > 900) {
  throw new Error("Usage: node scripts/sign-agent-workflow-approval.mjs --key-id <keyId> --executive-id <executiveId> --private-key <path> [--expires-in-seconds 600] < approval-payload.json, or add --pending --decision <approve|reject|waive> to sign the single pending approval in local state.");
}
function pendingApproval() {
  const assignmentsRoot = path.join(process.cwd(), ".agent-state", "assignments");
  const candidates = readdirSync(assignmentsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const assignmentId = entry.name;
      try {
        const assignment = JSON.parse(readFileSync(path.join(assignmentsRoot, assignmentId, "assignment", `${assignmentId}.json`), "utf8"));
        const approvalsRoot = path.join(assignmentsRoot, assignmentId, "approvals");
        const approvals = readdirSync(approvalsRoot, { withFileTypes: true })
          .filter((candidate) => candidate.isFile() && candidate.name.endsWith(".json"))
          .map((candidate) => JSON.parse(readFileSync(path.join(approvalsRoot, candidate.name), "utf8")));
        const approval = approvals.find((candidate) => candidate.state === "requested" && candidate.subject?.record_type === "plan");
        return assignment.lifecycle_state === "awaiting_approval" && approval ? [{ assignment, approval }] : [];
      } catch { return []; }
    });
  const selected = objective === undefined ? candidates : candidates.filter((candidate) => candidate.assignment.objective === objective);
  if (selected.length !== 1) throw new Error(`Expected exactly one pending plan approval in .agent-state; found ${selected.length}${objective === undefined && candidates.length > 1 ? ". Specify --objective with the exact Manager-visible assignment objective." : ""}`);
  const { assignment, approval } = selected[0];
  return { approvalId: approval.approval_id, assignmentId: assignment.assignment_id, planId: approval.subject.record_id, planRevision: approval.subject.revision, scope: approval.scope, decision };
}
let requested;
if (pending) {
  if (!decision) throw new Error("--pending requires --decision <approve|reject|waive>");
  requested = pendingApproval();
} else {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  requested = JSON.parse(input);
}
for (const field of ["approvalId", "assignmentId", "planId", "planRevision", "scope", "decision"]) {
  if (requested[field] === undefined || requested[field] === null || requested[field] === "") throw new Error(`Approval payload requires ${field}`);
}
if (!["approve", "reject", "waive"].includes(requested.decision)) throw new Error("decision must be approve, reject, or waive");
const issuedAt = new Date();
const payload = {
  version: "1.0",
  approvalId: String(requested.approvalId), assignmentId: String(requested.assignmentId), planId: String(requested.planId), planRevision: Number(requested.planRevision),
  scope: String(requested.scope), decision: requested.decision, executiveId,
  issuedAt: issuedAt.toISOString(), expiresAt: new Date(issuedAt.getTime() + expiresInSeconds * 1000).toISOString(), nonce: randomUUID(),
};
const privateKey = createPrivateKey(readFileSync(privateKeyPath));
const signature = sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString("base64");
process.stdout.write(`${JSON.stringify({ keyId, payload, signature }, null, 2)}\n`);
