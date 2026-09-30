"""Local fixtures only: no credentials, network calls, deployments or email."""
from copy import deepcopy
import contextlib
import io
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
        name = prepare.ENDPOINT
        self.rows[release.PARENT + '/functions/' + name] = {
            'name': release.PARENT + '/functions/' + name, 'status': 'ACTIVE', 'entryPoint': name,
            'runtime': 'nodejs22', 'versionId': '1', 'timeout': '60s', 'availableMemoryMb': 256, 'maxInstances': 5,
            'secretEnvironmentVariables': [{'key': 'RESEND_API_KEY', 'secret': 'RESEND_API_KEY', 'version': '1', 'projectId': release.PROJECT}],
            'httpsTrigger': {'url': f'https://{release.REGION}-{release.PROJECT}.cloudfunctions.net/{name}'},
            'ingressSettings': 'ALLOW_ALL', 'labels': {},
        }
        self.policies[name] = {'etag': 'fixture', 'bindings': [{'role': 'roles/cloudfunctions.invoker', 'members': ['allUsers']}]}
        self.archives[name] = data.getvalue()


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.release = prepare.configure()
        parent = self.release.ROOT / '.netlify' / 'booking-release-tests'
        parent.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=parent)
        self.run = Path(self.temp.name) / 'source-release'
        self.api = FakeApi(self.release)
        with contextlib.redirect_stdout(io.StringIO()): self.release.prepare(self.run, self.api)
        self.api.deployed(self.run)

    def tearDown(self): self.temp.cleanup()

    def verify(self):
        with contextlib.redirect_stdout(io.StringIO()): self.release.verify(self.run, self.api)

    def row(self): return self.api.rows[self.release.PARENT + '/functions/' + prepare.ENDPOINT]

    def test_scoped_source_and_configuration_verify(self):
        self.verify()
        config = self.release.read(self.run / 'firebase.json')
        self.assertEqual(set(config), {'functions'})
        self.assertEqual(config['functions']['codebase'], 'performance-test-booking')
        manifest = self.release.read(self.run / 'manifest.json')
        self.assertEqual(manifest['endpoints'], [prepare.ENDPOINT])
        self.assertNotIn('workout-notifications.js', manifest['files'])
        self.assertTrue(self.release.read(self.run / 'verified.json')['unrelatedFunctionsPreserved'])

    def test_prepared_source_and_extra_deployed_source_are_rejected(self):
        original = (self.run / 'source' / 'index.js').read_bytes()
        (self.run / 'source' / 'index.js').write_text('changed')
        with self.assertRaisesRegex(RuntimeError, 'Prepared source changed'): self.verify()
        (self.run / 'source' / 'index.js').write_bytes(original)
        self.api.deployed(self.run, 'private.json')
        with self.assertRaisesRegex(RuntimeError, 'Unexpected file'): self.verify()

    def test_unrelated_function_changes_are_rejected(self):
        self.api.rows[self.release.PARENT + '/functions/unrelated']['versionId'] = '8'
        with self.assertRaisesRegex(RuntimeError, 'Unrelated'): self.verify()

    def test_secret_scope_and_version_are_checked(self):
        for patch in ({'secret': 'OTHER_KEY'}, {'projectId': 'other-project'}, {'version': 'latest'}):
            with self.subTest(patch=patch):
                self.api.deployed(self.run)
                self.row()['secretEnvironmentVariables'][0].update(patch)
                with self.assertRaisesRegex(RuntimeError, 'Secret binding'): self.verify()
        self.api.deployed(self.run)
        self.row()['secretEnvironmentVariables'] = []
        with self.assertRaisesRegex(RuntimeError, 'Secret bindings'): self.verify()

    def test_endpoint_identity_and_runtime_bounds_are_checked(self):
        for patch in ({'name': 'wrong'}, {'entryPoint': 'wrong'}, {'runtime': 'nodejs20'}, {'maxInstances': 50}, {'timeout': '540s'}):
            with self.subTest(patch=patch):
                self.api.deployed(self.run); self.row().update(patch)
                with self.assertRaises(RuntimeError): self.verify()

    def test_public_http_transport_must_not_become_callable(self):
        self.row()['labels']['deployment-callable'] = 'true'
        with self.assertRaisesRegex(RuntimeError, 'HTTP transport'): self.verify()
        self.api.deployed(self.run)
        self.row()['httpsTrigger']['url'] = 'https://wrong.example'
        with self.assertRaisesRegex(RuntimeError, 'HTTPS trigger'): self.verify()
        self.api.deployed(self.run)
        self.api.policies[prepare.ENDPOINT]['bindings'] = []
        with self.assertRaisesRegex(RuntimeError, 'invoker missing'): self.verify()


if __name__ == '__main__': unittest.main()
