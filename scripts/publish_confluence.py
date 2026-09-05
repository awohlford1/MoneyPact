"""Protected-main publication entry point; never reads local credential files."""

import argparse
import json

from publication import (ROOT, MANIFEST, SHA, PublicationError, ancestor, bootstrap_manifest, bounded, converter,
                         execute_plan, git, inventory, json_object, read_manifest, registry,
                         sections, select_documents, sha256, source, validate_manifest, validate_range)
from publication_transport import Confluence, WorkflowHistory, validate_recovery

PLAN = ROOT / ".cache/confluence-publication-plan.json"


def recovery_history(repo, head, run_id, run_attempt):
    recovery = json_object((repo / "config/confluence-recovery.json").read_text(encoding="utf-8"))
    # An owner reconciliation checkpoint is not a later successful workflow:
    # it must already be in this head's history, never authorize an overtaken
    # no-op by naming an unmerged descendant or unrelated commit.
    approvals = list(validate_recovery(recovery).values())
    for approval in approvals:
        validate_range(repo, approval["checkpoint_sha"], head)
    if approvals:
        previous = read_manifest(repo, head)["bootstrap_sha"]
        for index, approval in enumerate(approvals):
            if not ancestor(repo, previous, approval["checkpoint_sha"]):
                raise PublicationError("recovery-checkpoint-must-include-bootstrap" if index == 0
                                       else "non-monotonic-recovery-checkpoints")
            previous = approval["checkpoint_sha"]
    evidence = WorkflowHistory().safe_heads(run_id, run_attempt, head, recovery)
    for approval in evidence["reconciled"]:
        for success in evidence["successful"]:
            # Only a successful commit already containing this exact approval
            # can advance beyond its checkpoint. A success predating approval
            # must be included in that checkpoint, or it would silently win the
            # ancestry maximum after the owner restored a different live state.
            path = "config/confluence-recovery.json"
            names = git(repo, "ls-tree", "--name-only", success, "--", path).decode().splitlines()
            recorded = (validate_recovery(json_object(git(repo, "show", success + ":" + path).decode("utf-8")))
                        if names else {})
            identity = (approval["run_id"], approval["attempt"], approval["head_sha"])
            if recorded.get(identity) == approval:
                if not ancestor(repo, approval["checkpoint_sha"], success):
                    raise PublicationError("incompatible-recovery-checkpoint")
            elif not ancestor(repo, success, approval["checkpoint_sha"]):
                raise PublicationError("recovery-checkpoint-must-include-prior-successes")
    return evidence["successful"] + [row["checkpoint_sha"] for row in evidence["reconciled"]]


def activation(repo):
    data = json_object((repo / "config/confluence-activation.json").read_text(encoding="utf-8"))
    if (not isinstance(data, dict) or set(data) != {"enabled", "prerequisites", "owner_approval", "exclusive_writer_approval", "smoke_target"}
            or data["enabled"] is not True or data["prerequisites"] != {"CBD-113": "Done", "CBD-114": "Done"}
            or not isinstance(data["owner_approval"], str) or len(data["owner_approval"].strip()) < 20
            or not isinstance(data["smoke_target"], str) or not data["smoke_target"]):
        raise PublicationError("activation-requires-done-prerequisites-and-owner-smoke-approval")
    if not isinstance(data["exclusive_writer_approval"], str) or len(data["exclusive_writer_approval"].strip()) < 20:
        raise PublicationError("activation-requires-verified-draft-clearance-and-exclusive-writer-control")
    manifest = json_object((repo / MANIFEST).read_text(encoding="utf-8"))
    if not any(entry.get("target") == data["smoke_target"] and entry.get("policy") == "approved"
               for entry in manifest["documents"]):
        raise PublicationError("smoke-target-must-be-registered-and-approved")


def checkpoint(repo, bootstrap, head, successful):
    validate_range(repo, bootstrap, head)
    current = bootstrap
    for candidate in successful:
        if not isinstance(candidate, str) or not SHA.fullmatch(candidate):
            raise PublicationError("invalid-workflow-checkpoint")
        # A later successful run already covers this event; never roll pages back.
        if ancestor(repo, head, candidate) and candidate != head:
            return candidate, True
        if not ancestor(repo, candidate, head):
            raise PublicationError("divergent-workflow-checkpoint")
        if ancestor(repo, current, candidate):
            current = candidate
    return current, False


def prepare(repo, event_before, head, history):
    validate_range(repo, event_before, head)  # before any credential loading
    if git(repo, "rev-parse", "HEAD").decode().strip() != head:
        raise PublicationError("checkout-event-mismatch")
    activation(repo)
    desired = read_manifest(repo, head)
    effective, overtaken = checkpoint(repo, desired["bootstrap_sha"], head, history())
    result = {"schema": 1, "event_before": event_before, "head": head, "base": effective,
              "overtaken": overtaken, "manifest_sha256": sha256(json.dumps(desired, sort_keys=True))}
    if not overtaken:
        build_plan(repo, result)  # source/manifest/conversion errors before Confluence auth
    return result


def build_plan(repo, plan):
    if (not isinstance(plan, dict) or set(plan) != {"schema", "event_before", "head", "base", "overtaken", "manifest_sha256"}
            or type(plan["schema"]) is not int or plan["schema"] != 1 or type(plan["overtaken"]) is not bool):
        raise PublicationError("invalid-publication-plan")
    validate_range(repo, plan["event_before"], plan["head"])
    if git(repo, "rev-parse", "HEAD").decode().strip() != plan["head"]:
        raise PublicationError("checkout-event-mismatch")
    desired = read_manifest(repo, plan["head"])
    if sha256(json.dumps(desired, sort_keys=True)) != plan["manifest_sha256"]:
        raise PublicationError("manifest-changed-after-planning")
    if plan["overtaken"]:
        validate_range(repo, plan["head"], plan["base"])
        return []
    validate_range(repo, plan["base"], plan["head"])
    desired_paths = inventory(repo, plan["head"])
    desired_bodies = {path: source(repo, plan["head"], path) for path in desired_paths}
    validate_manifest(desired, desired_paths, desired_bodies, registry())
    base_paths = inventory(repo, plan["base"])
    base_bodies = {path: source(repo, plan["base"], path) for path in base_paths}
    # The first deployment has an independent historical snapshot. Never infer
    # past registrations, approval policies or dependencies from Desired.
    names = git(repo, "ls-tree", "--name-only", plan["base"], "--", MANIFEST).decode().splitlines()
    if names:
        base = read_manifest(repo, plan["base"])
        validate_manifest(base, base_paths, base_bodies)
    elif plan["base"] == desired["bootstrap_sha"]:
        base = bootstrap_manifest(repo, plan["base"], base_paths, base_bodies)
    else:
        raise PublicationError("missing-base-manifest-recover-from-bootstrap")
    selected = select_documents(base, desired, base_bodies, desired_bodies)
    convert = converter()
    result = [(entry, bounded(convert(bounded(before))), bounded(convert(bounded(after)))) for entry, before, after in selected]
    for _, before, after in result:
        sections(before)
        sections(after)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("prepare", "publish"))
    parser.add_argument("before")
    parser.add_argument("head")
    parser.add_argument("--run-id", type=int)
    parser.add_argument("--run-attempt", type=int)
    args = parser.parse_args()
    try:
        validate_range(ROOT, args.before, args.head)
        if args.mode == "prepare":
            result = prepare(ROOT, args.before, args.head, lambda: recovery_history(
                ROOT, args.head, args.run_id, args.run_attempt))
            PLAN.parent.mkdir(parents=True, exist_ok=True)
            PLAN.write_text(json.dumps(result), encoding="utf-8")
            print(json.dumps({"merge_sha": args.head, "action": "no-op" if result["overtaken"] else "planned",
                              "base_sha": result["base"], "verified": True}))
        else:
            activation(ROOT)
            plan = json_object(PLAN.read_text(encoding="utf-8"))
            if plan.get("event_before") != args.before or plan.get("head") != args.head:
                raise PublicationError("plan-event-mismatch")
            selected = build_plan(ROOT, plan)
            if selected:
                execute_plan(Confluence(), selected, args.head, lambda row: print(json.dumps(row)))
            else:
                print(json.dumps({"merge_sha": args.head, "action": "no-op", "verified": True}))
        return 0
    except PublicationError as error:
        print(json.dumps({"action": "conflict", "verified": False, "reason": error.code}))
        return 1
    except BaseException:
        print('{"action":"conflict","verified":false,"reason":"publication-failed-details-suppressed"}')
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
