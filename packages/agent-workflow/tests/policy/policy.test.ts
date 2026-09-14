import assert from "node:assert/strict";
import test from "node:test";
import defaults from "../../defaults/config.json" with { type: "json" };
import { assessMateriality } from "../../src/policy/index.ts";
import { grantApproval, requestApproval, validateApproval } from "../../src/approvals/index.ts";
import type { FrameworkConfiguration } from "../../src/contracts/configuration.ts";

const executive = { actorId: "executive-1", actorType: "executive" as const };

test("materiality distinguishes delegated, material, cumulative, and ambiguous changes", () => {
  const config = (defaults as FrameworkConfiguration).materiality;
  assert.equal(assessMateriality({ paths: ["implementation.details"], rationale: "refactor", priorNonmaterialChangeCount: 0 }, config).classification, "nonmaterial");
  assert.equal(assessMateriality({ paths: ["security.authentication"], rationale: "replace auth", priorNonmaterialChangeCount: 0 }, config).classification, "material");
  assert.equal(assessMateriality({ paths: ["implementation.details"], rationale: "third accumulated change", priorNonmaterialChangeCount: 2 }, config).code, "CUMULATIVE_MATERIALITY_THRESHOLD");
  assert.equal(assessMateriality({ paths: ["unknown.path"], rationale: "unclear", priorNonmaterialChangeCount: 0 }, config).classification, "ambiguous");
});

test("approval is bound to exact subject, scope, and revision", () => {
  const requested = requestApproval({ approvalId: "apr-1", subjectType: "plan", subjectId: "pln-1", subjectRevision: 1, scope: "execute", approver: executive });
  const granted = grantApproval(requested, executive);
  assert.equal(validateApproval(granted, { type: "plan", id: "pln-1", revision: 1, scope: "execute" }).allowed, true);
  assert.equal(validateApproval(granted, { type: "plan", id: "pln-2", revision: 1, scope: "execute" }).code, "APPROVAL_SCOPE_MISMATCH");
  assert.equal(validateApproval(granted, { type: "plan", id: "pln-1", revision: 2, scope: "execute" }).code, "APPROVAL_REVISION_MISMATCH");
});
