"""Reject untrusted or incomplete mobile-source artifacts before download."""
import unittest

from mobile_contract_artifact import select_artifact

SHA = "a" * 40


def artifact(**changes):
    value = {"name": "mobile-contract-" + SHA, "expired": False, "id": 21,
             "size_in_bytes": 1234, "workflow_run": {"id": 12}}
    value.update(changes)
    return value


def run(**changes):
    value = {"id": 12, "event": "workflow_dispatch", "status": "completed",
             "conclusion": "success", "head_branch": "main",
             "path": ".github/workflows/mobile-contract-source.yml@refs/heads/main",
             "repository": {"full_name": "posetek/posetek_website"}}
    value.update(changes)
    return value


class MobileArtifactTests(unittest.TestCase):
    def test_exact_trusted_run_is_selected(self):
        self.assertEqual(select_artifact([artifact()], lambda _: run(), SHA),
                         {"run_id": 12, "artifact_id": 21, "sha": SHA})
        self.assertEqual(select_artifact([artifact(name="spoof"), artifact()], lambda _: run(), SHA)["artifact_id"], 21)

    def test_missing_expired_oversized_or_malformed_artifact_fails(self):
        for bad in ([], [artifact(expired=True)], [artifact(size_in_bytes=0)],
                    [artifact(size_in_bytes=11 * 1024 * 1024)], [artifact(workflow_run=None)],
                    [artifact(id="21")], [artifact(name="mobile-contract-" + "b" * 40)]):
            with self.subTest(artifacts=bad), self.assertRaises(ValueError):
                select_artifact(bad, lambda _: run(), SHA)

    def test_other_workflow_event_branch_or_result_fails(self):
        mutations = ({"event": "pull_request"}, {"status": "in_progress"}, {"conclusion": "failure"},
                     {"head_branch": "feature"}, {"path": ".github/workflows/untrusted.yml"},
                     {"repository": {"full_name": "another/repo"}}, {"id": 13})
        for change in mutations:
            with self.subTest(change=change), self.assertRaises(ValueError):
                select_artifact([artifact()], lambda _: run(**change), SHA)

    def test_revision_must_be_full_lowercase_sha(self):
        for sha in ("", "a" * 39, "A" * 40, "a" * 40 + "x"):
            with self.subTest(sha=sha), self.assertRaises(ValueError):
                select_artifact([artifact()], lambda _: run(), sha)


if __name__ == "__main__":
    unittest.main()
