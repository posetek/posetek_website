"""Offline validation for advisory review data; no model, network, or publisher.

The caller supplies trusted revision and inspected-line metadata. Those inputs
must come from the trusted resolver, never from the model's own report. Passing
validation establishes shape and scope only, not that findings are correct.
"""

import re


SHA = re.compile(r"[0-9a-f]{40}\Z")
STATUSES = {"complete", "partial", "unavailable", "not-run"}


def validate_report(report, *, revisions, inspected_lines, scope_complete):
    """Return errors. Stale/invalid reports must not be published by a caller."""
    errors = []
    if type(scope_complete) is not bool:
        raise ValueError("scope_complete must be trusted boolean metadata")
    if set(revisions) != {"base_sha", "head_sha", "policy_sha"} or any(
        not isinstance(value, str) or not SHA.fullmatch(value)
        for value in revisions.values()
    ):
        raise ValueError("trusted revisions must be full commit SHAs")
    for path, lines in inspected_lines.items():
        if (not isinstance(path, str) or not path or path.startswith("/")
                or "\\" in path or any(p in {"", ".", ".."} for p in path.split("/"))
                or not isinstance(lines, (set, frozenset))
                or any(type(line) is not int or line < 1 for line in lines)):
            raise ValueError("invalid trusted inspected-line metadata")
    if not isinstance(report, dict):
        return ["report must be an object"]
    allowed = {"base_sha", "head_sha", "policy_sha", "status", "summary", "findings"}
    if set(report) != allowed:
        errors.append("report fields must match the advisory contract; actions are forbidden")
    for key, expected in revisions.items():
        if report.get(key) != expected:
            errors.append(f"{key}: stale or mismatched revision")
    status = report.get("status")
    if not isinstance(status, str) or status not in STATUSES:
        errors.append("status: expected complete, partial, unavailable, or not-run")
    if status == "complete" and not scope_complete:
        errors.append("complete review cannot be claimed for incomplete inspected scope")
    summary = report.get("summary")
    if not isinstance(summary, str) or not summary.strip() or len(summary) > 4000:
        errors.append("summary: required nonblank text up to 4000 characters")
    findings = report.get("findings")
    if not isinstance(findings, list) or len(findings) > 50:
        return errors + ["findings: expected list of at most 50 findings"]
    if status in {"unavailable", "not-run"} and findings:
        errors.append("unavailable or not-run outcomes cannot contain findings")
    for index, finding in enumerate(findings):
        prefix = f"findings[{index}]"
        if not isinstance(finding, dict) or set(finding) != {
            "severity", "path", "line", "evidence", "suggestion"
        }:
            errors.append(f"{prefix}: invalid finding fields")
            continue
        if finding["severity"] not in ("P0", "P1", "P2", "P3"):
            errors.append(f"{prefix}.severity: invalid priority")
        path, line = finding["path"], finding["line"]
        if not isinstance(path, str) or path not in inspected_lines:
            errors.append(f"{prefix}.path: not an inspected file")
        elif type(line) is not int or line not in inspected_lines[path]:
            errors.append(f"{prefix}.line: not an inspected line")
        for field in ("evidence", "suggestion"):
            value = finding[field]
            if not isinstance(value, str) or not value.strip() or len(value) > 4000:
                errors.append(f"{prefix}.{field}: required bounded nonblank text")
    return errors
