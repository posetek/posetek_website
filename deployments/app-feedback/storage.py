"""Add only feedback indexes and TTL policies; preserve existing database config."""
import argparse
import json
from pathlib import Path
import time
from urllib.request import Request, urlopen

BASE = 'https://firestore.googleapis.com/v1/projects/kickai-69dd0/databases/(default)/collectionGroups/'
COLLECTIONS = ('appFeedbackResponsesV1', 'appFeedbackSessionsV1', 'appFeedbackRateLimitsV1')
INDEXES = [{'queryScope': 'COLLECTION', 'fields': [{'fieldPath': flag, 'order': 'ASCENDING'},
    {'fieldPath': 'createdAt', 'order': 'ASCENDING'}]} for flag in ('opened', 'started', 'submitted')]

def configure(credential_file, *, apply=False):
    token = json.loads(Path(credential_file).read_text(encoding='utf-8-sig'))
    if token['expires_at'] <= time.time() * 1000 + 60000:
        raise RuntimeError('Renew the authorized owner session')
    def request(method, url, value=None):
        data = json.dumps(value).encode() if value is not None else None
        with urlopen(Request(url, data=data, method=method, headers={
            'Authorization': 'Bearer ' + token['access_token'], 'Content-Type': 'application/json'}), timeout=60) as response:
            return json.load(response)
    def index_fields(index):
        return [row for row in index['fields'] if row['fieldPath'] != '__name__']
    result = {'indexes': [], 'ttl': {}, 'apply': apply}
    url = BASE + 'appFeedbackSessionsV1/indexes'
    current = request('GET', url).get('indexes', [])
    for expected in INDEXES:
        existing = next((row for row in current if row['queryScope'] == expected['queryScope'] and index_fields(row) == expected['fields']), None)
        if not existing and apply:
            request('POST', url, expected)
        result['indexes'].append({'fields': expected['fields'], 'state': existing.get('state') if existing else 'requested' if apply else 'missing'})
    for collection in COLLECTIONS:
        url = BASE + collection + '/fields/expiresAt'
        current = request('GET', url)
        state = current.get('ttlConfig', {}).get('state')
        if state != 'ACTIVE' and apply:
            request('PATCH', url + '?updateMask=ttlConfig', {'ttlConfig': {}})
        result['ttl'][collection] = state or ('requested' if apply else 'missing')
    return result

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--credential-file', required=True)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    result = configure(args.credential_file, apply=args.apply)
    Path(args.output).write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))
