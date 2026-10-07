"""Bound review patches as inert data; never fetch or execute repository content.

A trusted resolver must supply the full changed-file count and API patch records
for immutable revisions. This helper cannot authenticate those inputs or detect
provider-side omission of entire, syntactically complete hunks. The resolver must
independently establish that its source is complete before claiming full scope.
"""

import re


HUNK = re.compile(r"@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)")


def added_lines(patch):
    """Validate unified hunk lengths and return safe new-side comment lines."""
    result = set()
    remaining_old = remaining_new = None
    line_number = 0
    for line in patch.splitlines():
        hunk = HUNK.fullmatch(line)
        if hunk:
            if remaining_old not in (None, 0) or remaining_new not in (None, 0):
                raise ValueError("truncated hunk")
            _, old_count, start, new_count = hunk.groups()
            remaining_old = int(old_count) if old_count is not None else 1
            remaining_new = int(new_count) if new_count is not None else 1
            line_number = int(start)
            if remaining_new and line_number < 1:
                raise ValueError("invalid new-side line")
        elif line == "\\ No newline at end of file" and remaining_old is not None:
            continue
        elif remaining_old is None or not line or line[0] not in " +-":
            raise ValueError("unsupported patch format")
        else:
            if line[0] in " -":
                remaining_old -= 1
            if line[0] in " +":
                remaining_new -= 1
                if line[0] == "+":
                    result.add(line_number)
                line_number += 1
            if remaining_old < 0 or remaining_new < 0:
                raise ValueError("hunk length mismatch")
    if remaining_old != 0 or remaining_new != 0:
        raise ValueError("empty or truncated patch")
    return result


def prepare_files(records, *, expected_files, source_complete,
                  max_files=40, max_bytes=200_000):
    """Select bounded patches and explicitly describe uninspected scope.

    Returned patch text is untrusted data, never system policy. Limits include
    filename bytes. Callers must separately limit provider prompt/output tokens.
    """
    if (type(expected_files) is not int or expected_files < 0
            or type(source_complete) is not bool
            or type(max_files) is not int or max_files < 1
            or type(max_bytes) is not int or max_bytes < 1
            or not isinstance(records, list)):
        raise ValueError("invalid trusted input metadata")
    selected, omitted, inspected = [], [], {}
    seen, used = set(), 0
    for record in records:
        if not isinstance(record, dict) or set(record) != {"path", "patch"}:
            raise ValueError("expected path and patch record")
        path, patch = record["path"], record["patch"]
        if (not isinstance(path, str) or not path or path.startswith("/")
                or "\\" in path or any(ord(c) < 32 for c in path)
                or any(p in {"", ".", ".."} for p in path.split("/"))
                or path in seen):
            raise ValueError("unsafe or duplicate file path")
        seen.add(path)
        reason = None
        if not isinstance(patch, str) or not patch:
            reason = "patch unavailable (including binary or rename-only change)"
        elif len(selected) >= max_files:
            reason = "file limit"
        elif used + len(path.encode("utf-8")) + len(patch.encode("utf-8")) > max_bytes:
            reason = "byte limit"
        else:
            try:
                lines = added_lines(patch)
            except ValueError as error:
                reason = str(error)
        if reason:
            omitted.append({"path": path, "reason": reason})
            continue
        selected.append({"path": path, "patch": patch})
        inspected[path] = lines
        used += len(path.encode("utf-8")) + len(patch.encode("utf-8"))
    complete = source_complete and len(records) == expected_files and not omitted
    return {"files": selected, "omitted": omitted, "inspected_lines": inspected,
            "scope_complete": complete, "bytes": used,
            "expected_files": expected_files, "received_files": len(records)}
