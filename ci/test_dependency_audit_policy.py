"""Synthetic policy checks; no registry, credentials, or package installation."""

from copy import deepcopy
from datetime import date
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from dependency_audit_policy import evaluate, findings

SCRIPT = Path(__file__).with_name("dependency_audit_policy.py")
URL = "https://github.com/advisories/GHSA-aaaa-bbbb-cccc"
TODAY = date(2026, 10, 7)


def lock():
    return {"lockfileVersion": 3, "packages": {
        "": {"dependencies": {"server": "1.0.0"}, "devDependencies": {"testkit": "1.0.0"}},
        "node_modules/server": {"version": "1.0.0", "dependencies": {"parser": "1.0.0"}},
        "node_modules/parser": {"version": "1.0.0"},
        "node_modules/testkit": {"version": "1.0.0", "dev": True},
    }}


def report(level="high", node="node_modules/parser", url=URL):
    return {"auditReportVersion": 2, "metadata": {"vulnerabilities": {
        "info": 0, "low": 0, "moderate": 0, "high": int(level == "high"),
        "critical": int(level == "critical"), "total": 1,
    }}, "vulnerabilities": {"parser": {
        "name": "parser", "severity": level, "nodes": [node],
        "via": [{"url": url, "severity": level}],
    }}}


def exception(level="high"):
    return {"advisory": URL, "path": ["server", "parser"], "severity": level,
            "owner": "Security maintainer", "reason": "Reviewed remediation pending",
            "expires": "2099-10-08"}


class DependencyAuditPolicyTests(unittest.TestCase):
    def test_new_high_and_critical_block_but_approved_baseline_stays_visible(self):
        for level in ("high", "critical"):
            current, failures = evaluate(report(level), lock(), {"schema": 1, "exceptions": []}, TODAY)
            self.assertEqual(current[(URL, ("server", "parser"))], level)
            self.assertEqual(len(failures), 1)
        current, failures = evaluate(report(), lock(), {"schema": 1, "exceptions": [exception()]}, TODAY)
        self.assertEqual(len(current), 1)
        self.assertEqual(failures, [])

    def test_new_moderate_is_visible_without_high_severity_block(self):
        candidate = report()
        candidate["vulnerabilities"]["parser"]["severity"] = "moderate"
        candidate["vulnerabilities"]["parser"]["via"][0]["severity"] = "moderate"
        candidate["metadata"]["vulnerabilities"].update(high=0, moderate=1)
        current, failures = evaluate(candidate, lock(), {"schema": 1, "exceptions": []}, TODAY)
        self.assertEqual(current[(URL, ("server", "parser"))], "moderate")
        self.assertEqual(failures, [])

    def test_path_and_severity_are_part_of_exception_identity(self):
        baseline = {"schema": 1, "exceptions": [exception()]}
        _, failures = evaluate(report("critical"), lock(), baseline, TODAY)
        self.assertIn("severity increased", failures[0][2])
        other = deepcopy(baseline)
        other["exceptions"][0]["path"] = ["other", "parser"]
        _, failures = evaluate(report(), lock(), other, TODAY)
        self.assertIn("new production", failures[0][2])

    def test_shared_hoisted_node_requires_each_new_production_path(self):
        baseline = {"schema": 1, "exceptions": [exception()]}
        expanded = lock()
        expanded["packages"][""]["dependencies"]["second"] = "1.0.0"
        expanded["packages"]["node_modules/second"] = {
            "version": "1.0.0", "dependencies": {"parser": "1.0.0"},
        }
        current, failures = evaluate(report(), expanded, baseline, TODAY)
        self.assertEqual(current[(URL, ("server", "parser"))], "high")
        self.assertEqual(current[(URL, ("second", "parser"))], "high")
        self.assertEqual(len(failures), 1)
        self.assertEqual(failures[0][0][1], ("second", "parser"))

    def test_exception_requires_named_owner_reason_and_unexpired_date(self):
        for field, value in (("owner", "pending"), ("reason", ""), ("expires", "2026-10-06")):
            baseline = {"schema": 1, "exceptions": [exception()]}
            baseline["exceptions"][0][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                evaluate(report(), lock(), baseline, TODAY)
        with self.assertRaisesRegex(ValueError, "missing approved baseline"):
            evaluate(report(), lock(), {}, TODAY)
        with self.assertRaisesRegex(ValueError, "missing approved baseline"):
            evaluate(report(), lock(), {"schema": True, "exceptions": []}, TODAY)

    def test_dev_only_or_unresolved_nodes_cannot_be_mislabeled_production(self):
        for node in ("node_modules/testkit", "node_modules/missing"):
            with self.subTest(node=node), self.assertRaisesRegex(ValueError, "outside production"):
                findings(report(node=node), lock())
        nested = lock()
        nested["packages"]["node_modules/server"]["dependencies"]["parser"] = "2.0.0"
        nested["packages"]["node_modules/server/node_modules/parser"] = {"version": "2.0.0"}
        observed = findings(report(node="node_modules/server/node_modules/parser"), nested)
        self.assertEqual(observed[(URL, ("server", "parser"))], "high")

    def test_malformed_and_aggregate_only_reports_fail_closed(self):
        cases = []
        for change in (
            lambda x: x.pop("vulnerabilities"),
            lambda x: x["metadata"]["vulnerabilities"].update(total=0),
            lambda x: x["metadata"]["vulnerabilities"].update(high=True, total=True),
            lambda x: x["vulnerabilities"]["parser"].update(via=["unreported"]),
            lambda x: x["vulnerabilities"]["parser"]["via"][0].update(url="http://unknown"),
            lambda x: x["vulnerabilities"]["parser"]["via"][0].update(severity="low"),
        ):
            candidate = report()
            change(candidate)
            cases.append(candidate)
        for candidate in cases:
            with self.subTest(candidate=candidate), self.assertRaises(ValueError):
                findings(candidate, lock())

    def test_aggregate_severity_must_match_referenced_advisory(self):
        candidate = report()
        candidate["vulnerabilities"]["server"] = {
            "name": "server", "severity": "high", "nodes": ["node_modules/server"], "via": ["parser"],
        }
        candidate["metadata"]["vulnerabilities"].update(high=2, total=2)
        self.assertEqual(findings(candidate, lock())[(URL, ("server", "parser"))], "high")
        candidate["vulnerabilities"]["server"]["severity"] = "critical"
        candidate["metadata"]["vulnerabilities"].update(high=1, critical=1)
        with self.assertRaisesRegex(ValueError, "severity disagrees"):
            findings(candidate, lock())

    def test_cli_rejects_scanner_error_missing_files_and_exit_mismatch(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "audit.json").write_text(json.dumps(report()))
            (root / "lock.json").write_text(json.dumps(lock()))
            (root / "baseline.json").write_text(json.dumps({"schema": 1, "exceptions": [exception()]}))
            def run(status, audit="audit.json"):
                return subprocess.run([sys.executable, str(SCRIPT), "--audit", str(root / audit),
                    "--lock", str(root / "lock.json"), "--baseline", str(root / "baseline.json"),
                    "--audit-exit", str(status)], capture_output=True, text=True)
            self.assertEqual(run(1).returncode, 0)
            for result in (run(2), run(0), run(1, "missing.json")):
                self.assertEqual(result.returncode, 2)
                self.assertIn("incomplete", result.stderr)


if __name__ == "__main__":
    unittest.main()
