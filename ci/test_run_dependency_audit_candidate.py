"""Exercise the inactive runner without querying the registry."""

import json
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
import subprocess
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

import run_dependency_audit_candidate as candidate


def clean_report():
    return {"auditReportVersion": 2, "vulnerabilities": {},
            "metadata": {"vulnerabilities": {"info": 0, "low": 0, "moderate": 0,
                                              "high": 0, "critical": 0, "total": 0}}}


def high_report():
    report = clean_report()
    report["metadata"]["vulnerabilities"].update(high=1, total=1)
    report["vulnerabilities"]["@grpc/grpc-js"] = {
        "name": "@grpc/grpc-js", "severity": "high",
        "nodes": ["node_modules/@grpc/grpc-js"],
        "via": [{"url": "https://github.com/advisories/GHSA-m9gg-hp2v-232j", "severity": "high"}],
    }
    return report


class AuditRunnerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.baseline = Path(self.temp.name) / "baseline.json"
        self.baseline.write_text(json.dumps({"schema": 1, "exceptions": []}))

    def invoke(self, status, report, scope="app"):
        with patch.object(candidate.subprocess, "run", return_value=SimpleNamespace(
            returncode=status, stdout=report, stderr="registry response")) as mocked:
            result = candidate.run(scope, self.baseline)
        command = mocked.call_args.args[0]
        self.assertEqual(command[0], "npm")
        self.assertEqual(command[2:6], [str(candidate.ROOT / candidate.SCOPES[scope]), "audit", "--omit=dev", "--json"])
        self.assertEqual(mocked.call_args.kwargs["timeout"], 120)
        return result

    def test_clean_report_can_pass_and_high_advisory_blocks(self):
        self.assertEqual(self.invoke(0, json.dumps(clean_report())), 0)
        self.assertEqual(self.invoke(1, json.dumps(high_report())), 1)

    def test_scanner_error_bad_json_missing_baseline_and_mismatched_status_fail(self):
        self.assertEqual(self.invoke(2, ""), 2)
        self.assertEqual(self.invoke(1, "not JSON"), 2)
        self.assertEqual(self.invoke(1, json.dumps(clean_report())), 2)
        self.baseline.unlink()
        self.assertEqual(self.invoke(0, json.dumps(clean_report())), 2)

    def test_unapproved_existing_high_remains_visible_and_cannot_pass(self):
        self.baseline.unlink()
        output = StringIO()
        with redirect_stdout(output):
            result = self.invoke(1, json.dumps(high_report()))
        self.assertEqual(result, 2)
        self.assertIn("firebase -> @firebase/firestore -> @grpc/grpc-js", output.getvalue())

    def test_timeout_fails(self):
        with patch.object(candidate.subprocess, "run", side_effect=subprocess.TimeoutExpired("npm", 120)):
            self.assertEqual(candidate.run("functions", self.baseline), 2)


if __name__ == "__main__":
    unittest.main()
