"""Prepare and audit exactly ten recovery callables; never deploy or publish rules."""
from __future__ import annotations
import argparse
import contextlib
from copy import deepcopy
import importlib.util
import io
import json
from pathlib import Path
import re

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('recovery_release_audit', HERE.parent / 'expanded-insights' / 'prepare.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)
EXISTING = ('getAccountAccessLink', 'completeAccountAccessLink', 'listAccountAccessLinks', 'revokeAccountAccessLink')
NEW = ('inspectPlayerRecovery', 'issuePlayerRecovery', 'submitAccountRecoveryRequest', 'listAccountRecoveryRequests',
       'updateAccountRecoveryRequest', 'confirmAccountRecovery')
ENDPOINTS = (*EXISTING, *NEW)
FILES = ('account-access.js', 'account-recovery.js', 'clubs.js', 'club-access.js', 'player-profile.js', 'athlete-storage-paths.js', 'package.json', 'package-lock.json')
ONLY = ','.join('functions:' + name for name in ENDPOINTS)
SERVICE_ACCOUNT = audit.PROJECT + '@appspot.gserviceaccount.com'
TRANSIENT = {'versionId', 'updateTime', 'buildId', 'buildName', 'sourceUploadUrl', 'sourceArchiveUrl', 'sourceRepository'}

def definitions():
    return {name: {'timeout': '120s' if name in EXISTING[:2] else '30s' if name == 'submitAccountRecoveryRequest' else '60s', 'availableMemoryMb': 256,
                  'maxInstances': 10 if name == 'submitAccountRecoveryRequest' else 5 if name in NEW else None, 'httpsTrigger': True, 'callable': True,
                  'publicInvoker': True, 'ingressSettings': 'ALLOW_ALL', 'secrets': []} for name in ENDPOINTS}

def validate(name, row, policy):
    expected = definitions()[name]
    audit.require(isinstance(row, dict) and row.get('name') == audit.PARENT + '/functions/' + name
                  and row.get('status') == 'ACTIVE' and row.get('entryPoint') == name and row.get('runtime') == 'nodejs22',
                  'Endpoint is not the expected active runtime: ' + name)
    audit.require(audit.timeout_seconds(row.get('timeout')) == audit.timeout_seconds(expected['timeout']), 'Timeout differs: ' + name)
    audit.require(row.get('availableMemoryMb', 256) == 256 and row.get('maxInstances') == expected['maxInstances'], 'Capacity differs: ' + name)
    audit.require(row.get('serviceAccountEmail') == SERVICE_ACCOUNT and not row.get('vpcConnector') and not row.get('secretVolumes')
                  and not row.get('secretEnvironmentVariables') and row.get('environment', 'GEN_1') == 'GEN_1', 'Service/runtime binding differs: ' + name)
    audit.require(isinstance(row.get('httpsTrigger'), dict) and 'eventTrigger' not in row
                  and row['httpsTrigger'].get('url') == f'https://{audit.REGION}-{audit.PROJECT}.cloudfunctions.net/{name}', 'Callable trigger differs: ' + name)
    audit.require(row.get('labels', {}).get('deployment-callable') == 'true' and not row.get('labels', {}).get('firebase-functions-codebase')
                  and row.get('ingressSettings', 'ALLOW_ALL') == 'ALLOW_ALL', 'Callable ownership/transport differs: ' + name)
    bindings = policy.get('bindings', [])
    audit.require(any(b.get('role') == 'roles/cloudfunctions.invoker' and 'allUsers' in b.get('members', []) and not b.get('condition') for b in bindings),
                  'Public callable transport invoker missing: ' + name)
    audit.require(all(b.get('role') == 'roles/cloudfunctions.invoker' for b in bindings if 'allUsers' in b.get('members', [])), 'Unexpected public IAM role: ' + name)
    return expected

def stable(row):
    row = deepcopy(row)
    for field in TRANSIENT: row.pop(field, None)
    row.get('labels', {}).pop('firebase-functions-hash', None)
    return row

def module_closure(source, files):
    dependencies = json.loads((source / 'package.json').read_text())['dependencies']
    literals = re.compile(r'\brequire\s*\(\s*(["\'])([^"\']+)\1\s*\)')
    calls = re.compile(r'\brequire\s*\(')
    graph, external = {}, set()
    for name in sorted(files):
        if not name.endswith('.js'): continue
        text = (source / name).read_text(encoding='utf-8')
        matches = list(literals.finditer(text))
        audit.require({m.start() for m in calls.finditer(text)} == {m.start() for m in matches}, 'Computed runtime import requires review: ' + name)
        imports = []
        for match in matches:
            request = match.group(2)
            if request.startswith('.'):
                target = (source / name).parent / request
                candidates = [target, Path(str(target) + '.js'), Path(str(target) + '.json')]
                audit.require(all(p.resolve().is_relative_to(source.resolve()) for p in candidates), 'Runtime import escapes prepared source')
                resolved = next((p for p in candidates if p.is_file()), None)
                audit.require(resolved is not None and resolved.relative_to(source).as_posix() in files, 'Required runtime module missing: ' + name + ' -> ' + request)
                imports.append(resolved.relative_to(source).as_posix())
            else:
                audit.require(request in ('crypto', 'node:crypto', 'node:net') or request in dependencies, 'Undeclared runtime dependency: ' + request)
                external.add(request)
        graph[name] = sorted(set(imports))
    reached, pending = set(), ['index.js']
    while pending:
        name = pending.pop()
        if name in reached: continue
        reached.add(name); pending.extend(graph.get(name, []))
    audit.require(set(graph).issubset(reached), 'Prepared runtime has unreachable JavaScript modules')
    return {'entryPoint': 'index.js', 'localModules': sorted(reached), 'externalImports': sorted(external), 'imports': graph}

def configure():
    audit.HERE, audit.ENDPOINTS, audit.FILES, audit.CALLABLES = HERE, ENDPOINTS, FILES, ENDPOINTS
    audit.FIREBASE_CONFIG = {'functions': {'source': 'source', 'runtime': 'nodejs22'}}
    audit.expected_definitions, audit.validate_definition = definitions, validate
    audit.scoped_runtime_module_closure = module_closure
    return audit

def verify(run, api):
    release = configure()
    try:
        # Emit success only after the added existing-runtime/IAM comparison.
        with contextlib.redirect_stdout(io.StringIO()): release.verify(run, api)
        before, after = release.read(run / 'before.json'), release.read(run / 'after.json')
        before_iam, after_iam = release.read(run / 'before-iam.json'), release.read(run / 'after-iam.json')
        for name in EXISTING:
            key = release.PARENT + '/functions/' + name
            release.require(key in before and stable(before[key]) == stable(after[key]), 'Existing runtime configuration changed: ' + name)
            release.require(before_iam[name] == after_iam[name], 'Existing IAM policy changed: ' + name)
        proof = release.read(run / 'verified.json')
        proof.update(existingRuntimeAndIamPreserved=True, explicitEndpointFilter=ONLY)
        release.write(run / 'verified.json', proof)
    except Exception:
        (run / 'verified.json').unlink(missing_ok=True)
        raise
    print(json.dumps({'verified': True, 'functions': proof['functions'], 'existingRuntimeAndIamPreserved': True,
                      'unrelatedFunctionsPreserved': True, 'runtimeModuleClosureVerified': True}))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=['prepare', 'verify'], required=True)
    parser.add_argument('--run-dir', required=True)
    parser.add_argument('--credential-file', required=True)
    args = parser.parse_args()
    release = configure()
    run, api = release.private(args.run_dir), release.Api(args.credential_file)
    if args.mode == 'prepare':
        release.prepare(run, api)
        print(json.dumps({'explicitEndpointFilter': ONLY, 'rulesPublished': False}))
    else: verify(run, api)
