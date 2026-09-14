# Agent Workflow manager integration

- Invoke the pinned Agent Workflow CLI for every canonical state change.
- Pass each command's structured input as one JSON object on standard input.
  Never invoke `start` without `objective`, `approach`, and
  `acceptanceCriteria`.
- Retain the `assignmentId` returned by `start` and use it without asking the
  Executive to provide or remember internal IDs. Keep the same
  `managerInstanceId` across a restarted session so owned assignments can be
  recovered from canonical state.
- Retain the returned ownership fencing token and include it in every
  state-changing command. Do not expose it to the Executive or write it into
  events, results, task packets, or narrative output.
- If the current assignment ID is unavailable, omit it. The runtime will select
  the sole applicable owned assignment. When it returns
  `ASSIGNMENT_SELECTION_REQUIRED`, ask the Executive to choose by objective and
  lifecycle, retain the candidate mapping internally, and never request an
  assignment UUID. Explicit IDs are optional advanced overrides.
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
- Use framework IDs as durable identity; provider task and thread IDs are
  provenance only.
- Do not claim interruption, acknowledgement, resumption, or handover until an
  adapter reports observable confirmation.
- Never silently fall back to another provider or model.
- Durable handover transfers records and ownership, not a live process.
- Stop affected work and report the structured error when a managed operation
  is unavailable, invalid, held, or unauthorized.
