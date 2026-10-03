"""Prepare/preflight/verify an isolated social package. Never deploy or set IAM."""
from __future__ import annotations
import argparse
from copy import deepcopy
import importlib.util
import io
import json
import re
from pathlib import Path
import time
import zipfile

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('social_release_base', HERE.parent / 'expanded-insights' / 'prepare.py')
A = importlib.util.module_from_spec(spec)
spec.loader.exec_module(A)
ENDPOINTS = ('getSocialAdminDirectory', 'getSocialContext', 'getSocialFeed', 'getSocialActivity',
             'saveSocialPreferences', 'setSocialVisibility', 'getSocialPeople', 'socialConnection',
             'setSocialKudos', 'getSocialComments', 'saveSocialComment', 'reportSocialActivity',
             'moderateSocialActivity', 'getSocialMedia')
RUNTIME_HELPERS = ('social.js', 'social-projection.js', 'social-benchmarks.json', 'club-access.js', 'athlete-storage-paths.js')
PACKAGE_FILES = ('package.json', 'package-lock.json')
HELPERS = (*RUNTIME_HELPERS, *PACKAGE_FILES)
CHANGED = ('social-callable-observation.js',)
FILES = ('index.js', *HELPERS, *CHANGED, 'runtime-options.json', 'implementation-roots.json')
CONFIG = {'functions': {'source': 'source', 'codebase': 'default', 'runtime': 'nodejs22'}}
ONLY = ','.join('functions:' + name for name in ENDPOINTS)
OUTPUT_FIELDS = {'status', 'versionId', 'updateTime', 'sourceUploadUrl', 'sourceArchiveUrl', 'sourceRepository', 'buildId', 'buildName'}


def configuration(row):
    value = {key: deepcopy(item) for key, item in row.items() if key not in OUTPUT_FIELDS}
    # Firebase's deployment content hash changes with source bytes; preserve all
    # other labels, including callable, tool and any original codebase labels.
    value.get('labels', {}).pop('firebase-functions-hash', None)
    return value


def iam_configuration(policy):
    value = deepcopy(policy)
    value.pop('etag', None)
    value['bindings'] = sorted(value.get('bindings', []), key=lambda row: json.dumps(row, sort_keys=True))
    for binding in value['bindings']:
        binding['members'] = sorted(binding.get('members', []))
    return value


def validate(endpoint, row, policy):
    A.require(isinstance(row, dict) and row.get('name') == A.PARENT + '/functions/' + endpoint
              and row.get('status') == 'ACTIVE' and row.get('entryPoint') == endpoint and row.get('runtime') == 'nodejs22', 'Expected active social runtime missing: ' + endpoint)
    A.require(row.get('timeout') == '120s' and row.get('availableMemoryMb', 256) == 256, 'Unreviewed social runtime limits: ' + endpoint)
    A.require(isinstance(row.get('httpsTrigger'), dict) and 'eventTrigger' not in row
              and row['httpsTrigger'].get('url') == f'https://{A.REGION}-{A.PROJECT}.cloudfunctions.net/{endpoint}', 'Social callable transport differs: ' + endpoint)
    A.require(row.get('labels', {}).get('deployment-callable') == 'true', 'Callable label missing: ' + endpoint)
    A.require(row.get('ingressSettings', 'ALLOW_ALL') == 'ALLOW_ALL', 'Unreviewed social ingress: ' + endpoint)
    A.require(row.get('serviceAccountEmail') == A.PROJECT + '@appspot.gserviceaccount.com', 'Unreviewed social service account: ' + endpoint)
    A.require(not row.get('secretEnvironmentVariables') and not row.get('vpcConnector'), 'Unreviewed social secret/VPC settings: ' + endpoint)
    A.require(any(binding.get('role') == 'roles/cloudfunctions.invoker' and 'allUsers' in binding.get('members', []) and not binding.get('condition') for binding in policy.get('bindings', [])), 'Existing public callable invoker missing: ' + endpoint)
    return {'timeoutSeconds': 120, 'memory': '256MB', 'serviceAccount': row['serviceAccountEmail'], 'ingressSettings': 'ALLOW_ALL',
            **({'maxInstances': row['maxInstances']} if 'maxInstances' in row else {}),
            **({'minInstances': row['minInstances']} if 'minInstances' in row else {}), 'preserveExternalChanges': True}


def source_files(data):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names = [name for name in archive.namelist() if not name.endswith('/')]
        A.require(len(names) == len(set(names)), 'Duplicate live source ZIP entries')
        A.require(all(not name.startswith(('/', '\\')) and '..' not in Path(name).parts for name in names), 'Unsafe live source ZIP path')
        return {name: archive.read(name) for name in names}


def implementation_files(endpoint, files):
    # A previous scoped release can include distinct implementation roots. Read
    # the helper bytes actually selected for this endpoint, not an unused common
    # social.js that happens to be present in the same uploaded source bundle.
    if 'implementation-roots.json' not in files:
        return files
    A.require(files.get('index.js') == (HERE / 'index.js').read_bytes(), 'Unreviewed live scoped entrypoint: ' + endpoint)
    roots = json.loads(files['implementation-roots.json'])
    A.require(isinstance(roots, dict) and set(roots) == set(ENDPOINTS)
              and all(root == '.' or root == 'endpoint-deps/' + name for name, root in roots.items()), 'Unreviewed live implementation roots')
    root = roots[endpoint]
    effective = dict(files)
    for name in RUNTIME_HELPERS:
        path = name if root == '.' else root + '/' + name
        A.require(path in files, 'Selected live helper missing: ' + endpoint + '/' + name)
        effective[name] = files[path]
    return effective


def digest(value):
    return A.sha(json.dumps(value, sort_keys=True, separators=(',', ':')).encode())


def caller_source(data):
    matches = re.findall(r'^function requireCaller\(context\) \{[\s\S]*?^\}', data.decode('utf-8').replace('\r\n', '\n'), re.MULTILINE)
    A.require(len(matches) == 1, 'Expected caller implementation missing or ambiguous')
    return matches[0].encode()


def prepare(run, api):
    A.require(not run.exists(), 'Use a fresh ignored run directory')
    before, policies, archives, live_files, options = api.inventory(), {}, {}, {}, {}
    run.mkdir(parents=True)
    for endpoint in ENDPOINTS:
        row = before.get(A.PARENT + '/functions/' + endpoint)
        policy = api.iam(endpoint)
        options[endpoint] = validate(endpoint, row, policy)
        policies[endpoint] = policy
        archive = api.source(endpoint, row['versionId'])
        (run / (endpoint + '-before.zip')).write_bytes(archive)
        archives[endpoint] = {'versionId': row['versionId'], 'sourceSha256': A.sha(archive), 'configurationSha256': digest(row), 'iamSha256': digest(policy)}
        live_files[endpoint] = implementation_files(endpoint, source_files(archive))
    A.require(api.inventory() == before, 'Function inventory changed during capture')
    A.require(all(api.iam(endpoint) == policy for endpoint, policy in policies.items()), 'Function IAM changed during capture')
    A.write(run / 'before.json', before)
    A.write(run / 'before-iam.json', policies)
    A.write(run / 'rollback.json', archives)
    assemble(run, before, policies, archives, live_files, options)


def assemble(run, before, policies, archives, live_files, options):
    # The runtime dependencies include the service implementation itself. Keep
    # each endpoint's exact deployed versions, even when previous targeted
    # releases left different helper/service versions across this group.
    helper_bytes, roots, variants = {}, {}, {}
    candidate_index = (HERE / 'index.js').read_bytes()
    candidate_caller = caller_source(candidate_index)
    callers = {}
    for endpoint in ENDPOINTS:
        original_index = live_files[endpoint].get('index.js')
        A.require(original_index is not None and caller_source(original_index) == candidate_caller, 'Original caller contract differs: ' + endpoint)
        callers[endpoint] = {'sourceIndexSha256': A.sha(original_index), 'callerSha256': A.sha(candidate_caller)}
    for name in HELPERS:
        values = [live_files[endpoint].get(name) for endpoint in ENDPOINTS]
        A.require(all(value is not None for value in values), 'Unchanged helper absent from live source: ' + name)
        if name in PACKAGE_FILES:
            A.require(all(value == values[0] for value in values), 'Live package dependencies differ across social endpoints: ' + name)
        helper_bytes[name] = values[0]
    for endpoint in ENDPOINTS:
        same = all(live_files[endpoint][name] == helper_bytes[name] for name in RUNTIME_HELPERS)
        roots[endpoint] = '.' if same else 'endpoint-deps/' + endpoint
        if not same:
            variants.update({roots[endpoint] + '/' + name: live_files[endpoint][name] for name in RUNTIME_HELPERS})
    source = run / 'source'
    source.mkdir()
    contents = {'index.js': candidate_index, **helper_bytes, **variants,
                **{name: (A.ROOT / 'functions' / name).read_bytes() for name in CHANGED},
                'runtime-options.json': (json.dumps(options, indent=2) + '\n').encode(),
                'implementation-roots.json': (json.dumps(roots, indent=2) + '\n').encode()}
    for name, data in contents.items():
        path = source / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    (source / '.firebaseignore').write_bytes(A.FIREBASE_IGNORE)
    A.write(run / 'firebase.json', CONFIG)
    manifest = {'schemaVersion': 1, 'project': A.PROJECT, 'region': A.REGION, 'endpoints': list(ENDPOINTS), 'only': ONLY,
                'preparedAtMillis': int(time.time() * 1000), 'files': {name: {'sha256': A.sha(data), 'bytes': len(data)} for name, data in contents.items()},
                'configurations': {endpoint: configuration(before[A.PARENT + '/functions/' + endpoint]) for endpoint in ENDPOINTS},
                'runtimeOptions': options, 'implementationRoots': roots, 'callerProvenance': callers, 'rollback': archives,
                'unchangedHelpers': {endpoint: {name: {'sha256': A.sha(live_files[endpoint][name]), 'bytes': len(live_files[endpoint][name])} for name in HELPERS} for endpoint in ENDPOINTS}}
    manifest['candidateDigest'] = digest(manifest['files'])
    A.write(run / 'manifest.json', manifest)
    print(json.dumps({'prepared': True, 'functions': len(ENDPOINTS), 'sourceFiles': len(contents), 'candidateDigest': manifest['candidateDigest']}))


def compose(run, api):
    # Recover a fully captured but refused package without re-downloading its
    # version-specific archives. Fresh control-plane checks still guard it.
    A.require(run.exists() and not (run / 'manifest.json').exists() and not (run / 'source').exists(), 'Captured run cannot be recomposed')
    before, policies, archives = A.read(run / 'before.json'), A.read(run / 'before-iam.json'), A.read(run / 'rollback.json')
    A.require(api.inventory() == before and all(api.iam(endpoint) == policies[endpoint] for endpoint in ENDPOINTS), 'Captured state changed; prepare a fresh run')
    live_files, options = {}, {}
    for endpoint in ENDPOINTS:
        data = (run / (endpoint + '-before.zip')).read_bytes()
        A.require(A.sha(data) == archives[endpoint]['sourceSha256'], 'Captured source archive changed')
        row = before[A.PARENT + '/functions/' + endpoint]
        A.require(str(row['versionId']) == str(archives[endpoint]['versionId']) and digest(row) == archives[endpoint]['configurationSha256'] and digest(policies[endpoint]) == archives[endpoint]['iamSha256'], 'Captured source metadata changed')
        options[endpoint] = validate(endpoint, row, policies[endpoint])
        live_files[endpoint] = implementation_files(endpoint, source_files(data))
    A.require(api.inventory() == before, 'Function inventory changed during composition')
    assemble(run, before, policies, archives, live_files, options)


def reprepare(run, api, previous):
    A.require(not run.exists(), 'Use a fresh ignored run directory')
    old_before, old_policies, archives = A.read(previous / 'before.json'), A.read(previous / 'before-iam.json'), A.read(previous / 'rollback.json')
    before, policies, live_files, options = api.inventory(), {}, {}, {}
    run.mkdir(parents=True)
    for endpoint in ENDPOINTS:
        key = A.PARENT + '/functions/' + endpoint
        A.require(before.get(key) == old_before.get(key), 'Captured endpoint changed; prepare fresh source: ' + endpoint)
        policy = api.iam(endpoint)
        A.require(policy == old_policies[endpoint], 'Captured IAM changed; prepare fresh source: ' + endpoint)
        row = before[key]
        data = (previous / (endpoint + '-before.zip')).read_bytes()
        A.require(A.sha(data) == archives[endpoint]['sourceSha256'] and digest(row) == archives[endpoint]['configurationSha256'] and digest(policy) == archives[endpoint]['iamSha256'], 'Captured source provenance changed')
        (run / (endpoint + '-before.zip')).write_bytes(data)
        policies[endpoint] = policy
        live_files[endpoint] = implementation_files(endpoint, source_files(data))
        options[endpoint] = validate(endpoint, row, policy)
    A.require(api.inventory() == before and all(api.iam(endpoint) == policies[endpoint] for endpoint in ENDPOINTS), 'Function state changed during re-preparation')
    A.write(run / 'before.json', before)
    A.write(run / 'before-iam.json', policies)
    A.write(run / 'rollback.json', archives)
    assemble(run, before, policies, archives, live_files, options)


def validate_package(run):
    manifest = A.read(run / 'manifest.json')
    A.require(manifest.get('schemaVersion') == 1 and manifest.get('project') == A.PROJECT and manifest.get('region') == A.REGION
              and tuple(manifest.get('endpoints', [])) == ENDPOINTS and manifest.get('only') == ONLY, 'Prepared deployment scope changed')
    roots = manifest.get('implementationRoots', {})
    A.require(set(roots) == set(ENDPOINTS) and all(root == '.' or root == 'endpoint-deps/' + endpoint for endpoint, root in roots.items()), 'Prepared implementation roots differ')
    expected_files = set(FILES) | {root + '/' + name for root in roots.values() if root != '.' for name in RUNTIME_HELPERS}
    A.require(set(manifest.get('files', {})) == expected_files and manifest.get('candidateDigest') == digest(manifest['files']), 'Prepared manifest differs')
    A.require(A.read(run / 'firebase.json') == CONFIG and (run / 'source' / '.firebaseignore').read_bytes() == A.FIREBASE_IGNORE, 'Scoped Firebase configuration changed')
    local_names = set()
    for path in (run / 'source').rglob('*'):
        relative = path.relative_to(run / 'source').as_posix()
        if relative == 'node_modules' or relative.startswith('node_modules/'): continue
        A.require(not path.is_symlink(), 'Prepared source symlink refused')
        if path.is_file(): local_names.add(relative)
    A.require(local_names == expected_files | {'.firebaseignore'}, 'Unexpected prepared source file')
    for name, expected in manifest['files'].items():
        data = (run / 'source' / name).read_bytes()
        A.require(A.sha(data) == expected['sha256'] and len(data) == expected['bytes'], 'Prepared source changed: ' + name)
    A.require(A.read(run / 'source' / 'runtime-options.json') == manifest['runtimeOptions'], 'Prepared runtime options changed')
    A.require(A.read(run / 'source' / 'implementation-roots.json') == roots, 'Prepared implementation roots changed')
    caller_hash = A.sha(caller_source((run / 'source' / 'index.js').read_bytes()))
    A.require(set(manifest.get('callerProvenance', {})) == set(ENDPOINTS) and all(row.get('callerSha256') == caller_hash for row in manifest['callerProvenance'].values()), 'Prepared caller contract differs')
    for endpoint in ENDPOINTS:
        root = roots[endpoint]
        for name in HELPERS:
            path = name if name in PACKAGE_FILES or root == '.' else root + '/' + name
            A.require(manifest['files'][path] == manifest['unchangedHelpers'][endpoint][name], 'Unchanged endpoint helper differs: ' + endpoint + '/' + name)
    return manifest


def preflight(run, api):
    manifest = validate_package(run)
    before, policies = A.read(run / 'before.json'), A.read(run / 'before-iam.json')
    A.require(api.inventory() == before, 'Function inventory changed before deployment')
    A.require(all(api.iam(endpoint) == policies[endpoint] for endpoint in ENDPOINTS), 'Function IAM changed before deployment')
    A.write(run / 'preflight.json', {'checkedAtMillis': int(time.time() * 1000), 'candidateDigest': manifest['candidateDigest'], 'inventoryUnchanged': True, 'iamUnchanged': True})
    print(json.dumps({'preflight': True, 'functions': len(ENDPOINTS), 'candidateDigest': manifest['candidateDigest']}))


def verify(run, api):
    manifest = validate_package(run)
    before, before_iam, after = A.read(run / 'before.json'), A.read(run / 'before-iam.json'), api.inventory()
    owned = {A.PARENT + '/functions/' + endpoint for endpoint in ENDPOINTS}
    A.require({key: value for key, value in before.items() if key not in owned} == {key: value for key, value in after.items() if key not in owned}, 'Unrelated function inventory changed')
    results, policies = {}, {}
    for endpoint in ENDPOINTS:
        row, policy = after.get(A.PARENT + '/functions/' + endpoint), api.iam(endpoint)
        validate(endpoint, row, policy)
        A.require(configuration(row) == manifest['configurations'][endpoint], 'Live social configuration changed: ' + endpoint)
        A.require(iam_configuration(policy) == iam_configuration(before_iam[endpoint]), 'Live social IAM changed: ' + endpoint)
        data = api.source(endpoint, row['versionId'])
        files = source_files(data)
        A.require(set(manifest['files']).issubset(files) and set(files).issubset(set(manifest['files']) | {'.firebaseignore', '.runtimeconfig.json'}), 'Unexpected deployed source inventory')
        for name, expected in manifest['files'].items():
            A.require(len(files[name]) == expected['bytes'] and A.sha(files[name]) == expected['sha256'], 'Deployed source differs: ' + name)
        if '.firebaseignore' in files: A.require(files['.firebaseignore'] == A.FIREBASE_IGNORE, 'Deployed ignore file differs')
        runtime_config = A.validate_runtime_config(files['.runtimeconfig.json']) if '.runtimeconfig.json' in files else {'present': False}
        results[endpoint] = {'versionId': row['versionId'], 'sourceSha256': A.sha(data), 'configurationPreserved': True, 'iamPreserved': True, 'runtimeConfig': runtime_config}
        policies[endpoint] = policy
    A.require(api.inventory() == after, 'Function inventory changed during verification')
    A.require(all(api.iam(endpoint) == policy for endpoint, policy in policies.items()), 'Function IAM changed during verification')
    A.write(run / 'after.json', after)
    A.write(run / 'after-iam.json', policies)
    A.write(run / 'verified.json', {'verifiedAtMillis': int(time.time() * 1000), 'candidateDigest': manifest['candidateDigest'], 'functions': results, 'unrelatedFunctionsPreserved': True})
    print(json.dumps({'verified': True, 'functions': len(results), 'candidateDigest': manifest['candidateDigest'], 'unrelatedFunctionsPreserved': True}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=['prepare', 'compose', 'reprepare', 'preflight', 'verify'], required=True)
    parser.add_argument('--run-dir', required=True)
    parser.add_argument('--credential-file', required=True)
    parser.add_argument('--from-run')
    args = parser.parse_args()
    if args.mode == 'reprepare':
        A.require(bool(args.from_run), '--from-run is required for reprepare')
        reprepare(A.private(args.run_dir), A.Api(args.credential_file), A.private(args.from_run))
    else:
        A.require(args.from_run is None, '--from-run is only valid for reprepare')
        globals()[args.mode](A.private(args.run_dir), A.Api(args.credential_file))
