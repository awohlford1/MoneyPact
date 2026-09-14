import { ApiError } from "./client.ts";
import type { CreationState, Draft, ProposalApi, Proposal } from "./proposals.ts";

function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
/** Key-order-independent equality: the API stores the proposal as jsonb, so a re-read returns the same values with a different key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export function sameProposal(left: Proposal, right: Proposal): boolean { return canonical(left) === canonical(right); }
/** Every draft edit invalidates synchronously, before an asynchronous request can resolve. */
export class CreationController {
  private state: CreationState;
  private listeners = new Set<() => void>();
  private generation = 0;
  private abort?: AbortController;
  private confirmationKey?: string;
  private predecessor?: string;
  private subject: string;
  private api: ProposalApi;
  private now: () => number;
  private key: () => string;
  constructor(api: ProposalApi, draft: Draft, subject: string, now = Date.now, key: () => string = () => crypto.randomUUID()) {
    this.api = api; this.now = now; this.key = key;
    this.subject = subject;
    this.state = { stage: "draft", draft, rendered: false, acknowledged: false, errors: [], message: "" };
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(next: CreationState) { this.state = next; this.listeners.forEach((listener) => listener()); }
  edit(draft: Draft) {
    if (this.state.stage === "confirming") return;
    this.generation++;
    this.abort?.abort();
    this.predecessor = this.state.proposal?.proposalId ?? this.predecessor;
    this.confirmationKey = undefined;
    // An edit invalidates the acknowledgement with the review it was given against.
    this.publish({ stage: "draft", draft, rendered: false, acknowledged: false, errors: [], message: "Review the updated schedule before creating your budget." });
  }
  dispose() {
    this.generation++; this.abort?.abort();
    // Next may preserve hidden route state for back/forward navigation.
    // Never retain a review or binding when the route's effects are disconnected.
    this.confirmationKey = undefined;
    this.publish({ stage: "draft", draft: this.state.draft, rendered: false, acknowledged: false, errors: [], message: "Review your schedule again before creating your budget." });
  }
  async preview() {
    const generation = ++this.generation;
    this.abort?.abort();
    this.abort = new AbortController();
    const draft = structuredClone(this.state.draft);
    this.publish({ stage: "loading", draft, rendered: false, acknowledged: false, errors: [], message: "Preparing your schedule…" });
    try {
      const proposal = freeze(structuredClone(await this.api.createProposal(draft, this.key(), this.predecessor, this.abort.signal)));
      if (generation !== this.generation) return;
      if (proposal.preview.periods.length < 4 || proposal.preview.periodCount !== proposal.preview.periods.length || proposal.preview.periods[0]?.relation !== "current" || !Number.isFinite(Date.parse(proposal.expiresAt)) || Date.parse(proposal.expiresAt) <= this.now()) throw new ApiError(502, "invalid_preview");
      this.predecessor = proposal.proposalId;
      // A new proposal needs a new Idempotency-Key: reusing the old key with a different proposalId is a CBD-233 idempotency_key_reused conflict.
      this.confirmationKey = undefined;
      this.publish({ stage: "review", draft, proposal, rendered: false, acknowledged: false, errors: [], message: "Review your complete current period and the next three periods." });
    } catch (error) {
      if (generation !== this.generation) return;
      this.publish({ stage: "error", draft, rendered: false, acknowledged: false, errors: error instanceof ApiError ? error.fieldErrors : [], message: "We could not prepare this schedule. Check the fields and try again." });
    }
  }
  rendered(id: string, subject: string) {
    if (this.state.stage !== "review" || this.state.rendered || this.state.proposal?.proposalId !== id || subject !== this.subject || this.expired()) return;
    this.publish({ ...this.state, rendered: true });
  }
  /**
   * CBD-236: the explicit acknowledgement of the disclosure the server sent with this review. It is
   * given against one disclosure version, so a review whose disclosure differs drops it, and every
   * edit and every new preview drops it too.
   */
  acknowledge(acknowledged: boolean) {
    if (this.state.stage !== "review") return;
    this.publish({ ...this.state, acknowledged });
  }
  expired() { return !this.state.proposal || this.now() >= Date.parse(this.state.proposal.expiresAt); }
  canConfirm() { return this.state.stage === "review" && this.state.rendered && this.state.acknowledged && !this.expired(); }
  async revalidate() {
    if (this.state.stage !== "review") return;
    const generation = this.generation;
    const reviewed = this.state.proposal!;
    this.publish({ ...this.state, rendered: false });
    try {
      const read = await this.api.readProposal(reviewed.proposalId, this.abort?.signal);
      if (generation !== this.generation) return;
      if (read.lifecycle.status !== "previewed" || this.expired() || !sameProposal(read.proposal, reviewed)) {
        this.edit(this.state.draft);
        await this.preview();
      } else this.publish({ ...this.state, acknowledged: this.state.acknowledged && read.proposal.currentDisclosure.version === reviewed.currentDisclosure.version
        && read.proposal.currentDisclosure.kind === reviewed.currentDisclosure.kind, proposal: freeze(structuredClone(read.proposal)) });
    } catch {
      if (generation === this.generation) this.edit(this.state.draft);
    }
  }
  async confirm(subject: string) {
    if (!this.canConfirm() || subject !== this.subject) return;
    const generation = this.generation;
    const reviewed: Proposal = this.state.proposal!;
    this.publish({ ...this.state, stage: "confirming", rendered: false, message: "Creating your budget…" });
    try {
      const read = await this.api.readProposal(reviewed.proposalId);
      if (generation !== this.generation) return;
      if (read.lifecycle.status !== "previewed" || this.expired() || !sameProposal(read.proposal, reviewed)) {
        this.publish({ ...this.state, stage: "review" });
        this.edit(this.state.draft);
        await this.preview();
        return;
      }
      this.confirmationKey ??= this.key();
      // The acknowledged disclosure is a claim the server re-checks against the approved registry; a
      // superseded one is denied `stale_disclosure` and nothing is written.
      const result = await this.api.confirmProposal(reviewed.proposalId, reviewed.confirmationBinding, this.confirmationKey,
        { kind: reviewed.currentDisclosure.kind, version: reviewed.currentDisclosure.version });
      if (generation !== this.generation) return;
      this.publish({ ...this.state, stage: "complete", proposal: undefined, acknowledged: false, message: "Your budget is ready." });
      return result;
    } catch (error) {
      if (generation !== this.generation) return;
      if (error instanceof ApiError && ["confirmation_stale", "proposal_not_current", "stale_disclosure"].includes(error.code)) {
        this.publish({ ...this.state, stage: "review" }); this.edit(this.state.draft); await this.preview();
      } else this.publish({ ...this.state, stage: "error", proposal: undefined, message: "We could not confirm the result. Check your budgets before trying again." });
    }
  }
}
