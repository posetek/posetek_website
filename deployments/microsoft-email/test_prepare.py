"""Offline source/IAM/secret audit and private flow-package regression checks."""
from copy import deepcopy
import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile
import prepare
import build_flow

class FakeApi:
    def __init__(self):
        self.rows = {prepare.audit.PARENT + '/functions/unrelated': {'versionId': '9'}}
        self.policies = {}
        self.archives = {}
    def inventory(self): return deepcopy(self.rows)
    def source(self, endpoint, version): return self.archives[endpoint]
    def iam(self, endpoint): return deepcopy(self.policies.get(endpoint, {'bindings': []}))
    def deployed(self, run):
        data = io.BytesIO()
        with zipfile.ZipFile(data, 'w') as archive:
            for source in (run / 'source').iterdir(): archive.writestr(source.name, source.read_bytes())
        for name, definition in prepare.definitions().items():
            row = {'name': prepare.audit.PARENT + '/functions/' + name, 'status': 'ACTIVE', 'entryPoint': name, 'runtime': 'nodejs22', 'versionId': '1',
                   **{key: definition[key] for key in ('timeout', 'availableMemoryMb', 'maxInstances')},
                   'secretEnvironmentVariables': [{'key': key, 'secret': key, 'version': '1'} for key in definition['secrets']]}
            if name == 'reconcileMicrosoftEmail': row['eventTrigger'] = deepcopy(definition['eventTrigger'])
            else:
                row['httpsTrigger'] = {'url': f'https://{prepare.audit.REGION}-{prepare.audit.PROJECT}.cloudfunctions.net/{name}'}
                self.policies[name] = {'bindings': [{'role': 'roles/cloudfunctions.invoker', 'members': ['allUsers']}]}
            self.rows[row['name']] = row
            self.archives[name] = data.getvalue()

class MicrosoftReleaseTests(unittest.TestCase):
    def setUp(self):
        parent = prepare.audit.ROOT / '.netlify' / 'microsoft-email-release-tests'
        parent.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=parent)
    def tearDown(self): self.temp.cleanup()
    def prepared(self):
        release, api = prepare.configure(), FakeApi()
        run = Path(self.temp.name) / 'release'
        with contextlib.redirect_stdout(io.StringIO()): release.prepare(run, api)
        api.deployed(run)
        return release, api, run
    def test_three_endpoints_verify_and_unrelated_inventory_preserved(self):
        release, api, run = self.prepared()
        with contextlib.redirect_stdout(io.StringIO()): release.verify(run, api)
        self.assertTrue(release.read(run / 'verified.json')['unrelatedFunctionsPreserved'])
        self.assertEqual(release.read(run / 'firebase.json')['functions']['codebase'], 'microsoft-email')
    def test_claim_secret_and_private_source_audit_cannot_be_bypassed(self):
        release, api, run = self.prepared()
        api.rows[release.PARENT + '/functions/claimMicrosoftEmail']['secretEnvironmentVariables'] = []
        with self.assertRaisesRegex(RuntimeError, 'Secret bindings'): release.verify(run, api)
    def test_trace_scheduler_does_not_gain_callback_secret(self):
        release, api, run = self.prepared()
        api.rows[release.PARENT + '/functions/reconcileMicrosoftEmail']['secretEnvironmentVariables'].append({'key': 'MICROSOFT_EMAIL_CALLBACK_SECRET', 'secret': 'MICROSOFT_EMAIL_CALLBACK_SECRET', 'version': '1'})
        with self.assertRaisesRegex(RuntimeError, 'Secret bindings'): release.verify(run, api)
    def test_import_package_is_new_and_private_configuration_is_not_printed(self):
        output = Path(self.temp.name) / 'flow.zip'
        cfg = Path(self.temp.name) / 'private.json'
        cfg.write_text(json.dumps({'callerObjectId': '11111111-1111-1111-1111-111111111111', 'callbackSecret': 'private-fixture-secret-' + 'x' * 32, 'outlookConnectionName': 'fixture-connection'}))
        metadata = build_flow.build(output, cfg)
        self.assertNotIn('private-fixture', json.dumps(metadata))
        with zipfile.ZipFile(output) as archive:
            manifest = json.loads(archive.read('manifest.json'))
            flow = json.loads(archive.read(next(name for name in archive.namelist() if name.endswith('/definition.json'))))
        resource = next(row for row in manifest['resources'].values() if row['type'] == 'Microsoft.Flow/flows')
        self.assertEqual(resource['suggestedCreationType'], 'New')
        definition = flow['properties']['definition']
        self.assertEqual(definition['triggers']['manual']['inputs']['triggerAllowedUsers'], '11111111-1111-1111-1111-111111111111')
        self.assertEqual(definition['actions']['Claim']['inputs']['retryPolicy']['type'], 'none')
        send = definition['actions']['Has_send_permission']['actions']['Send_email_once']
        self.assertEqual(send['inputs']['retryPolicy']['type'], 'none')
        self.assertEqual(send['inputs']['parameters']['emailMessage/To'], "@body('Claim')?['to']")
        with self.assertRaisesRegex(ValueError, 'NEW ignored'): build_flow.build(output, cfg)

if __name__ == '__main__': unittest.main()
