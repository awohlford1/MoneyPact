export const FRAMEWORK_ERROR_CODES = [
  "CONFIG_FILE_NOT_FOUND",
  "CONFIG_PARSE_ERROR",
  "CONFIG_IO_ERROR",
  "CONFIG_INVALID_TYPE",
  "CONFIG_INVALID_VALUE",
  "CONFIG_UNKNOWN_KEY",
  "CONFIG_OVERRIDE_NOT_ALLOWED",
  "CONFIG_LOCAL_GOVERNANCE_OVERRIDE",
  "CONFIG_EXTENSION_INVALID",
  "CONFIG_EXTENSION_DUPLICATE",
  "CONFIG_INVARIANT_VIOLATION",
  "PROVIDER_CONTEXT_INVALID",
  "PROVIDER_CAPABILITY_UNAVAILABLE",
  "OPERATION_INVALID",
] as const;

export type CoreFrameworkErrorCode = (typeof FRAMEWORK_ERROR_CODES)[number];
export type FrameworkErrorCode = CoreFrameworkErrorCode;

export interface FrameworkError<TCode extends string = string> {
  code: TCode;
  message: string;
  path?: string;
  details?: Readonly<Record<string, unknown>>;
}

export class AgentWorkflowError<TCode extends string = string> extends Error {
  readonly code: TCode;
  readonly path?: string;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(error: FrameworkError<TCode>, options?: ErrorOptions) {
    super(error.message, options);
    this.name = "AgentWorkflowError";
    this.code = error.code;
    if (error.path !== undefined) this.path = error.path;
    if (error.details !== undefined) this.details = error.details;
  }

  toJSON(): FrameworkError<TCode> {
    return {
      code: this.code,
      message: this.message,
      ...(this.path === undefined ? {} : { path: this.path }),
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}
