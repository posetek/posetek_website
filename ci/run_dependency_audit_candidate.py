"""Inactive npm production-audit runner; requires reviewed exception files."""

import argparse
from datetime import date
import json
from pathlib import Path
import subprocess
import sys

from dependency_audit_policy import evaluate, load_json, require, SEVERITY

ROOT = Path(__file__).resolve().parents[1]
SCOPES = {
    "app": "app",
    "functions": "functions",
    "legacy": "functions/legacy-upload-processor",
}


def run(scope, baseline, npm="npm"):
    directory = ROOT / SCOPES[scope]
    try:
        completed = subprocess.run(
            [npm, "--prefix", str(directory), "audit", "--omit=dev", "--json"],
            cwd=ROOT, capture_output=True, text=True, timeout=120,
        )
        require(completed.returncode in (0, 1), f"scanner error exit status {completed.returncode}")
        audit = json.loads(completed.stdout)
        lock = load_json(directory / "package-lock.json")
        current, failures = evaluate(audit, lock, load_json(baseline), date.today())
        require((completed.returncode == 0) == (not audit["vulnerabilities"]), "audit exit/report mismatch")
    except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError, subprocess.TimeoutExpired) as error:
        print(f"Dependency audit incomplete for {scope}: {error}", file=sys.stderr)
        return 2
    for (advisory, path), severity in sorted(current.items()):
        if SEVERITY[severity] >= SEVERITY["high"]:
            print(f"{scope} {severity}: {advisory} via {' -> '.join(path)}")
    for (advisory, path), severity, reason in failures:
        print(f"BLOCK {scope} {reason}: {severity} {advisory} via {' -> '.join(path)}", file=sys.stderr)
    print(f"{scope}: {len(current)} advisory-path findings; {len(failures)} blocking")
    return 1 if failures else 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scope", choices=SCOPES)
    parser.add_argument("--baseline", required=True, help="separately reviewed exception JSON")
    args = parser.parse_args(argv)
    return run(args.scope, args.baseline)


if __name__ == "__main__":
    sys.exit(main())
