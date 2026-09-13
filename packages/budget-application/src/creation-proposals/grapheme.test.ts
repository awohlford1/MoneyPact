import assert from "node:assert/strict";
import { test } from "node:test";
import { createOrRegenerateProposal } from "./application.ts";
import { testAuthContext, testPorts } from "./support.ts";
void test("CBD-233 section 8 counts graphemes and versions incompatible proposals", async () => {
  for (const [length, expected] of [[100, "created"], [101, "validation_failed"]] as const) {
    const result = await createOrRegenerateProposal({ subjectContext: testAuthContext(), idempotencyKeyHeader: "4444444444444444",
      body: { name: "\u{1f468}\u200d\u{1f469}\u200d\u{1f467}\u200d\u{1f466}".repeat(length), timeZone: "America/New_York", currencyCode: "USD", schedule: { cadence: "weekly", anchor: "monday" } } }, testPorts());
    assert.equal(result.kind, expected);
    if (result.kind === "created") assert.equal(result.response.governingVersions.proposalContractVersion, "cbd-232/0.2.1-grapheme");
  }
});
