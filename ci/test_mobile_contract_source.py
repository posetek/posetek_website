"""Guard the trusted, manually dispatched mobile source workflow.

This catches accidental privilege expansion; human review still protects edits to
both the workflow and this test. It does not claim a required PR integration.
"""
from copy import deepcopy
from pathlib import Path
import os
import re
import subprocess
import tempfile
import unittest

import yaml


def validate(workflow):
    assert workflow["permissions"] == {}
    assert set(workflow["on"]) == {"workflow_dispatch"}
    source_input = workflow["on"]["workflow_dispatch"]["inputs"]["mobile_sha"]
    assert source_input["required"] == "true" and source_input["type"] == "string"
    assert set(workflow["jobs"]) == {"source"}
    job = workflow["jobs"]["source"]
    assert job["runs-on"] == "ubuntu-24.04"
    assert 0 < int(job["timeout-minutes"]) <= 10
    assert job["permissions"] == {"contents": "read"}
    assert not job.get("continue-on-error")
    validate_sha, token, checkout, stage, upload = job["steps"]
    assert validate_sha["id"] == "revision"
    assert validate_sha["env"]["MOBILE_SHA"] == "${{ inputs.mobile_sha }}"
    assert "^[0-9a-f]{40}$" in validate_sha["run"]
    assert '>> "$GITHUB_OUTPUT"' in validate_sha["run"]
    assert token["uses"] == "actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1"
    assert token["with"] == {
        "client-id": "${{ vars.POSETEK_CI_APP_CLIENT_ID }}",
        "private-key": "${{ secrets.POSETEK_CI_APP_PRIVATE_KEY }}",
        "owner": "posetek", "repositories": "posetek-mobile-app",
        "permission-contents": "read",
    }
    assert checkout["uses"] == "actions/checkout@11d5960a326750d5838078e36cf38b85af677262"
    assert checkout["with"] == {
        "repository": "posetek/posetek-mobile-app",
        "ref": "${{ steps.revision.outputs.sha }}",
        "token": "${{ steps.app-token.outputs.token }}",
        "persist-credentials": "false", "path": "mobile",
    }
    assert stage["env"]["EXPECTED_SHA"] == "${{ steps.revision.outputs.sha }}"
    assert 'test "$actual_sha" = "$EXPECTED_SHA"' in stage["run"]
    assert '$(find "$source" -type l -print -quit)' in stage["run"]
    assert "source-sha.txt" in stage["run"]
    assert upload["uses"] == "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02"
    assert upload["with"]["name"] == "mobile-contract-${{ steps.revision.outputs.sha }}"
    assert upload["with"]["if-no-files-found"] == "error"
    assert int(upload["with"]["retention-days"]) <= 7
    for step in job["steps"]:
        assert not step.get("continue-on-error")
        if "uses" in step:
            assert re.fullmatch(r"actions/[a-z-]+@[0-9a-f]{40}", step["uses"])
        if "run" in step:
            assert step["run"].startswith("set -euo pipefail\n")


class MobileContractSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = yaml.load(
            (Path(__file__).resolve().parents[1] / ".github/workflows/mobile-contract-source.yml").read_text(),
            Loader=yaml.BaseLoader,
        )

    def test_trusted_source_workflow(self):
        validate(self.workflow)

    def test_privilege_expansions_are_rejected(self):
        mutations = [
            lambda w: w["on"].update(pull_request_target={}),
            lambda w: w["jobs"]["source"].update(permissions={"contents": "write"}),
            lambda w: w["jobs"]["source"]["steps"][1]["with"].update(repositories="other-repo"),
            lambda w: w["jobs"]["source"]["steps"][1]["with"].update(**{"permission-contents": "write"}),
            lambda w: w["jobs"]["source"]["steps"][2]["with"].update(**{"persist-credentials": "true"}),
            lambda w: w["jobs"]["source"]["steps"][2]["with"].update(ref="${{ github.event.pull_request.head.sha }}"),
            lambda w: w["jobs"]["source"]["steps"][4]["with"].update(**{"if-no-files-found": "warn"}),
        ]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                candidate = deepcopy(self.workflow)
                mutate(candidate)
                with self.assertRaises(AssertionError):
                    validate(candidate)

    def test_revision_validation_rejects_non_sha_inputs(self):
        script = self.workflow["jobs"]["source"]["steps"][0]["run"]
        with tempfile.TemporaryDirectory() as directory:
            output = str(Path(directory) / "step-output")
            for value in ("", "a" * 39, "A" * 40, "a" * 40 + "\nanything", "$(date)"):
                with self.subTest(value=value):
                    result = subprocess.run(
                        ["bash", "-c", script], capture_output=True, text=True,
                        env={**os.environ, "MOBILE_SHA": value, "GITHUB_OUTPUT": output},
                    )
                    self.assertNotEqual(result.returncode, 0)
                    self.assertFalse(Path(output).exists())
            result = subprocess.run(
                ["bash", "-c", script], capture_output=True, text=True,
                env={**os.environ, "MOBILE_SHA": "a" * 40, "GITHUB_OUTPUT": output},
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(Path(output).read_text(), "sha=" + "a" * 40 + "\n")


if __name__ == "__main__":
    unittest.main()
