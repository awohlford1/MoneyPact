import type { ConsentDisclosure, ConsentDisclosureSource } from "../creation-confirmation/disclosure.ts";
import { PRIMARY_OWNER_SELF_DISCLOSURE } from "../creation-confirmation/disclosure.ts";
import { hmacSha256Base64Url } from "./canonical-json.ts";
import { InMemoryProposalStore } from "./in-memory-store.ts";
import type {
  AuthenticatedSubjectContext, BindingKeyring, Clock, CurrencyContextReader, OpaqueIdGenerator, Ports,
} from "./ports.ts";

export class FakeClock implements Clock {
  #current: Date;
  constructor(initialIso: string) { this.#current = new Date(initialIso); }
  now(): Date { return this.#current; }
  set(iso: string): void { this.#current = new Date(iso); }
  advanceMs(deltaMs: number): void { this.#current = new Date(this.#current.getTime() + deltaMs); }
}

export class SequentialIdGenerator implements OpaqueIdGenerator {
  #counter = 0;
  proposalId(): string {
    this.#counter += 1;
    return `bcp_${this.#counter.toString(16).padStart(32, "0")}`;
  }
}

const TEST_KEYS: Record<string, string> = {
  primary: "correct horse battery staple test signing key one",
  secondary: "correct horse battery staple test signing key two",
};

export class FakeBindingKeyring implements BindingKeyring {
  readonly bindingVersion = "bcp-hmac-sha256/v1" as const;
  readonly #activeKeyId: string;
  readonly #keys: Record<string, string>;
  constructor(activeKeyId: string = "primary", keys: Record<string, string> = TEST_KEYS) {
    this.#activeKeyId = activeKeyId;
    this.#keys = keys;
  }
  sign(canonicalEnvelope: string): string {
    const key = this.#keys[this.#activeKeyId];
    if (key === undefined) throw new Error(`Unknown signing key ${this.#activeKeyId}`);
    return `${this.bindingVersion}.${this.#activeKeyId}.${hmacSha256Base64Url(key, canonicalEnvelope)}`;
  }
  verify(canonicalEnvelope: string, token: string): boolean {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const [version, keyId, mac] = parts as [string, string, string];
    if (version !== this.bindingVersion) return false;
    const key = this.#keys[keyId];
    if (key === undefined) return false;
    const expected = hmacSha256Base64Url(key, canonicalEnvelope);
    return expected.length === mac.length && expected === mac;
  }
}

export class FakeCurrencyContextReader implements CurrencyContextReader {
  readonly currencyCatalogVersion: string;
  readonly #supported: ReadonlySet<string>;
  readonly #incompatibleCode: string | null;
  constructor(options?: { readonly currencyCatalogVersion?: string; readonly supported?: readonly string[];
    readonly incompatibleCode?: string }) {
    this.currencyCatalogVersion = options?.currencyCatalogVersion ?? "currency-catalog-test-1";
    this.#supported = new Set(options?.supported ?? ["USD", "EUR", "GBP", "JPY", "CAD"]);
    this.#incompatibleCode = options?.incompatibleCode ?? null;
  }
  isSupportedCode(code: string): boolean { return this.#supported.has(code); }
  isCompatibleWithContext(code: string, _context: AuthenticatedSubjectContext): boolean {
    return code !== this.#incompatibleCode;
  }
}

/** A one-entry approved registry standing in for config/consent-disclosure-registry.json. */
export function testDisclosures(overrides?: Partial<ConsentDisclosure>): ConsentDisclosureSource {
  const disclosure: ConsentDisclosure = { kind: PRIMARY_OWNER_SELF_DISCLOSURE, version: 1, digest: "d".repeat(64),
    text: { heading: "Before you create this budget", items: [{ id: "role", text: "You become the sole Primary Owner." }],
      acknowledgement: "I agree to become Primary Owner of this budget space." }, ...overrides };
  return { current: (kind: string) => { if (kind !== disclosure.kind) throw new Error(`consent_disclosure_kind_unregistered: ${kind}`); return disclosure; } };
}
export function testAuthContext(overrides?: Partial<AuthenticatedSubjectContext>): AuthenticatedSubjectContext {
  return { environment: "test", subjectId: "subject-1", accountId: "account-1", profileId: "profile-1",
    sessionGeneration: 1, ...overrides };
}
export function testPorts(overrides?: Partial<Ports>): Ports {
  return { clock: new FakeClock("2026-09-15T12:00:00.000Z"), idGenerator: new SequentialIdGenerator(),
    bindingKeyring: new FakeBindingKeyring(), currencyContextReader: new FakeCurrencyContextReader(),
    store: new InMemoryProposalStore(), timeZoneDataVersion: "tzdata-test-1", disclosures: testDisclosures(), ...overrides };
}
