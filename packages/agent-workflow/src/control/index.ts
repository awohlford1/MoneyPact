import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { assertPortableId, writeJsonAtomic, type JsonValue } from "../storage/index.ts";
import { persistRedactedRawResponse } from "../providers/index.ts";

export type CliProvider = "codex" | "claude";
export interface ControlledProcess { control_id: string; provider: CliProvider; pid: number; assignment_id: string; execution_id: string; task_id?: string; started_at: string; command: string; args: string[]; status: "running" | "stopped" | "unknown"; stopped_at?: string; dispatch_response_id?: string; response_capture?: { response_id: string; captured_at: string; truncated: boolean; event_id?: string } }

const controlPath = (id: string) => path.join("control", "processes", `${assertPortableId(id, "control ID")}.json`);
const executionPath = (id: string) => path.join("control", "processes", `execution-${assertPortableId(id, "execution ID")}.json`);

function executable(provider: CliProvider) { return provider === "codex" ? "codex" : "claude"; }
async function write(stateRoot: string, record: ControlledProcess) {
  await writeJsonAtomic(stateRoot, controlPath(record.control_id), record as unknown as JsonValue);
  await writeJsonAtomic(stateRoot, executionPath(record.execution_id), record as unknown as JsonValue);
}
export async function launchControlledCli(stateRoot: string, input: { provider: CliProvider; assignmentId: string; executionId: string; taskId?: string; args: string[]; retentionDays?: number }) {
  assertPortableId(input.assignmentId, "assignment ID"); assertPortableId(input.executionId, "execution ID");
  const controlId = `ctl-${randomUUID()}`;
  const stdoutPath = path.join(stateRoot, "control", "outputs", `${controlId}.stdout.log`);
  const stderrPath = path.join(stateRoot, "control", "outputs", `${controlId}.stderr.log`);
  const finalMessagePath = path.join(stateRoot, "control", "outputs", `${controlId}.last-message.txt`);
  const effectiveArgs = input.provider === "codex" && !input.args.some((value) => value === "--output-last-message" || value === "-o")
    ? [...input.args, "--output-last-message", finalMessagePath]
    : input.args;
  const stdout = openSync(stdoutPath, "a", 0o600); const stderr = openSync(stderrPath, "a", 0o600);
  let child;
  // Codex CLI on Windows requires its provider-specific state location when
  // launched outside the desktop application's inherited environment.
  const environment = input.provider === "codex"
    ? { ...process.env, CODEX_HOME: process.env.CODEX_HOME ?? path.join(homedir(), ".codex") }
    : process.env;
  try { child = spawn(executable(input.provider), effectiveArgs, { detached: true, stdio: ["ignore", stdout, stderr], windowsHide: true, env: environment }); }
  finally { closeSync(stdout); closeSync(stderr); }
  child.unref();
  if (!child.pid) throw new Error("CONTROL_LAUNCH_FAILED: provider CLI did not return a process ID");
  const dispatchResponseId = `raw-${randomUUID()}`;
  await persistRedactedRawResponse(stateRoot, { responseId: dispatchResponseId, provider: input.provider, sourceEvent: "provider_cli_dispatch", content: { command: executable(input.provider), args: effectiveArgs }, ...(input.retentionDays === undefined ? {} : { retentionDays: input.retentionDays }), assignmentId: input.assignmentId, ...(input.taskId ? { taskId: input.taskId } : {}), executionId: input.executionId });
  const record: ControlledProcess = { control_id: controlId, provider: input.provider, pid: child.pid, assignment_id: input.assignmentId, execution_id: input.executionId, ...(input.taskId ? { task_id: input.taskId } : {}), started_at: new Date().toISOString(), command: executable(input.provider), args: effectiveArgs, status: "running", dispatch_response_id: dispatchResponseId };
  await write(stateRoot, record); return record;
}
export async function readControlledExecution(stateRoot: string, executionId: string): Promise<ControlledProcess | undefined> {
  try { return JSON.parse(await readFile(path.join(stateRoot, executionPath(executionId)), "utf8")) as ControlledProcess; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
function alive(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function captureOutput(stateRoot: string, record: ControlledProcess, retentionDays = 7): Promise<ControlledProcess> {
  if (record.response_capture) return record;
  const stdoutPath = path.join(stateRoot, "control", "outputs", `${record.control_id}.stdout.log`);
  const stderrPath = path.join(stateRoot, "control", "outputs", `${record.control_id}.stderr.log`);
  const finalMessagePath = path.join(stateRoot, "control", "outputs", `${record.control_id}.last-message.txt`);
  const limit = 512 * 1024;
  const [stdout, stderr, finalMessage] = await Promise.all([readFile(stdoutPath).catch(() => Buffer.alloc(0)), readFile(stderrPath).catch(() => Buffer.alloc(0)), readFile(finalMessagePath).catch(() => Buffer.alloc(0))]);
  const truncated = stdout.length > limit || stderr.length > limit || finalMessage.length > limit;
  const responseId = `raw-${randomUUID()}`;
  const capturedStdout = stdout.subarray(0, limit).toString("utf8");
  const capturedFinalMessage = finalMessage.subarray(0, limit).toString("utf8");
  // Codex writes a dedicated final-message file. Claude's print mode writes its
  // response to stdout, so normalize both providers to the same final_message
  // evidence field without discarding the original stream.
  const normalizedFinalMessage = capturedFinalMessage.length > 0 ? capturedFinalMessage : capturedStdout;
  await persistRedactedRawResponse(stateRoot, { responseId, provider: record.provider, sourceEvent: "provider_cli_response", content: { stdout: capturedStdout, stderr: stderr.subarray(0, limit).toString("utf8"), final_message: normalizedFinalMessage, truncated }, retentionDays, assignmentId: record.assignment_id, ...(record.task_id ? { taskId: record.task_id } : {}), executionId: record.execution_id });
  await Promise.all([rm(stdoutPath, { force: true }), rm(stderrPath, { force: true }), rm(finalMessagePath, { force: true })]);
  record.response_capture = { response_id: responseId, captured_at: new Date().toISOString(), truncated };
  await write(stateRoot, record); return record;
}
export async function interruptControlledExecution(stateRoot: string, executionId: string, mode: "graceful" | "force", timeoutMs = 5_000) {
  const record = await readControlledExecution(stateRoot, executionId);
  if (!record) return { confirmed: false, reason: "CONTROL_NOT_REGISTERED" };
  if (!alive(record.pid)) { record.status = "stopped"; record.stopped_at ??= new Date().toISOString(); await captureOutput(stateRoot, record); return { confirmed: true }; }
  try { process.kill(record.pid, mode === "force" ? "SIGKILL" : "SIGTERM"); } catch { return { confirmed: false, reason: "CONTROL_SIGNAL_FAILED" }; }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (!alive(record.pid)) { record.status = "stopped"; record.stopped_at = new Date().toISOString(); await captureOutput(stateRoot, record); await writeJsonAtomic(stateRoot, path.join("control", "receipts", `${record.control_id}-${Date.now()}.json`), { control_id: record.control_id, execution_id: executionId, action: "interrupt", mode, confirmed: true, recorded_at: record.stopped_at }); return { confirmed: true, checkpointId: mode === "graceful" ? `chk-${record.control_id}` : undefined }; } await new Promise(resolve => setTimeout(resolve, 50)); }
  record.status = "unknown"; await write(stateRoot, record); return { confirmed: false, reason: "CONTROL_TIMEOUT" };
}

export async function controlStatus(stateRoot: string, executionId: string, retentionDays = 7) { const record = await readControlledExecution(stateRoot, executionId); if (!record) return undefined; if (record.status === "running" && !alive(record.pid)) { record.status = "stopped"; record.stopped_at = new Date().toISOString(); await captureOutput(stateRoot, record, retentionDays); } return record; }
/** Marks the one durable timeline event associated with an automatically captured response. */
export async function markResponseCaptureObserved(stateRoot: string, executionId: string, eventId: string) {
  const record = await readControlledExecution(stateRoot, executionId);
  if (!record?.response_capture || record.response_capture.event_id) return record;
  record.response_capture.event_id = eventId;
  await write(stateRoot, record);
  return record;
}
export function handoverPackageId(assignmentId: string, receiverManagerInstanceId: string) { return `pkg-${assertPortableId(assignmentId, "assignment ID")}-${assertPortableId(receiverManagerInstanceId, "receiver manager ID")}`; }
export async function acknowledgeHandover(stateRoot: string, assignmentId: string, receiverManagerInstanceId: string) { const packageId = handoverPackageId(assignmentId, receiverManagerInstanceId); await writeJsonAtomic(stateRoot, path.join("control", "receipts", `${packageId}.accepted.json`), { package_id: packageId, assignment_id: assignmentId, receiver_manager_instance_id: receiverManagerInstanceId, accepted_at: new Date().toISOString() }); return { packageId, accepted: true }; }
export async function isHandoverAcknowledged(stateRoot: string, assignmentId: string, receiverManagerInstanceId: string) { try { await readFile(path.join(stateRoot, "control", "receipts", `${handoverPackageId(assignmentId, receiverManagerInstanceId)}.accepted.json`), "utf8"); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } }
