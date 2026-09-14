import assert from "node:assert/strict";
import test from "node:test";
import { canTransition, transitionRegistries, WorkflowTransitionError } from "../../src/workflows/index.ts";

for (const [resource, table] of Object.entries(transitionRegistries)) {
  const states = Object.keys(table);
  for (const from of states) for (const to of states) {
    const expected = (table as Record<string, readonly string[]>)[from]!.includes(to);
    test(`${resource}: ${from} -> ${to} is ${expected ? "allowed" : "forbidden"}`, () => {
      assert.equal(canTransition(table as never, from as never, to as never), expected);
      if (!expected) assert.ok(new WorkflowTransitionError(resource, from, to).message.includes(from));
    });
  }
}
