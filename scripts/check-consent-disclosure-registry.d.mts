/**
 * Types for `check-consent-disclosure-registry.mjs`, so
 * `apps/api/src/budget-creation/consent-registry.test.ts` can import the pure
 * validator under `--noImplicitAny` and drive every deliberate violation in
 * process rather than only through a child process.
 */
export declare const repositoryRoot: string;
export declare const registryPath: string;
export declare function canonicalize(value: unknown): string;
export declare function digestOf(value: unknown): string;
export declare function validateConsentDisclosureRegistry(input: {
  readonly baseEntries: unknown;
  readonly candidateEntries: unknown;
  readonly contents: Readonly<Record<string, unknown>>;
}): string[];
