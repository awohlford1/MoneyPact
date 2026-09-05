"""Bounded HTTPS-only clients. Redirects and implicit credential sources forbidden."""

import base64
import json
import urllib.error
import urllib.request

from publication import MAX_BODY, SHA, PublicationError, json_object
from tool_config import load_tool_config


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class JsonClient:
    def __init__(self, origin, authorization):
        self.origin = origin
        self.authorization = authorization
        # No environment proxy, netrc, cookies, redirect, or automatic retry.
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def request(self, path, method="GET", payload=None):
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        if data is not None and len(data) > MAX_BODY * 3:
            raise PublicationError("manual-handling-size-limit")
        request = urllib.request.Request(self.origin + path, data=data, method=method,
                                         headers={"Authorization": self.authorization, "Accept": "application/json",
                                                  "Content-Type": "application/json"})
        try:
            with self.opener.open(request, timeout=30) as response:
                if response.status != 200:
                    raise PublicationError("http-request-failed")
                body = response.read(MAX_BODY * 3 + 1)
                if len(body) > MAX_BODY * 3:
                    raise PublicationError("manual-handling-size-limit")
                return json_object(body.decode("utf-8"))
        except urllib.error.HTTPError as error:
            raise PublicationError("stale-version-conflict" if error.code == 409 else "http-request-failed") from None
        except (OSError, ValueError, urllib.error.URLError):
            raise PublicationError("http-request-failed") from None


class Confluence:
    def __init__(self):
        values = load_tool_config("confluence", {})
        # This repository has one approved destination. A valid but substituted
        # HTTPS origin must not receive its publishing credential.
        if values["CONFLUENCE_BASE_URL"] != "https://cobudget.atlassian.net":
            raise PublicationError("unapproved-confluence-origin")
        encoded = base64.b64encode((values["CONFLUENCE_EMAIL"] + ":" + values["CONFLUENCE_API_TOKEN"]).encode()).decode()
        self.client = JsonClient(values["CONFLUENCE_BASE_URL"], "Basic " + encoded)

    def get(self, page_id):
        return self.client.request("/wiki/api/v2/pages/" + page_id + "?body-format=storage")

    def put(self, entry, body, version, head):
        response = self.client.request("/wiki/api/v2/pages/" + entry["page_id"], "PUT", {
            "id": entry["page_id"], "status": "current", "title": entry["expected_title"],
            "body": {"representation": "storage", "value": body},
            "version": {"number": version, "message": "CBD-115 repository merge " + head},
        })
        try:
            if (not isinstance(response, dict) or response["id"] != entry["page_id"]
                    or response["title"] != entry["expected_title"] or response["status"] != "current"
                    or type(response["version"]["number"]) is not int or response["version"]["number"] != version):
                raise PublicationError("invalid-update-acknowledgement")
        except (KeyError, TypeError):
            raise PublicationError("invalid-update-acknowledgement") from None


class WorkflowHistory:
    def __init__(self):
        values = load_tool_config("publication-checkpoint", {})
        self.client = JsonClient("https://api.github.com", "Bearer " + values["GH_TOKEN"])

    def runs(self):
        runs, seen = [], set()
        # Filtered Actions searches are capped at 1,000 results. Missing or
        # inconsistent pagination is not proof that no uncertain attempt exists.
        for page in range(1, 11):
            response = self.client.request(
                "/repos/awohlford1/MoneyPact/actions/workflows/publish-confluence.yml/runs"
                "?event=push&branch=main&per_page=100&page=" + str(page))
            if (not isinstance(response, dict) or not isinstance(response.get("workflow_runs"), list)
                    or type(response.get("total_count")) is not int or not 1 <= response["total_count"] < 1000):
                raise PublicationError("invalid-workflow-history")
            for run in response["workflow_runs"]:
                if (not isinstance(run, dict) or run.get("event") != "push" or run.get("head_branch") != "main"
                        or not isinstance(run.get("repository"), dict)
                        or run.get("repository", {}).get("full_name") != "awohlford1/MoneyPact"
                        or run.get("path") != ".github/workflows/publish-confluence.yml"
                        or type(run.get("id")) is not int or run["id"] < 1 or run["id"] in seen
                        or type(run.get("run_attempt")) is not int or not 1 <= run["run_attempt"] <= 100
                        or not isinstance(run.get("head_sha"), str) or not SHA.fullmatch(run["head_sha"])):
                    raise PublicationError("invalid-workflow-history")
                seen.add(run["id"])
                runs.append(run)
            if len(response["workflow_runs"]) < 100:
                if len(runs) != response["total_count"]:
                    raise PublicationError("incomplete-workflow-history")
                return runs
        raise PublicationError("workflow-history-recovery-limit")

    def safe_heads(self, run_id, run_attempt, head, recovery):
        """Do not turn an uncertain write into a new Live baseline on retry.

        Every previous attempt is inspected, including attempts hidden by a
        rerun's current status. Only the exact active attempt is excluded.
        No Confluence credential is loaded during this read-only safety gate.
        """
        if (type(run_id) is not int or run_id < 1 or type(run_attempt) is not int or run_attempt < 1):
            raise PublicationError("invalid-current-workflow-attempt")
        approvals = validate_recovery(recovery)
        runs = self.runs()
        current = [run for run in runs if run["id"] == run_id]
        if (len(current) != 1 or current[0]["run_attempt"] != run_attempt
                or current[0]["head_sha"] != head or current[0].get("status") != "in_progress"):
            raise PublicationError("current-workflow-attempt-not-proven")
        heads, reconciled = [], []
        for run in runs:
            for attempt in range(1, run["run_attempt"] + 1):
                if run["id"] == run_id and attempt == run_attempt:
                    continue
                # A later queued run has not started; all earlier rerun attempts
                # must still be inspected. Never exclude by SHA or run ID order.
                if (attempt == run["run_attempt"] and run.get("status") in ("queued", "waiting", "pending", "requested")
                        and run.get("conclusion") is None):
                    continue
                response = self.client.request(
                    f"/repos/awohlford1/MoneyPact/actions/runs/{run['id']}/attempts/{attempt}/jobs?per_page=100")
                # This pinned workflow has exactly one job. Empty/truncated or
                # renamed execution evidence cannot establish a safe retry.
                if (not isinstance(response, dict) or type(response.get("total_count")) is not int
                        or response["total_count"] != 1 or not isinstance(response.get("jobs"), list)
                        or len(response["jobs"]) != 1):
                    raise PublicationError("incomplete-publication-attempt-evidence")
                job = response["jobs"][0]
                if (not isinstance(job, dict) or job.get("run_id") != run["id"]
                        or job.get("head_sha") != run["head_sha"]
                        or job.get("name") != "Approved merged documentation publication"
                        or not isinstance(job.get("steps"), list)):
                    raise PublicationError("invalid-publication-attempt-evidence")
                steps = [step for step in job["steps"] if isinstance(step, dict)
                         and step.get("name") == "Publish approved selected documents"]
                if len(steps) != 1:
                    raise PublicationError("incomplete-publication-attempt-evidence")
                step = steps[0]
                successful = (attempt == run["run_attempt"] and run.get("status") == "completed"
                              and run.get("conclusion") == "success" and job.get("status") == "completed"
                              and job.get("conclusion") == "success"
                              and step.get("status") == "completed" and step.get("conclusion") == "success")
                if successful:
                    heads.append(run["head_sha"])
                    continue
                skipped = step.get("status") == "completed" and step.get("conclusion") == "skipped"
                if skipped:
                    continue
                if job.get("status") != "completed":
                    raise PublicationError("uncertain-publication-attempt-requires-reviewed-reconciliation")
                approval = approvals.get((run["id"], attempt, run["head_sha"]))
                if approval is None:
                    raise PublicationError("uncertain-publication-attempt-requires-reviewed-reconciliation")
                reconciled.append(approval)
        return {"successful": heads, "reconciled": reconciled}


def validate_recovery(data):
    if (not isinstance(data, dict) or set(data) != {"schema", "reconciled_attempts"}
            or type(data["schema"]) is not int or data["schema"] != 1
            or not isinstance(data["reconciled_attempts"], list)):
        raise PublicationError("invalid-recovery-approval")
    approvals = {}
    for row in data["reconciled_attempts"]:
        if (not isinstance(row, dict) or set(row) != {"run_id", "attempt", "head_sha", "checkpoint_sha", "authority"}
                or type(row["run_id"]) is not int or row["run_id"] < 1
                or type(row["attempt"]) is not int or row["attempt"] < 1
                or any(not isinstance(row[field], str) or not SHA.fullmatch(row[field]) for field in ("head_sha", "checkpoint_sha"))
                or not isinstance(row["authority"], str) or len(row["authority"].strip()) < 20):
            raise PublicationError("invalid-recovery-approval")
        key = (row["run_id"], row["attempt"], row["head_sha"])
        if key in approvals:
            raise PublicationError("duplicate-recovery-approval")
        approvals[key] = row
    return approvals
