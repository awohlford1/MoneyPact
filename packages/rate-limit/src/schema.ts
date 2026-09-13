import schemaJson from "./parameter-record.schema.json" with { type: "json" };

export interface Schema {
  $ref?: string; $defs?: Record<string, Schema>; type?: string | string[]; const?: unknown;
  enum?: unknown[]; required?: string[]; properties?: Record<string, Schema>; additionalProperties?: boolean;
  items?: Schema; minItems?: number; uniqueItems?: boolean; minLength?: number; minimum?: number;
  pattern?: string; format?: string;
}
export const PARAMETER_SCHEMA: Schema = schemaJson;
export interface Diagnostic { recordId: string; code: string; pointer: string }
export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function instant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d+)?(?:Z|[+-](\d\d):(\d\d))$/.exec(value);
  if (!parts || !Number.isFinite(Date.parse(value))) return false;
  const [, year, month, day, hour, minute, second, offsetHour = "0", offsetMinute = "0"] = parts;
  return Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1
    && Number(day) <= new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate()
    && Number(hour) < 24 && Number(minute) < 60 && Number(second) < 60 && Number(offsetHour) < 24 && Number(offsetMinute) < 60;
}
export function validateShape(value: unknown, schema: Schema = PARAMETER_SCHEMA, pointer = "", root = schema): string[] {
  if (schema.$ref) return validateShape(value, root.$defs![schema.$ref.split("/").at(-1)!]!, pointer, root);
  const errors: string[] = [];
  const types = typeof schema.type === "string" ? [schema.type] : schema.type;
  const matches = (type: string): boolean => type === "null" ? value === null : type === "object" ? isObject(value)
    : type === "array" ? Array.isArray(value) : type === "integer" ? Number.isSafeInteger(value) : typeof value === type;
  if (types && !types.some(matches)) return [pointer];
  if (Object.hasOwn(schema, "const") && value !== schema.const) errors.push(pointer);
  if (schema.enum && !schema.enum.includes(value)) errors.push(pointer);
  if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum) errors.push(pointer);
  if (typeof value === "string" && ((schema.minLength !== undefined && value.length < schema.minLength)
    || (schema.pattern && !new RegExp(schema.pattern).test(value)) || (schema.format === "date-time" && !instant(value)))) errors.push(pointer);
  if (isObject(value)) {
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) errors.push(`${pointer}/${key}`);
    for (const [key, child] of Object.entries(value)) {
      if (schema.properties?.[key]) errors.push(...validateShape(child, schema.properties[key], `${pointer}/${key}`, root));
      else if (schema.additionalProperties === false) errors.push(`${pointer}/${key}`);
    }
  }
  if (Array.isArray(value)) {
    if ((schema.minItems !== undefined && value.length < schema.minItems) || (schema.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length)) errors.push(pointer);
    if (schema.items) value.forEach((item, index) => errors.push(...validateShape(item, schema.items!, `${pointer}/${index}`, root)));
  }
  return [...new Set(errors)].sort();
}

/** JSON.parse silently overwrites duplicate keys. This token parser rejects them,
 * including escaped spellings of the same key, before accepting any registry. */
export function parseRegistryJson(source: string): unknown {
  let position = 0;
  const whitespace = (): void => { while (/\s/.test(source[position] ?? "") && position < source.length) position++; };
  function string(): string {
    const start = position++;
    while (position < source.length) {
      const char = source[position++];
      if (char === "\\") position++;
      else if (char === '"') return JSON.parse(source.slice(start, position)) as string;
    }
    throw new Error("record_json_invalid");
  }
  function value(): unknown {
    whitespace();
    if (source[position] === '"') return string();
    if (source[position] === "{") {
      position++; whitespace(); const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      if (source[position] === "}") { position++; return result; }
      for (;;) {
        whitespace(); if (source[position] !== '"') throw new Error("record_json_invalid");
        const key = string(); if (Object.hasOwn(result, key)) throw new Error("record_json_duplicate_key");
        whitespace(); if (source[position++] !== ":") throw new Error("record_json_invalid");
        result[key] = value(); whitespace(); const separator = source[position++];
        if (separator === "}") return result;
        if (separator !== ",") throw new Error("record_json_invalid");
      }
    }
    if (source[position] === "[") {
      position++; whitespace(); const result: unknown[] = [];
      if (source[position] === "]") { position++; return result; }
      for (;;) { result.push(value()); whitespace(); const separator = source[position++]; if (separator === "]") return result; if (separator !== ",") throw new Error("record_json_invalid"); }
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(source.slice(position));
    if (!match) throw new Error("record_json_invalid"); position += match[0].length; return JSON.parse(match[0]) as unknown;
  }
  const result = value(); whitespace(); if (position !== source.length) throw new Error("record_json_invalid"); return result;
}
