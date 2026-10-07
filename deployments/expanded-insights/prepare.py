"""Prepare/verify a scoped Firebase CLI release. Private receipts stay ignored."""
from __future__ import annotations
import argparse
from decimal import Decimal, InvalidOperation
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import time
from urllib.request import Request, urlopen
import zipfile

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
PROJECT = 'kickai-69dd0'
REGION = 'us-central1'
ENDPOINTS = ('getClubInsightsV2', 'getCoachPlayerComparison', 'recordInsightUsage', 'projectInsightPlayer', 'projectInsightRecords',
             'projectInsightRevisions', 'projectInsightFailures', 'projectInsightArtifacts', 'projectInsightArtifactDeletes')
FILES = ('insights-entrypoints.js', 'insights-v2.js', 'insights-overview.js', 'insights-v2-projection.js', 'insights-v2-qualification.js',
         'processing-evidence.js', 'insight-usage.js', 'club-access.js', 'athlete-storage-paths.js',
         'effective-rep.js', 'insights-axis-scoring.js', 'athlete-profile-spec.json', 'package.json', 'package-lock.json')
API = 'https://cloudfunctions.googleapis.com/v1/'
PARENT = f'projects/{PROJECT}/locations/{REGION}'
BUCKET = 'kickai-69dd0.firebasestorage.app'
CALLABLES = ENDPOINTS[:3]
FIREBASE_IGNORE = b'node_modules\n.git\n*.log\n'
FIREBASE_CONFIG = {'functions': {'source': 'source', 'codebase': 'expanded-insights', 'runtime': 'nodejs22'}}
# Pinned from the Firebase SDK __trigger inspection in the private September 17
# control-plane receipt. The SDK puts failurePolicy at the top level; REST v1
# exposes it inside eventTrigger. Unspecified v1 memory defaults to 256 MB.
DOCUMENT_TRIGGERS = {
    'projectInsightPlayer': 'players/{playerId}',
    'projectInsightRecords': 'players/{playerId}/{collectionId}/{recordId}',
    'projectInsightRevisions': 'players/{playerId}/reps/{repId}/revisions/{revisionId}',
    'projectInsightFailures': 'failureCases/{failureId}',
}

def expected_definitions():
    definitions = {}
    for endpoint in ENDPOINTS:
        row = {'timeout': '60s' if endpoint == 'recordInsightUsage' else '540s',
               'availableMemoryMb': 256 if endpoint == 'recordInsightUsage' else 1024 if endpoint in ('getClubInsightsV2', 'getCoachPlayerComparison') else 512,
               'maxInstances': 10}
        if endpoint in CALLABLES:
            row.update({'httpsTrigger': True, 'callableLabel': 'true', 'publicInvoker': True, 'ingressSettings': 'ALLOW_ALL'})
        else:
            row['eventTrigger'] = {
                'resource': f'projects/{PROJECT}/databases/(default)/documents/{DOCUMENT_TRIGGERS[endpoint]}' if endpoint in DOCUMENT_TRIGGERS else f'projects/_/buckets/{BUCKET}',
                'eventType': 'providers/cloud.firestore/eventTypes/document.write' if endpoint in DOCUMENT_TRIGGERS else
                    'google.storage.object.delete' if endpoint == 'projectInsightArtifactDeletes' else 'google.storage.object.finalize',
                'service': 'firestore.googleapis.com' if endpoint in DOCUMENT_TRIGGERS else 'storage.googleapis.com',
                'failurePolicy': {'retry': {}},
            }
        definitions[endpoint] = row
    return definitions
def sha(data): return hashlib.sha256(data).hexdigest()
def read(path): return json.loads(Path(path).read_text(encoding='utf-8-sig'))
def write(path, data): Path(path).write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')
def require(ok, message):
    if not ok: raise RuntimeError(message)

def runtime_module_closure(source, files):
    """Check the scoped, static CommonJS graph before dependencies are installed.

    Every local import must resolve within the immutable source manifest. Node
    builtins and declared production dependencies are the only external imports.
    Computed imports need a reviewed resolver rather than escaping this check.
    """
    source = source.resolve()
    package = read(source / 'package.json')
    require(package.get('main') == 'index.js', 'Unexpected runtime entry point')
    dependencies = set(package.get('dependencies', {}))
    literal = re.compile(r"\brequire\s*\(\s*(['\"])([^'\"\r\n]+)\1\s*\)")
    calls = re.compile(r'\brequire\s*\(')
    graph, external = {}, set()
    for name in sorted(files):
        if not name.endswith('.js'): continue
        text = (source / name).read_text(encoding='utf-8')
        matches = list(literal.finditer(text))
        require({match.start() for match in calls.finditer(text)} == {match.start() for match in matches},
                'Computed runtime import requires review: ' + name)
        imports = set()
        for match in matches:
            request = match.group(2)
            if request.startswith('.'):
                target = (source / name).parent / request
                candidates = [target, Path(str(target) + '.js'), Path(str(target) + '.json'),
                              target / 'index.js', target / 'index.json']
                require(all(path.resolve().is_relative_to(source) for path in candidates),
                        'Runtime import escapes prepared source: ' + name + ' -> ' + request)
                resolved = next((path for path in candidates if path.is_file()), None)
                require(resolved is not None, 'Required runtime module missing: ' + name + ' -> ' + request)
                relative = resolved.relative_to(source).as_posix()
                require(relative in files, 'Required runtime module absent from manifest: ' + relative)
                imports.add(relative)
            else:
                dependency = '/'.join(request.split('/')[:2]) if request.startswith('@') else request.split('/')[0]
                require(request in ('node:crypto', 'node:util') or dependency in dependencies,
                        'Undeclared runtime dependency: ' + name + ' -> ' + request)
                external.add(request)
        graph[name] = sorted(imports)
    reached, pending = set(), ['index.js']
    while pending:
        name = pending.pop()
        if name in reached: continue
        require(name in files, 'Runtime entry module absent from manifest: ' + name)
        reached.add(name)
        pending.extend(graph.get(name, []))
    require(set(graph).issubset(reached), 'Prepared runtime has unreachable JavaScript modules')
    return {'entryPoint': 'index.js', 'localModules': sorted(reached), 'externalImports': sorted(external), 'imports': graph}

def scoped_runtime_module_closure(source, files):
    # Other independently reviewed publishers reuse this auditor and keep their
    # own dynamic module and source contracts. This gate belongs to this bundle.
    if FIREBASE_CONFIG['functions']['codebase'] == 'expanded-insights':
        return runtime_module_closure(source, files)
    return None
def validate_runtime_config(data):
    """Allow only the non-secret Firebase config appended by the CLI upload."""
    require(len(data) <= 4096, 'Deployed runtime configuration exceeds its bound')
    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, 'Duplicate key in deployed runtime configuration')
            result[key] = value
        return result
    try:
        config = json.loads(data.decode('utf-8'), object_pairs_hook=unique_object)
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise RuntimeError('Invalid deployed runtime configuration') from None
    require(config == {'firebase': {'projectId': PROJECT, 'storageBucket': BUCKET}},
            'Unexpected deployed runtime configuration')
    return {'present': True, 'sha256': sha(data), 'bytes': len(data),
            'schema': 'firebase-project-and-bucket'}

def private(path):
    path = Path(path).resolve()
    require(path.is_relative_to(ROOT / '.netlify'), 'Artifacts must be inside ignored .netlify')
    require(subprocess.run(['git', 'check-ignore', '--quiet', str(path)], cwd=ROOT).returncode == 0, 'Artifact path must be ignored')
    return path
class Api:
    def __init__(self, credential): self.credential = private(credential)
    def request(self, method, path, body=None):
        session = read(self.credential)
        require(session['expires_at'] > time.time() * 1000 + 60000, 'Renew the authorized owner session')
        data = json.dumps(body).encode() if body is not None else None
        with urlopen(Request(API + path, data=data, method=method, headers={'Authorization': 'Bearer ' + session['access_token'], 'Content-Type': 'application/json'}), timeout=60) as response:
            return json.load(response)
    def inventory(self):
        rows, token = {}, None
        while True:
            value = self.request('GET', PARENT + '/functions' + ('?pageToken=' + token if token else ''))
            rows.update({r['name']: r for r in value.get('functions', [])})
            token = value.get('nextPageToken')
            if not token: return rows
    def source(self, endpoint, version):
        from urllib.parse import urlparse
        result = self.request('POST', PARENT + '/functions/' + endpoint + ':generateDownloadUrl', {'versionId': str(version)})
        url = result['downloadUrl']; host = urlparse(url).hostname
        require(host and (host == 'storage.googleapis.com' or host.endswith('.storage.googleapis.com')), 'Unexpected source host')
        with urlopen(url, timeout=60) as response: archive = response.read(104857601)
        require(len(archive) <= 104857600, 'Source archive exceeds the verification bound')
        return archive
    def iam(self, endpoint):
        return self.request('GET', PARENT + '/functions/' + endpoint + ':getIamPolicy?options.requestedPolicyVersion=3')

def timeout_seconds(value):
    if not isinstance(value, str) or not value.endswith('s'): return None
    try: return Decimal(value[:-1])
    except InvalidOperation: return None

def validate_definition(endpoint, row, policy=None):
    expected = expected_definitions()[endpoint]
    require(row and row.get('name') == PARENT + '/functions/' + endpoint and row.get('status') == 'ACTIVE'
            and row.get('entryPoint') == endpoint and row.get('runtime') == 'nodejs22',
            'Endpoint is not the expected active runtime: ' + endpoint)
    require(timeout_seconds(row.get('timeout')) == timeout_seconds(expected['timeout']), 'Timeout differs: ' + endpoint)
    require(type(row.get('availableMemoryMb', 256)) is int and row.get('availableMemoryMb', 256) == expected['availableMemoryMb'], 'Memory differs: ' + endpoint)
    require(type(row.get('maxInstances')) is int and row['maxInstances'] == expected['maxInstances'], 'Maximum instances differs: ' + endpoint)
    if endpoint in CALLABLES:
        require(isinstance(row.get('httpsTrigger'), dict) and 'eventTrigger' not in row, 'Callable trigger differs: ' + endpoint)
        require(row['httpsTrigger'].get('url') == f'https://{REGION}-{PROJECT}.cloudfunctions.net/{endpoint}', 'Callable URL differs: ' + endpoint)
        require(row.get('labels', {}).get('deployment-callable') == 'true', 'Callable transport label missing: ' + endpoint)
        require(row.get('ingressSettings', 'ALLOW_ALL') == 'ALLOW_ALL', 'Callable ingress is not public: ' + endpoint)
        bindings = policy.get('bindings', []) if isinstance(policy, dict) else []
        require(any(binding.get('role') == 'roles/cloudfunctions.invoker' and 'allUsers' in binding.get('members', [])
                    and not binding.get('condition') for binding in bindings), 'Callable public invoker IAM missing: ' + endpoint)
        require(all(binding.get('role') == 'roles/cloudfunctions.invoker' for binding in bindings
                    if 'allUsers' in binding.get('members', [])), 'Unexpected public IAM role: ' + endpoint)
    else:
        require('httpsTrigger' not in row and row.get('eventTrigger') == expected['eventTrigger'], 'Event trigger resource/type/service/retry differs: ' + endpoint)
    return expected

def prepare(run, api):
    require(not run.exists(), 'Use a fresh run directory')
    before = api.inventory()
    source = run / 'source'; source.mkdir(parents=True)
    manifest = {}
    for name in ('index.js', *FILES):
        original = HERE / name if name == 'index.js' else ROOT / 'functions' / name
        data = original.read_bytes(); (source / name).write_bytes(data)
        manifest[name] = {'sha256': sha(data), 'bytes': len(data)}
    closure = scoped_runtime_module_closure(source, manifest)
    require(api.inventory() == before, 'Function inventory changed during preparation')
    rollback, before_iam = {}, {}
    for endpoint in ENDPOINTS:
        old = before.get(PARENT + '/functions/' + endpoint)
        if old:
            require(old.get('status') == 'ACTIVE', 'Existing endpoint is changing or unavailable: ' + endpoint)
            policy = api.iam(endpoint); before_iam[endpoint] = policy
            archive = api.source(endpoint, old['versionId']); (run / (endpoint + '-before.zip')).write_bytes(archive)
            rollback[endpoint] = {'version': old['versionId'], 'sha256': sha(archive),
                                  'iamSha256': sha(json.dumps(policy, sort_keys=True).encode()),
                                  'configurationSha256': sha(json.dumps(old, sort_keys=True).encode())}
    require(api.inventory() == before, 'Function inventory changed during rollback capture')
    require(all(api.iam(endpoint) == policy for endpoint, policy in before_iam.items()), 'Function IAM changed during rollback capture')
    write(run / 'before.json', before)
    write(run / 'before-iam.json', before_iam)
    write(run / 'manifest.json', {'schemaVersion': 2, 'project': PROJECT, 'endpoints': ENDPOINTS, 'files': manifest,
                                  'definitions': expected_definitions(), 'rollback': rollback, 'preparedAt': time.time(),
                                  **({'moduleClosure': closure} if closure is not None else {})})
    write(run / 'firebase.json', FIREBASE_CONFIG)
    (source / '.firebaseignore').write_bytes(FIREBASE_IGNORE)
    print(json.dumps({'prepared': True, 'endpoints': list(ENDPOINTS), 'sourceFiles': len(manifest)}))

def verify(run, api):
    manifest, before, after = read(run / 'manifest.json'), read(run / 'before.json'), api.inventory()
    require(manifest.get('schemaVersion') == 2 and tuple(manifest['endpoints']) == ENDPOINTS and manifest['project'] == PROJECT
            and manifest.get('definitions') == expected_definitions(), 'Release scope or expected definitions changed; prepare a fresh run')
    require(set(manifest['files']) == {'index.js', *FILES}, 'Prepared source manifest is incomplete')
    require(read(run / 'firebase.json') == FIREBASE_CONFIG and (run / 'source' / '.firebaseignore').read_bytes() == FIREBASE_IGNORE, 'Scoped Firebase configuration changed')
    for name, expected in manifest['files'].items():
        data = (run / 'source' / name).read_bytes()
        require(sha(data) == expected['sha256'] and len(data) == expected['bytes'], 'Prepared source changed')
    closure = scoped_runtime_module_closure(run / 'source', manifest['files'])
    if closure is not None:
        require(manifest.get('moduleClosure') == closure, 'Prepared runtime module closure changed; prepare a fresh run')
    owned = {PARENT + '/functions/' + name for name in ENDPOINTS}
    require({k: v for k, v in before.items() if k not in owned} == {k: v for k, v in after.items() if k not in owned}, 'Unrelated function inventory changed')
    results, after_iam = {}, {}
    for endpoint in ENDPOINTS:
        row = after.get(PARENT + '/functions/' + endpoint)
        policy = api.iam(endpoint)
        after_iam[endpoint] = policy
        definition = validate_definition(endpoint, row, policy)
        archive = api.source(endpoint, row['versionId'])
        runtime_config = {'present': False}
        with zipfile.ZipFile(io.BytesIO(archive)) as z:
            names = [name for name in z.namelist() if not name.endswith('/')]
            require(len(names) == len(set(names)), 'Duplicate files in deployed archive')
            require(set(manifest['files']).issubset(names), 'Required source absent from deployed archive')
            require(set(names).issubset(set(manifest['files']) | {'.firebaseignore', '.runtimeconfig.json'}), 'Unexpected file in deployed archive')
            for name, expected in manifest['files'].items():
                require(z.getinfo(name).file_size == expected['bytes'] and sha(z.read(name)) == expected['sha256'], 'Deployed source differs: ' + name)
            if '.firebaseignore' in names: require(z.read('.firebaseignore') == FIREBASE_IGNORE, 'Deployed ignore configuration differs')
            if '.runtimeconfig.json' in names:
                require(z.getinfo('.runtimeconfig.json').file_size <= 4096, 'Deployed runtime configuration exceeds its bound')
                runtime_config = validate_runtime_config(z.read('.runtimeconfig.json'))
        results[endpoint] = {'versionId': row['versionId'], 'sourceSha256': sha(archive), 'status': row['status'],
                             'definition': definition, 'iamSha256': sha(json.dumps(policy, sort_keys=True).encode()),
                             'runtimeConfig': runtime_config}
    require(api.inventory() == after, 'Function inventory changed during verification')
    require(all(api.iam(endpoint) == policy for endpoint, policy in after_iam.items()), 'Function IAM changed during verification')
    write(run / 'after.json', after)
    write(run / 'after-iam.json', after_iam)
    write(run / 'verified.json', {'verifiedAt': time.time(), 'functions': results, 'unrelatedFunctionsPreserved': True, 'triggerRuntimeAndTransportVerified': True,
                                 **({'runtimeModuleClosureVerified': True} if closure is not None else {})})
    print(json.dumps({'verified': True, 'functions': results, 'unrelatedFunctionsPreserved': True}))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--mode', choices=['prepare', 'verify'], required=True)
    parser.add_argument('--run-dir', required=True); parser.add_argument('--credential-file', required=True)
    args = parser.parse_args()
    (prepare if args.mode == 'prepare' else verify)(private(args.run_dir), Api(args.credential_file))
