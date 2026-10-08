"""Add recovery TTL/indexes only. Default reads configuration without mutation."""
from __future__ import annotations
import argparse
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import time
from urllib.request import Request, urlopen

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('recovery_storage_audit', HERE / 'prepare.py')
scope = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scope)
BASE = f'https://firestore.googleapis.com/v1/projects/{scope.audit.PROJECT}/databases/(default)/collectionGroups/'
TTL_COLLECTIONS = ('accountRecoveryRequests', 'accountRecoveryRequestRateLimits')
INDEXES = {
    'accountRecoveryRequests': [{'queryScope': 'COLLECTION', 'fields': [
        {'fieldPath': 'organizationId', 'order': 'ASCENDING'}, {'fieldPath': 'createdAtMillis', 'order': 'DESCENDING'}]}],
    'accountAccessGrants': [{'queryScope': 'COLLECTION', 'fields': [
        {'fieldPath': 'organizationId', 'order': 'ASCENDING'}, {'fieldPath': 'recoveryScope', 'order': 'ASCENDING'},
        {'fieldPath': 'createdAtMillis', 'order': 'DESCENDING'}]}],
}
MEMBER_INDEX = {'queryScope': 'COLLECTION_GROUP', 'fields': [{'fieldPath': 'userUID', 'order': 'ASCENDING'}]}

class Api:
    def __init__(self, credential): self.credential = scope.audit.private(credential)
    def request(self, method, url, body=None):
        session = scope.audit.read(self.credential)
        scope.audit.require(session.get('expires_at', 0) > time.time() * 1000 + 60000, 'Renew the authorized owner session')
        payload = json.dumps(body).encode() if body is not None else None
        with urlopen(Request(url, data=payload, method=method, headers={
            'Authorization': 'Bearer ' + session['access_token'], 'Content-Type': 'application/json'}), timeout=60) as response:
            return json.load(response)

def fields(index): return [item for item in index.get('fields', []) if item.get('fieldPath') != '__name__']
def equivalent(actual, expected):
    return actual.get('queryScope') == expected['queryScope'] and fields(actual) == expected['fields']
def writable_index(index):
    return {key: deepcopy(index[key]) for key in ('queryScope', 'apiScope', 'fields', 'density', 'multikey') if key in index}

def configure(api, *, apply=False):
    result = {'apply': apply, 'indexes': [], 'ttl': {}, 'memberUserUidCollectionGroupIndex': None}
    for collection, expected_indexes in INDEXES.items():
        url = BASE + collection + '/indexes'
        current, page_token = [], None
        while True:
            page = api.request('GET', url + ('?pageToken=' + page_token if page_token else ''))
            current.extend(page.get('indexes', []))
            page_token = page.get('nextPageToken')
            if not page_token: break
        for expected in expected_indexes:
            existing = next((item for item in current if equivalent(item, expected)), None)
            if existing is None and apply: api.request('POST', url, expected)
            result['indexes'].append({'collectionGroup': collection, **expected,
                'state': existing.get('state', 'unknown') if existing else 'requested' if apply else 'missing'})
    for collection in TTL_COLLECTIONS:
        url = BASE + collection + '/fields/expiresAt'
        current = api.request('GET', url)
        state = current.get('ttlConfig', {}).get('state')
        if state != 'ACTIVE' and apply: api.request('PATCH', url + '?updateMask=ttlConfig', {'ttlConfig': {}})
        result['ttl'][collection] = state or ('requested' if apply else 'missing')
    # A player account is excluded when canonical staff membership uses its UID.
    # Add this equality index while retaining every existing field index.
    url = BASE + 'members/fields/userUID'
    current = api.request('GET', url)
    config = current.get('indexConfig', {})
    indexes = config.get('indexes', [])
    existing = next((item for item in indexes if equivalent(item, MEMBER_INDEX)), None)
    if existing is None and apply:
        fresh = api.request('GET', url)
        scope.audit.require(fresh == current, 'Member index configuration changed; review before retry')
        api.request('PATCH', url + '?updateMask=indexConfig', {'indexConfig': {
            'indexes': [writable_index(item) for item in indexes] + [MEMBER_INDEX]}})
    result['memberUserUidCollectionGroupIndex'] = existing.get('state', 'unknown') if existing else 'requested' if apply else 'missing'
    result['ready'] = (all(item['state'] == 'READY' for item in result['indexes'])
        and all(state == 'ACTIVE' for state in result['ttl'].values())
        and result['memberUserUidCollectionGroupIndex'] == 'READY')
    return result

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--credential-file', required=True)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    result = configure(Api(args.credential_file), apply=args.apply)
    output = scope.audit.private(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    scope.audit.write(output, result)
    print(json.dumps(result))
