import contextlib
from copy import deepcopy
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile
import prepare as S


class FakeApi:
    def __init__(self):
        self.rows = {S.A.PARENT + '/functions/unrelated': {'name': 'unrelated', 'versionId': '7'}}
        self.policies = {}
        self.archives = {}
        old = self.zip({'index.js': (S.HERE / 'index.js').read_bytes(), **{name: ('helper:' + name).encode() for name in S.HELPERS}})
        for name in S.ENDPOINTS:
            self.rows[S.A.PARENT + '/functions/' + name] = {'name': S.A.PARENT + '/functions/' + name, 'status': 'ACTIVE', 'entryPoint': name,
                'runtime': 'nodejs22', 'versionId': '4', 'timeout': '120s', 'availableMemoryMb': 256,
                'serviceAccountEmail': S.A.PROJECT + '@appspot.gserviceaccount.com', 'ingressSettings': 'ALLOW_ALL',
                'httpsTrigger': {'url': f'https://{S.A.REGION}-{S.A.PROJECT}.cloudfunctions.net/{name}'},
                'labels': {'deployment-callable': 'true', 'firebase-functions-hash': 'old', 'deployment-tool': 'cli-firebase'},
                'environmentVariables': {'GCLOUD_PROJECT': S.A.PROJECT}, 'buildEnvironmentVariables': {'GOOGLE_NODE_RUN_SCRIPTS': ''}}
            self.policies[name] = {'version': 3, 'etag': 'original', 'bindings': [{'role': 'roles/cloudfunctions.invoker', 'members': ['allUsers', 'serviceAccount:existing@example.test']}]}
            self.archives[name] = old
    @staticmethod
    def zip(files):
        data = io.BytesIO()
        with zipfile.ZipFile(data, 'w') as archive:
            for name, value in files.items(): archive.writestr(name, value)
        return data.getvalue()
    def inventory(self): return deepcopy(self.rows)
    def iam(self, name): return deepcopy(self.policies[name])
    def source(self, name, version): return self.archives[name]
    def deployed(self, run, extra=None):
        files = {path.relative_to(run / 'source').as_posix(): path.read_bytes() for path in (run / 'source').rglob('*') if path.is_file()}
        if extra: files[extra] = b'private'
        archive = self.zip(files)
        for name in S.ENDPOINTS:
            self.rows[S.A.PARENT + '/functions/' + name]['versionId'] = '5'
            self.rows[S.A.PARENT + '/functions/' + name]['labels']['firebase-functions-hash'] = 'new'
            self.archives[name] = archive


class SocialReleaseTests(unittest.TestCase):
    def setUp(self):
        parent = S.A.ROOT / '.netlify' / 'social-release-tests'
        parent.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=parent)
        self.run = Path(self.temp.name) / 'run'
        self.api = FakeApi()
        with contextlib.redirect_stdout(io.StringIO()): S.prepare(self.run, self.api)
    def tearDown(self): self.temp.cleanup()
    def test_exact_scope_preserves_all_settings_and_source(self):
        manifest = S.validate_package(self.run)
        self.assertEqual(len(manifest['endpoints']), 14)
        self.assertEqual(manifest['only'], ','.join('functions:' + name for name in S.ENDPOINTS))
        self.assertNotIn('maxInstances', manifest['runtimeOptions']['getSocialFeed'])
        self.api.deployed(self.run)
        with contextlib.redirect_stdout(io.StringIO()): S.verify(self.run, self.api)
        proof = S.A.read(self.run / 'verified.json')
        self.assertTrue(proof['unrelatedFunctionsPreserved'])
        self.assertEqual(len(proof['functions']), 14)
    def test_helpers_come_from_exact_live_source_not_local_changes(self):
        for name in S.HELPERS: self.assertEqual((self.run / 'source' / name).read_bytes(), ('helper:' + name).encode())
    def test_preflight_rejects_source_inventory_or_iam_drift(self):
        with contextlib.redirect_stdout(io.StringIO()): S.preflight(self.run, self.api)
        (self.run / 'source' / 'private.json').write_text('private')
        with self.assertRaisesRegex(RuntimeError, 'Unexpected prepared'): S.preflight(self.run, self.api)
        (self.run / 'source' / 'private.json').unlink()
        self.api.policies[S.ENDPOINTS[0]]['bindings'][0]['members'].append('user:other@example.test')
        with self.assertRaisesRegex(RuntimeError, 'IAM changed before'): S.preflight(self.run, self.api)
    def test_refuses_unrelated_function_change(self):
        self.api.deployed(self.run)
        self.api.rows[S.A.PARENT + '/functions/unrelated']['versionId'] = '8'
        with self.assertRaisesRegex(RuntimeError, 'Unrelated'): S.verify(self.run, self.api)
    def test_refuses_each_configuration_change(self):
        for field, value in [('timeout', '60s'), ('availableMemoryMb', 512), ('maxInstances', 100), ('minInstances', 1),
                             ('environmentVariables', {'different': 'fixture'}), ('buildEnvironmentVariables', {'different': 'fixture'}),
                             ('serviceAccountEmail', 'other@example.test'), ('labels', {'deployment-callable': 'true', 'new': 'label'})]:
            with self.subTest(field=field):
                self.api = FakeApi(); self.api.deployed(self.run)
                self.api.rows[S.A.PARENT + '/functions/' + S.ENDPOINTS[0]][field] = value
                with self.assertRaisesRegex(RuntimeError, 'runtime limits|configuration changed|service account'): S.verify(self.run, self.api)
    def test_refuses_permission_change_but_accepts_unchanged_policy_order_and_etag(self):
        self.api.deployed(self.run)
        self.api.policies[S.ENDPOINTS[0]]['etag'] = 'new-etag'
        self.api.policies[S.ENDPOINTS[0]]['bindings'][0]['members'].reverse()
        with contextlib.redirect_stdout(io.StringIO()): S.verify(self.run, self.api)
        self.api.policies[S.ENDPOINTS[0]]['bindings'][0]['members'].append('user:extra@example.test')
        with self.assertRaisesRegex(RuntimeError, 'IAM changed'): S.verify(self.run, self.api)
    def test_refuses_mutated_source_or_unexpected_deployed_files(self):
        self.api.deployed(self.run, 'private.json')
        with self.assertRaisesRegex(RuntimeError, 'Unexpected deployed source'): S.verify(self.run, self.api)
        self.api.deployed(self.run)
        (self.run / 'source' / 'social.js').write_text('changed')
        with self.assertRaisesRegex(RuntimeError, 'Prepared source changed'): S.verify(self.run, self.api)
    def test_preserves_differing_live_helper_implementations_and_refuses_missing_dependencies(self):
        for absent in [False, True]:
            with self.subTest(absent=absent):
                api = FakeApi(); files = {'index.js': (S.HERE / 'index.js').read_bytes(), **{name: ('helper:' + name).encode() for name in S.HELPERS}}
                if absent: files.pop('club-access.js')
                else: files['club-access.js'] = b'different-helper'
                api.archives[S.ENDPOINTS[0]] = api.zip(files)
                run = Path(self.temp.name) / ('other' + str(absent))
                if absent:
                    with self.assertRaisesRegex(RuntimeError, 'helper absent'):
                        with contextlib.redirect_stdout(io.StringIO()): S.prepare(run, api)
                else:
                    with contextlib.redirect_stdout(io.StringIO()): S.prepare(run, api)
                    manifest = S.validate_package(run)
                    self.assertEqual(manifest['implementationRoots'][S.ENDPOINTS[0]], '.')
                    other = manifest['implementationRoots'][S.ENDPOINTS[1]]
                    self.assertNotEqual(other, '.')
                    self.assertEqual((run / 'source' / other / 'club-access.js').read_bytes(), b'helper:club-access.js')
    def test_refuses_different_package_lock_dependency_graphs(self):
        api = FakeApi(); files = {'index.js': (S.HERE / 'index.js').read_bytes(), **{name: ('helper:' + name).encode() for name in S.HELPERS}}
        files['package-lock.json'] = b'different-lock'
        api.archives[S.ENDPOINTS[0]] = api.zip(files)
        with self.assertRaisesRegex(RuntimeError, 'package dependencies differ'):
                with contextlib.redirect_stdout(io.StringIO()): S.prepare(Path(self.temp.name) / 'different-lock', api)
    def test_recapture_of_scoped_source_preserves_actual_selected_implementation_root(self):
        api = FakeApi()
        roots = {endpoint: '.' for endpoint in S.ENDPOINTS}
        roots['socialConnection'] = 'endpoint-deps/socialConnection'
        files = {'index.js': (S.HERE / 'index.js').read_bytes(), 'implementation-roots.json': json.dumps(roots).encode(),
                 **{name: ('helper:' + name).encode() for name in S.HELPERS},
                 **{'endpoint-deps/socialConnection/' + name: ('selected:' + name).encode() for name in S.RUNTIME_HELPERS}}
        api.archives['socialConnection'] = api.zip(files)
        run = Path(self.temp.name) / 'selected-root'
        with contextlib.redirect_stdout(io.StringIO()): S.prepare(run, api)
        manifest = S.validate_package(run); selected = manifest['implementationRoots']['socialConnection']
        self.assertEqual((run / 'source' / selected / 'social.js').read_bytes(), b'selected:social.js')
        self.assertEqual(manifest['unchangedHelpers']['socialConnection']['social.js']['sha256'], S.A.sha(b'selected:social.js'))
        files.pop('endpoint-deps/socialConnection/club-access.js')
        with self.assertRaisesRegex(RuntimeError, 'Selected live helper missing'): S.implementation_files('socialConnection', files)
    def test_refuses_concurrent_source_capture(self):
        api = FakeApi(); original = api.source
        def changed(name, version):
            api.rows[S.A.PARENT + '/functions/unrelated']['versionId'] = '8'
            return original(name, version)
        api.source = changed
        with self.assertRaisesRegex(RuntimeError, 'inventory changed during capture'):
            S.prepare(Path(self.temp.name) / 'changing', api)
    def test_refuses_a_changed_original_caller_and_never_overwrites_a_frozen_candidate(self):
        api = FakeApi(); files = {'index.js': (S.HERE / 'index.js').read_bytes().replace(b'isAnonymous: false', b'isAnonymous: true'), **{name: ('helper:' + name).encode() for name in S.HELPERS}}
        api.archives[S.ENDPOINTS[0]] = api.zip(files)
        with self.assertRaisesRegex(RuntimeError, 'Original caller contract differs'):
            S.prepare(Path(self.temp.name) / 'different-caller', api)
        with self.assertRaisesRegex(RuntimeError, 'fresh ignored run'): S.reprepare(self.run, self.api, self.run)


if __name__ == '__main__': unittest.main()
