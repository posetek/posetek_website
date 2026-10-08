"""Guard the trusted source workflow and exercise artifact staging."""
from copy import deepcopy
from pathlib import Path
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[1]
STAGE = ROOT / "ci/stage-mobile-contract.sh"


def validate(workflow):
    assert workflow["permissions"] == {}
    assert set(workflow["on"]) == {"workflow_dispatch"}
    assert workflow["on"]["workflow_dispatch"]["inputs"] == {
        "mobile_sha": {
            "description": "Reviewed full mobile commit SHA for public contract data",
            "required": "true", "type": "string",
        },
    }
    assert set(workflow["jobs"]) == {"source"}
    job = workflow["jobs"]["source"]
    assert job["runs-on"] == "ubuntu-24.04"
    assert 0 < int(job["timeout-minutes"]) <= 10
    assert job["environment"] == "mobile-contract-source"
    assert job["permissions"] == {"contents": "read"}
    assert not job.get("continue-on-error")
    website, revision, token, mobile, stage, upload = job["steps"]
    assert website["uses"] == "actions/checkout@11d5960a326750d5838078e36cf38b85af677262"
    assert website["with"] == {"persist-credentials": "false"}
    assert revision["id"] == "revision"
    assert revision["env"] == {"REVIEWED_MOBILE_SHA": "${{ inputs.mobile_sha }}"}
    assert '"$GITHUB_REF" != refs/heads/main' in revision["run"]
    assert 'mobile_sha="$REVIEWED_MOBILE_SHA"' in revision["run"]
    assert "${{" not in revision["run"]
    assert "^[0-9a-f]{40}$" in revision["run"]
    assert '>> "$GITHUB_OUTPUT"' in revision["run"]
    assert token["uses"] == "actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1"
    assert token["with"] == {
        "client-id": "${{ vars.POSETEK_CI_APP_CLIENT_ID }}",
        "private-key": "${{ secrets.POSETEK_CI_APP_PRIVATE_KEY }}",
        "owner": "posetek", "repositories": "posetek-mobile-app",
        "permission-contents": "read",
    }
    assert mobile["uses"] == "actions/checkout@11d5960a326750d5838078e36cf38b85af677262"
    assert mobile["with"] == {
        "repository": "posetek/posetek-mobile-app", "ref": "${{ steps.revision.outputs.sha }}",
        "token": "${{ steps.app-token.outputs.token }}", "persist-credentials": "false", "path": "mobile",
    }
    assert stage["env"] == {
        "MOBILE_DIR": "mobile", "EXPECTED_SHA": "${{ steps.revision.outputs.sha }}",
        "ARTIFACT_ROOT": "${{ runner.temp }}/mobile-contract-artifact",
    }
    assert stage["run"] == "set -euo pipefail\nbash ci/stage-mobile-contract.sh\n"
    assert upload["uses"] == "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02"
    assert upload["with"]["name"] == "mobile-contract-${{ steps.revision.outputs.sha }}"
    assert upload["with"]["path"] == "${{ runner.temp }}/mobile-contract-artifact/"
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
            (ROOT / ".github/workflows/mobile-contract-source.yml").read_text(), Loader=yaml.BaseLoader,
        )

    def test_trusted_source_workflow(self):
        validate(self.workflow)
        manifest = json.loads((ROOT / "ci/mobile-contract-source.json").read_text())
        self.assertEqual(manifest["repository"], "posetek/posetek-mobile-app")
        self.assertRegex(manifest["sha"], r"^[0-9a-f]{40}$")

    def test_privilege_expansions_are_rejected(self):
        mutations = [
            lambda w: w["on"].update(pull_request_target={}),
            lambda w: w["on"]["workflow_dispatch"]["inputs"]["mobile_sha"].update(required="false"),
            lambda w: w["jobs"]["source"].update(environment="unprotected"),
            lambda w: w["jobs"]["source"].update(permissions={"contents": "write"}),
            lambda w: w["jobs"]["source"]["steps"][2]["with"].update(repositories="other-repo"),
            lambda w: w["jobs"]["source"]["steps"][2]["with"].update(**{"permission-contents": "write"}),
            lambda w: w["jobs"]["source"]["steps"][3]["with"].update(**{"persist-credentials": "true"}),
            lambda w: w["jobs"]["source"]["steps"][3]["with"].update(ref="${{ github.event.pull_request.head.sha }}"),
            lambda w: w["jobs"]["source"]["steps"][1]["env"].update(REVIEWED_MOBILE_SHA="${{ github.event.pull_request.head.sha }}"),
            lambda w: w["jobs"]["source"]["steps"][1].update(run="set -euo pipefail\nmobile_sha='${{ inputs.mobile_sha }}'\n"),
            lambda w: w["jobs"]["source"]["steps"][5]["with"].update(**{"if-no-files-found": "warn"}),
        ]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                candidate = deepcopy(self.workflow)
                mutate(candidate)
                with self.assertRaises(AssertionError):
                    validate(candidate)

    def test_revision_validation_fails_outside_main_or_for_bad_input(self):
        script = self.workflow["jobs"]["source"]["steps"][1]["run"]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "step-output"

            def run(value="a" * 40, ref="refs/heads/main"):
                return subprocess.run(
                    ["bash", "-c", script], cwd=root, capture_output=True, text=True,
                    env={**os.environ, "GITHUB_EVENT_NAME": "workflow_dispatch", "GITHUB_REF": ref,
                         "GITHUB_OUTPUT": str(output), "REVIEWED_MOBILE_SHA": value},
                )

            self.assertNotEqual(run(ref="refs/heads/feature").returncode, 0)
            self.assertFalse(output.exists())
            injection = "$(touch injected)"
            for value in ("", "a" * 39, "A" * 40, "a" * 40 + "\nanything", injection):
                self.assertNotEqual(run(value).returncode, 0)
                self.assertFalse(output.exists())
            self.assertFalse((root / "injected").exists())
            result = run()
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(output.read_text(), "sha=" + "a" * 40 + "\n")

    def test_staging_accepts_exact_data_and_rejects_escape_and_missing_fixture(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            mobile = root / "mobile"
            source = mobile / "tools/contracts/device-performance-v1"
            (source / "fixtures").mkdir(parents=True)
            (source / "schema.json").write_text('{"type":"object"}')
            (source / "README.md").write_text("prose only")
            (source / "fixtures/one.json").write_text('{"ok":true}')
            (mobile / "firebase").mkdir()
            (mobile / "firebase/firestore.rules").write_text("private rules")
            (mobile / "firebase/storage.rules").write_text("private rules")
            subprocess.run(["git", "init", "-q", str(mobile)], check=True)
            subprocess.run(["git", "-C", str(mobile), "add", "."], check=True)
            subprocess.run(["git", "-C", str(mobile), "-c", "user.name=CI", "-c", "user.email=ci@example.invalid",
                            "commit", "-qm", "fixture"], check=True)
            sha = subprocess.check_output(["git", "-C", str(mobile), "rev-parse", "HEAD"], text=True).strip()
            output = root / "artifact"

            def stage():
                return subprocess.run(
                    ["bash", str(STAGE)], capture_output=True, text=True,
                    env={**os.environ, "MOBILE_DIR": str(mobile), "EXPECTED_SHA": sha,
                         "ARTIFACT_ROOT": str(output)},
                )

            result = stage()
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual((output / "source-sha.txt").read_text(), sha + "\n")
            self.assertEqual((output / "tools/contracts/device-performance-v1/fixtures/one.json").read_text(), '{"ok":true}')
            self.assertFalse((output / "tools/contracts/device-performance-v1/README.md").exists())
            self.assertFalse((output / "firebase").exists(), "private rules must not be staged")
            (source / "fixtures/one.json").unlink()
            self.assertNotEqual(stage().returncode, 0, "empty fixtures must fail")
            (source / "fixtures/one.json").write_text('{"ok":true}')
            (source / "fixtures/unexpected.txt").write_text("unexpected")
            self.assertNotEqual(stage().returncode, 0, "non-contract file must fail")
            (source / "fixtures/unexpected.txt").unlink()
            outside = root / "outside"
            shutil.move(str(mobile / "tools"), outside)
            (mobile / "tools").symlink_to(outside, target_is_directory=True)
            self.assertNotEqual(stage().returncode, 0, "ancestor symlink must fail")


if __name__ == "__main__":
    unittest.main()
