import { createHash } from "node:crypto";
import type { JsonValue } from "./types.ts";

function normalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, normalize(value[key] as JsonValue)]),
    );
  }
  return value;
}
export function canonicalJson(value: JsonValue): string {
  return JSON.stringify(normalize(value));
}

export function jsonDigest(value: JsonValue): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}
