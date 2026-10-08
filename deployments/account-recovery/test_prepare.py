"""Immutable source closure, ten-callable scope and unchanged existing settings."""
from copy import deepcopy
import contextlib
import io
import json
from pathlib import Path
import re
import tempfile
import unittest
import zipfile
import prepare

class FakeApi:
    def __init__(self):
        self.rows, self.archives, self.policies = {}, {}, {}
        self.rows[prepare.audit.PARENT + '/functions/unrelated'] = {'versionId': '7'}
        for name in prepare.EXISTING: self.install(name)
    def install(self, name):
        d = prepare.definitions()[name]
        self.rows[prepare.audit.PARENT + '/functions/' + name] = {'name': prepare.audit.PARENT + '/functions/' + name,
            'status': 'ACTIVE', 'entryPoint': name, 'runtime': 'nodejs22', 'versionId': '1', 'timeout': d['timeout'],
            'availableMemoryMb': 256, 'serviceAccountEmail': prepare.SERVICE_ACCOUNT, 'environment': 'GEN_1',
            'httpsTrigger': {'url': f'https://{prepare.audit.REGION}-{prepare.audit.PROJECT}.cloudfunctions.net/{name}'},
            'labels': {'deployment-callable': 'true', 'deployment-tool': 'cli-firebase', 'firebase-functions-hash': 'old-source'},
            **({'maxInstances': d['maxInstances']} if d['maxInstances'] else {})}
        self.policies[name] = {'etag': 'fixture', 'bindings': [{'role': 'roles/cloudfunctions.invoker', 'members': ['allUsers']}]}
        self.archives[name] = b'old-rollback-archive'
    def inventory(self): return deepcopy(self.rows)
    def iam(self, endpoint): return deepcopy(self.policies[endpoint])
    def source(self, endpoint, version): return self.archives[endpoint]
    def deployed(self, run, extra=None):
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w') as archive:
            for path in (run / 'source').iterdir(): archive.writestr(path.name, path.read_bytes())
            if extra: archive.writestr(extra, 'unexpected')
        for name in prepare.ENDPOINTS:
            if name not in prepare.EXISTING: self.install(name)
            row = self.rows[prepare.audit.PARENT + '/functions/' + name]
            row['versionId'] = '2'; row['labels']['firebase-functions-hash'] = 'reviewed-source'
            self.archives[name] = output.getvalue()

class ReleaseTests(unittest.TestCase):
    def setUp(self):
        parent = prepare.audit.ROOT / '.netlify' / 'account-recovery-release-tests'
        parent.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=parent)
        self.run = Path(self.temp.name) / 'release'
        self.api = FakeApi(); prepare.configure()
        with contextlib.redirect_stdout(io.StringIO()): prepare.audit.prepare(self.run, self.api)
        self.api.deployed(self.run)
    def tearDown(self): self.temp.cleanup()
    def verify(self):
        with contextlib.redirect_stdout(io.StringIO()): prepare.verify(self.run, self.api)
    def test_exact_ten_endpoints_default_codebase_and_runtime_verify(self):
        self.verify()
        proof = prepare.audit.read(self.run / 'verified.json')
        self.assertTrue(proof['existingRuntimeAndIamPreserved'])
        self.assertTrue(proof['unrelatedFunctionsPreserved'])
        self.assertEqual(len(proof['functions']), 10)
        self.assertNotIn('codebase', prepare.audit.read(self.run / 'firebase.json')['functions'])
        self.assertEqual(set(proof['explicitEndpointFilter'].split(',')), {'functions:' + name for name in prepare.ENDPOINTS})
    def test_prepared_source_change_refused(self):
        (self.run / 'source' / 'index.js').write_text('changed')
        with self.assertRaisesRegex(RuntimeError, 'Prepared source changed'): self.verify()
    def test_unexpected_uploaded_source_refused(self):
        self.api.deployed(self.run, 'credentials.json')
        with self.assertRaisesRegex(RuntimeError, 'Unexpected file'): self.verify()
    def test_unrelated_version_change_refused(self):
        self.api.rows[prepare.audit.PARENT + '/functions/unrelated']['versionId'] = '8'
        with self.assertRaisesRegex(RuntimeError, 'Unrelated'): self.verify()
    def test_capacity_change_on_existing_endpoint_refused(self):
        self.api.rows[prepare.audit.PARENT + '/functions/getAccountAccessLink']['maxInstances'] = 5
        with self.assertRaisesRegex(RuntimeError, 'Capacity'): self.verify()
    def test_secret_binding_refused(self):
        self.api.rows[prepare.audit.PARENT + '/functions/submitAccountRecoveryRequest']['secretEnvironmentVariables'] = [{'key': 'unrelated'}]
        with self.assertRaisesRegex(RuntimeError, 'binding'): self.verify()
    def test_existing_environment_change_refused(self):
        self.api.rows[prepare.audit.PARENT + '/functions/getAccountAccessLink']['environmentVariables'] = {'unexpected': 'value'}
        with self.assertRaisesRegex(RuntimeError, 'configuration changed'): self.verify()
        self.assertFalse((self.run / 'verified.json').exists())
    def test_existing_iam_change_refused(self):
        self.api.policies['getAccountAccessLink']['etag'] = 'unexpected-update'
        with self.assertRaisesRegex(RuntimeError, 'IAM policy changed'): self.verify()
    def test_owned_codebase_change_refused(self):
        self.api.rows[prepare.audit.PARENT + '/functions/getAccountAccessLink']['labels']['firebase-functions-codebase'] = 'another'
        with self.assertRaisesRegex(RuntimeError, 'ownership'): self.verify()
    def test_source_transitive_requires_are_contained(self):
        names = {'index.js', *prepare.FILES}
        for filename in names:
            if not filename.endswith('.js'): continue
            source = (self.run / 'source' / filename).read_text()
            for dependency in re.findall(r'require\(["\']\./([^"\']+)["\']\)', source):
                target = dependency if dependency.endswith(('.js', '.json')) else dependency + '.js'
                self.assertIn(target, names, filename + ' has an unstaged dependency')

if __name__ == '__main__': unittest.main()
