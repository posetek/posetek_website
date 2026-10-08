"""Contract tests for the actual CI workflow, including failure-path mutations.

These protect this repository's secret-free PR workflow. They are not a security
boundary against a PR that edits both this file and the workflow: require human
review of policy changes and enforce permissions/rulesets on GitHub too.
"""
from copy import deepcopy
from pathlib import Path
import json
import os
import re
import subprocess
import unittest

import yaml


def validate(workflow):
    # BaseLoader preserves GitHub's 'on' key (YAML 1.1 calls it a boolean).
    assert workflow["permissions"] == {}, "workflow permissions must be empty"
    events = workflow["on"]
    assert "pull_request" in events and "merge_group" in events
    assert not (set(events) & {"pull_request_target", "workflow_run", "issue_comment"})
    assert set(events) <= {"pull_request", "push", "merge_group", "workflow_dispatch"}
    assert not events["pull_request"], "required CI must not have path/branch filters"
    assert workflow["concurrency"]["cancel-in-progress"] == "true"
    jobs = workflow["jobs"]
    gate = jobs["ci"]
    assert gate["if"] == "${{ always() }}"
    assert set(gate["needs"]) == set(jobs) - {"ci"}, "gate must cover all lanes"
    assert gate["permissions"] == {}
    assert "node --test ci/verify-mobile-contract-artifact.test.cjs" in [
        step.get("run") for step in jobs["server"]["steps"]
    ], "contract artifact verifier regressions belong in the required server lane"
    for name, job in jobs.items():
        assert 0 < int(job["timeout-minutes"]) <= 30
        assert job["runs-on"] in {"ubuntu-24.04", "macos-15"}, "no persistent PR runners"
        assert "if" not in job or name == "ci", "no silently skipped test lanes"
        assert not job.get("continue-on-error")
        assert all(v == "read" for v in job.get("permissions", {}).values())
        assert set(job.get("permissions", {})) <= {"contents"}
        serialized = json.dumps(job)
        assert "secrets." not in serialized and "secrets[" not in serialized
        for step in job.get("steps", []):
            assert not step.get("continue-on-error")
            if "uses" in step:
                assert re.fullmatch(r"actions/[a-z-]+@[0-9a-f]{40}", step["uses"]), "pin official actions"
                if step["uses"].startswith("actions/checkout@"):
                    assert step["with"]["persist-credentials"] == "false"
                    assert "ref" not in step["with"], "test the event's merge commit"
            if "run" in step:
                assert "${{" not in step["run"], "pass event inputs via environment"
    return gate["steps"][0]["run"]


class WorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = yaml.load(
            (Path(__file__).resolve().parents[1] / ".github/workflows/ci.yml").read_text(),
            Loader=yaml.BaseLoader,
        )

    def test_actual_workflow(self):
        validate(self.workflow)

    def test_privileged_pr_work_is_rejected(self):
        mutations = [
            lambda w: w.update(permissions={"contents": "write"}),
            lambda w: w["on"].update(pull_request_target={}),
            lambda w: w["on"].update(pull_request={"paths": ["src/**"]}),
            lambda w: w["jobs"]["policy"].update(permissions={"contents": "write"}),
            lambda w: w["jobs"]["policy"].update(env={"KEY": "${{ secrets.API_KEY }}"}),
            lambda w: w["jobs"]["policy"].update(**{"continue-on-error": "true"}),
            lambda w: w["jobs"]["policy"].update(**{"runs-on": "self-hosted"}),
            lambda w: w["jobs"]["policy"]["steps"][0]["with"].update(**{"persist-credentials": "true"}),
            lambda w: w["jobs"]["policy"]["steps"][0].update(uses="actions/checkout@v4"),
            lambda w: w["jobs"]["server"]["steps"].pop(),
            lambda w: w["jobs"]["ci"]["needs"].remove("policy"),
        ]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                candidate = deepcopy(self.workflow)
                mutate(candidate)
                with self.assertRaises(AssertionError):
                    validate(candidate)

    def test_real_aggregate_script_fails_on_incomplete_evidence(self):
        script = validate(self.workflow)
        for state in ("success", "failure", "cancelled", "skipped", "timed_out"):
            with self.subTest(state=state):
                result = subprocess.run(
                    ["bash", "-c", script], capture_output=True, text=True,
                    env={**os.environ, "RESULTS": json.dumps({"lane": {"result": state}})},
                )
                self.assertEqual(result.returncode == 0, state == "success", result.stderr)
        for raw in ("{}", "not-json"):
            result = subprocess.run(["bash", "-c", script], capture_output=True, text=True,
                                    env={**os.environ, "RESULTS": raw})
            self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
