/**
 * Normalization and canonical field-error catalog (CBD-232 §5).
 */

import { parseCadenceDefinition } from "@cobudget/budget-domain/schedule";
import type { FieldError } from "./errors.ts";
import { sortFieldErrors } from "./errors.ts";
import { canonicalizeTimeZone } from "./time-zone.ts";
import type { AuthenticatedSubjectContext, CurrencyContextReader, NormalizedInputs } from "./ports.ts";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7E]{16,128}$/u;

export function validateIdempotencyKeyHeader(header: string | undefined): FieldError[] {
  if (header === undefined || header.length === 0) {
    return [
      {
        code: "idempotency-key.required",
        path: "header.Idempotency-Key",
        message: "Provide an Idempotency-Key header.",
      },
    ];
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(header)) {
    return [
      {
        code: "idempotency-key.invalid",
        path: "header.Idempotency-Key",
        message: "Use 16 to 128 visible ASCII characters.",
      },
    ];
  }
  return [];
}

const WHITESPACE_RUN = /\p{White_Space}+/gu;
const LEADING_TRAILING_WHITESPACE = /^\p{White_Space}+|\p{White_Space}+$/gu;

function normalizeName(value: unknown): { value?: string; errors: FieldError[] } {
  if (typeof value !== "string") {
    return {
      errors: [
        { code: "name.expected-string", path: "name", message: "Enter a budget name." },
      ],
    };
  }
  const normalized = value
    .normalize("NFC")
    .replace(LEADING_TRAILING_WHITESPACE, "")
    .replace(WHITESPACE_RUN, " ");
  if (normalized.length === 0) {
    return {
      errors: [{ code: "name.required", path: "name", message: "Enter a budget name." }],
    };
  }
  if ([...normalized].length > 100) {
    return {
      errors: [
        { code: "name.too-long", path: "name", message: "Use 100 characters or fewer." },
      ],
    };
  }
  return { value: normalized, errors: [] };
}

function normalizeTimeZone(value: unknown): { value?: string; errors: FieldError[] } {
  if (typeof value !== "string") {
    return {
      errors: [
        {
          code: "time-zone.expected-string",
          path: "timeZone",
          message: "Enter a named IANA time zone.",
        },
      ],
    };
  }
  const trimmed = value.replace(LEADING_TRAILING_WHITESPACE, "");
  if (trimmed.length === 0) {
    return {
      errors: [
        {
          code: "time-zone.required",
          path: "timeZone",
          message: "Enter a named IANA time zone.",
        },
      ],
    };
  }
  const canonical = canonicalizeTimeZone(trimmed);
  if (canonical === null) {
    return {
      errors: [
        {
          code: "time-zone.invalid",
          path: "timeZone",
          message: "Choose a valid named IANA time zone.",
        },
      ],
    };
  }
  return { value: canonical, errors: [] };
}

function normalizeCurrency(
  value: unknown,
  context: AuthenticatedSubjectContext,
  currencyContextReader: CurrencyContextReader,
): { value?: string; errors: FieldError[] } {
  if (typeof value !== "string") {
    return {
      errors: [
        { code: "currency.expected-string", path: "currencyCode", message: "Enter a currency code." },
      ],
    };
  }
  const trimmed = value.replace(LEADING_TRAILING_WHITESPACE, "");
  if (trimmed.length === 0) {
    return {
      errors: [
        { code: "currency.required", path: "currencyCode", message: "Enter a currency code." },
      ],
    };
  }
  const uppercased = trimmed.replace(/[a-z]/gu, (letter) => letter.toUpperCase());
  if (!/^[A-Z]{3}$/u.test(uppercased) || !currencyContextReader.isSupportedCode(uppercased)) {
    return {
      errors: [
        {
          code: "currency.invalid",
          path: "currencyCode",
          message: "Choose a supported three-letter currency code.",
        },
      ],
    };
  }
  if (!currencyContextReader.isCompatibleWithContext(uppercased, context)) {
    return {
      errors: [
        {
          code: "currency.context-mismatch",
          path: "currencyCode",
          message: "Choose the currency used by this financial profile.",
        },
      ],
    };
  }
  return { value: uppercased, errors: [] };
}

const SUPERSEDES_PATTERN = /^bcp_[0-9a-f]{32}$/u;

function validateSupersedes(value: unknown): { value: string | null; errors: FieldError[] } {
  if (value === undefined) return { value: null, errors: [] };
  if (typeof value !== "string") {
    return {
      value: null,
      errors: [
        {
          code: "supersedes-proposal-id.expected-string",
          path: "supersedesProposalId",
          message: "Enter a valid proposal identifier.",
        },
      ],
    };
  }
  if (!SUPERSEDES_PATTERN.test(value)) {
    return {
      value: null,
      errors: [
        {
          code: "supersedes-proposal-id.invalid",
          path: "supersedesProposalId",
          message: "Enter a valid proposal identifier.",
        },
      ],
    };
  }
  return { value, errors: [] };
}

const TOP_LEVEL_KEYS = new Set(["name", "timeZone", "currencyCode", "schedule", "supersedesProposalId"]);

const SCHEDULE_KEYS: Readonly<Record<string, readonly string[]>> = {
  weekly: ["cadence", "anchor"],
  monthly: ["cadence", "anchor"],
  paycheck: ["cadence", "pattern", "businessDayPolicy"],
  "custom-fixed-length": ["cadence", "startBoundary", "lengthInDays"],
};

const PATTERN_KEYS: Readonly<Record<string, readonly string[]>> = {
  "twice-per-week": ["kind", "weekdays"],
  weekly: ["kind", "weekday"],
  "every-two-weeks": ["kind", "weekday", "recurrenceOrigin"],
  "twice-per-month": ["kind", "anchors"],
  monthly: ["kind", "anchor"],
  "custom-weekly-interval": ["kind", "weekday", "recurrenceOrigin", "everyWeeks"],
};

const MONTHLY_ANCHOR_KEYS = ["kind", "day"] as const;

function unknownFieldsIn(
  record: Record<string, unknown>,
  allowed: readonly string[],
  pathPrefix: string,
): FieldError[] {
  return Object.keys(record)
    .filter((key) => !allowed.includes(key))
    .map((key) => ({
      code: "input.unknown-field",
      path: `${pathPrefix}.${key}`,
      message: "Remove the unsupported field.",
    }));
}

function unknownAnchorFields(value: unknown, path: string): FieldError[] {
  return isRecord(value) ? unknownFieldsIn(value, MONTHLY_ANCHOR_KEYS, path) : [];
}

/**
 * Detect unknown fields, including inside `schedule`, ahead of cadence
 * parsing (§5.4). Nested detection is only possible once `cadence` (and, for
 * paycheck, `pattern.kind`) is itself recognised; an unrecognised cadence or
 * pattern kind is left to `parseCadenceDefinition`'s own `*.unsupported*`
 * codes rather than guessed at here.
 */
function detectUnknownFields(body: Record<string, unknown>): FieldError[] {
  const errors: FieldError[] = Object.keys(body)
    .filter((key) => !TOP_LEVEL_KEYS.has(key))
    .map((key) => ({ code: "input.unknown-field", path: key, message: "Remove the unsupported field." }));

  const schedule = body["schedule"];
  if (!isRecord(schedule)) return errors;

  const cadence = schedule["cadence"];
  if (typeof cadence !== "string") return errors;
  const scheduleAllowed = SCHEDULE_KEYS[cadence];
  if (scheduleAllowed === undefined) return errors;

  errors.push(...unknownFieldsIn(schedule, scheduleAllowed, "schedule"));

  if (cadence === "monthly") {
    errors.push(...unknownAnchorFields(schedule["anchor"], "schedule.anchor"));
  }

  if (cadence === "paycheck" && isRecord(schedule["pattern"])) {
    const pattern = schedule["pattern"];
    const kind = pattern["kind"];
    if (typeof kind === "string") {
      const patternAllowed = PATTERN_KEYS[kind];
      if (patternAllowed !== undefined) {
        errors.push(...unknownFieldsIn(pattern, patternAllowed, "schedule.pattern"));
        if (kind === "monthly") {
          errors.push(...unknownAnchorFields(pattern["anchor"], "schedule.pattern.anchor"));
        }
        if (kind === "twice-per-month" && Array.isArray(pattern["anchors"])) {
          pattern["anchors"].forEach((anchor: unknown, index: number) => {
            errors.push(...unknownAnchorFields(anchor, `schedule.pattern.anchors.${index}`));
          });
        }
      }
    }
  }

  return errors;
}

export interface ValidationSuccess {
  readonly ok: true;
  readonly normalizedInputs: NormalizedInputs;
  readonly supersedesProposalId: string | null;
}

export interface ValidationFailure {
  readonly ok: false;
  readonly fieldErrors: readonly FieldError[];
}

export type ValidationOutcome = ValidationSuccess | ValidationFailure;

export function validateCreateProposalRequest(
  idempotencyKeyHeader: string | undefined,
  body: unknown,
  deps: {
    readonly currencyContextReader: CurrencyContextReader;
    readonly subjectContext: AuthenticatedSubjectContext;
  },
): ValidationOutcome {
  const errors: FieldError[] = [...validateIdempotencyKeyHeader(idempotencyKeyHeader)];

  const record = isRecord(body) ? body : {};
  errors.push(...detectUnknownFields(record));

  const name = normalizeName(record["name"]);
  errors.push(...name.errors);

  const timeZone = normalizeTimeZone(record["timeZone"]);
  errors.push(...timeZone.errors);

  const currency = normalizeCurrency(record["currencyCode"], deps.subjectContext, deps.currencyContextReader);
  errors.push(...currency.errors);

  const scheduleRaw = record["schedule"];
  let scheduleErrors: FieldError[] = [];
  let schedule: NormalizedInputs["schedule"] | undefined;
  if (scheduleRaw === undefined || scheduleRaw === null || Array.isArray(scheduleRaw) || !isRecord(scheduleRaw)) {
    scheduleErrors = [
      { code: "input.expected-object", path: "schedule", message: "Enter a schedule definition." },
    ];
  } else {
    const parsed = parseCadenceDefinition(scheduleRaw);
    if (parsed.ok) {
      schedule = parsed.value;
    } else {
      scheduleErrors = parsed.issues.map((issue) => ({
        code: issue.code,
        path: issue.path === "" ? "schedule" : `schedule.${issue.path}`,
        message: issue.message,
      }));
    }
  }
  errors.push(...scheduleErrors);

  const supersedes = validateSupersedes(record["supersedesProposalId"]);
  errors.push(...supersedes.errors);

  if (errors.length > 0) {
    return { ok: false, fieldErrors: sortFieldErrors(errors) };
  }

  return {
    ok: true,
    normalizedInputs: {
      name: name.value as string,
      timeZone: timeZone.value as string,
      currencyCode: currency.value as string,
      schedule: schedule as NormalizedInputs["schedule"],
    },
    supersedesProposalId: supersedes.value,
  };
}
