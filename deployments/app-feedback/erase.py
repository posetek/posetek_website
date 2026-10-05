"""Preview or explicitly erase only one verified account's attributed feedback.

No Auth/player writes, deployments, broad collection deletion, or answer reads.
Credentials and count-only receipts stay in the ignored .netlify directory.
"""
from __future__ import annotations
import argparse
import importlib.util
import json
from pathlib import Path
import re
import sys
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('feedback_erasure_prepare', HERE / 'prepare.py')
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)
audit = prepare.audit
PARENT = 'projects/kickai-69dd0/databases/(default)/documents'
BASE = 'https://firestore.googleapis.com/v1/'
RESPONSES = 'appFeedbackResponsesV1'
SESSIONS = 'appFeedbackSessionsV1'
PAGE_SIZE = 200
MAX_RESPONSES = 10000
UUID = r'[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}'
STAMP = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$')
SESSION_MASK = '?mask.fieldPaths=formVersion&mask.fieldPaths=identityMode'


def require(ok, message):
    if not ok:
        raise ValueError(message)


def validate_uid(uid):
    require(isinstance(uid, str) and 0 < len(uid) <= 128 and bool(uid.strip())
            and not re.search(r'[\x00-\x1f\x7f-\x9f]', uid), 'Supply an exact valid account UID')
    return uid  # Never trim, case-fold, or infer another account's identifier.


def document_path(name, collection):
    require(isinstance(name, str) and re.fullmatch(re.escape(PARENT + '/' + collection + '/') + UUID, name),
            'Unexpected feedback document path')
    return name


def query_body(uid, after=None):
    validate_uid(uid)
    query = {
        'select': {'fields': [{'fieldPath': field} for field in ('formVersion', 'identityMode', 'author.uid')]},
        'from': [{'collectionId': RESPONSES}],
        'where': {'fieldFilter': {'field': {'fieldPath': 'author.uid'}, 'op': 'EQUAL', 'value': {'stringValue': uid}}},
        'orderBy': [{'field': {'fieldPath': '__name__'}, 'direction': 'ASCENDING'}],
        'limit': PAGE_SIZE,
    }
    if after is not None:
        query['startAt'] = {'values': [{'referenceValue': document_path(after, RESPONSES)}], 'before': False}
    return {'structuredQuery': query}


def eligible(document, uid):
    fields = document.get('fields', {})
    return (fields.get('formVersion') == {'integerValue': '2'}
            and fields.get('identityMode') == {'stringValue': 'account'}
            and fields.get('author', {}).get('mapValue', {}).get('fields', {}).get('uid') == {'stringValue': uid})


class Api(audit.Api):
    """Reuse the release auditor's private credential checks; pin Firestore scope."""
    def request(self, method, path, body=None):
        query = method == 'POST' and path == PARENT + ':runQuery'
        commit = method == 'POST' and path == PARENT + ':commit'
        session = method == 'GET' and path.endswith(SESSION_MASK)
        if session:
            document_path(path[:-len(SESSION_MASK)], SESSIONS)
        require(query or commit or session, 'Unsupported erasure API operation')
        credential = audit.read(self.credential)
        require(credential['expires_at'] > time.time() * 1000 + 60000, 'Renew the authorized owner session')
        data = json.dumps(body).encode() if body is not None else None
        try:
            with urlopen(Request(BASE + path, data=data, method=method, headers={
                    'Authorization': 'Bearer ' + credential['access_token'], 'Content-Type': 'application/json'}), timeout=60) as response:
                return json.load(response)
        except HTTPError as error:
            if session and error.code == 404:
                return None
            # Never print a provider body, credential, query UID, or document data.
            raise RuntimeError('Firestore erasure request failed') from None


def plan(api, uid):
    validate_uid(uid)
    documents, after, seen = [], None, set()
    while True:
        rows = api.request('POST', PARENT + ':runQuery', query_body(uid, after))
        require(isinstance(rows, list), 'Unexpected feedback query result')
        page = [row['document'] for row in rows if isinstance(row, dict) and 'document' in row]
        require(len(page) <= PAGE_SIZE, 'Feedback query exceeded its page bound')
        for document in page:
            name = document_path(document.get('name'), RESPONSES)
            require(name not in seen and (after is None or name > after), 'Feedback query cursor did not advance')
            seen.add(name)
            if eligible(document, uid):
                require(bool(STAMP.fullmatch(document.get('updateTime', ''))), 'Missing response revision')
                documents.append(document)
        require(len(seen) <= MAX_RESPONSES, 'Feedback query exceeded its safety bound')
        if len(page) < PAGE_SIZE:
            break
        after = document_path(page[-1]['name'], RESPONSES)
    pairs = []
    for document in documents:
        response = document['name']
        session_path = document_path(PARENT + '/' + SESSIONS + '/' + response.rsplit('/', 1)[1], SESSIONS)
        session = api.request('GET', session_path + SESSION_MASK)
        if session is not None:
            require(isinstance(session, dict) and session.get('name') == session_path,
                    'Unexpected feedback session path')
            fields = session.get('fields', {})
            require(fields.get('formVersion') == {'integerValue': '2'}
                    and fields.get('identityMode') == {'stringValue': 'account'},
                    'Refusing to alter an anonymous or historical session')
            require(bool(STAMP.fullmatch(session.get('updateTime', ''))), 'Missing session revision')
        pairs.append((response, document['updateTime'], session_path, session.get('updateTime') if session else None))
    return pairs


class ErasureError(RuntimeError):
    def __init__(self, receipt):
        super().__init__('Erasure incomplete; preview and retry with the same verified UID')
        self.receipt = receipt


def erase(api, uid, *, apply=False):
    receipt = {'mode': 'apply' if apply else 'preview', 'completed': False,
               'matchedResponses': 0, 'matchedSessions': 0,
               'responseDeletesAcknowledged': 0, 'sessionDeletesAcknowledged': 0}
    try:
        pairs = plan(api, uid)
        receipt.update(matchedResponses=len(pairs), matchedSessions=sum(stamp is not None for _, _, _, stamp in pairs))
        if apply:
            for response, revision, session, session_revision in pairs:
                # Atomic and revision-guarded: a stale plan cannot delete a changed
                # response, another mode's session, or leave a joinable session.
                api.request('POST', PARENT + ':commit', {'writes': [
                    {'delete': response, 'currentDocument': {'updateTime': revision}},
                    {'delete': session, 'currentDocument': {'updateTime': session_revision} if session_revision else {'exists': False}},
                ]})
                receipt['responseDeletesAcknowledged'] += 1
                receipt['sessionDeletesAcknowledged'] += session_revision is not None
        receipt['completed'] = True
        return receipt
    except Exception:
        # Partial application is safe to rerun: re-query remaining eligible rows.
        # A lost commit response is not counted as an acknowledged deletion.
        raise ErasureError(receipt) from None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--uid', required=True, help='Exact UID from a verified account/privacy-deletion request')
    parser.add_argument('--credential-file', required=True)
    parser.add_argument('--run-dir', required=True, help='Fresh receipt directory inside ignored .netlify')
    parser.add_argument('--apply', action='store_true', help='Actually delete the previewed eligible response/session pairs')
    args = parser.parse_args(argv)
    try:
        validate_uid(args.uid)
        run = audit.private(args.run_dir)
        require(not run.exists(), 'Use a fresh private run directory')
        api = Api(args.credential_file)
        run.mkdir(parents=True)
        try:
            receipt = erase(api, args.uid, apply=args.apply)
            status = 0
        except ErasureError as error:
            receipt, status = error.receipt, 1
        audit.write(run / 'erasure.json', receipt)
        print(json.dumps(receipt))
        return status
    except Exception:
        print(json.dumps({'completed': False, 'error': 'Erasure setup failed; check the exact UID and private paths'}))
        return 1


if __name__ == '__main__':
    sys.exit(main())
