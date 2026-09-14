# Public contract baseline

Import provider-neutral types from `@agent-workflow/cli/contracts`. The public
surface includes `OperationRequest`, `OperationResult`, `ActorRef`,
`RecordRef`, `ArtifactRef`, `Clock`, `IdGenerator`, `ProviderAdapter`,
`ProviderContext`, `CapabilityReport`, `FrameworkConfiguration`,
`EffectiveConfiguration`, and structured framework error types.

The constant catalogues (`ACTOR_TYPES`, `FRAMEWORK_ID_KINDS`,
`OPERATION_OUTCOMES`, `ENFORCEMENT_LEVELS`, `PROVIDER_CAPABILITIES`, and
`FRAMEWORK_ERROR_CODES`) are the canonical values downstream packages should
use. Provider identifiers are provenance only; framework identifiers remain
durable.

Configuration APIs are exported separately from `@agent-workflow/cli/config`.
