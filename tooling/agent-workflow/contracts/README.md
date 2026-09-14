# Agent Workflow Contracts

These files are the provider-neutral operating contract installed into a consumer repository at `.agent-workflow/contracts/`. The package copy is canonical; installed copies are immutable inputs for a specific framework release and should be replaced only by the installer or an explicit upgrade.

- `MANAGER.md` defines manager command and authority rules.
- `CONTRACTS.md` defines task packets and specialist results.
- `ROLES.md` defines the shared specialist lifecycle and role catalogue.

Provider-specific files are adapters generated from the same role catalogue. They must not introduce additional authority.
