export function missingRuntimeExports(
  module: Record<string, unknown>,
  barrel: Record<string, unknown>,
): readonly string[];

export function missingTypeExports(
  moduleSource: string,
  barrelSource: string,
  moduleSpecifier: string,
): readonly string[];

export function runtimeDiagnostic(
  moduleName: string,
  groupName: string,
  missing: readonly string[],
): string;

export function typeDiagnostic(
  moduleName: string,
  groupName: string,
  missing: readonly string[],
): string;
