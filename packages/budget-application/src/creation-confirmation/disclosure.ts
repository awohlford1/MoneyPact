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
  /**
   * The entry at exactly this kind and version, or `null` when the registry
   * does not carry it -- an unknown kind, or a version the registry has
   * moved past and no longer keeps (`GAPS-F03` follow-up, `TCF-02`). Unlike
   * {@link current}, this never throws: absence is the answer, not an error,
   * so a view can show the text the parties actually read even after the
   * registry's current version has moved on, and withhold it only once that
   * version is truly gone.
   *
   * Optional so a source with no history of its own -- a fixture that only
   * ever holds one version per kind -- need not implement it; a caller reads
   * it through the optional-call operator and treats its absence as `null`.
   */
  at?(kind: string, version: number): ConsentDisclosure | null;
}
/** The CBD-233 request claim (amendment routed to the CBD-233 owner). */
export interface AcknowledgedDisclosure { readonly kind: string; readonly version: number }
