"""Prepare/verify only Microsoft email claims, receipts and trace reconciliation."""
import argparse
import importlib.util
from pathlib import Path
HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('microsoft_email_release', HERE.parent / 'workout-notifications' / 'prepare.py')
scope = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scope)
audit = scope.audit
ENDPOINTS = ('claimMicrosoftEmail', 'receiptMicrosoftEmail', 'reconcileMicrosoftEmail')
FILES = (*scope.FILES, 'microsoft-email.js', 'microsoft-email-entrypoints.js')
# The inherited issue/webhook closure now includes the final send-policy gate.
# Refuse preparation if that dependency is ever removed from the base manifest.
assert 'user-issue-notification-policy.js' in FILES

def definitions():
    result = {}
    for name in ENDPOINTS:
        scheduled = name == 'reconcileMicrosoftEmail'
        row = {'timeout': '300s' if scheduled else '60s', 'availableMemoryMb': 256,
               'maxInstances': 1 if scheduled else 10,
               'secrets': scope.MICROSOFT_SECRETS[1:] if scheduled else ['MICROSOFT_EMAIL_CALLBACK_SECRET']}
        if scheduled:
            row['eventTrigger'] = {'resource': f'projects/{audit.PROJECT}/topics/firebase-schedule-{name}-{audit.REGION}',
                                   'eventType': 'google.pubsub.topic.publish', 'service': 'pubsub.googleapis.com'}
        else:
            row.update({'httpsTrigger': True, 'publicInvoker': True, 'ingressSettings': 'ALLOW_ALL', 'callable': False})
        result[name] = row
    return result

def validate(name, row, policy):
    if name == 'reconcileMicrosoftEmail' and row.get('eventTrigger', {}).get('failurePolicy') == {}:
        row = {**row, 'eventTrigger': {k: v for k, v in row['eventTrigger'].items() if k != 'failurePolicy'}}
    return scope.validate(name, row, policy)

def configure():
    audit.HERE = HERE
    audit.ENDPOINTS = ENDPOINTS
    audit.FILES = FILES
    audit.CALLABLES = ()
    audit.FIREBASE_CONFIG = {'functions': {'source': 'source', 'codebase': 'microsoft-email', 'runtime': 'nodejs22'}}
    scope.HTTPS = ENDPOINTS[:2]
    scope.CALLABLES = ()
    scope.definitions = definitions
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
