"""Synthetic report checks; they never execute model content or publish findings."""

import unittest

from reviewer_contract import validate_report


REVISIONS = dict(base_sha="a" * 40, head_sha="b" * 40, policy_sha="c" * 40)
LINES = {"src/example.py": {8, 9, 10}}


def report():
    return {**REVISIONS, "status": "complete", "summary": "Reviewed the supplied scope.",
            "findings": [{"severity": "P2", "path": "src/example.py", "line": 9,
                          "evidence": "An empty input triggers the unchecked index.",
                          "suggestion": "Handle an empty input before indexing."}]}


def check(value, complete=True):
    return validate_report(value, revisions=REVISIONS, inspected_lines=LINES,
                           scope_complete=complete)


class ReviewerContractTests(unittest.TestCase):
    def test_valid_scoped_findings_and_zero_findings_are_allowed(self):
        self.assertEqual(check(report()), [])
        value = report()
        value["findings"] = []
        self.assertEqual(check(value), [])

    def test_new_head_or_changed_policy_invalidates_report(self):
        for key in REVISIONS:
            value = report()
            value[key] = "d" * 40
            self.assertTrue(check(value), key)

    def test_incomplete_scope_never_becomes_complete_review(self):
        self.assertTrue(check(report(), complete=False))
        value = report()
        value["status"] = "partial"
        value["summary"] = "Only one file was inspected; remaining scope omitted."
        self.assertEqual(check(value, complete=False), [])

    def test_unavailable_and_not_run_remain_explicit(self):
        for status in ("unavailable", "not-run"):
            value = report()
            value["status"] = status
            self.assertTrue(check(value))
            value["findings"] = []
            self.assertEqual(check(value), [])

    def test_actions_and_uninspected_locations_are_rejected(self):
        for key in ("approve", "merge", "deploy", "run", "spend_override"):
            value = report()
            value[key] = True
            self.assertTrue(check(value), key)
        for path, line in (("../secret", 9), ("src/other.py", 9),
                           ("src/example.py", 99), ("src/example.py", True)):
            value = report()
            value["findings"][0].update(path=path, line=line)
            self.assertTrue(check(value))

    def test_malformed_or_oversized_model_output_fails_without_execution(self):
        for value in (None, [], {"status": ["complete"]}):
            self.assertTrue(check(value))
        for status in (["complete"], {"status": "complete"}, None, True):
            value = report()
            value["status"] = status
            self.assertTrue(check(value))
        value = report()
        value["findings"] = value["findings"] * 51
        self.assertTrue(check(value))
        value = report()
        value["summary"] = "x" * 4001
        self.assertTrue(check(value))
        value = report()
        value["findings"][0]["run"] = "echo do-not-execute"
        self.assertTrue(check(value))

    def test_invalid_resolver_metadata_is_a_configuration_error(self):
        with self.assertRaises(ValueError):
            validate_report(report(), revisions={"head_sha": "main"},
                            inspected_lines=LINES, scope_complete=True)
        with self.assertRaises(ValueError):
            validate_report(report(), revisions=REVISIONS,
                            inspected_lines={"../outside": {1}}, scope_complete=True)


if __name__ == "__main__":
    unittest.main()
