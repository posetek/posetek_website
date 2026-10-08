import contextlib
from copy import deepcopy
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import prepare as release

class FakeApi:
    def __init__(self):
        self.rows = {release.PARENT + '/functions/unrelated': {'name': 'unrelated', 'versionId': '7'}}
        self.archives = {}
        self.policies = {}
    def inventory(self): return deepcopy(self.rows)
    def source(self, endpoint, version): return self.archives[endpoint]
    def iam(self, endpoint): return deepcopy(self.policies.get(endpoint, {'bindings': [], 'etag': 'fixture'}))
    def deployed(self, run, extra=None, runtime_config=None):
        data = io.BytesIO()
        with zipfile.ZipFile(data, 'w') as archive:
            for path in (run / 'source').iterdir(): archive.writestr(path.name, path.read_bytes())
            if extra: archive.writestr(extra, 'unexpected')
            if runtime_config is not None: archive.writestr('.runtimeconfig.json', runtime_config)
        for name in release.ENDPOINTS:
            definition = release.expected_definitions()[name]
            row = {'name': release.PARENT + '/functions/' + name, 'status': 'ACTIVE', 'entryPoint': name, 'runtime': 'nodejs22', 'versionId': '1',
                   **{k: deepcopy(definition[k]) for k in ('timeout', 'availableMemoryMb', 'maxInstances')}}
            if name in release.CALLABLES:
                row.update({'httpsTrigger': {'url': f'https://{release.REGION}-{release.PROJECT}.cloudfunctions.net/{name}'},
                            'labels': {'deployment-callable': 'true'}, 'ingressSettings': 'ALLOW_ALL'})
                self.policies[name] = {'etag': 'fixture', 'bindings': [{'role': 'roles/cloudfunctions.invoker', 'members': ['allUsers']}]}
            else: row['eventTrigger'] = deepcopy(definition['eventTrigger'])
            self.rows[release.PARENT + '/functions/' + name] = row
            self.archives[name] = data.getvalue()

class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp_parent = release.ROOT / '.netlify' / 'expanded-insights-release-tests'
        self.temp_parent.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=self.temp_parent)
        self.assertTrue(Path(self.temp.name).resolve().is_relative_to(self.temp_parent.resolve()))
        self.run = Path(self.temp.name) / 'run'
        self.api = FakeApi()
        with contextlib.redirect_stdout(io.StringIO()): release.prepare(self.run, self.api)
    def tearDown(self): self.temp.cleanup()
    def test_exact_source_and_unrelated_inventory(self):
        self.api.deployed(self.run)
        with contextlib.redirect_stdout(io.StringIO()): release.verify(self.run, self.api)
        self.assertTrue(json.loads((self.run / 'verified.json').read_text())['unrelatedFunctionsPreserved'])
        self.assertEqual(len(list((self.run / 'source').iterdir())), 16)
        self.assertTrue((self.run / 'source' / 'processing-evidence.js').is_file())
        self.assertTrue((self.run / 'source' / 'effective-rep.js').is_file())
        self.assertTrue((self.run / 'source' / 'athlete-profile-spec.json').is_file())
        self.assertTrue((self.run / 'source' / 'insights-overview.js').is_file())
        manifest = release.read(self.run / 'manifest.json')
        self.assertIn('insights-overview.js', manifest['moduleClosure']['imports']['insights-v2.js'])
        self.assertIn('athlete-profile-spec.json', manifest['moduleClosure']['localModules'])
        self.assertTrue(release.read(self.run / 'verified.json')['runtimeModuleClosureVerified'])
    def test_refuses_missing_transitive_module_before_creating_release_manifest(self):
        incomplete = Path(self.temp.name) / 'incomplete'
        files = tuple(name for name in release.FILES if name != 'insights-overview.js')
        with patch.object(release, 'FILES', files):
            with self.assertRaisesRegex(RuntimeError, 'Required runtime module missing: insights-v2.js -> ./insights-overview'):
                release.prepare(incomplete, self.api)
        self.assertFalse((incomplete / 'manifest.json').exists())
    def test_runtime_closure_refuses_missing_computed_escaping_and_undeclared_imports(self):
        path = self.run / 'source' / 'insights-overview.js'
        original = path.read_text(encoding='utf-8')
        manifest = release.read(self.run / 'manifest.json')['files']
        cases = [("require('./private-helper')", 'Required runtime module missing'),
                 ("require(moduleName)", 'Computed runtime import requires review'),
                 ("require('../private-helper')", 'Runtime import escapes prepared source'),
                 ("require('unreviewed-package')", 'Undeclared runtime dependency')]
        for expression, message in cases:
            with self.subTest(expression=expression):
                path.write_text(original + '\n' + expression + ';\n', encoding='utf-8')
                with self.assertRaisesRegex(RuntimeError, message):
                    release.runtime_module_closure(self.run / 'source', manifest)
        path.write_text(original, encoding='utf-8')
    def test_refuses_runtime_closure_receipt_drift(self):
        self.api.deployed(self.run)
        manifest = release.read(self.run / 'manifest.json')
        manifest['moduleClosure']['localModules'].remove('insights-overview.js')
        release.write(self.run / 'manifest.json', manifest)
        with self.assertRaisesRegex(RuntimeError, 'Prepared runtime module closure changed'):
            release.verify(self.run, self.api)
    def test_refuses_missing_overview_module_in_deployed_archive(self):
        self.api.deployed(self.run)
        data = io.BytesIO()
        with zipfile.ZipFile(data, 'w') as archive:
            for path in (self.run / 'source').iterdir():
                if path.name != 'insights-overview.js': archive.writestr(path.name, path.read_bytes())
        self.api.archives['getClubInsightsV2'] = data.getvalue()
        with self.assertRaisesRegex(RuntimeError, 'Required source absent from deployed archive'):
            release.verify(self.run, self.api)
    @unittest.skipUnless(shutil.which('node') and (release.ROOT / 'functions' / 'node_modules' / 'firebase-functions').is_dir()
                         and (release.ROOT / 'functions' / 'node_modules' / 'firebase-admin').is_dir(),
                         'Node and installed functions dependencies are required for runtime discovery')
    def test_immutable_prepared_source_discovers_exact_nine_sdk_functions(self):
        # External SDKs come from the installed dependency tree. Relative module
        # resolution stays inside the copied source, so the retired omission
        # fails here exactly as it would during Firebase CLI discovery.
        script = '''
const assert = require('node:assert/strict');
const path = require('node:path');
const index = process.argv[1];
const endpoints = JSON.parse(process.argv[2]);
const definitions = JSON.parse(process.argv[3]);
const loaded = require(index);
assert.deepEqual(Object.keys(loaded).sort(), endpoints.sort());
for (const name of endpoints) {
  const trigger = loaded[name].__trigger, expected = definitions[name];
  assert.ok(trigger, name + ' SDK trigger missing');
  assert.equal(trigger.timeout, expected.timeout, name + ' timeout');
  assert.equal(trigger.availableMemoryMb ?? 256, expected.availableMemoryMb, name + ' memory');
  assert.equal(trigger.maxInstances, expected.maxInstances, name + ' maximum instances');
  if (expected.httpsTrigger) {
    assert.ok(trigger.httpsTrigger && !trigger.eventTrigger, name + ' callable transport');
    assert.equal(trigger.labels['deployment-callable'], 'true', name + ' callable label');
  } else {
    assert.ok(!trigger.httpsTrigger, name + ' event transport');
    assert.deepEqual({...trigger.eventTrigger, failurePolicy: trigger.failurePolicy}, expected.eventTrigger, name + ' event definition');
  }
}
assert.ok(require.cache[path.join(path.dirname(index), 'insights-overview.js')]);
process.stdout.write(JSON.stringify({discovered: Object.keys(loaded).length, overviewLoaded: true}));
'''
        manifest_before = (self.run / 'manifest.json').read_bytes()
        environment = {**os.environ, 'NODE_PATH': str(release.ROOT / 'functions' / 'node_modules'),
                       'GCLOUD_PROJECT': release.PROJECT,
                       'FIREBASE_CONFIG': json.dumps({'projectId': release.PROJECT, 'storageBucket': release.BUCKET})}
        result = subprocess.run([shutil.which('node'), '-e', script, str(self.run / 'source' / 'index.js'),
                                 json.dumps(release.ENDPOINTS), json.dumps(release.expected_definitions())], cwd=self.temp.name, env=environment,
                                text=True, capture_output=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {'discovered': 9, 'overviewLoaded': True})
        self.assertEqual((self.run / 'manifest.json').read_bytes(), manifest_before)
        for name, expected in release.read(self.run / 'manifest.json')['files'].items():
            self.assertEqual(release.sha((self.run / 'source' / name).read_bytes()), expected['sha256'])
    def test_refuses_local_source_drift(self):
        self.api.deployed(self.run)
        (self.run / 'source' / 'index.js').write_text('changed')
        with self.assertRaisesRegex(RuntimeError, 'Prepared source changed'): release.verify(self.run, self.api)
    def test_refuses_unrelated_function_change(self):
        self.api.deployed(self.run)
        self.api.rows[release.PARENT + '/functions/unrelated'] = {'versionId': '8'}
        with self.assertRaisesRegex(RuntimeError, 'Unrelated'): release.verify(self.run, self.api)
    def test_refuses_unexpected_published_file(self):
        self.api.deployed(self.run, 'private.json')
        with self.assertRaisesRegex(RuntimeError, 'Unexpected file'): release.verify(self.run, self.api)
    def test_accepts_only_expected_cli_runtime_config_and_records_its_hash(self):
        data = json.dumps({'firebase': {'storageBucket': release.BUCKET, 'projectId': release.PROJECT}}, indent=2).encode()
        self.api.deployed(self.run, runtime_config=data)
        original_manifest = (self.run / 'manifest.json').read_bytes()
        with contextlib.redirect_stdout(io.StringIO()): release.verify(self.run, self.api)
        receipt = release.read(self.run / 'verified.json')
        for row in receipt['functions'].values():
            self.assertEqual(row['runtimeConfig'], {'present': True, 'sha256': release.sha(data),
                'bytes': len(data), 'schema': 'firebase-project-and-bucket'})
        self.assertEqual((self.run / 'manifest.json').read_bytes(), original_manifest)
    def test_refuses_extra_values_and_secrets_in_cli_runtime_config(self):
        allowed = {'firebase': {'projectId': release.PROJECT, 'storageBucket': release.BUCKET}}
        values = [dict(allowed, secret='fixture-secret'),
                  {'firebase': dict(allowed['firebase'], secret='fixture-secret')},
                  {'firebase': dict(allowed['firebase'], projectId='other-project')},
                  {'firebase': dict(allowed['firebase'], storageBucket='other-bucket')},
                  {'firebase': {'projectId': release.PROJECT}}, {}, None]
        for value in values:
            with self.subTest(value=value):
                self.api.deployed(self.run, runtime_config=json.dumps(value))
                with self.assertRaisesRegex(RuntimeError, 'Unexpected deployed runtime configuration'):
                    release.verify(self.run, self.api)
                self.assertFalse((self.run / 'verified.json').exists())
    def test_refuses_duplicate_keys_malformed_and_oversized_runtime_config(self):
        valid = json.dumps({'firebase': {'projectId': release.PROJECT, 'storageBucket': release.BUCKET}})
        values = ['{"firebase":{"secret":"fixture-secret"},' + valid[1:],
                  valid.replace('"projectId":', '"projectId":"fixture-secret","projectId":'),
                  '{invalid', b'\xff', ' ' * 4097]
        for value in values:
            with self.subTest(value=value[:40]):
                self.api.deployed(self.run, runtime_config=value)
                with self.assertRaisesRegex(RuntimeError, 'runtime configuration'):
                    release.verify(self.run, self.api)
    def test_refuses_source_mismatch(self):
        self.api.deployed(self.run)
        data = io.BytesIO()
        with zipfile.ZipFile(data, 'w') as archive:
            for path in (self.run / 'source').iterdir(): archive.writestr(path.name, b'wrong' if path.name == 'index.js' else path.read_bytes())
        self.api.archives[release.ENDPOINTS[0]] = data.getvalue()
        with self.assertRaisesRegex(RuntimeError, 'Deployed source differs'): release.verify(self.run, self.api)
    def test_refuses_existing_run(self):
        with self.assertRaisesRegex(RuntimeError, 'fresh run'): release.prepare(self.run, self.api)
    def test_pinned_definitions_match_observed_sdk_contract(self):
        definitions = release.expected_definitions()
        self.assertEqual(definitions['recordInsightUsage']['availableMemoryMb'], 256)
        self.assertEqual(definitions['getCoachPlayerComparison']['availableMemoryMb'], 1024)
        self.assertTrue(definitions['getCoachPlayerComparison']['publicInvoker'])
        self.assertEqual(definitions['projectInsightRecords']['eventTrigger'], {
            'resource': 'projects/kickai-69dd0/databases/(default)/documents/players/{playerId}/{collectionId}/{recordId}',
            'eventType': 'providers/cloud.firestore/eventTypes/document.write', 'service': 'firestore.googleapis.com', 'failurePolicy': {'retry': {}}})
        self.assertEqual(definitions['projectInsightArtifactDeletes']['eventTrigger']['eventType'], 'google.storage.object.delete')
    def test_refuses_each_runtime_limit_drift(self):
        for field, value, message in [('timeout', '60s', 'Timeout'), ('availableMemoryMb', 256, 'Memory'), ('maxInstances', 100, 'Maximum instances')]:
            with self.subTest(field=field):
                self.api.deployed(self.run)
                self.api.rows[release.PARENT + '/functions/getClubInsightsV2'][field] = value
                with self.assertRaisesRegex(RuntimeError, message): release.verify(self.run, self.api)
    def test_refuses_each_event_contract_drift(self):
        for field, value in [('resource', 'projects/other/buckets/other'), ('eventType', 'google.storage.object.delete'),
                             ('service', 'pubsub.googleapis.com'), ('failurePolicy', {})]:
            with self.subTest(field=field):
                self.api.deployed(self.run)
                self.api.rows[release.PARENT + '/functions/projectInsightArtifacts']['eventTrigger'][field] = value
                with self.assertRaisesRegex(RuntimeError, 'Event trigger'): release.verify(self.run, self.api)
    def test_refuses_missing_or_conditional_public_invoker(self):
        for binding in [None, {'role': 'roles/cloudfunctions.invoker', 'members': ['allAuthenticatedUsers']},
                        {'role': 'roles/cloudfunctions.invoker', 'members': ['allUsers'], 'condition': {'expression': 'false'}}]:
            with self.subTest(binding=binding):
                self.api.deployed(self.run)
                self.api.policies['getClubInsightsV2'] = {'bindings': [] if binding is None else [binding]}
                with self.assertRaisesRegex(RuntimeError, 'public invoker IAM'): release.verify(self.run, self.api)
    def test_refuses_wrong_trigger_kind_label_url_or_ingress(self):
        for patch in [{'httpsTrigger': None}, {'labels': {}}, {'httpsTrigger': {'url': 'https://other.test'}}, {'ingressSettings': 'ALLOW_INTERNAL_ONLY'}]:
            with self.subTest(patch=patch):
                self.api.deployed(self.run)
                self.api.rows[release.PARENT + '/functions/getClubInsightsV2'].update(patch)
                with self.assertRaisesRegex(RuntimeError, 'Callable'): release.verify(self.run, self.api)
    def test_prepare_captures_existing_configuration_iam_and_archive(self):
        self.api.deployed(self.run)
        old_iam = deepcopy(self.api.policies['getClubInsightsV2'])
        other = Path(self.temp.name) / 'with-existing'
        with contextlib.redirect_stdout(io.StringIO()): release.prepare(other, self.api)
        manifest = release.read(other / 'manifest.json')
        self.assertEqual(release.read(other / 'before-iam.json')['getClubInsightsV2'], old_iam)
        self.assertEqual(manifest['rollback']['getClubInsightsV2']['sha256'], release.sha((other / 'getClubInsightsV2-before.zip').read_bytes()))
        self.assertEqual(manifest['rollback']['getClubInsightsV2']['configurationSha256'], release.sha(json.dumps(self.api.rows[release.PARENT + '/functions/getClubInsightsV2'], sort_keys=True).encode()))
    def test_refuses_concurrent_deployment_during_verification(self):
        self.api.deployed(self.run)
        source = self.api.source
        def changed(endpoint, version):
            self.api.rows[release.PARENT + '/functions/getClubInsightsV2']['versionId'] = '2'
            return source(endpoint, version)
        self.api.source = changed
        with self.assertRaisesRegex(RuntimeError, 'changed during verification'): release.verify(self.run, self.api)
    def test_refuses_concurrent_iam_change_during_verification(self):
        self.api.deployed(self.run)
        source = self.api.source
        def changed(endpoint, version):
            if endpoint == 'getClubInsightsV2': self.api.policies[endpoint]['etag'] = 'changed'
            return source(endpoint, version)
        self.api.source = changed
        with self.assertRaisesRegex(RuntimeError, 'IAM changed during verification'): release.verify(self.run, self.api)
    def test_refuses_stale_definition_or_configuration_manifest(self):
        self.api.deployed(self.run)
        manifest = release.read(self.run / 'manifest.json')
        manifest['definitions']['recordInsightUsage']['maxInstances'] = 999
        release.write(self.run / 'manifest.json', manifest)
        with self.assertRaisesRegex(RuntimeError, 'expected definitions changed'): release.verify(self.run, self.api)
    def test_accepts_semantic_duration_and_documented_default_memory(self):
        self.api.deployed(self.run)
        self.api.rows[release.PARENT + '/functions/getClubInsightsV2']['timeout'] = '540.000s'
        self.api.rows[release.PARENT + '/functions/recordInsightUsage'].pop('availableMemoryMb')
        with contextlib.redirect_stdout(io.StringIO()): release.verify(self.run, self.api)

if __name__ == '__main__': unittest.main()
