/**
 * The approved consent disclosure, as a leaf type module (CBD-236;
 * CBD236-CONSENT-SEMANTICS-001 item 3).
 *
 * This file imports nothing. The disclosure is named by the CBD-232 preview
 * response, by the CBD-233 confirmation request, by the registry loader in
 * `apps/api` and by the consent write, and routing all four through one leaf
 * keeps the package's module graph acyclic.
 */

/** The `primary_owner_self` disclosure kind, the only kind the prototype records. */
export const PRIMARY_OWNER_SELF_DISCLOSURE = "primary_owner_self";

export interface ConsentDisclosureItem { readonly id: string; readonly text: string }
export interface ConsentDisclosureText {
  readonly heading: string;
  readonly items: readonly ConsentDisclosureItem[];
  readonly acknowledgement: string;
}
/** One approved entry of `config/consent-disclosure-registry.json`, with its content. */
export interface ConsentDisclosure {
  readonly kind: string;
  readonly version: number;
  readonly digest: string;
  readonly text: ConsentDisclosureText;
}
/** Server-side access to the approved registry. Never reads a request value. */
export interface ConsentDisclosureSource {
  /** The current (highest approved) version of a kind. Throws when the kind is not registered. */
  current(kind: string): ConsentDisclosure;
}
/** The CBD-233 request claim (amendment routed to the CBD-233 owner). */
export interface AcknowledgedDisclosure { readonly kind: string; readonly version: number }
