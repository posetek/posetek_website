"""Prepare/verify only the ten user-issue functions. Does not deploy rules."""
import argparse
import importlib.util
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('issue_release', HERE.parent / 'workout-notifications' / 'prepare.py')
scope = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scope)
audit = scope.audit
ENDPOINTS = ('submitUserIssue', 'getUserIssues', 'updateUserIssue', 'observeIssueAi', 'observeIssueReport',
             'observeIssueDiagnostic', 'observeIssueLog', 'dispatchUserIssue', 'sweepUserIssues', 'dailyUserIssues')
CALLABLES = ENDPOINTS[:3]
FILES = ('user-issues.js', 'user-issue-model.js', 'user-issue-sources.js', 'user-issue-entrypoints.js',
         'workout-notifications-provider.js', 'club-access.js', 'athlete-storage-paths.js', 'package.json', 'package-lock.json')

def definitions():
    result = {}
    documents = {'observeIssueAi': 'aiIncidents/{id}', 'observeIssueReport': 'fieldReports/{id}',
                 'observeIssueDiagnostic': 'failureCases/{id}', 'dispatchUserIssue': 'userIssueOutbox/{id}'}
    for name in ENDPOINTS:
        scheduled = name in ('sweepUserIssues', 'dailyUserIssues')
        row = {'timeout': '60s' if name in CALLABLES else '300s' if scheduled else '120s',
               'availableMemoryMb': 256, 'maxInstances': 10 if name in CALLABLES else 1 if scheduled else 5,
               'secrets': ['RESEND_API_KEY'] if scheduled or name == 'dispatchUserIssue' else []}
        if name in CALLABLES:
            row.update({'httpsTrigger': True, 'publicInvoker': True, 'ingressSettings': 'ALLOW_ALL', 'callable': True})
        elif name in documents:
            row['eventTrigger'] = {'resource': f'projects/{audit.PROJECT}/databases/(default)/documents/{documents[name]}',
                'eventType': 'providers/cloud.firestore/eventTypes/document.write' if name == 'dispatchUserIssue' else 'providers/cloud.firestore/eventTypes/document.create',
                'service': 'firestore.googleapis.com', 'failurePolicy': {'retry': {}}}
        else:
            topic = 'posetek-user-issues' if name == 'observeIssueLog' else f'firebase-schedule-{name}-{audit.REGION}'
            row['eventTrigger'] = {'resource': f'projects/{audit.PROJECT}/topics/{topic}',
                'eventType': 'google.pubsub.topic.publish', 'service': 'pubsub.googleapis.com'}
            if not scheduled: row['eventTrigger']['failurePolicy'] = {'retry': {}}
        result[name] = row
    return result

def validate(name, row, policy):
    # REST v1 normalizes omitted scheduler failurePolicy to an empty object.
    if name in ('sweepUserIssues', 'dailyUserIssues') and row.get('eventTrigger', {}).get('failurePolicy') == {}:
        row = {**row, 'eventTrigger': {k: v for k, v in row['eventTrigger'].items() if k != 'failurePolicy'}}
    return scope.validate(name, row, policy)

def configure():
    audit.HERE = HERE
    audit.ENDPOINTS = ENDPOINTS
    audit.FILES = FILES
    audit.CALLABLES = CALLABLES
    audit.FIREBASE_CONFIG = {'functions': {'source': 'source', 'codebase': 'user-issues', 'runtime': 'nodejs22'}}
    scope.HTTPS = scope.CALLABLES = CALLABLES
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
