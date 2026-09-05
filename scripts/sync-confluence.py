#!/usr/bin/env python3
"""Legacy target registry, converter and read-only preview tool.

CBD-115 retires manual writes. Use the protected-main publication workflow;
activation, approval and recovery instructions are in scripts/PUBLICATION.md.
The registry and converter remain here for existing audit consumers.

    python scripts/sync-confluence.py --list
    python scripts/sync-confluence.py --dry-run --set cbd-69

Dry runs require Markdown and requests, read current Confluence metadata and
write local .confluence-preview files. They load validated operator values from
the environment, then untracked .env.local. They never publish. The automated
publisher does not use this credential loader, preview path or text normalizer.
"""

from __future__ import annotations

import argparse
import html
import importlib
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from tool_config import ConfigurationError, load_tool_config


def require(name: str):
    """Import a publish-time dependency, with installation guidance if absent.

    These are imported where they are used rather than at module level so the
    TARGETS table can be read by tooling that only needs the page-to-file map.
    `scripts/check-jira-freshness.py` does exactly that, and runs in CI where
    neither package is installed.
    """
    if name not in ("markdown", "requests"):
        sys.exit("Unsupported publisher dependency.")
    try:
        return importlib.import_module(name)
    except ImportError:  # pragma: no cover - dependency guidance
        sys.exit(f"Missing dependency: {name}. Run: pip install markdown requests")


REPO_ROOT = Path(__file__).resolve().parent.parent
PREVIEW_DIR = REPO_ROOT / ".confluence-preview"

# A ```mermaid fence publishes as a code block. This is a decision, not a gap.
#
# The "Mermaid Diagrams for Confluence" app installed here (macro key
# `mermaid-cloud`) does not read a diagram from the macro body. It keeps two
# page attachments per diagram — an extensionless file holding the mermaid
# source, and a sibling `.png` of the rendered image — and the macro carries
# only `filename`, `toolbar`, `zoom` and `revision` pointing at that pair. The
# PNG is produced by the app's renderer in the browser when someone edits the
# macro, so a server-side publisher cannot generate it.
#
# Publishing the macro with the source in `ac:plain-text-body` was tried on
# 2026-08-16: Confluence accepted the macro, silently discarded the body, and
# CBD-92 section 4 published as four empty diagrams with the source lost from
# the page. Code blocks keep the source readable and are the approved behavior
# per the Product Owner decision that day. Diagrams render from the same
# markdown on GitHub.
#
# Reviving macro output requires uploading both attachments per diagram and
# solving the browser-side render, not a flag.
MERMAID_FENCE = re.compile(r"^```mermaid[ \t]*\n(.*?)^```[ \t]*$", re.MULTILINE | re.DOTALL)


@dataclass(frozen=True)
class Target:
    key: str
    doc_set: str
    page_id: str
    expected_title: str
    path: str
    baseline: bool = False
    """True when a later target cites this document as a frozen source baseline.

    A failure on a baseline target halts the run, so a citing document can never
    publish while the source it cites failed to publish. CBD-71 §2 cites the
    CBD-69 package and the Future Feature Register; CBD-91 cites the CBD-72
    permission model and traceability record.
    """

    @property
    def file(self) -> Path:
        return REPO_ROOT / self.path


# Dependency order matters. CBD-71 §2 cites both the CBD-69 package and the
# Future Feature Register as frozen source baselines, so both publish first.
# CBD-72 then publishes before CBD-91, which cites its closed decisions, and
# CBD-91 before CBD-92, which CBD-93 in turn consumes.
TARGETS: tuple[Target, ...] = (
    # CBD-67, CBD-68, and CBD-70 were published by hand before this script
    # existed and were registered on September 4, 2026 so that the pages are
    # guarded from then on. Their content matched the repository at
    # registration, so the first run republishes identical text. They publish
    # first because CBD-71 consolidates their decisions; none is a baseline,
    # since CBD-71 §2 names the CBD-69 package and the Future Feature Register
    # as its frozen sources rather than these. Two CBD-70 documents carry a
    # v1.1 synchronization-review draft status in both places; publishing them
    # reproduces that state and does not approve it.
    Target(
        key="cbd-67-specification",
        doc_set="cbd-67",
        page_id="655361",
        expected_title="CBD-67 — Weekly and Monthly Budget Cycle Workflow Specification",
        path="docs/cbd-67-weekly-monthly-cadence-workflow-specification.md",
    ),
    Target(
        key="cbd-67-scenarios",
        doc_set="cbd-67",
        page_id="688129",
        expected_title="CBD-67 — Weekly and Monthly Cadence Scenario Catalog",
        path="docs/cbd-67-weekly-monthly-cadence-scenario-catalog.md",
    ),
    Target(
        key="cbd-67-traceability",
        doc_set="cbd-67",
        page_id="720897",
        expected_title="CBD-67 — Acceptance Criteria Traceability and Review Record",
        path="docs/cbd-67-acceptance-criteria-traceability.md",
    ),
    Target(
        key="cbd-68-specification",
        doc_set="cbd-68",
        page_id="3735553",
        expected_title="CBD-68 — Paycheck and Custom Budget Cadence Workflow Specification",
        path="docs/cbd-68-paycheck-custom-cadence-workflow-specification.md",
    ),
    Target(
        key="cbd-68-scenarios",
        doc_set="cbd-68",
        page_id="3342349",
        expected_title="CBD-68 — Paycheck and Custom Cadence Scenario Catalog",
        path="docs/cbd-68-paycheck-custom-cadence-scenario-catalog.md",
    ),
    Target(
        key="cbd-68-traceability",
        doc_set="cbd-68",
        page_id="3768321",
        expected_title="CBD-68 — Acceptance Criteria Traceability and Review Record",
        path="docs/cbd-68-acceptance-criteria-traceability.md",
    ),
    Target(
        key="cbd-70-calendar-examples",
        doc_set="cbd-70",
        page_id="6062090",
        expected_title="CBD-70 — Deterministic Calendar Example Set",
        path="docs/cbd-70-calendar-example-set.md",
    ),
    Target(
        key="cbd-70-scenarios",
        doc_set="cbd-70",
        page_id="6422529",
        expected_title="CBD-70 — Deterministic Budget Calendar and Financial Scenario Catalog",
        path="docs/cbd-70-scenario-catalog.md",
    ),
    Target(
        key="cbd-70-traceability",
        doc_set="cbd-70",
        page_id="6225922",
        expected_title="CBD-70 — Acceptance Criteria Traceability and Review Record",
        path="docs/cbd-70-acceptance-criteria-traceability.md",
    ),
    Target(
        key="cbd-69-specification",
        doc_set="cbd-69",
        page_id="3538946",
        expected_title="CBD-69 — Period Edge Cases & Validation Rule Specification",
        path="docs/cbd-69-period-edge-cases-validation-rule-specification.md",
        baseline=True,
    ),
    Target(
        key="cbd-69-scenarios",
        doc_set="cbd-69",
        page_id="3571722",
        expected_title="CBD-69 — Period Edge Case Scenario Catalog",
        path="docs/cbd-69-period-edge-case-scenario-catalog.md",
        baseline=True,
    ),
    Target(
        key="cbd-69-traceability",
        doc_set="cbd-69",
        page_id="3670026",
        expected_title="CBD-69 — Acceptance Criteria Traceability",
        path="docs/cbd-69-acceptance-criteria-traceability.md",
        baseline=True,
    ),
    Target(
        key="future-feature-register",
        doc_set="cross-cutting",
        page_id="950274",
        expected_title="CoBudget Future Feature Register",
        path="docs/cobudget-future-feature-register.md",
        baseline=True,
    ),
    Target(
        key="cbd-71-register",
        doc_set="cbd-71",
        page_id="6914050",
        expected_title="CBD-71 — MVP Schedule Decisions",
        path="docs/cbd-71-mvp-schedule-decision-register.md",
    ),
    Target(
        key="cbd-71-checklist",
        doc_set="cbd-71",
        page_id="6160404",
        expected_title="CBD-71 — MVP Schedule Decisions Validation Checklist",
        path="docs/cbd-71-validation-checklist.md",
    ),
    Target(
        key="cbd-71-traceability",
        doc_set="cbd-71",
        page_id="6782985",
        expected_title="CBD-71 — Acceptance Criteria Traceability and Review Record",
        path="docs/cbd-71-acceptance-criteria-traceability.md",
    ),
    # CBD-72 inherits CBD-71 v1.1 under its closed decision OD-72-06, so it
    # publishes after CBD-71. The permission model and the traceability record
    # are baselines: CBD-91 §1 and §8 cite the model's closed OD-72 decisions,
    # and CBD-91 v1.0.1 additionally cites RF-72-61, which lives in the
    # traceability record. The scenario catalog is not a baseline because no
    # later target cites it.
    Target(
        key="cbd-72-model",
        doc_set="cbd-72",
        page_id="8880130",
        expected_title="CBD-72 — Collaboration Permission Model",
        path="docs/cbd-72-collaboration-permission-model.md",
        baseline=True,
    ),
    Target(
        key="cbd-72-scenarios",
        doc_set="cbd-72",
        page_id="8880151",
        expected_title="CBD-72 — Authorization Scenario Catalog",
        path="docs/cbd-72-authorization-scenario-catalog.md",
    ),
    Target(
        key="cbd-72-traceability",
        doc_set="cbd-72",
        page_id="8880172",
        expected_title="CBD-72 — Acceptance Criteria Traceability and Review Record",
        path="docs/cbd-72-acceptance-criteria-traceability.md",
        baseline=True,
    ),
    # CBD-91 cites the approved CBD-71 v1.1 decision set and the closed CBD-72
    # decisions as its controlling inputs, so it publishes after both. It is
    # itself a baseline because CBD-93 §1 and §12 cite the v1.0.1 inventory as
    # the authoritative input its whole analysis is built on.
    Target(
        key="cbd-91-inventory",
        doc_set="cbd-91",
        page_id="8781826",
        expected_title="CBD-91 — Private MVP Data Inventory",
        path="docs/cbd-91-private-mvp-data-inventory.md",
        baseline=True,
    ),
    # CBD-92 consumes the CBD-91 inventory and the approved CBD-72 decisions, so
    # it publishes after both. The technical model is a baseline because CBD-93
    # consumes its approved SA/CA/CL/PA/NT/EM/OP/AN/RL contracts and cites its
    # threat register throughout. The traceability record is not a baseline
    # because no later document cites it.
    Target(
        key="cbd-92-threat-model",
        doc_set="cbd-92",
        page_id="8945669",
        expected_title="CBD-92 — System Flow, Trust Boundary, and Technical Threat Model",
        path="docs/cbd-92-system-flow-technical-threat-model.md",
        baseline=True,
    ),
    Target(
        key="cbd-92-traceability",
        doc_set="cbd-92",
        page_id="8945690",
        expected_title="CBD-92 — Acceptance Criteria Traceability and Review Record",
        path="docs/cbd-92-acceptance-criteria-traceability.md",
    ),
    # CBD-93 consumes the CBD-91 inventory, the CBD-72 permission model, and the
    # CBD-92 contracts, so it publishes before CBD-94. It is a baseline because
    # CBD-94 §2 freezes its v1.1 blob and routes all 86 AB-93 scenarios, 96
    # active SG-93 safeguards, EG-93-001–010, and RI-93-001–019 from it.
    Target(
        key="cbd-93-abuse-analysis",
        doc_set="cbd-93",
        page_id="8749076",
        expected_title="CBD-93 — Privacy, Coercion, Surveillance, and Abuse-Case Analysis",
        path="docs/cbd-93-privacy-coercion-abuse-analysis.md",
        baseline=True,
    ),
    # CBD-94 consumes the frozen CBD-91 v1.0.1, CBD-92 v1.0, and CBD-93 v1.1
    # blobs listed in its §2 source baseline, so the whole set publishes after
    # them. Within the set the order follows the header citations: the register
    # is cited by the inventory's "Governing register" field and the
    # traceability record's "Primary evidence" field; the inventory is cited by
    # "Verification evidence"; the findings record is cited by "Independent
    # review". The traceability record therefore publishes last and is not a
    # baseline, since nothing cites it. This mirrors the CBD-92 arrangement.
    #
    # These four pages were created as placeholders on August 16, 2026 to
    # reserve the targets; the first successful run replaces that placeholder
    # text with the merged v1.0 content. Until then the repository files are
    # authoritative, per traceability record RV-94-019.
    Target(
        key="cbd-94-register",
        doc_set="cbd-94",
        page_id="9601026",
        expected_title="CBD-94 — Risk, Mitigation, and Security/Privacy Requirement Register",
        path="docs/cbd-94-risk-mitigation-requirement-register.md",
        baseline=True,
    ),
    Target(
        key="cbd-94-verification-inventory",
        doc_set="cbd-94",
        page_id="9535490",
        expected_title="CBD-94 — Verification, Negative-Test, and Specialist-Review Inventory",
        path="docs/cbd-94-verification-review-inventory.md",
        baseline=True,
    ),
    Target(
        key="cbd-94-review-findings",
        doc_set="cbd-94",
        page_id="9633793",
        expected_title="CBD-94 — Exhaustive Review Findings",
        path="docs/cbd-94-exhaustive-review-findings.md",
        baseline=True,
    ),
    Target(
        key="cbd-94-traceability",
        doc_set="cbd-94",
        page_id="9273364",
        expected_title="CBD-94 — Acceptance Criteria Traceability and Review Record",
        path="docs/cbd-94-acceptance-criteria-traceability.md",
    ),
    # CBD-95 consolidates the frozen CBD-91 through CBD-94 blobs recorded in its
    # manifest §2, so the whole set publishes after them. Within the set the
    # order follows the header citations: the matrix names the manifest as its
    # "Governing package"; the register names both the manifest and the matrix;
    # the traceability record cites all three as deliverable evidence. The
    # traceability record therefore publishes last and is not a baseline, since
    # nothing cites it. This mirrors the CBD-92 and CBD-94 arrangements.
    #
    # The execution plan is deliberately not a target. It is working material
    # rather than a CBD-95 deliverable: the plan's own §4 lists the manifest,
    # matrix, register, traceability record, and audit script as the artifacts,
    # and CBD-94 likewise published no plan.
    #
    # These four pages were created as placeholders on August 16, 2026 to
    # reserve the targets; the first successful run replaces that placeholder
    # text with the merged approved content. Until then the repository files on
    # `main` are authoritative.
    Target(
        key="cbd-95-manifest",
        doc_set="cbd-95",
        page_id="9797633",
        expected_title="CBD-95 — Threat-Model and Data-Inventory Package Manifest",
        path="docs/cbd-95-threat-model-package-manifest.md",
        baseline=True,
    ),
    Target(
        key="cbd-95-reconciliation-matrix",
        doc_set="cbd-95",
        page_id="9830401",
        expected_title="CBD-95 — CBD-12 Security and Privacy Reconciliation Matrix",
        path="docs/cbd-95-cbd-12-reconciliation-matrix.md",
        baseline=True,
    ),
    Target(
        key="cbd-95-follow-up-register",
        doc_set="cbd-95",
        page_id="9863169",
        expected_title="CBD-95 — Architecture, Roadmap, and Follow-up Register",
        path="docs/cbd-95-architecture-roadmap-follow-up-register.md",
        baseline=True,
    ),
    Target(
        key="cbd-95-traceability",
        doc_set="cbd-95",
        page_id="9895937",
        expected_title="CBD-95 — Acceptance Criteria Traceability and Review Record",
        path="docs/cbd-95-acceptance-criteria-traceability.md",
    ),
    # CBD-73 consumes the approved CBD-72 permission model, the CBD-71 v1.1
    # schedule decisions, the CBD-91 data classes, and the CBD-94
    # SR-94-007–SR-94-011 requirements, so it publishes after those sets.
    # Within the set the order follows the header citations: the lifecycle
    # specification is cited by every other document's "Governing
    # specification" field, the message and test inventories are cited by the
    # traceability record's deliverable table, and the findings record is cited
    # by its "Independent review" field. The traceability record therefore
    # publishes last and is not a baseline, since nothing cites it.
    #
    # These five pages were created as placeholders on August 18, 2026 to
    # reserve the targets; the first successful run replaces that placeholder
    # text with the merged approved v1.0 content. Until then the repository
    # files on `main` are authoritative, per OI-73-007.
    Target(
        key="cbd-73-specification",
        doc_set="cbd-73",
        page_id="11370497",
        expected_title="CBD-73 — Invitation, Consent, and Revocation Lifecycle Specification",
        path="docs/cbd-73-invitation-consent-lifecycle-specification.md",
        baseline=True,
    ),
    Target(
        key="cbd-73-message-inventory",
        doc_set="cbd-73",
        page_id="11403265",
        expected_title="CBD-73 — Customer-Facing Message Inventory",
        path="docs/cbd-73-customer-message-inventory.md",
        baseline=True,
    ),
    Target(
        key="cbd-73-test-inventory",
        doc_set="cbd-73",
        page_id="11436033",
        expected_title="CBD-73 — Negative and Recovery Test Inventory",
        path="docs/cbd-73-negative-recovery-test-inventory.md",
        baseline=True,
    ),
    Target(
        key="cbd-73-review-findings",
        doc_set="cbd-73",
        page_id="11468801",
        expected_title="CBD-73 — Exhaustive Review Findings",
        path="docs/cbd-73-exhaustive-review-findings.md",
        baseline=True,
    ),
    Target(
        key="cbd-73-traceability",
        doc_set="cbd-73",
        page_id="11403286",
        expected_title="CBD-73 — Acceptance Criteria Traceability and Review Record",
        path="docs/cbd-73-acceptance-criteria-traceability.md",
    ),
    # CBD-74 consumes the CBD-72 permission model and the CBD-73 lifecycle, and
    # CBD-75 consumes CBD-72 through CBD-74, so both publish after CBD-73. The
    # CBD-74 specification and the CBD-75 standard are baselines because the
    # CBD-76 record cites them as governing collaboration sources; the test
    # inventory and the two traceability records are cited by nothing later.
    # The CBD-75 JSON registers are normative companions and remain repository
    # files, as does the CBD-76 register below.
    #
    # These five pages were created as placeholders on September 4, 2026 to
    # reserve the targets; the first successful run replaces that text with the
    # approved v1.0.1 (CBD-74) and v1.0 (CBD-75) content already merged to main.
    Target(
        key="cbd-74-specification",
        doc_set="cbd-74",
        page_id="18776065",
        expected_title="CBD-74 — Accountability Alert Boundary Specification",
        path="docs/cbd-74-accountability-alert-boundary-specification.md",
        baseline=True,
    ),
    Target(
        key="cbd-74-test-inventory",
        doc_set="cbd-74",
        page_id="18612245",
        expected_title="CBD-74 — Alert Negative and Recovery Test Inventory",
        path="docs/cbd-74-negative-recovery-test-inventory.md",
    ),
    Target(
        key="cbd-74-traceability",
        doc_set="cbd-74",
        page_id="18808833",
        expected_title="CBD-74 — Acceptance Criteria Traceability and Review Record",
        path="docs/cbd-74-acceptance-criteria-traceability.md",
    ),
    Target(
        key="cbd-75-standard",
        doc_set="cbd-75",
        page_id="18841601",
        expected_title="CBD-75 — Role Terminology and Customer-Facing Copy Standard",
        path="docs/cbd-75-role-terminology-and-copy-standard.md",
        baseline=True,
    ),
    Target(
        key="cbd-75-traceability",
        doc_set="cbd-75",
        page_id="18874369",
        expected_title="CBD-75 — Acceptance-Criteria Traceability and Review Record",
        path="docs/cbd-75-acceptance-criteria-traceability.md",
    ),
    # CBD-102 derives its gates from the approved CBD-72 permission model, the
    # CBD-91 inventory, the CBD-92 contract registers, and the architecture
    # security baseline, so the whole set publishes after those.
    #
    # Within the set the ordering rule differs from every set above, and the
    # difference is deliberate rather than an oversight. The CBD-9x sets form an
    # acyclic citation chain, so their order is the citation order. CBD-102 does
    # not: the catalog §2.4 cites the evidence register §3.3 for the UNPROVEN
    # gate outcome, and the evidence register cites catalog gates throughout.
    # The rubric and the demand model are mutually referential the same way,
    # since WR-102-019 scores against the demand model's base tier while the
    # demand model exists to serve the rubric and cost template. No acyclic
    # order exists to follow.
    #
    # The five documents were written and merged as one unit at one version in
    # PR #47, so the order below is reading order — the gates, the rubric that
    # scores what the gates deliberately do not, the demand quantities, the cost
    # structure those quantities feed, and the evidence rules that govern all
    # four. The first four carry baseline=True so that any failure or skip halts
    # the run and the set cannot publish half-way, which is the property that
    # actually matters for a mutually-referential set. The evidence register was
    # not a baseline while nothing published after it; the CBD-103 set now
    # does and cites it, so it carries baseline=True like the other four.
    #
    # These five pages were created as placeholders on August 16, 2026 and were
    # first published from the repository later that day, so they hold real
    # content rather than placeholder text. The Product Owner approved the set
    # at v1.0 on August 18, 2026 after a full audit; this run republishes that
    # approved content.
    Target(
        key="cbd-102-gate-catalog",
        doc_set="cbd-102",
        page_id="9371654",
        expected_title="CBD-102 — Provider Requirements and Hard-Gate Catalog",
        path="docs/cbd-102-provider-requirements-hard-gate-catalog.md",
        baseline=True,
    ),
    Target(
        key="cbd-102-rubric",
        doc_set="cbd-102",
        page_id="9142327",
        expected_title="CBD-102 — Weighted Provider Evaluation Rubric",
        path="docs/cbd-102-provider-evaluation-rubric.md",
        baseline=True,
    ),
    Target(
        key="cbd-102-demand-model",
        doc_set="cbd-102",
        page_id="9273396",
        expected_title="CBD-102 — Private MVP Demand Model",
        path="docs/cbd-102-demand-model.md",
        baseline=True,
    ),
    Target(
        key="cbd-102-cost-template",
        doc_set="cbd-102",
        page_id="9469982",
        expected_title="CBD-102 — Provider Cost Template",
        path="docs/cbd-102-cost-template.md",
        baseline=True,
    ),
    Target(
        key="cbd-102-evidence-register",
        doc_set="cbd-102",
        page_id="9601048",
        expected_title="CBD-102 — Evidence Register and Exception Rules",
        path="docs/cbd-102-evidence-register-and-exception-rules.md",
        baseline=True,
    ),
    # CBD-103 consumes the approved CBD-102 method — its §6 matrix measures
    # against the catalog's gates, its verdicts follow the evidence register
    # §3.3, and its cost record follows the template — so the set publishes
    # after cbd-102, whose evidence register becomes a baseline now that a
    # later set cites it. Within the set the order is the citation order: the
    # topology's TD-103-* decisions are cited by all three others, the
    # evaluation's verdicts and EV-102-* register rows are cited by the
    # operational assessment and the traceability record, and the operational
    # assessment is cited by the traceability record's AC4 and deliverable
    # rows. The traceability record publishes last and is not a baseline,
    # since nothing cites it.
    #
    # These four pages were created as placeholders on August 20, 2026 to
    # reserve the targets; the first successful run replaces that placeholder
    # text with the merged approved v1.0 content.
    Target(
        key="cbd-103-topology",
        doc_set="cbd-103",
        page_id="12320769",
        expected_title="CBD-103 — Hosting and Runtime Topology Specification",
        path="docs/cbd-103-runtime-topology-specification.md",
        baseline=True,
    ),
    Target(
        key="cbd-103-evaluation",
        doc_set="cbd-103",
        page_id="12353537",
        expected_title="CBD-103 — Hosting Candidate Shortlist and Gate Evaluation",
        path="docs/cbd-103-candidate-shortlist-and-gate-evaluation.md",
        baseline=True,
    ),
    Target(
        key="cbd-103-operational",
        doc_set="cbd-103",
        page_id="12320790",
        expected_title="CBD-103 — Deployment, Outage, Support, Cost, and Exit Assessment",
        path="docs/cbd-103-operational-and-cost-assessment.md",
        baseline=True,
    ),
    Target(
        key="cbd-103-traceability",
        doc_set="cbd-103",
        page_id="12386305",
        expected_title="CBD-103 — Acceptance Criteria Traceability and Review Record",
        path="docs/cbd-103-acceptance-criteria-traceability.md",
    ),
    # CBD-105 publishes after CBD-103, which it cites as a frozen source
    # baseline: the recovery posture is built on the TD-103 topology decisions
    # (private networking, KMS custody, environment separation, forward-only
    # migrations, transactional audit), and the evaluation reuses the CBD-103
    # evidence records and inherits its evidence ceiling. It also consumes the
    # approved CBD-102 method and the CBD-91 classification, both already above.
    #
    # Within the set the order follows the header citations. The specification
    # is cited by every other document; the evaluation is cited by the
    # operational assessment and the traceability record; the operational
    # assessment is cited by the traceability record, which nothing cites and
    # which therefore publishes last and is not a baseline.
    #
    # These four pages were created as placeholders on August 21, 2026 to
    # reserve the targets; the first successful run replaces that placeholder
    # text with the merged approved v1.0 content.
    Target(
        key="cbd-105-specification",
        doc_set="cbd-105",
        page_id="12812289",
        expected_title="CBD-105 — Data Protection and Recovery Specification",
        path="docs/cbd-105-data-protection-and-recovery-specification.md",
        baseline=True,
    ),
    Target(
        key="cbd-105-evaluation",
        doc_set="cbd-105",
        page_id="12845057",
        expected_title="CBD-105 — PostgreSQL Candidate Shortlist and Gate Evaluation",
        path="docs/cbd-105-candidate-shortlist-and-gate-evaluation.md",
        baseline=True,
    ),
    Target(
        key="cbd-105-operational",
        doc_set="cbd-105",
        page_id="12877825",
        expected_title="CBD-105 — Capacity, Maintenance, Monitoring, Cost, and Exit Assessment",
        path="docs/cbd-105-operational-and-cost-assessment.md",
        baseline=True,
    ),
    Target(
        key="cbd-105-traceability",
        doc_set="cbd-105",
        page_id="12910593",
        expected_title="CBD-105 — Acceptance Criteria Traceability and Review Record",
        path="docs/cbd-105-acceptance-criteria-traceability.md",
    ),
    # CBD-104 publishes after CBD-103, which it cites as a frozen source
    # baseline: the identity boundary plugs into the TD-103 topology, reuses its
    # evidence records, and inherits the route-A observation authorization
    # recorded against OI-103-008. It cites no CBD-105 document, so its position
    # relative to that set carries no dependency.
    #
    # Within the set the order follows the header citations. The boundary
    # specification is cited by every other document; the evaluation is cited by
    # the assessment and the traceability record; the assessment is cited by the
    # traceability record, which nothing cites and which therefore publishes
    # last and is not a baseline.
    #
    # These four pages were created as placeholders on August 21, 2026 to
    # reserve the targets; the first successful run replaces that placeholder
    # text with the merged approved v1.0 content.
    Target(
        key="cbd-104-specification",
        doc_set="cbd-104",
        page_id="13107201",
        expected_title="CBD-104 — Identity Integration Boundary Specification",
        path="docs/cbd-104-identity-integration-boundary-specification.md",
        baseline=True,
    ),
    Target(
        key="cbd-104-evaluation",
        doc_set="cbd-104",
        page_id="13139969",
        expected_title="CBD-104 — Identity Candidate Shortlist and Gate Evaluation",
        path="docs/cbd-104-candidate-shortlist-and-gate-evaluation.md",
        baseline=True,
    ),
    Target(
        key="cbd-104-operational",
        doc_set="cbd-104",
        page_id="12877849",
        expected_title="CBD-104 — Integration, Outage, Support, Cost, and Exit Assessment",
        path="docs/cbd-104-operational-and-cost-assessment.md",
        baseline=True,
    ),
    Target(
        key="cbd-104-traceability",
        doc_set="cbd-104",
        page_id="13172737",
        expected_title="CBD-104 — Acceptance Criteria Traceability and Review Record",
        path="docs/cbd-104-acceptance-criteria-traceability.md",
    ),
    # CBD-106 publishes after CBD-103 and CBD-104, both of which it cites as
    # frozen source baselines: the send path is a job on the TD-103 outbox
    # behind the TD-103 edge, and ED-106-004 takes a position on the ceremony
    # email ID-104-018 left open. It cites no CBD-105 document, so its position
    # relative to that set carries no dependency.
    #
    # Within the set the order follows the header citations. The boundary
    # specification is cited by every other document; the evaluation is cited
    # by the assessment and the traceability record; the assessment is cited by
    # the traceability record, which nothing cites and which therefore
    # publishes last and is not a baseline.
    #
    # These four pages were created as placeholders on August 21, 2026 to
    # reserve the targets; the first successful run replaces that placeholder
    # text with the merged approved v1.0 content.
    Target(
        key="cbd-106-specification",
        doc_set="cbd-106",
        page_id="13205505",
        expected_title="CBD-106 — Email Delivery and Content Boundary Specification",
        path="docs/cbd-106-email-delivery-and-content-boundary-specification.md",
        baseline=True,
    ),
    Target(
        key="cbd-106-evaluation",
        doc_set="cbd-106",
        page_id="12845090",
        expected_title=(
            "CBD-106 — Transactional Email Candidate Shortlist and Gate Evaluation"
        ),
        path="docs/cbd-106-candidate-shortlist-and-gate-evaluation.md",
        baseline=True,
    ),
    Target(
        key="cbd-106-operational",
        doc_set="cbd-106",
        page_id="13238273",
        expected_title="CBD-106 — Deliverability, Operations, Cost, and Exit Assessment",
        path="docs/cbd-106-operational-and-cost-assessment.md",
        baseline=True,
    ),
    Target(
        key="cbd-106-traceability",
        doc_set="cbd-106",
        page_id="12877869",
        expected_title="CBD-106 — Acceptance Criteria Traceability and Review Record",
        path="docs/cbd-106-acceptance-criteria-traceability.md",
    ),
    # CBD-107 publishes after CBD-103, which it cites as a frozen source
    # baseline: the send path, the edge, the diagnostic boundary and the
    # secret boundary are all TD-103 decisions. It cites no CBD-104, CBD-105
    # or CBD-106 document, so its position relative to those sets carries no
    # dependency.
    #
    # Within the set the order follows the header citations. The boundary
    # specification is cited by every other document; the evaluation is cited
    # by the lifecycle map, the assessment and the traceability record; the
    # lifecycle map is cited by the assessment and the traceability record;
    # the assessment is cited by the traceability record, which nothing cites
    # and which therefore publishes last and is not a baseline.
    #
    # These five pages were created as placeholders on August 21, 2026 to
    # reserve the targets; the first successful run replaces that placeholder
    # text with the merged approved v1.0 content.
    Target(
        key="cbd-107-specification",
        doc_set="cbd-107",
        page_id="13500417",
        expected_title="CBD-107 — Connection and Provenance Boundary Specification",
        path="docs/cbd-107-connection-and-provenance-boundary-specification.md",
        baseline=True,
    ),
    Target(
        key="cbd-107-evaluation",
        doc_set="cbd-107",
        page_id="13533185",
        expected_title=(
            "CBD-107 — Financial-Data Connectivity Candidate Shortlist "
            "and Gate Evaluation"
        ),
        path="docs/cbd-107-candidate-shortlist-and-gate-evaluation.md",
        baseline=True,
    ),
    Target(
        key="cbd-107-lifecycle",
        doc_set="cbd-107",
        page_id="13565953",
        expected_title="CBD-107 — Transaction Lifecycle, Coverage, and Provider-Signal Map",
        path="docs/cbd-107-transaction-lifecycle-and-coverage-map.md",
        baseline=True,
    ),
    Target(
        key="cbd-107-operational",
        doc_set="cbd-107",
        page_id="13303816",
        expected_title="CBD-107 — Connection Operations, Support, Cost, and Exit Assessment",
        path="docs/cbd-107-operational-and-cost-assessment.md",
        baseline=True,
    ),
    Target(
        key="cbd-107-traceability",
        doc_set="cbd-107",
        page_id="13598721",
        expected_title="CBD-107 — Acceptance Criteria Traceability and Review Record",
        path="docs/cbd-107-acceptance-criteria-traceability.md",
    ),
    # CBD-130 publishes after CBD-103, which it cites as a frozen source
    # baseline for the edge, the outbox, the secret boundary and the diagnostic
    # boundary. It cites CBD-106 and CBD-107 only for two open-item
    # cross-references, which are pointers rather than dependencies, so its
    # position relative to those sets carries no ordering requirement.
    #
    # Within the set the order follows the header citations: the boundary
    # specification is cited by every other document; the evaluation by the
    # assessment and the traceability record; the assessment by the
    # traceability record, which nothing cites and which therefore publishes
    # last and is not a baseline.
    #
    # These four pages were created as placeholders on August 21, 2026 to
    # reserve the targets; the first successful run replaces that placeholder
    # text with the merged approved v1.0 content.
    Target(
        key="cbd-130-specification",
        doc_set="cbd-130",
        page_id="13434891",
        expected_title="CBD-130 — Push and SMS Delivery Boundary Specification",
        path="docs/cbd-130-push-and-sms-delivery-boundary-specification.md",
        baseline=True,
    ),
    Target(
        key="cbd-130-evaluation",
        doc_set="cbd-130",
        page_id="13795329",
        expected_title=(
            "CBD-130 — Push and SMS Candidate Shortlist, Gate Evaluation, "
            "and Rubric Scores"
        ),
        path="docs/cbd-130-candidate-shortlist-and-gate-evaluation.md",
        baseline=True,
    ),
    Target(
        key="cbd-130-operational",
        doc_set="cbd-130",
        page_id="13828097",
        expected_title="CBD-130 — Channel Operations, Registration, Cost, and Exit Assessment",
        path="docs/cbd-130-operational-and-cost-assessment.md",
        baseline=True,
    ),
    Target(
        key="cbd-130-traceability",
        doc_set="cbd-130",
        page_id="13860865",
        expected_title="CBD-130 — Acceptance Criteria Traceability and Review Record",
        path="docs/cbd-130-acceptance-criteria-traceability.md",
    ),
    # CBD-76 consolidates approved CBD-71 through CBD-75 and CBD-91 through
    # CBD-95 decisions, so it publishes after every set above. Neither page is a
    # baseline: nothing later cites the record, and the traceability report
    # cites the record rather than the reverse. The machine-readable register
    # docs/cbd-76-mvp-boundary-register.json is normative with the record but
    # is not a Confluence page; the record names its repository path.
    #
    # Both pages were created as placeholders on September 4, 2026 to reserve
    # the targets after the package was approved at v1.0 and merged as f7edd90.
    Target(
        key="cbd-76-record",
        doc_set="cbd-76",
        page_id="18612225",
        expected_title="CBD-76 — MVP Boundary and Readiness Record",
        path="docs/cbd-76-mvp-boundary-and-readiness-record.md",
    ),
    Target(
        key="cbd-76-traceability",
        doc_set="cbd-76",
        page_id="18579458",
        expected_title="CBD-76 — Acceptance Criteria Traceability and Completeness Report",
        path="docs/cbd-76-acceptance-criteria-traceability.md",
    ),
    # CBD-108 consumes all six CBD-15 category evaluations and CBD-102's
    # approved rules, so it publishes last of everything above.
    #
    # Registered on September 5, 2026, and the registration itself reverses a
    # standing direction: on September 2 the Product Owner directed that
    # CBD-108 stay unpublished while it was an unapproved draft, and CBD-108
    # section 4.64 recorded that as correct and rule-following. The package was
    # approved at v1.0 on September 5 and the direction was reversed the same
    # day. The earlier direction is not overridden silently -- it is superseded
    # on the record, at CBD-108 section 4.89.
    #
    # No target here is a baseline. Within the set the disposition register is
    # the document the other five describe, but none cites another as a frozen
    # source baseline in the CBD-71 sense, so a failure on one does not have to
    # halt the rest. The six carry one shared version and move together, which
    # is a release property rather than a citation dependency.
    #
    # The six pages were created as placeholders on September 5, 2026 to
    # reserve the targets, after the approval merged as 445adde.
    Target(
        key="cbd-108-disposition",
        doc_set="cbd-108",
        page_id="19955713",
        expected_title="CBD-108 — Provider Set Disposition Register",
        path="docs/cbd-108-provider-set-disposition-register.md",
    ),
    Target(
        key="cbd-108-coherence",
        doc_set="cbd-108",
        page_id="19660815",
        expected_title="CBD-108 — Cross-Category Coherence Review",
        path="docs/cbd-108-cross-category-coherence-review.md",
    ),
    Target(
        key="cbd-108-cost",
        doc_set="cbd-108",
        page_id="19988481",
        expected_title="CBD-108 — Combined Cost Model",
        path="docs/cbd-108-combined-cost-model.md",
    ),
    Target(
        key="cbd-108-carried",
        doc_set="cbd-108",
        page_id="19660835",
        expected_title="CBD-108 — Carried Item Disposition Register",
        path="docs/cbd-108-carried-item-disposition-register.md",
    ),
    Target(
        key="cbd-108-retrieval",
        doc_set="cbd-108",
        page_id="19660855",
        expected_title="CBD-108 — Evidence Retrieval Pass",
        path="docs/cbd-108-evidence-retrieval-pass.md",
    ),
    Target(
        key="cbd-108-traceability",
        doc_set="cbd-108",
        page_id="20021249",
        expected_title=(
            "CBD-108 — Acceptance Criteria Traceability and Review Record"
        ),
        path="docs/cbd-108-acceptance-criteria-traceability.md",
    ),
)


def load_env_file() -> dict[str, str]:
    """Read `.env.local` if present. Values are returned, never logged.

    `docs/development.md` places secrets in an untracked `.env.local`, so an
    operator who followed that guidance should not also have to export the same
    values into the shell. Environment variables still win, which keeps CI and
    one-off overrides working.
    """
    path = REPO_ROOT / ".env.local"
    if not path.is_file():
        return {}
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def session_from_env() -> tuple[requests.Session, str]:
    try:
        config = load_tool_config("confluence", load_env_file())
    except ConfigurationError as error:
        sys.exit(str(error))

    requests = require("requests")
    session = requests.Session()
    session.auth = (config["CONFLUENCE_EMAIL"], config["CONFLUENCE_API_TOKEN"])
    session.headers.update({"Accept": "application/json"})
    return session, config["CONFLUENCE_BASE_URL"]


def to_storage(markdown_text: str) -> str:
    """Convert repository markdown to Confluence storage format.

    Confluence storage is XHTML. `markdown` with the table and fenced-code
    extensions produces the subset these documents need: headings, paragraphs,
    tables, lists, inline code, bold, and links. A ```mermaid fence becomes a
    code block; see the MERMAID_FENCE comment for why that is the decision.
    """
    markdown = require("markdown")
    rendered = markdown.markdown(
        markdown_text,
        extensions=["tables", "fenced_code", "sane_lists", "attr_list"],
        output_format="xhtml",
    )
    # Confluence rejects a bare ampersand in storage format.
    return re.sub(r"&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);)", "&amp;", rendered)


def normalize(text: str) -> str:
    """Collapse a page to comparable text so a read-back can be verified.

    CDATA content is held aside before tags are stripped. Confluence stores a
    code-macro body as CDATA, and that body is literal text that may contain
    `<`, `>` or `-->`; stripping tags over it consumes from the CDATA opener to
    the first `>` inside the code and leaves the read-back comparing two equally
    damaged projections rather than the content it is supposed to verify. That
    matters most for the documents whose diagrams publish as code blocks.
    """
    literals: list[str] = []

    def hold(match: re.Match[str]) -> str:
        literals.append(match.group(1))
        return f" \x01{len(literals) - 1}\x01 "

    text = re.sub(r"<!\[CDATA\[(.*?)\]\]>", hold, text, flags=re.DOTALL)
    stripped = re.sub(r"<[^>]+>", " ", text)
    collapsed = re.sub(r"\s+", " ", html.unescape(stripped)).strip()
    for index, literal in enumerate(literals):
        collapsed = collapsed.replace(f"\x01{index}\x01", re.sub(r"\s+", " ", literal).strip())
    return collapsed


def fetch_page(session: requests.Session, base: str, page_id: str) -> dict:
    response = session.get(
        f"{base}/wiki/api/v2/pages/{page_id}",
        params={"body-format": "storage"},
        timeout=30,
    )
    response.raise_for_status()
    return response.json()


def publish(session: requests.Session, base: str, target: Target, storage: str, version: int, title: str) -> None:
    raise RuntimeError("Manual publication is disabled; use the protected-main CBD-115 workflow.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="convert and write previews without publishing")
    parser.add_argument("--only", metavar="KEY", help="preview a single target by key")
    parser.add_argument("--set", metavar="DOC_SET", dest="doc_set", help="preview one document set, e.g. cbd-69")
    parser.add_argument("--list", action="store_true", help="list targets and exit")
    args = parser.parse_args()

    if args.list:
        for target in TARGETS:
            print(f"{target.key:24} {target.doc_set:8} page {target.page_id:9} {target.path}")
        return 0

    selected = [
        target
        for target in TARGETS
        if (not args.only or target.key == args.only) and (not args.doc_set or target.doc_set == args.doc_set)
    ]
    if not selected:
        sys.exit("No targets matched. Use --list to see available keys.")

    if not args.dry_run:
        sys.exit("Manual publication is disabled. Use the protected-main CBD-115 workflow after approval.")
    session, base = session_from_env()
    if args.dry_run:
        PREVIEW_DIR.mkdir(exist_ok=True)

    failures = 0
    for target in selected:
        if not target.file.exists():
            print(f"FAIL {target.key}: missing {target.path}")
            failures += 1
            continue

        source = target.file.read_text(encoding="utf-8")
        storage = to_storage(source)
        diagrams = len(MERMAID_FENCE.findall(source))

        try:
            page = fetch_page(session, base, target.page_id)
        except Exception:  # Remote error details may contain credentials or content.
            print(f"FAIL {target.key}: cannot read page {target.page_id}; details suppressed")
            failures += 1
            continue

        live_title = page.get("title", "")
        if live_title != target.expected_title:
            print(
                f"SKIP {target.key}: page {target.page_id} has an unexpected title. "
                "Refusing to preview an unexpected page."
            )
            print(f"     If the page was deliberately renamed, update expected_title for {target.key}.")
            failures += 1
            continue

        version = int(page["version"]["number"])

        if args.dry_run:
            preview = PREVIEW_DIR / f"{target.key}.html"
            preview.write_text(storage, encoding="utf-8")
            note = f"; {diagrams} mermaid diagram(s) as code blocks" if diagrams else ""
            print(
                f"DRY  {target.key}: {len(source):,} chars markdown -> {len(storage):,} chars storage; "
                f"page v{version}; preview {preview.relative_to(REPO_ROOT)}{note}"
            )
            continue

    if failures:
        print(f"\n{failures} target(s) need attention.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
