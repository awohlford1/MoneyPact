import type { ReliabilityEvent } from "@cobudget/contracts/telemetry";

/**
 * CBD-262-AC01: the only sink interface the S1 telemetry pipeline exposes.
 * `ReliabilitySink`'s sole parameter type is the closed `ReliabilityEvent`
 * from `@cobudget/contracts/telemetry` (CBD-109) -- there is no overload and
 * no second parameter through which a wider value could pass.
 *
 * Both apps/api and apps/worker import this file byte-for-byte (see
 * `parity.test.ts`), the same convention `apps/*\/src/authorization` already
 * uses for shared enforcement code (see its `inventory.test.ts` "prevents
 * drift" check), so the two deployment units cannot drift on what a sink is
 * allowed to accept.
 *
 * This module deliberately has no live destination. The CBD-262 ticket note
 * is explicit that "the provider binding of the sink arrives with CBD-263";
 * wiring this type to a queue, HTTP client, or file is that ticket's job,
 * not a gap left here.
 */
export type ReliabilitySink = (event: ReliabilityEvent) => void;
