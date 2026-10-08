"""Keep the inactive PR parity proposal unprivileged and fail-closed."""
from copy import deepcopy
from pathlib import Path
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[1]
PROPOSAL = ROOT / "ci/mobile-contract-pr-job.yml"


def validate(candidate):
    assert set(candidate) == {"mobile-contract"}
    job = candidate["mobile-contract"]
    assert job["permissions"] == {"contents": "read", "actions": "read"}
    assert job["runs-on"] == "ubuntu-24.04"
    assert 0 < int(job["timeout-minutes"]) <= 10
    assert not job.get("if") and not job.get("continue-on-error")
    checkout, select, download, node, verify, install, parity = job["steps"]
    assert checkout["uses"] == "actions/checkout@11d5960a326750d5838078e36cf38b85af677262"
    assert checkout["with"] == {"persist-credentials": "false"}
    assert select["id"] == "source"
    assert select["env"] == {"GH_TOKEN": "${{ github.token }}"}
    assert select["run"] == "python3 ci/mobile_contract_artifact.py"
    assert download["uses"] == "actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093"
    assert download["with"] == {
        "artifact-ids": "${{ steps.source.outputs.artifact-id }}",
        "repository": "posetek/posetek_website",
        "run-id": "${{ steps.source.outputs.run-id }}",
        "github-token": "${{ github.token }}",
        "path": "${{ runner.temp }}/mobile-contract-source",
    }
    assert verify["env"] == {"MOBILE_CONTRACT_ARTIFACT": "${{ runner.temp }}/mobile-contract-source"}
    assert verify["run"] == "node ci/verify-mobile-contract-artifact.cjs"
    assert node["uses"] == "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020"
    assert node["with"] == {"node-version": "22.23.3"}
    assert install["run"] == "npm --prefix functions ci --ignore-scripts --no-audit --no-fund"
    assert parity["env"] == {"POSETEK_MOBILE_REPO": "${{ runner.temp }}/mobile-contract-source"}
    assert parity["run"] == "node --test functions/device-performance-parity.integration.cjs"
    for step in job["steps"]:
        assert not step.get("if") and not step.get("continue-on-error")
        assert not any("secrets." in str(value) for value in step.values())


class MobileContractPrJobTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.candidate = yaml.load(PROPOSAL.read_text(), Loader=yaml.BaseLoader)

    def test_candidate_is_outside_active_workflows_and_has_a_closed_gate(self):
        self.assertFalse(str(PROPOSAL.relative_to(ROOT)).startswith(".github/workflows/"))
        validate(self.candidate)

    def test_permission_or_gate_weakening_is_rejected(self):
        mutations = [
            lambda job: job["permissions"].update(contents="write"),
            lambda job: job.update(**{"continue-on-error": "true"}),
            lambda job: job["steps"][1].update(**{"if": "false"}),
            lambda job: job["steps"][2]["with"].update(**{"artifact-ids": ""}),
            lambda job: job["steps"][4].update(run="echo verified"),
            lambda job: job["steps"][6].update(run="echo parity passed"),
            lambda job: job["steps"][0]["with"].update(**{"persist-credentials": "true"}),
        ]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                candidate = deepcopy(self.candidate)
                mutate(candidate["mobile-contract"])
                with self.assertRaises(AssertionError):
                    validate(candidate)


if __name__ == "__main__":
    unittest.main()
