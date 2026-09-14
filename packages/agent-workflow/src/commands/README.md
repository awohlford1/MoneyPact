# AW-04 command contract

`WorkflowCommandService` is the provider-neutral command surface. Public manager
operations are `start`, `resume`, `status`, `ask`, `steer`, `pause`, and
`handover`. Internal operations cover plan approval/rejection/waiver, task and
execution lifecycle, result submission/acceptance/rework, action outcomes and
reconciliation, decisions, cancellation, closure, and reopening.

All methods accept framework IDs and a `CommandContext`; none accepts or
manipulates a provider session. Provider adapters implement only these
operations:

- `requestStop`
- `createTransferPackage`
- `transferOwnership`
- optional `dispatchTask`

`requestStop` receives the requested mode and optional graceful timeout. The
runtime never changes its mode from `graceful` to `force`.

The transition registry is exported from `../workflows/index.ts`. Policy result
codes are exported from `../policy/index.ts`. `status` and `ask` append audit
events but never persist a changed aggregate or alter execution authority.

`runConsequentialOperation` performs one initial intent-persistence attempt plus
the configured transient retries. The external operation is never invoked after
intent-persistence exhaustion. Graceful interruption is never converted to
force by the command service.

`StateWorkflowRepository` is the AW-03 integration adapter for assignment
aggregate persistence and daily event append. `MemoryWorkflowRepository` is
provided for deterministic service and composition tests.
