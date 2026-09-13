/**
 * Deterministic fakes for the CBD-232 ports, shared by this package's tests
 * (§11: "Tests use injected clocks, IDs, keyrings, and ports; no live
 * provider or wall clock is required.").
 */

import { hmacSha256Base64Url } from "./canonical-json.ts";
import { InMemoryProposalStore } from "./in-memory-store.ts";
import type { AuthenticatedSubjectContext, BindingKeyring, Clock, CurrencyContextReader, OpaqueIdGenerator, Ports } from "./ports.ts";

export class FakeClock implements Clock {
  #current: Date;

  constructor(initialIso: string) {
    this.#current = new Date(initialIso);
  }

  now(): Date {
    return this.#current;
  }

  set(iso: string): void {
    this.#current = new Date(iso);
  }

  advanceMs(deltaMs: number): void {
    this.#current = new Date(this.#current.getTime() + deltaMs);
  }
}

export class SequentialIdGenerator implements OpaqueIdGenerator {
  #counter = 0;

  proposalId(): string {
    this.#counter += 1;
    return `bcp_${this.#counter.toString(16).padStart(32, "0")}`;
  }
}

const TEST_KEYS: Record<string, string> = {
  "test-key-1": "correct horse battery staple test signing key one",
  "test-key-2": "correct horse battery staple test signing key two",
};

export class FakeBindingKeyring implements BindingKeyring {
  readonly bindingVersion = "bcp-hmac-sha256/v1" as const;
  readonly #activeKeyId: string;
  readonly #keys: Record<string, string>;

  constructor(activeKeyId: string = "test-key-1", keys: Record<string, string> = TEST_KEYS) {
    this.#activeKeyId = activeKeyId;
    this.#keys = keys;
  }

  sign(canonicalEnvelope: string): string {
    const key = this.#keys[this.#activeKeyId];
    if (key === undefined) throw new Error(`Unknown signing key ${this.#activeKeyId}`);
    const mac = hmacSha256Base64Url(key, canonicalEnvelope);
    return `${this.bindingVersion}.${this.#activeKeyId}.${mac}`;
  }

  verify(canonicalEnvelope: string, token: string): boolean {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const [version, keyId, mac] = parts as [string, string, string];
    if (version !== this.bindingVersion) return false;
    const key = this.#keys[keyId];
    if (key === undefined) return false; // retired/unknown key: invalidates (§7.1)
    const expected = hmacSha256Base64Url(key, canonicalEnvelope);
    return expected.length === mac.length && expected === mac;
  }
}

export class FakeCurrencyContextReader implements CurrencyContextReader {
  readonly currencyCatalogVersion: string;
  readonly #supported: ReadonlySet<string>;
  readonly #incompatibleCode: string | null;

  constructor(options?: {
    readonly currencyCatalogVersion?: string;
    readonly supported?: readonly string[];
    readonly incompatibleCode?: string;
  }) {
    this.currencyCatalogVersion = options?.currencyCatalogVersion ?? "currency-catalog/test-1";
    this.#supported = new Set(options?.supported ?? ["USD", "EUR", "GBP", "JPY", "CAD"]);
    this.#incompatibleCode = options?.incompatibleCode ?? null;
  }

  isSupportedCode(code: string): boolean {
    return this.#supported.has(code);
  }

  isCompatibleWithContext(code: string, _context: AuthenticatedSubjectContext): boolean {
    return code !== this.#incompatibleCode;
  }
}

export function testAuthContext(overrides?: Partial<AuthenticatedSubjectContext>): AuthenticatedSubjectContext {
  return {
    environment: "test",
    subjectId: "subject-1",
    accountId: "account-1",
    profileId: "profile-1",
    sessionGeneration: 1,
    ...overrides,
  };
}

export function testPorts(overrides?: Partial<Ports>): Ports {
  return {
    clock: new FakeClock("2026-09-15T12:00:00.000Z"),
    idGenerator: new SequentialIdGenerator(),
    bindingKeyring: new FakeBindingKeyring(),
    currencyContextReader: new FakeCurrencyContextReader(),
    store: new InMemoryProposalStore(),
    timeZoneDataVersion: "tzdata/test-1",
    ...overrides,
  };
}
