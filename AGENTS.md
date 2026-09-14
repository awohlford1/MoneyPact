# CoBudget repository working rules

These instructions apply throughout the repository unless a more specific
`AGENTS.md` adds compatible guidance for a subdirectory.

## Repository documents and Confluence synchronization

- Draft, revise, and review Confluence-backed project documentation in the
  local repository. Repository documents are the working source during an
  active document change.
- Treat Confluence copies as read-only while work is in progress. Synchronize a
  changed document to Confluence only after the corresponding repository change
  has been merged into `main`.
- Limit every change to the documents and requirements in the active task's
  stated scope. Do not update unrelated repository documents or external
  documents merely to improve consistency, wording, links, or formatting.
- Obtain the user's explicit consent before changing any document outside the
  active task's scope. Make an approved out-of-scope document change as a
  separate, focused branch and pull request; merge it independently before
  synchronizing its affected documents to Confluence.
- Reading Jira, Confluence, or other authoritative references for evidence is
  allowed. This does not by itself authorize editing those sources.
- If repository and Confluence content differ, preserve the repository version
  during active work and record the discrepancy for post-merge synchronization
  instead of editing Confluence early.

## Jira issue updates

- Keep Jira issue descriptions, acceptance criteria, subtasks, assignments,
  estimates, due dates, workflow status, and issue links in Jira. Do not create
  repository documents merely to stage or mirror proposed Jira changes unless
  the user explicitly requests a repository artifact.
- When the user authorizes a Jira change, apply it directly in Jira; it does not
  require a repository branch, commit, merge, or Confluence synchronization.
- Immediately before proposing or applying a Jira update, fetch the current
  issue and the relevant current subtasks, links, status, assignments, dates,
  and comments. Compare the intended change against that live state so stale
  conversation context, local drafts, or earlier reads do not overwrite newer
  information.
- Preserve current Jira content that remains valid. Reconcile additions and
  corrections with the existing ticket rather than replacing the ticket from
  memory. If current Jira state materially conflicts with the requested change,
  report the conflict and resolve it within the authorized task scope.
- Jira changes do not authorize early edits to Confluence. Any resulting
  Confluence-backed document change still follows the repository-first,
  merge-to-`main`, then synchronize workflow above.

## GitHub publishing authentication

- Treat a successful authenticated `git fetch` or `git push` through Windows
  Git Credential Manager as the authority for local GitHub transport. A stale
  `gh auth status` result does not prove that repository publishing is
  unavailable.
- Use ordinary `git` commands for staging, committing, fetching, and pushing.
  Prefer the connected GitHub app for pull-request reads and writes when its
  installation permissions allow the requested operation.
- If the GitHub app can read the repository but a requested write returns
  `403 Resource not accessible by integration`, use the GitHub REST API with
  the credential supplied in memory by `git credential fill`. Never print,
  log, persist, or place that credential in a command argument, file, PR body,
  or tool result.
- Before merging, verify the exact PR head SHA, mergeability, and required
  check results. Submit the merge with that expected head SHA and follow the
  repository's established merge method.
- Do not assume the in-app browser is authenticated. Use browser UI for GitHub
  mutations only after its signed-in state is visibly confirmed.

## Agentic Workflow Role Routing

- The main session the user prompts directly is the Manager. It decomposes
  work, dispatches role agents, integrates their results, and owns the merge
  lane. Its own operating instructions are kept outside this repository.
- Delegated agents follow the shared specialist contract stated in full inside
  their role definition under `.claude/agents/` or `.codex/agents/`. Both
  providers carry the same role text, so the same eleven roles dispatch either
  way.
- A specialist receives a task packet naming its scope, the files it may write,
  its gate command and its prohibitions, and reports back to the Manager.
- Specialists do not become Managers and do not dispatch further agents.
- Pending policies and approvals remain pending.

## Agent Workflow CLI Integration

- Managers use the pinned Agent Workflow CLI (`agent-workflow`) for canonical state changes;
  direct editing of `.agent-state` is unsupported.
- Managers pass command inputs as JSON on standard input. A `start` input must
  include `objective`, `approach`, and `acceptanceCriteria`.
- The Manager owns framework-ID bookkeeping. Retain the `assignmentId` returned
  by `start` and reuse it for later commands without asking the Executive to
  provide or remember an internal ID. Keep the same `managerInstanceId` when a
  session restarts so the runtime can recover assignments owned by that Manager.
- Retain the ownership fencing token returned by `start`, `ownership-acquire`,
  renewal, or handover, and include it in every state-changing command. Never
  show the token to the Executive or place it in events, results, or prose.
- If the current assignment ID is unavailable, omit it and let the runtime
  resolve the applicable owned assignment. If the runtime returns
  `ASSIGNMENT_SELECTION_REQUIRED`, ask the Executive to choose using the
  candidates' objectives and lifecycle states. Do not expose or request their
  assignment IDs. An explicit ID remains an optional advanced override.
- Record an Executive decision with `approve-plan`, `reject-plan`, or
  `waive-plan` for the exact returned `approvalId`. When
  `security.executiveApproval.mode` is `signed_ed25519`, pass the externally
  signed `approvalReceipt`; `actorType` is not proof of Executive identity.
  In `record_only` mode, clearly treat approval identity as unauthenticated.
  Do not begin work until execution authority is `authorized`.
- If the manager's lease expires while waiting for the Executive, the same
  manager must run `ownership-acquire` before retrying. A different manager
  must use the explicit handover workflow.
- Invoke `npm run agent:doctor` before managed work when integration health is
  uncertain. Treat its enforced, observed, instructed, and unsupported labels
  literally.
- Framework assignment, task, execution, action, and manager-instance IDs are
  durable. Provider thread, session, task, and process IDs are provenance only.
- Do not claim interruption, acknowledgement, resumption, or handover without
  observable confirmation. Durable handover does not transfer a live process.
- Do not silently substitute a provider or model. Stop the affected operation
  when the shared runtime returns a validation, approval, or capability error.
