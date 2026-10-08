"""Dry-run-first exact-UID erasure of server-bound recovery requests only."""
from __future__ import annotations
import argparse
import importlib.util
import json
from pathlib import Path
import re
import time
from urllib.request import Request, urlopen

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('recovery_erasure_prepare', HERE / 'prepare.py')
scope = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scope)
audit = scope.audit
PARENT = 'projects/kickai-69dd0/databases/(default)/documents'
BASE = 'https://firestore.googleapis.com/v1/'
COLLECTION = 'accountRecoveryRequests'
PAGE_SIZE, MAX_REQUESTS = 200, 10000
UUID = r'[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}'
STAMP = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$')

def require(valid, message):
    if not valid: raise ValueError(message)
def validate_uid(uid):
    require(isinstance(uid, str) and 0 < len(uid) <= 128 and bool(uid.strip()) and not re.search(r'[\x00-\x1f\x7f-\x9f]', uid), 'Supply an exact verified account UID')
    return uid
def document_path(name):
    require(isinstance(name, str) and re.fullmatch(re.escape(PARENT + '/' + COLLECTION + '/') + UUID, name), 'Unexpected recovery document path')
    return name
def query_body(uid, after=None):
    validate_uid(uid)
    query = {'select': {'fields': [{'fieldPath': field} for field in ('schemaVersion', 'targetUID')]},
        'from': [{'collectionId': COLLECTION}], 'where': {'fieldFilter': {'field': {'fieldPath': 'targetUID'}, 'op': 'EQUAL', 'value': {'stringValue': uid}}},
        'orderBy': [{'field': {'fieldPath': '__name__'}, 'direction': 'ASCENDING'}], 'limit': PAGE_SIZE}
    if after: query['startAt'] = {'values': [{'referenceValue': document_path(after)}], 'before': False}
    return {'structuredQuery': query}

class Api(audit.Api):
    def request(self, method, path, body=None):
        require(method == 'POST' and path in (PARENT + ':runQuery', PARENT + ':commit'), 'Unsupported erasure operation')
        if path.endswith(':commit'):
            require(isinstance(body, dict) and len(body.get('writes', [])) == 1, 'Only one revision-guarded request deletion is allowed')
            write = body['writes'][0]
            document_path(write.get('delete'))
            require(set(write) == {'delete', 'currentDocument'} and set(write['currentDocument']) == {'updateTime'} and bool(STAMP.fullmatch(write['currentDocument']['updateTime'])), 'Invalid erasure revision guard')
        credential = audit.read(self.credential)
        require(credential.get('expires_at', 0) > time.time() * 1000 + 60000, 'Renew the authorized owner session')
        with urlopen(Request(BASE + path, data=json.dumps(body).encode(), method=method, headers={
            'Authorization': 'Bearer ' + credential['access_token'], 'Content-Type': 'application/json'}), timeout=60) as response:
            return json.load(response)

def plan(api, uid):
    validate_uid(uid)
    selected, after, seen = [], None, set()
    while True:
        rows = api.request('POST', PARENT + ':runQuery', query_body(uid, after))
        require(isinstance(rows, list), 'Unexpected recovery query result')
        page = [row['document'] for row in rows if isinstance(row, dict) and 'document' in row]
        require(len(page) <= PAGE_SIZE, 'Query exceeded its page bound')
        for doc in page:
            name = document_path(doc.get('name'))
            require(name not in seen and (after is None or name > after), 'Query cursor did not advance')
            seen.add(name)
            fields = doc.get('fields', {})
            # Never infer an account from the public claimant's email or name.
            if fields.get('schemaVersion') == {'integerValue': '1'} and fields.get('targetUID') == {'stringValue': uid}:
                require(bool(STAMP.fullmatch(doc.get('updateTime', ''))), 'Missing request revision')
                selected.append((name, doc['updateTime']))
        require(len(seen) <= MAX_REQUESTS, 'Query exceeded its safety bound')
        if len(page) < PAGE_SIZE: break
        after = document_path(page[-1]['name'])
    return selected

class ErasureError(RuntimeError):
    def __init__(self, receipt):
        super().__init__('Erasure incomplete; preview and retry the same verified UID')
        self.receipt = receipt

def erase(api, uid, *, apply=False):
    receipt = {'mode': 'apply' if apply else 'preview', 'completed': False, 'matchedRequests': 0, 'requestDeletesAcknowledged': 0}
    try:
        selected = plan(api, uid); receipt['matchedRequests'] = len(selected)
        if apply:
            for name, revision in selected:
                api.request('POST', PARENT + ':commit', {'writes': [{'delete': name, 'currentDocument': {'updateTime': revision}}]})
                receipt['requestDeletesAcknowledged'] += 1
        receipt['completed'] = True
        return receipt
    except Exception: raise ErasureError(receipt) from None

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--uid', required=True, help='Exact UID from a verified account/privacy request; never from claimant details')
    parser.add_argument('--credential-file', required=True)
    parser.add_argument('--run-dir', required=True, help='Fresh private receipt directory under ignored .netlify')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args(argv)
    try:
        validate_uid(args.uid); run = audit.private(args.run_dir)
        require(not run.exists(), 'Use a fresh private run directory')
        api = Api(args.credential_file); run.mkdir(parents=True)
        try: receipt, status = erase(api, args.uid, apply=args.apply), 0
        except ErasureError as error: receipt, status = error.receipt, 1
        audit.write(run / 'erasure.json', receipt); print(json.dumps(receipt)); return status
    except Exception:
        print(json.dumps({'completed': False, 'error': 'Erasure setup failed; check exact UID and private paths'})); return 1

if __name__ == '__main__': raise SystemExit(main())
