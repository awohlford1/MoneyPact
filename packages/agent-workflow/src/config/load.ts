import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ConfigurationExtension,
  EffectiveConfiguration,
  FrameworkConfiguration,
  MachineLocalConfiguration,
} from "../contracts/configuration.ts";
import { AgentWorkflowError } from "../contracts/errors.ts";
import { canonicalJson, configurationDigest } from "./canonical.ts";
import { assertMandatoryInvariants } from "./invariants.ts";
import { applyConfigurationOverride, applyProviderRestrictions } from "./merge.ts";
import {
  asFrameworkConfiguration,
  validateConfigurationLayer,
  validateExtension,
  validateMachineConfiguration,
} from "./validate.ts";

export interface LoadConfigurationOptions {
  projectRoot: string;
  projectConfigPath?: string;
  extensionsDirectory?: string;
  localConfigPath?: string;
  requireProjectConfig?: boolean;
  assignmentOverrides?: unknown;
  executiveOverrides?: unknown;
  disabledProviders?: readonly string[];
}

async function readJson(filePath: string, required: boolean): Promise<unknown | undefined> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      if (!required) return undefined;
      throw new AgentWorkflowError({
        code: "CONFIG_FILE_NOT_FOUND",
        message: `Required configuration file was not found: ${filePath}`,
        path: filePath,
      }, { cause: error });
    }
    throw new AgentWorkflowError({
      code: "CONFIG_IO_ERROR",
      message: `Could not read configuration file: ${filePath}`,
      path: filePath,
    }, { cause: error });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new AgentWorkflowError({
      code: "CONFIG_PARSE_ERROR",
      message: `Configuration file is not valid JSON: ${filePath}`,
      path: filePath,
    }, { cause: error });
  }
}

async function loadExtensions(directory: string): Promise<Record<string, ConfigurationExtension>> {
  let names: string[];
  try {
    names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new AgentWorkflowError({
      code: "CONFIG_IO_ERROR",
      message: `Could not read configuration extension directory: ${directory}`,
      path: directory,
    }, { cause: error });
  }

  const extensions: Record<string, ConfigurationExtension> = {};
  for (const name of names) {
    const filePath = path.join(directory, name);
    const extension = validateExtension(await readJson(filePath, true), filePath);
    if (extensions[extension.namespace] !== undefined) {
      throw new AgentWorkflowError({
        code: "CONFIG_EXTENSION_DUPLICATE",
        message: `Duplicate extension namespace ${extension.namespace}.`,
        path: filePath,
      });
    }
    extensions[extension.namespace] = extension;
  }
  return extensions;
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function normalize(config: FrameworkConfiguration): FrameworkConfiguration {
  const normalized = structuredClone(config);
  normalized.roles.enabled = sortedUnique(normalized.roles.enabled);
  normalized.materiality.alwaysMaterial = sortedUnique(normalized.materiality.alwaysMaterial);
  normalized.materiality.delegatedChanges = sortedUnique(normalized.materiality.delegatedChanges);
  normalized.models.selectionAuthority = sortedUnique(normalized.models.selectionAuthority) as FrameworkConfiguration["models"]["selectionAuthority"];
  for (const policy of Object.values(normalized.models.roles)) {
    policy.allowed = sortedUnique(policy.allowed);
  }
  normalized.providers = Object.fromEntries(Object.entries(normalized.providers).sort(([left], [right]) => left.localeCompare(right)));
  normalized.models.roles = Object.fromEntries(Object.entries(normalized.models.roles).sort(([left], [right]) => left.localeCompare(right)));
  return normalized;
}

function assertEffectiveRelationships(config: FrameworkConfiguration): void {
  if (config.intentLogging.backoffSeconds.length !== config.intentLogging.retryCount) {
    throw new AgentWorkflowError({
      code: "CONFIG_INVALID_VALUE",
      message: "intentLogging.backoffSeconds must contain one delay for each retry.",
      path: "effective configuration.intentLogging.backoffSeconds",
    });
  }
  if (config.referenceValidation.retrySeconds.some((delay) => delay >= config.referenceValidation.timeoutSeconds)) {
    throw new AgentWorkflowError({
      code: "CONFIG_INVALID_VALUE",
      message: "Reference retry delays must occur before the validation timeout.",
      path: "effective configuration.referenceValidation.retrySeconds",
    });
  }
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export async function loadEffectiveConfiguration(options: LoadConfigurationOptions): Promise<EffectiveConfiguration> {
  const projectRoot = path.resolve(options.projectRoot);
  const defaultPath = fileURLToPath(new URL("../../defaults/config.json", import.meta.url));
  const defaultInput = await readJson(defaultPath, true);
  let config = asFrameworkConfiguration(validateConfigurationLayer(defaultInput, "framework defaults"));

  const projectPath = path.resolve(projectRoot, options.projectConfigPath ?? ".agent-workflow/config.json");
  const projectInput = await readJson(projectPath, options.requireProjectConfig ?? false);
  if (projectInput !== undefined) {
    const projectLayer = validateConfigurationLayer(projectInput, projectPath);
    config = applyConfigurationOverride(config, projectLayer, "project", projectPath);
  }

  const extensions = await loadExtensions(path.resolve(projectRoot, options.extensionsDirectory ?? ".agent-workflow/overrides"));

  const localPath = path.resolve(projectRoot, options.localConfigPath ?? ".agent-workflow/local.json");
  const localInput = await readJson(localPath, false);
  const machine: MachineLocalConfiguration = localInput === undefined
    ? {}
    : validateMachineConfiguration(localInput, localPath);

  if (options.assignmentOverrides !== undefined) {
    const assignmentLayer = validateConfigurationLayer(options.assignmentOverrides, "assignment override");
    config = applyConfigurationOverride(config, assignmentLayer, "assignment", "assignment override");
  }
  if (options.executiveOverrides !== undefined) {
    const executiveLayer = validateConfigurationLayer(options.executiveOverrides, "executive override");
    config = applyConfigurationOverride(config, executiveLayer, "executive", "executive override");
  }
  if (options.disabledProviders !== undefined) {
    config = applyProviderRestrictions(config, sortedUnique([...options.disabledProviders]));
  }

  config = normalize(config);
  asFrameworkConfiguration(config);
  assertEffectiveRelationships(config);
  assertMandatoryInvariants(config);

  const normalizedExtensions = Object.fromEntries(
    Object.entries(extensions).sort(([left], [right]) => left.localeCompare(right)),
  );
  const digest = configurationDigest({ config, extensions: normalizedExtensions });

  return deepFreeze({
    config,
    extensions: normalizedExtensions,
    machine: structuredClone(machine),
    digest,
  });
}

export function serializeEffectivePolicy(effective: EffectiveConfiguration): string {
  return canonicalJson({ config: effective.config, extensions: effective.extensions });
}
