"""Policy for npm audit --omit=dev JSON and a v3 lockfile.

Baseline entries are explicit, expiring exceptions; a generated audit snapshot
is never an approved baseline.
"""

import argparse
from collections import deque
from datetime import date
import json
from pathlib import Path
import re
import sys

SEVERITY = {"info": 0, "low": 1, "moderate": 2, "high": 3, "critical": 4}
ADVISORY = re.compile(r"https://github\.com/advisories/GHSA-[A-Za-z0-9-]+$")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def load_json(path):
    return json.loads(Path(path).read_text())


def resolve(packages, parent, name):
    require(isinstance(name, str) and name and not name.startswith("/"), "invalid dependency name")
    location = parent
    while True:
        candidate = f"{location}/node_modules/{name}" if location else f"node_modules/{name}"
        if candidate in packages:
            return candidate
        if not location:
            raise ValueError(f"unresolved dependency {name} from {parent or '<root>'}")
        if "/node_modules/" in location:
            location = location.rsplit("/node_modules/", 1)[0]
        else:
            location = ""


def production_paths(lock):
    require(type(lock.get("lockfileVersion")) is int and lock["lockfileVersion"] == 3, "expected npm lockfile v3")
    packages = lock.get("packages")
    require(isinstance(packages, dict) and isinstance(packages.get(""), dict), "missing lock package graph")
    root = packages[""]
    paths = {}
    queue = deque()
    for name in sorted(set(root.get("dependencies", {})) | set(root.get("optionalDependencies", {}))):
        queue.append((resolve(packages, "", name), (name,), frozenset()))
    while queue:
        location, chain, ancestors = queue.popleft()
        if location in ancestors:
            continue
        package = packages[location]
        require(isinstance(package, dict) and package.get("version"), f"invalid lock node {location}")
        require(package.get("dev") is not True, f"production path marked dev: {location}")
        paths.setdefault(location, set()).add(chain)
        require(sum(map(len, paths.values())) <= 10000, "production dependency graph has too many paths")
        names = set(package.get("dependencies", {})) | set(package.get("optionalDependencies", {}))
        for name in sorted(names):
            queue.append((resolve(packages, location, name), chain + (name,), ancestors | {location}))
    return paths


def findings(audit, lock):
    require(isinstance(audit, dict) and audit.get("auditReportVersion") == 2, "invalid npm audit report")
    vulnerabilities = audit.get("vulnerabilities")
    counts = audit.get("metadata", {}).get("vulnerabilities")
    require(isinstance(vulnerabilities, dict) and isinstance(counts, dict), "missing audit vulnerabilities/counts")
    require(all(type(counts.get(level)) is int and counts[level] >= 0 for level in SEVERITY), "invalid severity counts")
    require(type(counts.get("total")) is int and counts["total"] == len(vulnerabilities) == sum(counts[level] for level in SEVERITY), "inconsistent audit counts")
    require(all(counts[level] == sum(record.get("severity") == level for record in vulnerabilities.values()
                    if isinstance(record, dict)) for level in SEVERITY), "inconsistent audit severity counts")
    paths = production_paths(lock)
    result = {}
    for name, record in vulnerabilities.items():
        require(isinstance(record, dict) and record.get("name") == name, f"invalid vulnerability {name}")
        severity = record.get("severity")
        require(severity in SEVERITY and counts[severity] > 0, f"invalid severity for {name}")
        nodes, via = record.get("nodes"), record.get("via")
        require(isinstance(nodes, list) and nodes and isinstance(via, list) and via, f"missing nodes/advisories for {name}")
        for node in nodes:
            require(node in paths, f"audit node outside production lock graph: {node}")
        via_levels = []
        for item in via:
            if isinstance(item, str):
                require(item in vulnerabilities, f"unresolved aggregate advisory: {item}")
                referenced = vulnerabilities[item]
                require(isinstance(referenced, dict) and referenced.get("severity") in SEVERITY,
                        f"invalid aggregate severity: {item}")
                via_levels.append(referenced["severity"])
                continue
            require(isinstance(item, dict) and ADVISORY.fullmatch(str(item.get("url", ""))), f"invalid advisory for {name}")
            level = item.get("severity")
            require(level in SEVERITY, f"invalid advisory severity for {name}")
            via_levels.append(level)
            for node in nodes:
                for chain in paths[node]:
                    key = (item["url"], chain)
                    result[key] = max(result.get(key, "info"), level, key=SEVERITY.get)
        require(max(via_levels, key=SEVERITY.get) == severity, f"audit severity disagrees with advisories for {name}")
    require(not vulnerabilities or result, "audit has vulnerabilities without advisory identities")
    return result


def evaluate(audit, lock, baseline, today):
    current = findings(audit, lock)
    require(isinstance(baseline, dict) and set(baseline) == {"schema", "exceptions"}
            and type(baseline["schema"]) is int and baseline["schema"] == 1
            and isinstance(baseline["exceptions"], list), "missing approved baseline")
    approved = {}
    for entry in baseline["exceptions"]:
        require(isinstance(entry, dict) and set(entry) == {"advisory", "path", "severity", "owner", "reason", "expires"}, "invalid exception fields")
        require(ADVISORY.fullmatch(str(entry["advisory"])) is not None, "invalid exception advisory")
        require(isinstance(entry["path"], list) and entry["path"] and all(isinstance(n, str) and n for n in entry["path"]), "invalid exception path")
        require(entry["severity"] in SEVERITY, "invalid exception severity")
        for field in ("owner", "reason"):
            require(isinstance(entry[field], str) and entry[field].strip() and entry[field].strip().lower() not in {"pending", "unknown", "tbd"}, f"missing exception {field}")
        try:
            expiry = date.fromisoformat(entry["expires"])
        except (TypeError, ValueError):
            raise ValueError("invalid exception expiry") from None
        require(expiry >= today, "expired exception")
        key = (entry["advisory"], tuple(entry["path"]))
        require(key not in approved, "duplicate exception")
        approved[key] = entry
    failures = []
    for key, level in current.items():
        if SEVERITY[level] < SEVERITY["high"]:
            continue
        entry = approved.get(key)
        if entry is None:
            failures.append((key, level, "new production high/critical advisory"))
        elif SEVERITY[level] > SEVERITY[entry["severity"]]:
            failures.append((key, level, "severity increased beyond approved exception"))
    return current, failures


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audit", required=True)
    parser.add_argument("--lock", required=True)
    parser.add_argument("--baseline", required=True)
    parser.add_argument("--audit-exit", required=True, type=int, help="npm audit exit code: 0 clean, 1 findings")
    args = parser.parse_args(argv)
    try:
        require(args.audit_exit in (0, 1), "scanner error exit status")
        audit = load_json(args.audit)
        lock = load_json(args.lock)
        current, failures = evaluate(audit, lock, load_json(args.baseline), date.today())
        require((args.audit_exit == 0) == (not audit["vulnerabilities"]), "audit exit/report mismatch")
    except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError) as error:
        print(f"Dependency audit incomplete: {error}", file=sys.stderr)
        return 2
    for (advisory, path), level in sorted(current.items()):
        if SEVERITY[level] >= SEVERITY["high"]:
            print(f"{level}: {advisory} via {' -> '.join(path)}")
    for (advisory, path), level, reason in failures:
        print(f"BLOCK {reason}: {level} {advisory} via {' -> '.join(path)}", file=sys.stderr)
    print(f"{len(current)} advisory-path findings; {len(failures)} blocking")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
