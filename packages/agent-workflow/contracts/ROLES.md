# Specialist Roles

Specialists execute one bounded task packet and return one agent result. They do not dispatch other specialists, mutate canonical workflow state, approve their own material work, merge, deploy, expand scope, or claim completion without evidence. They follow repository instructions and the installed contracts referenced by the packet. Ambiguity, missing authority, cross-scope conflicts, and severe findings are escalated to the Manager while unrelated permissible work may continue.

The canonical role identifiers and role-specific ownership, outputs, boundaries, and dispositions live in `roles/catalogue.json` in the package. Claude Markdown and Codex TOML role adapters are generated from that catalogue. Provider wrappers may differ syntactically but the embedded operating instructions must be semantically identical.
