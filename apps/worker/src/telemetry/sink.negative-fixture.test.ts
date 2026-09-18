/**
 * CBD-262-AC01 negative fixture: a `ReliabilityEvent` (and therefore a
 * `ReliabilitySink` call) carrying a field outside the closed
 * `ReliabilityEvent` type must fail at compile time.
 *
 * `@ts-expect-error` asserts the next statement is a type error. If
 * `ReliabilityEvent` (`packages/contracts/src/telemetry/reliability-event.ts`)
 * is ever widened with an index signature or a catch-all field, these lines
 * stop being errors, the unused `@ts-expect-error` directives themselves
 * become type errors, and `npm run typecheck` fails -- so the fixture proves
 * the closed type by construction, the same technique
 * `packages/data-access/src/tenant.negative-fixture.test.ts` already uses
 * for tenant scoping.
 *
 * This file contains no runnable assertions; it exists to be type-checked.
 * `node --test` (via `tsx`) only executes it because the type-stripping
 * runtime erases the `@ts-expect-error` comment as a plain comment at
 * execution time, so it is harmless at runtime and load-bearing only at
 * `tsc --noEmit`.
 */
import { test } from "node:test";

import type { ReliabilityEvent } from "@cobudget/contracts/telemetry";

import type { ReliabilitySink } from "./sink.ts";

void test("CBD-262-AC01 negative fixture: an extra field on a ReliabilityEvent fails the type check (compile-time)", () => {
  // @ts-expect-error CBD-262-AC01: ReliabilityEvent has no field for a request path (the excess-property error lands on this line, not the declaration, so the directive must sit directly above the whole literal).
  const withExtraField: ReliabilityEvent = { service: "api", version: "abc123", operation: "request", outcome: "ok", path: "/budgets/42" };
  void withExtraField;
});

void test("CBD-262-AC01 negative fixture: a sink cannot be invoked with anything wider than ReliabilityEvent (compile-time)", () => {
  const sink: ReliabilitySink = () => undefined;
  // @ts-expect-error CBD-262-AC01: the sink's only parameter type is ReliabilityEvent; it has no field for a message.
  sink({ service: "api", version: "abc123", operation: "request", outcome: "ok", message: "smuggled" });
});
