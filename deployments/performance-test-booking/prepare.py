"""Prepare/verify the isolated public booking endpoint. Does not deploy or send."""
from __future__ import annotations
import argparse
import importlib.util
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('booking_release_audit', HERE.parent / 'expanded-insights' / 'prepare.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)
ENDPOINT = 'requestPerformanceTestBooking'
FILES = ('performance-test-booking.js', 'performance-test-booking-provider.js',
         'performance-test-booking-entrypoints.js', 'package.json', 'package-lock.json')


def definitions():
    return {ENDPOINT: {'timeout': '60s', 'availableMemoryMb': 256, 'maxInstances': 5,
                       'httpsTrigger': True, 'publicInvoker': True, 'ingressSettings': 'ALLOW_ALL',
                       'secrets': ['RESEND_API_KEY']}}


def validate(name, row, policy):
    expected = definitions()[name]
    audit.require(isinstance(row, dict) and row.get('name') == audit.PARENT + '/functions/' + name
                  and row.get('status') == 'ACTIVE' and row.get('entryPoint') == name
                  and row.get('runtime') == 'nodejs22', 'Endpoint runtime or identity differs: ' + name)
    audit.require(audit.timeout_seconds(row.get('timeout')) == audit.timeout_seconds(expected['timeout']), 'Timeout differs: ' + name)
    for key in ('availableMemoryMb', 'maxInstances'):
        value = row.get(key, 256 if key == 'availableMemoryMb' else None)
        audit.require(type(value) is int and value == expected[key], key + ' differs: ' + name)
    secrets = row.get('secretEnvironmentVariables', [])
    audit.require(isinstance(secrets, list) and len(secrets) == 1, 'Secret bindings differ: ' + name)
    secret = secrets[0]
    audit.require(secret.get('key') == 'RESEND_API_KEY' and secret.get('secret') == 'RESEND_API_KEY'
                  and secret.get('projectId') in (audit.PROJECT, '839600313930')
                  and isinstance(secret.get('version'), str) and secret['version'].isdigit(), 'Secret binding differs: ' + name)
    audit.require(isinstance(row.get('httpsTrigger'), dict) and 'eventTrigger' not in row
                  and row['httpsTrigger'].get('url') == f'https://{audit.REGION}-{audit.PROJECT}.cloudfunctions.net/{name}',
                  'HTTPS trigger differs: ' + name)
    audit.require(row.get('ingressSettings', 'ALLOW_ALL') == 'ALLOW_ALL'
                  and row.get('labels', {}).get('deployment-callable') != 'true', 'HTTP transport differs: ' + name)
    bindings = policy.get('bindings', []) if isinstance(policy, dict) else []
    audit.require(any(binding.get('role') == 'roles/cloudfunctions.invoker' and 'allUsers' in binding.get('members', [])
                      and not binding.get('condition') for binding in bindings), 'Public transport invoker missing: ' + name)
    audit.require(all(binding.get('role') == 'roles/cloudfunctions.invoker' for binding in bindings
                      if 'allUsers' in binding.get('members', [])), 'Unexpected public IAM role: ' + name)
    return expected


def configure():
    audit.HERE = HERE
    audit.ENDPOINTS = (ENDPOINT,)
    audit.FILES = FILES
    audit.CALLABLES = ()
    audit.FIREBASE_CONFIG = {'functions': {'source': 'source', 'codebase': 'performance-test-booking', 'runtime': 'nodejs22'}}
    audit.expected_definitions = definitions
    audit.validate_definition = validate
    return audit


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=['prepare', 'verify'], required=True)
    parser.add_argument('--run-dir', required=True)
    parser.add_argument('--credential-file', required=True)
    args = parser.parse_args()
    release = configure()
    (release.prepare if args.mode == 'prepare' else release.verify)(release.private(args.run_dir), release.Api(args.credential_file))
