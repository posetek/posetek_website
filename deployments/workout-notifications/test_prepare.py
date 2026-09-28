"""Regression checks for scoped source, transport, secret and rollback auditing."""
from copy import deepcopy
import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile
import prepare


class FakeApi:
    def __init__(self, release):
        self.release = release
        self.rows = {release.PARENT + '/functions/unrelated': {'versionId': '7'}}
        self.archives = {}
        self.policies = {}

    def inventory(self): return deepcopy(self.rows)
    def source(self, endpoint, version): return self.archives[endpoint]
    def iam(self, endpoint): return deepcopy(self.policies.get(endpoint, {'bindings': [], 'etag': 'fixture'}))

    def deployed(self, run, extra=None):
        release = self.release
        data = io.BytesIO()
        with zipfile.ZipFile(data, 'w') as archive:
            for path in (run / 'source').iterdir(): archive.writestr(path.name, path.read_bytes())
            if extra: archive.writestr(extra, 'unexpected')
        for name, definition in prepare.definitions().items():
            row = {'name': release.PARENT + '/functions/' + name, 'status': 'ACTIVE', 'entryPoint': name,
                   'runtime': 'nodejs22', 'versionId': '1',
                   **{key: deepcopy(definition[key]) for key in ('timeout', 'availableMemoryMb', 'maxInstances')},
                   'secretEnvironmentVariables': [{'key': key, 'secret': key, 'version': '1', 'projectId': release.PROJECT} for key in definition['secrets']]}
            if name in prepare.HTTPS:
                row.update({'httpsTrigger': {'url': f'https://{release.REGION}-{release.PROJECT}.cloudfunctions.net/{name}'},
                            'labels': {'deployment-callable': 'true'} if name in prepare.CALLABLES else {}, 'ingressSettings': 'ALLOW_ALL'})
                self.policies[name] = {'etag': 'fixture', 'bindings': [{'role': 'roles/cloudfunctions.invoker', 'members': ['allUsers']}]}
            else: row['eventTrigger'] = deepcopy(definition['eventTrigger'])
            self.rows[row['name']] = row
            self.archives[name] = data.getvalue()


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        parent = prepare.audit.ROOT / '.netlify' / 'workout-release-tests'
        parent.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=parent)

    def tearDown(self): self.temp.cleanup()

    def setup_scope(self, scope):
        release = prepare.configure(scope)
        run = Path(self.temp.name) / scope
        api = FakeApi(release)
        with contextlib.redirect_stdout(io.StringIO()): release.prepare(run, api)
        api.deployed(run)
        return release, run, api

    def verify(self, release, run, api):
        with contextlib.redirect_stdout(io.StringIO()): release.verify(run, api)

    def test_all_three_scopes_verify_exact_sources(self):
        for scope in prepare.SCOPES:
            with self.subTest(scope=scope):
                release, run, api = self.setup_scope(scope)
                self.verify(release, run, api)
                self.assertTrue(release.read(run / 'verified.json')['unrelatedFunctionsPreserved'])
                self.assertEqual(release.read(run / 'firebase.json')['functions']['codebase'], 'workout-notifications-' + scope)

    def test_scope_mismatch_refuses_before_reading_deployment(self):
        release, run, api = self.setup_scope('intake')
        prepare.configure('delivery')
        with self.assertRaisesRegex(RuntimeError, 'scope'): self.verify(release, run, api)

    def test_local_source_changes_refused(self):
        release, run, api = self.setup_scope('intake')
        (run / 'source' / 'index.js').write_text('changed')
        with self.assertRaisesRegex(RuntimeError, 'Prepared source changed'): self.verify(release, run, api)

    def test_unrelated_function_changes_refused(self):
        release, run, api = self.setup_scope('intake')
        api.rows[release.PARENT + '/functions/unrelated']['versionId'] = '8'
        with self.assertRaisesRegex(RuntimeError, 'Unrelated'): self.verify(release, run, api)

    def test_unexpected_published_file_refused(self):
        release, run, api = self.setup_scope('intake')
        api.deployed(run, 'private.json')
        with self.assertRaisesRegex(RuntimeError, 'Unexpected file'): self.verify(release, run, api)

    def test_extra_secret_on_intake_refused(self):
        release, run, api = self.setup_scope('intake')
        api.rows[release.PARENT + '/functions/recordWorkoutActivity']['secretEnvironmentVariables'] = [{'key': 'RESEND_API_KEY', 'secret': 'RESEND_API_KEY', 'version': '1'}]
        with self.assertRaisesRegex(RuntimeError, 'Secret bindings'): self.verify(release, run, api)

    def test_missing_sender_secret_refused(self):
        release, run, api = self.setup_scope('delivery')
        api.rows[release.PARENT + '/functions/dispatchWorkoutNotification']['secretEnvironmentVariables'] = []
        with self.assertRaisesRegex(RuntimeError, 'Secret bindings'): self.verify(release, run, api)

    def test_webhook_does_not_require_callable_label(self):
        release, run, api = self.setup_scope('webhook')
        self.verify(release, run, api)
        api.rows[release.PARENT + '/functions/resendWorkoutNotificationWebhook']['labels']['deployment-callable'] = 'true'
        with self.assertRaisesRegex(RuntimeError, 'Callable label'): self.verify(release, run, api)

    def test_webhook_requires_public_transport_and_exact_secret(self):
        release, run, api = self.setup_scope('webhook')
        api.policies['resendWorkoutNotificationWebhook']['bindings'] = []
        with self.assertRaisesRegex(RuntimeError, 'invoker missing'): self.verify(release, run, api)

    def test_workout_source_namespace_change_refused(self):
        release, run, api = self.setup_scope('intake')
        api.rows[release.PARENT + '/functions/observePersonalWorkoutNotifications']['eventTrigger']['resource'] = 'players/{playerId}/workoutLogs/{logId}'
        with self.assertRaisesRegex(RuntimeError, 'Event trigger'): self.verify(release, run, api)

    def test_empty_scheduler_failure_policy_is_equivalent_without_mutating_metadata(self):
        release, run, api = self.setup_scope('delivery')
        row = api.rows[release.PARENT + '/functions/sweepWorkoutNotifications']
        row['eventTrigger']['failurePolicy'] = {}
        before = deepcopy(row)
        self.verify(release, run, api)
        prepare.validate('sweepWorkoutNotifications', row, {})
        self.assertEqual(row, before)
        self.assertNotIn('failurePolicy', prepare.definitions()['sweepWorkoutNotifications']['eventTrigger'])

    def test_scheduler_explicit_retry_or_malformed_policy_refused(self):
        release, run, api = self.setup_scope('delivery')
        trigger = api.rows[release.PARENT + '/functions/sweepWorkoutNotifications']['eventTrigger']
        for policy in ({'retry': {}}, {'unexpected': {}}, None, []):
            with self.subTest(policy=policy):
                trigger['failurePolicy'] = policy
                with self.assertRaisesRegex(RuntimeError, 'Event trigger'): self.verify(release, run, api)

    def test_sender_still_requires_explicit_retry_policy(self):
        release, run, api = self.setup_scope('delivery')
        trigger = api.rows[release.PARENT + '/functions/dispatchWorkoutNotification']['eventTrigger']
        trigger['failurePolicy'] = {}
        with self.assertRaisesRegex(RuntimeError, 'Event trigger'): self.verify(release, run, api)
        del trigger['failurePolicy']
        with self.assertRaisesRegex(RuntimeError, 'Event trigger'): self.verify(release, run, api)

    def test_scheduled_trigger_changes_refused_even_with_empty_failure_policy(self):
        release, run, api = self.setup_scope('delivery')
        row = api.rows[release.PARENT + '/functions/sweepWorkoutNotifications']
        original = deepcopy(row['eventTrigger'])
        for field in ('resource', 'eventType', 'service', 'unexpected'):
            with self.subTest(field=field):
                row['eventTrigger'] = {**original, 'failurePolicy': {}, field: 'wrong'}
                with self.assertRaisesRegex(RuntimeError, 'Event trigger'): self.verify(release, run, api)


if __name__ == '__main__': unittest.main()
