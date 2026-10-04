"""Immutable, independently deployable workout-notification function scopes.

Reuses the existing source/inventory/IAM auditor. Never publishes rules or deploys.
"""
from __future__ import annotations
import argparse
import importlib.util
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('notification_release_audit', HERE.parent / 'expanded-insights' / 'prepare.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)
SCOPES = {
    'intake': ('observeWorkoutNotifications', 'observePersonalWorkoutNotifications', 'recordWorkoutActivity', 'getWorkoutNotificationStatus'),
    'delivery': ('dispatchWorkoutNotification', 'sweepWorkoutNotifications'),
    'webhook': ('resendWorkoutNotificationWebhook',),
}
DOCUMENTS = {
    'observeWorkoutNotifications': 'players/{playerId}/workoutLogs/{logId}',
    'observePersonalWorkoutNotifications': 'players/{playerId}/personalWorkoutLogs/{logId}',
    'dispatchWorkoutNotification': 'workoutNotificationOutbox/{notificationId}',
}
MICROSOFT_SECRETS = ['MICROSOFT_EMAIL_FLOW_ENDPOINT', 'MICROSOFT_EMAIL_TENANT_ID', 'MICROSOFT_EMAIL_CLIENT_ID', 'MICROSOFT_EMAIL_CLIENT_SECRET']
SECRETS = {
    'dispatchWorkoutNotification': ['RESEND_API_KEY', *MICROSOFT_SECRETS],
    'sweepWorkoutNotifications': ['RESEND_API_KEY', *MICROSOFT_SECRETS],
    'resendWorkoutNotificationWebhook': ['RESEND_WEBHOOK_SECRET'],
}
HTTPS = ('recordWorkoutActivity', 'getWorkoutNotificationStatus', 'resendWorkoutNotificationWebhook')
CALLABLES = HTTPS[:2]
FILES = ('workout-notifications.js', 'workout-notifications-entrypoints.js', 'workout-notifications-provider.js',
         'microsoft-email-model.js', 'microsoft-email-transport.js', 'microsoft-email-amendment.js',
         'user-issues.js', 'user-issue-model.js', 'user-issue-contacts.js',
         'user-issue-classification.js', 'user-issue-summary.js', 'user-issue-observations.js', 'user-issue-request-identity.js',
         'user-issue-notification-policy.js',
         'club-access.js', 'athlete-storage-paths.js', 'insights-v2-qualification.js', 'package.json', 'package-lock.json')


def definitions():
    result = {}
    for name in audit.ENDPOINTS:
        row = {'timeout': '300s' if name == 'sweepWorkoutNotifications' else '60s' if name in HTTPS else '120s',
               'availableMemoryMb': 256, 'maxInstances': 1 if name == 'sweepWorkoutNotifications' else 5 if name == 'dispatchWorkoutNotification' else 10,
               'secrets': SECRETS.get(name, [])}
        if name in HTTPS:
            row.update({'httpsTrigger': True, 'publicInvoker': True, 'ingressSettings': 'ALLOW_ALL', 'callable': name in CALLABLES})
        elif name in DOCUMENTS:
            row['eventTrigger'] = {
                'resource': f'projects/{audit.PROJECT}/databases/(default)/documents/{DOCUMENTS[name]}',
                'eventType': 'providers/cloud.firestore/eventTypes/document.write',
                'service': 'firestore.googleapis.com', 'failurePolicy': {'retry': {}},
            }
        else:
            row['eventTrigger'] = {
                'resource': f'projects/{audit.PROJECT}/topics/firebase-schedule-{name}-{audit.REGION}',
                'eventType': 'google.pubsub.topic.publish', 'service': 'pubsub.googleapis.com',
            }
        result[name] = row
    return result


def validate(name, row, policy):
    expected = definitions()[name]
    audit.require(isinstance(row, dict) and row.get('status') == 'ACTIVE', 'Endpoint is not ACTIVE: ' + name)
    audit.require(row.get('entryPoint') == name and row.get('runtime') == 'nodejs22', 'Entry point/runtime differs: ' + name)
    for key in ('timeout', 'availableMemoryMb', 'maxInstances'):
        audit.require(row.get(key, 256 if key == 'availableMemoryMb' else None) == expected[key], key + ' differs: ' + name)
    actual_secrets = row.get('secretEnvironmentVariables', [])
    audit.require(sorted(item.get('key', '') for item in actual_secrets) == sorted(expected['secrets']), 'Secret bindings differ: ' + name)
    for item in actual_secrets:
        audit.require(item.get('secret') == item.get('key') and bool(item.get('version')), 'Invalid secret binding: ' + name)
    if name in HTTPS:
        audit.require(isinstance(row.get('httpsTrigger'), dict) and 'eventTrigger' not in row, 'HTTPS trigger differs: ' + name)
        audit.require(row['httpsTrigger'].get('url') == f'https://{audit.REGION}-{audit.PROJECT}.cloudfunctions.net/{name}', 'HTTPS URL differs: ' + name)
        audit.require(row.get('ingressSettings', 'ALLOW_ALL') == 'ALLOW_ALL', 'HTTPS ingress differs: ' + name)
        audit.require((row.get('labels', {}).get('deployment-callable') == 'true') == (name in CALLABLES), 'Callable label differs: ' + name)
        bindings = policy.get('bindings', [])
        audit.require(any(b.get('role') == 'roles/cloudfunctions.invoker' and 'allUsers' in b.get('members', []) and not b.get('condition') for b in bindings), 'Public transport invoker missing: ' + name)
        audit.require(all(b.get('role') == 'roles/cloudfunctions.invoker' for b in bindings if 'allUsers' in b.get('members', [])), 'Unexpected public IAM role: ' + name)
    else:
        actual_trigger = row.get('eventTrigger')
        # Cloud Functions v1 may serialize an unspecified retry policy as an
        # empty object for the scheduler. Normalize only that equivalent form;
        # retain exact resource/type/service checks and all explicit retries.
        if (name == 'sweepWorkoutNotifications' and isinstance(actual_trigger, dict)
                and 'failurePolicy' not in expected['eventTrigger'] and actual_trigger.get('failurePolicy') == {}):
            actual_trigger = {key: value for key, value in actual_trigger.items() if key != 'failurePolicy'}
        audit.require('httpsTrigger' not in row and actual_trigger == expected['eventTrigger'], 'Event trigger differs: ' + name)
    return expected


def configure(scope):
    audit.HERE = HERE / scope
    audit.ENDPOINTS = SCOPES[scope]
    audit.FILES = FILES
    audit.CALLABLES = CALLABLES
    audit.FIREBASE_CONFIG = {'functions': {'source': 'source', 'codebase': 'workout-notifications-' + scope, 'runtime': 'nodejs22'}}
    audit.expected_definitions = definitions
    audit.validate_definition = validate
    return audit


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=['prepare', 'verify'], required=True)
    parser.add_argument('--scope', choices=SCOPES, required=True)
    parser.add_argument('--run-dir', required=True)
    parser.add_argument('--credential-file', required=True)
    args = parser.parse_args()
    release = configure(args.scope)
    (release.prepare if args.mode == 'prepare' else release.verify)(release.private(args.run_dir), release.Api(args.credential_file))
