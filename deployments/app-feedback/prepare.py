"""Prepare/verify only the public feedback receiver and private admin reader."""
import argparse
import importlib.util
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('feedback_scope', HERE.parent / 'workout-notifications' / 'prepare.py')
scope = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scope)
audit = scope.audit
ENDPOINTS = ('receiveAppFeedback', 'getAppFeedback')
FILES = ('app-feedback.js', 'club-access.js', 'athlete-storage-paths.js', 'package.json', 'package-lock.json')

def definitions():
    return {name: {'timeout': '30s', 'availableMemoryMb': 256,
        'maxInstances': 10 if name == 'receiveAppFeedback' else 5,
        'secrets': ['APP_FEEDBACK_RATE_KEY'] if name == 'receiveAppFeedback' else [],
        'httpsTrigger': True, 'publicInvoker': True, 'ingressSettings': 'ALLOW_ALL',
        'callable': name == 'getAppFeedback'} for name in ENDPOINTS}

def configure():
    audit.HERE, audit.ENDPOINTS, audit.FILES = HERE, ENDPOINTS, FILES
    audit.CALLABLES = ('getAppFeedback',)
    audit.FIREBASE_CONFIG = {'functions': {'source': 'source', 'codebase': 'app-feedback', 'runtime': 'nodejs22'}}
    scope.HTTPS, scope.CALLABLES = ENDPOINTS, ('getAppFeedback',)
    scope.definitions = definitions
    audit.expected_definitions, audit.validate_definition = definitions, scope.validate
    return audit

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=['prepare', 'verify'], required=True)
    parser.add_argument('--run-dir', required=True)
    parser.add_argument('--credential-file', required=True)
    args = parser.parse_args()
    release = configure()
    (release.prepare if args.mode == 'prepare' else release.verify)(release.private(args.run_dir), release.Api(args.credential_file))
