# Claude integration template

The installer merges `hooks.template.json` into a consuming project's Claude
settings after review. Every hook sends its JSON payload to the same framework
command on standard input. The adapter enriches that payload with durable
framework actor and assignment references before normalization.

Only `PreToolUse` can be treated as blocking by this initial template when the installed Claude version
and hook configuration confirm that behavior. Other hooks are observations.
Hook presence never proves that a repository owner cannot disable the hook.

For an accepted pre-tool request the adapter emits no permission decision, so
Claude's normal permission flow remains in force. For a runtime rejection it
emits the documented `PreToolUse` denial response.

Installed hooks invoke `npx --no-install agent-workflow`, resolving the binary
from the consumer's pinned dependency rather than referencing framework source
inside an incubating repository. Observable raw responses may be persisted only
through the exported redacting persistence contract.

The template does not promise force interruption, sub-agent resumption, message
acknowledgement, or live cross-provider process handover.
