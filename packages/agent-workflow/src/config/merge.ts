import type { FrameworkConfiguration, OverrideAuthority } from "../contracts/configuration.ts";
import { AgentWorkflowError } from "../contracts/errors.ts";
import { authorityForPath } from "./metadata.ts";

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function leafEntries(value: JsonObject, prefix = ""): [string, unknown][] {
  const entries: [string, unknown][] = [];
  for (const [key, child] of Object.entries(value)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (isObject(child)) {
      if (Object.keys(child).length > 0) entries.push(...leafEntries(child, path));
    } else entries.push([path, child]);
  }
  return entries;
}

function canOverride(path: string, authority: OverrideAuthority): boolean {
  const metadata = authorityForPath(path);
  if (metadata === undefined) return false;
  if (authority === "project") return metadata.projectOverridable;
  if (authority === "assignment") return metadata.assignmentOverridable;
  return metadata.executiveWaivable;
}

function setPath(target: JsonObject, path: string, value: unknown): void {
  const parts = path.split(".");
  let current = target;
  for (const part of parts.slice(0, -1)) {
    const child = current[part];
    if (!isObject(child)) current[part] = {};
    current = current[part] as JsonObject;
  }
  const leaf = parts.at(-1);
  if (leaf !== undefined) current[leaf] = structuredClone(value);
}

export function applyConfigurationOverride(
  base: FrameworkConfiguration,
  override: JsonObject,
  authority: OverrideAuthority,
  source: string,
): FrameworkConfiguration {
  const result = structuredClone(base) as unknown as JsonObject;
  for (const [path, value] of leafEntries(override)) {
    if (!canOverride(path, authority)) {
      throw new AgentWorkflowError({
        code: "CONFIG_OVERRIDE_NOT_ALLOWED",
        message: `${authority} configuration cannot override ${path}.`,
        path: `${source}.${path}`,
        details: { authority },
      });
    }
    setPath(result, path, value);
  }
  return result as unknown as FrameworkConfiguration;
}

export function applyProviderRestrictions(
  base: FrameworkConfiguration,
  disabledProviders: readonly string[],
): FrameworkConfiguration {
  const result = structuredClone(base);
  for (const provider of disabledProviders) {
    result.providers[provider] = { ...result.providers[provider], enabled: false };
  }
  return result;
}
