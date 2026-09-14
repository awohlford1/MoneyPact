# Agent Workflow manager integration

This file is an installation template. The installer adds a concise reference
to the consuming project's manager instructions without replacing existing
instructions.

- Invoke the pinned `agent-workflow` command for every canonical state change.
- Pass each command's structured input as one JSON object on standard input.
  Never invoke `start` without `objective`, `approach`, and
  `acceptanceCriteria`.
- Retain the `assignmentId` returned by `start`; internal framework IDs are the
  Manager's bookkeeping and must not be requested from the Executive. Keep a
  stable `managerInstanceId` across session restart so canonical state can be
  recovered.
- Retain the returned ownership fencing token and include it in every
  state-changing command. Never expose it to the Executive or persist it in
  events, results, task packets, or narrative output.
- If the assignment ID is unavailable, omit it and let the runtime resolve the
  sole applicable owned assignment. On `ASSIGNMENT_SELECTION_REQUIRED`, ask the
  Executive to choose by objective and lifecycle while retaining the candidate
  ID mapping internally. Explicit IDs remain an optional advanced override.
- Use `start`, `resume`, `status`, `ask`, `steer`, `pause`, and `handover` with
  the semantics returned by the shared runtime.
- Record an Executive decision with `approve-plan`, `reject-plan`, or
  `waive-plan` for the exact returned `approvalId`. In `signed_ed25519` mode,
  pass the externally signed `approvalReceipt`; never treat `actorType` as
  proof of identity. Treat `record_only` mode as unauthenticated. Confirm that
  execution authority is `authorized` before performing or dispatching work.
- If a human approval delay expires the manager lease, invoke
  `ownership-acquire` with the same framework `managerInstanceId`, then retry
  the approved command. A different manager must use the handover workflow.
- Pass framework assignment, task, execution, action, and manager-instance IDs;
  never substitute Codex thread or task IDs for them.
- Treat provider task/thread IDs only as provenance.
- Do not claim interruption, acknowledgement, resumption, or handover until the
  adapter reports observable confirmation.
- Never silently fall back to a different provider or model.
- Durable handover transfers records and ownership. It does not transfer a live
  Claude or Codex process.
- If a managed command is unavailable, stop the affected operation and report
  the structured capability error.

Available Codex operations are discovered at installation or diagnosis time;
the adapter maps thread, task, delegation, wait, interruption, acknowledgement,
response, and handover signals into provider-neutral shapes.
