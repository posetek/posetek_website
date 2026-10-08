"""Owned synthetic recovery fixtures, direct API acceptance, and resumable cleanup.

No email is sent. Ordinary rate limits stay active. Only newly reserved fixture
accounts and narrowly selected fixture records may be written or removed.
Synthetic browser passwords are private files until cleanup; ID tokens and
one-time recovery secrets remain in memory and never appear in reports.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import secrets
import time
import uuid
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('recovery_acceptance_scope', HERE / 'prepare.py')
scope = importlib.util.module_from_spec(spec); spec.loader.exec_module(scope)
PROJECT = scope.audit.PROJECT
DOCS = f'https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents'
AUTH = 'https://identitytoolkit.googleapis.com/v1/projects/' + PROJECT
FUNCTIONS = f'https://us-central1-{PROJECT}.cloudfunctions.net/'
CONFIRMATION_SIGN_IN_DELAY_SECONDS = 1.1
PLAYER_PROJECTION_QUERIES = (
    ('socialActivities', 'playerId'), ('insightUsageIntervals', 'playerId'),
    ('workoutNotificationActivity', 'playerId'), ('workoutNotificationOutbox', 'playerId'),
    ('athleteResultSharesV2', 'playerDocId'),
)
UID_PROJECTION_QUERIES = (('insightUsageIntervals', 'actorUid'), ('socialReports', 'reporterUid'))

def call(url, body=None, headers=None, method='POST'):
    try:
        with urlopen(Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
            headers={'Content-Type': 'application/json', **(headers or {})}), timeout=40) as response:
            data = response.read(); return response.status, json.loads(data) if data else {}
    except HTTPError as error:
        try: value = json.loads(error.read())
        except (ValueError, UnicodeDecodeError): value = {}
        return error.code, value
def encoded(value):
    if value is None: return {'nullValue': None}
    if isinstance(value, bool): return {'booleanValue': value}
    if isinstance(value, int): return {'integerValue': str(value)}
    if isinstance(value, str): return {'stringValue': value}
    if isinstance(value, list): return {'arrayValue': {'values': [encoded(item) for item in value]}}
    if isinstance(value, dict): return {'mapValue': {'fields': {key: encoded(item) for key, item in value.items()}}}
    raise RuntimeError('Unsupported fixture value')
def decoded(value):
    for key in ('stringValue', 'booleanValue', 'timestampValue', 'nullValue', 'referenceValue'):
        if key in value: return value[key]
    if 'integerValue' in value: return int(value['integerValue'])
    if 'doubleValue' in value: return value['doubleValue']
    if 'arrayValue' in value: return [decoded(item) for item in value['arrayValue'].get('values', [])]
    if 'mapValue' in value: return {key: decoded(item) for key, item in value['mapValue'].get('fields', {}).items()}
    raise RuntimeError('Unsupported fixture field')

class Acceptance:
    def __init__(self, run, credential):
        self.run = scope.audit.private(run); self.credential = scope.audit.private(credential)
        self.manifest_path = self.run / 'owned.json'; self.creds_path = self.run / 'browser-credentials.json'
        self.manifest = scope.audit.read(self.manifest_path) if self.manifest_path.exists() else {'runId': uuid.uuid4().hex, 'uids': {}, 'documents': [], 'requests': [], 'grants': [], 'status': 'prepared'}
        self.credentials = scope.audit.read(self.creds_path) if self.creds_path.exists() else {}
        self.checks = {}; self.stage = 'setup'; self.refresh()
        source = (scope.audit.ROOT / 'app/src/lib/firebase.ts').read_text(encoding='utf-8')
        self.api_key = re.search(r'apiKey:\s*"([^"]+)"', source).group(1)
    def refresh(self):
        credential = scope.audit.read(self.credential)
        if credential.get('expires_at', 0) <= time.time() * 1000 + 300000: raise RuntimeError('Renew operator session before acceptance')
        self.headers = {'Authorization': 'Bearer ' + credential['access_token'], 'x-goog-user-project': PROJECT}
    def save(self):
        self.run.mkdir(parents=True, exist_ok=True)
        scope.audit.write(self.manifest_path, self.manifest)
    def save_credentials(self):
        scope.audit.write(self.creds_path, self.credentials); self.creds_path.chmod(0o600)
    def check(self, name, valid):
        self.checks[name] = bool(valid)
        if not valid: raise RuntimeError(name)
    def auth(self, path, body):
        status, value = call(AUTH + path, body, self.headers)
        if status != 200: raise RuntimeError('Owned Auth operation failed')
        return value
    def lookup(self, uid): return self.auth('/accounts:lookup', {'localId': [uid]}).get('users', [])
    def document(self, path, method='GET', body=None):
        status, value = call(DOCS + '/' + quote(path, safe='/'), body, self.headers, method)
        if status not in (200, 404): raise RuntimeError('Owned document operation failed')
        return status, value
    def fields(self, path):
        status, value = self.document(path)
        if status != 200: raise RuntimeError('Owned fixture document missing')
        return {key: decoded(item) for key, item in value.get('fields', {}).items()}
    def create(self, path, fields):
        if self.document(path)[0] != 404: raise RuntimeError('Fixture document collision; refused overwrite')
        self.manifest['documents'].append(path); self.save()
        parent, identifier = path.rsplit('/', 1)
        status, _ = call(DOCS + '/' + parent + '?documentId=' + quote(identifier, safe=''), {'fields': {key: encoded(item) for key, item in fields.items()}}, self.headers)
        if status != 200: raise RuntimeError('Fixture creation unconfirmed; recover cleanup from manifest')
    def sign_in(self, role):
        credentials = self.credentials[role]
        status, value = call('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + self.api_key,
            {'email': credentials['email'], 'password': credentials['password'], 'returnSecureToken': True}, {'Origin': 'https://posetek.net'})
        if status != 200 or value.get('localId') != credentials['uid'] or not value.get('idToken'): raise RuntimeError('Synthetic password sign-in failed')
        return value['idToken']
    def fresh_recovery_sign_in(self):
        time.sleep(CONFIRMATION_SIGN_IN_DELAY_SECONDS)
        return self.sign_in('player')
    def invoke(self, name, data, role=None, token=None, expect=None):
        if role: token = self.sign_in(role)
        headers = {'Origin': 'https://posetek.net', **({'Authorization': 'Bearer ' + token} if token else {})}
        status, value = call(FUNCTIONS + name, {'data': data}, headers)
        if expect:
            self.check(expect[0], value.get('error', {}).get('status') == expect[1]); return value
        if status != 200 or 'result' not in value: raise RuntimeError('Synthetic callable failed at ' + name)
        return value['result']
    def prepare(self):
        if self.creds_path.exists() or self.manifest['uids']: raise RuntimeError('Use a fresh fixture run')
        prefix = 'recoverytest-' + self.manifest['runId']
        self.manifest['status'] = 'creating'; self.save()
        for role in ('admin', 'manager', 'otherManager', 'coach', 'player', 'otherPlayer', 'staffPlayer'):
            uid = prefix + '-' + role.lower()
            email = uid + ('@posetek.net' if role == 'admin' else '@example.test')
            if self.lookup(uid): raise RuntimeError('Generated account collision; refused mutation')
            self.manifest['uids'][role] = uid; self.save()
            password = secrets.token_urlsafe(32)
            created = self.auth('/accounts', {'localId': uid, 'email': email, 'password': password,
                'displayName': 'Recovery synthetic ' + role, 'emailVerified': role == 'admin', 'disableUser': False})
            self.check('created-' + role, created.get('localId') == uid)
            self.credentials[role] = {'uid': uid, 'email': email, 'password': password}; self.save_credentials()
        organization, other_org = prefix + '-org', prefix + '-other-org'
        team = prefix + '-team'
        self.manifest.update(organizationId=organization, otherOrganizationId=other_org, teamId=team, playerId=prefix + '-player-record',
            otherPlayerId=prefix + '-other-player-record', staffPlayerId=prefix + '-staff-player-record', companyPlayerId=prefix + '-company-player-record')
        self.save(); uids = self.manifest['uids']
        self.create('organizations/' + organization, {'schemaVersion': 2, 'name': 'Recovery acceptance organization',
            'memberUIDs': [uids['manager'], uids['coach']], 'managerUIDs': [uids['manager']], 'players': [], 'coaches': []})
        self.create('organizations/' + other_org, {'schemaVersion': 2, 'name': 'Other recovery acceptance organization',
            'memberUIDs': [uids['otherManager']], 'managerUIDs': [uids['otherManager']], 'players': [], 'coaches': []})
        for role, org, staff_role in (('manager', organization, 'manager'), ('otherManager', other_org, 'manager'), ('coach', organization, 'coach')):
            member = {'userUID': uids[role], 'role': staff_role, 'status': 'active', 'teamIds': [team] if staff_role == 'coach' else [],
                'firstName': 'Synthetic', 'lastName': role, 'email': self.credentials[role]['email']}
            self.create(f'organizations/{org}/members/{uids[role]}', member)
            self.create('coaches/' + uids[role], {**member, 'organizationId': org, 'organizationRole': staff_role, 'organizationStatus': 'active', 'members': []})
        self.create('admins/' + uids['admin'], {'userUID': uids['admin'], 'firstName': 'Synthetic', 'lastName': 'Administrator'})
        for role, key, org in (('player', 'playerId', organization), ('otherPlayer', 'otherPlayerId', other_org), ('staffPlayer', 'staffPlayerId', organization), ('admin', 'companyPlayerId', organization)):
            self.create('players/' + self.manifest[key], {'authenticationUID': uids[role], 'userUID': uids[role], 'registered': True,
                'organizationId': org, 'teamId': team if org == organization else None, 'firstName': 'Recovery', 'lastName': role,
                'acceptanceSentinel': self.manifest['runId']})
        self.create('coaches/' + uids['staffPlayer'], {'userUID': uids['staffPlayer'], 'firstName': 'Synthetic', 'lastName': 'Staff target'})
        self.create('teams/' + team, {'organizationId': organization, 'name': 'Recovery acceptance team',
            'playerIds': [self.manifest['playerId'], self.manifest['staffPlayerId'], self.manifest['companyPlayerId']], 'coachUIDs': [uids['coach']]})
        self.manifest['status'] = 'ready'; self.save()
        return {'prepared': True, 'syntheticAccounts': len(uids), 'createdDocuments': len(self.manifest['documents']), 'credentialsPrinted': False}
    def request(self, email, name='Synthetic recovery request'):
        request_id = str(uuid.uuid4()); self.manifest['requests'].append(request_id); self.save()
        data = {'requestId': request_id, 'email': email, 'name': name, 'organizationName': 'Recovery acceptance organization', 'contact': 'Run-owned synthetic trusted channel'}
        result = self.invoke('submitAccountRecoveryRequest', data)
        self.check('genericRequestAcknowledgement-' + str(len(self.manifest['requests'])), result == {'accepted': True, 'requestId': request_id})
        return request_id, data
    def check_api(self):
        if self.manifest.get('status') != 'ready': raise RuntimeError('Fixtures must be ready')
        m = self.manifest; own = {'organizationId': m['organizationId'], 'playerId': m['playerId']}
        before = self.fields('players/' + m['playerId']); membership = self.fields(f'organizations/{m["organizationId"]}/members/{m["uids"]["manager"]}')
        self.stage = 'authorization'
        inspected = self.invoke('inspectPlayerRecovery', own, 'manager')
        self.check('ownOrganizationInspection', inspected.get('recoverable') is True and inspected.get('targetUID') == m['uids']['player'])
        self.invoke('inspectPlayerRecovery', own, expect=('anonymousInspectionDenied', 'UNAUTHENTICATED'))
        self.invoke('inspectPlayerRecovery', own, 'coach', expect=('coachInspectionDenied', 'PERMISSION_DENIED'))
        self.invoke('inspectPlayerRecovery', own, 'otherManager', expect=('foreignManagerDenied', 'PERMISSION_DENIED'))
        self.invoke('inspectPlayerRecovery', {**own, 'playerId': m['staffPlayerId']}, 'manager', expect=('staffTargetDenied', 'FAILED_PRECONDITION'))
        self.invoke('inspectPlayerRecovery', {**own, 'playerId': m['companyPlayerId']}, 'manager', expect=('companyTargetDenied', 'FAILED_PRECONDITION'))
        self.invoke('issuePlayerRecovery', own, 'manager', expect=('missingIdentityConfirmationDenied', 'INVALID_ARGUMENT'))
        self.stage = 'private-intake'
        rid, submitted = self.request(self.credentials['player']['email'])
        saved = self.fields('accountRecoveryRequests/' + rid)
        self.check('exactUniqueRouting', saved.get('targetUID') == m['uids']['player'] and saved.get('organizationId') == m['organizationId'] and saved.get('identityVerified') is False)
        self.check('ninetyDayRequestRetention', saved.get('expiresAtMillis') - saved.get('createdAtMillis') == 90 * 86400000)
        self.check('duplicateAcknowledgement', self.invoke('submitAccountRecoveryRequest', submitted) == {'accepted': True, 'requestId': rid})
        self.check('duplicatePreservesRequest', self.fields('accountRecoveryRequests/' + rid) == saved)
        unmatched_id, _ = self.request('unknown-' + m['runId'] + '@example.test')
        unmatched = self.fields('accountRecoveryRequests/' + unmatched_id)
        self.check('unknownClaimUnrouted', not unmatched.get('targetUID') and not unmatched.get('organizationId'))
        self.invoke('listAccountRecoveryRequests', {'organizationId': m['organizationId'], 'requestId': rid}, 'otherManager', expect=('foreignRequestReadDenied', 'PERMISSION_DENIED'))
        listed = self.invoke('listAccountRecoveryRequests', {'organizationId': m['organizationId']}, 'manager')
        self.check('organizationQueueOnlyOwnedRequests', rid in [row['requestId'] for row in listed['requests']] and unmatched_id not in [row['requestId'] for row in listed['requests']])
        admin_result = self.invoke('listAccountRecoveryRequests', {'requestId': unmatched_id}, 'admin')
        self.check('unmatchedAvailableToPoseTek', len(admin_result['requests']) == 1)
        self.stage = 'one-time-recovery'
        issued = self.invoke('issuePlayerRecovery', {**own, 'identityConfirmed': True, 'requestId': rid}, 'manager')
        m['grants'].append(issued['grantId']); self.save()
        self.check('boundThirtyMinuteGrant', issued['targetUID'] == m['uids']['player'] if 'targetUID' in issued else issued['email'] == self.credentials['player']['email'])
        grant = self.fields('accountAccessGrants/' + issued['grantId'])
        self.check('thirtyMinuteExpiry', grant['expiresAtMillis'] - grant['createdAtMillis'] == 1800000)
        row = self.invoke('listAccountRecoveryRequests', {'organizationId': m['organizationId'], 'requestId': rid}, 'manager')['requests'][0]
        self.check('linkReadyBeforeManualSharing', row['status'] == 'link_ready' and row['linkSharedAtMillis'] is None)
        self.invoke('updateAccountRecoveryRequest', {'organizationId': m['organizationId'], 'requestId': rid, 'status': 'link_shared', 'expectedUpdatedAtMillis': row['updatedAtMillis'] - 1}, 'manager', expect=('concurrentStaleUpdateDenied', 'ABORTED'))
        changed = self.invoke('updateAccountRecoveryRequest', {'organizationId': m['organizationId'], 'requestId': rid, 'status': 'link_shared', 'expectedUpdatedAtMillis': row['updatedAtMillis']}, 'manager')['request']
        self.check('sharingExplicitlyAcknowledged', changed['status'] == 'link_shared')
        self.invoke('revokeAccountAccessLink', {'grantId': issued['grantId'], 'organizationId': m['otherOrganizationId']}, 'otherManager', expect=('foreignGrantRevocationDenied', 'PERMISSION_DENIED'))
        preflight = self.invoke('getAccountAccessLink', {'code': issued['code']})
        self.check('publicPrivateLinkPreflight', preflight['targetUID'] == m['uids']['player'] and preflight['status'] == 'ready')
        password = secrets.token_urlsafe(32)
        complete = self.invoke('completeAccountAccessLink', {'code': issued['code'], 'password': password})
        self.check('passwordCompletedForExactAccount', complete['status'] == 'completed' and complete['targetUID'] == m['uids']['player'])
        self.credentials['player']['password'] = password; self.save_credentials()
        row = self.invoke('listAccountRecoveryRequests', {'organizationId': m['organizationId'], 'requestId': rid}, 'manager')['requests'][0]
        self.check('passwordUpdateNotFalseSignIn', row['status'] == 'reset_completed' and row['signInConfirmedAtMillis'] is None)
        # Firebase auth_time has one-second resolution. Strict confirmation
        # rejects tokens minted in the reset/completion second, including a
        # pre-reset token. Wait across that boundary before fresh sign-in.
        token = self.fresh_recovery_sign_in()
        confirmed = self.invoke('confirmAccountRecovery', {'grantId': issued['grantId']}, token=token)
        self.check('freshPasswordSignInConfirmed', confirmed.get('confirmed') is True)
        self.check('confirmationRetryIdempotent', self.invoke('confirmAccountRecovery', {'grantId': issued['grantId']}, token=token).get('confirmed') is True)
        row = self.invoke('listAccountRecoveryRequests', {'organizationId': m['organizationId'], 'requestId': rid}, 'manager')['requests'][0]
        self.check('truthfulConfirmedQueue', row['status'] == 'confirmed')
        self.check('completedLinkReadbackIdempotent', self.invoke('completeAccountAccessLink', {'code': issued['code'], 'password': secrets.token_urlsafe(32)})['status'] == 'completed')
        self.check('completedReadbackDidNotRewritePassword', bool(self.sign_in('player')))
        self.check('playerRecordPreserved', self.fields('players/' + m['playerId']) == before)
        self.check('managerMembershipPreserved', self.fields(f'organizations/{m["organizationId"]}/members/{m["uids"]["manager"]}') == membership)
        self.check('emailVerificationPreserved', self.lookup(m['uids']['player'])[0].get('emailVerified', False) is False)
        self.stage = 'accepted'
        return {'passed': True, 'checks': self.checks, 'synthetic': True, 'liveRealAccountsChanged': 0, 'recoverySecretsPrinted': False, 'fixturesRetainedForBrowserAcceptance': True}
    def query_owned(self, collection, field, value):
        status, rows = call(DOCS + ':runQuery', {'structuredQuery': {'from': [{'collectionId': collection}],
            'where': {'fieldFilter': {'field': {'fieldPath': field}, 'op': 'EQUAL', 'value': {'stringValue': value}}}, 'limit': 500}}, self.headers)
        if status != 200 or not isinstance(rows, list): raise RuntimeError('Owned cleanup query failed')
        docs = [row['document'] for row in rows if 'document' in row]
        if len(docs) >= 500: raise RuntimeError('Owned cleanup exceeded bound')
        prefix = DOCS.split('/v1/', 1)[1] + '/' + collection + '/'
        if any(not doc.get('name', '').startswith(prefix) or '/' in doc['name'][len(prefix):] for doc in docs): raise RuntimeError('Owned cleanup query returned a foreign namespace')
        return docs
    def owned_projection_paths(self):
        m = self.manifest
        players = [m[key] for key in ('playerId', 'otherPlayerId', 'staffPlayerId', 'companyPlayerId') if m.get(key)]
        prefix = 'recoverytest-' + m['runId'] + '-'
        if any(not player.startswith(prefix) for player in players): raise RuntimeError('Fixture projection cleanup refused foreign player')
        documents = {'insightUsageDays/' + player for player in players}
        documents.update('insightUsageActors/' + uid for uid in m['uids'].values())
        documents.update('socialPreferences/' + uid for uid in m['uids'].values())
        documents.update('socialRateLimits/' + uid for uid in m['uids'].values())
        for collection, field in PLAYER_PROJECTION_QUERIES:
            for player in players:
                for doc in self.query_owned(collection, field, player):
                    path = doc['name'].split('/documents/', 1)[1]; documents.add(path)
                    if collection == 'socialActivities': documents.add('socialActivitySettings/' + path.rsplit('/', 1)[-1])
        for collection, field in UID_PROJECTION_QUERIES:
            for uid in m['uids'].values():
                for doc in self.query_owned(collection, field, uid): documents.add(doc['name'].split('/documents/', 1)[1])
        return documents
    def delete_tree(self, path):
        # Enumerate descendants only beneath a known, run-reserved parent.
        status, collections = call(DOCS + '/' + path + ':listCollectionIds', {'pageSize': 100}, self.headers)
        if status != 200 or collections.get('nextPageToken'): raise RuntimeError('Owned descendant enumeration failed')
        for collection in collections.get('collectionIds', []):
            status, rows = call(DOCS + '/' + path + '/' + collection + '?pageSize=500', headers=self.headers, method='GET')
            if status != 200 or rows.get('nextPageToken'): raise RuntimeError('Owned descendant bound exceeded')
            for document in rows.get('documents', []): self.delete_tree(document['name'].split('/documents/', 1)[1])
        self.document(path, method='DELETE')
    def descendant_count(self, path):
        count = 0
        status, collections = call(DOCS + '/' + path + ':listCollectionIds', {'pageSize': 100}, self.headers)
        if status != 200 or collections.get('nextPageToken'): raise RuntimeError('Owned readback enumeration failed')
        for collection in collections.get('collectionIds', []):
            status, rows = call(DOCS + '/' + path + '/' + collection + '?pageSize=500', headers=self.headers, method='GET')
            if status != 200 or rows.get('nextPageToken'): raise RuntimeError('Owned readback bound exceeded')
            for document in rows.get('documents', []):
                count += 1 + self.descendant_count(document['name'].split('/documents/', 1)[1])
        return count
    def verify_cleanup(self):
        self.refresh(); m = self.manifest; prefix = 'recoverytest-' + m['runId']
        if m.get('status') != 'cleaned' or any(not uid.startswith(prefix + '-') for uid in m['uids'].values()): raise RuntimeError('Cleaned owned manifest required')
        count = sum(bool(self.lookup(uid)) for uid in m['uids'].values())
        documents = set(m.get('cleanupDocuments', [])) | self.owned_projection_paths()
        remaining = sum(self.document(path)[0] == 200 for path in documents)
        owned_roots = [path for path in documents if path.startswith(('players/', 'organizations/', 'insightUsageDays/', 'socialActivities/')) and path.count('/') == 1]
        descendants = sum(self.descendant_count(path) for path in owned_roots)
        unexpected = set()
        for collection in ('accountAccessGrants', 'accountRecoveryRequests', 'accountAccessAudit'):
            for uid in m['uids'].values():
                for doc in self.query_owned(collection, 'targetUID', uid): unexpected.add(doc['name'])
            if collection == 'accountAccessAudit':
                for uid in m['uids'].values():
                    for doc in self.query_owned(collection, 'actorUID', uid): unexpected.add(doc['name'])
                for rid in m['requests']:
                    for doc in self.query_owned(collection, 'requestId', rid): unexpected.add(doc['name'])
        result = {'readOnly': True, 'passed': count == 0 and remaining == 0 and descendants == 0 and not unexpected and not self.creds_path.exists(),
            'remainingOwnedAuthAccounts': count, 'remainingKnownDocuments': remaining, 'remainingOwnedDescendants': descendants,
            'remainingScopedQueryDocuments': len(unexpected), 'credentialsAbsent': not self.creds_path.exists(), 'sharedRateCounters': 'untouched; normal TTL retained'}
        if not result['passed']: raise RuntimeError('Owned cleanup readback found residue')
        return result
    def cleanup(self):
        self.refresh(); m = self.manifest; prefix = 'recoverytest-' + m['runId']
        if any(not uid.startswith(prefix + '-') for uid in m['uids'].values()): raise RuntimeError('Fixture cleanup refused foreign UID')
        for role, row in self.credentials.items():
            expected_uid = m['uids'].get(role)
            expected_email = expected_uid + ('@posetek.net' if role == 'admin' else '@example.test') if expected_uid else None
            if row.get('uid') != expected_uid or row.get('email') != expected_email: raise RuntimeError('Fixture cleanup refused foreign credentials')
        documents = set(m['documents'])
        if any(not all(part.startswith(prefix + '-') or part in ('organizations', 'members', 'players', 'admins', 'coaches', 'teams') for part in path.split('/')) for path in documents): raise RuntimeError('Fixture cleanup refused unreserved path')
        for collection in ('accountAccessGrants', 'accountRecoveryRequests', 'accountAccessAudit'):
            for uid in m['uids'].values():
                for doc in self.query_owned(collection, 'targetUID', uid): documents.add(doc['name'].split('/documents/', 1)[1])
            if collection == 'accountAccessAudit':
                for uid in m['uids'].values():
                    for doc in self.query_owned(collection, 'actorUID', uid): documents.add(doc['name'].split('/documents/', 1)[1])
                for rid in m['requests']:
                    for doc in self.query_owned(collection, 'requestId', rid): documents.add(doc['name'].split('/documents/', 1)[1])
        documents.update('accountRecoveryRequests/' + rid for rid in m['requests'])
        documents.update('accountAccessGrants/' + gid for gid in m['grants'])
        documents.update('accountAccessTargets/' + hashlib.sha256((uid + ('@posetek.net' if role == 'admin' else '@example.test')).encode()).hexdigest() for role, uid in m['uids'].items())
        documents.update(self.owned_projection_paths())
        for path in sorted(documents, key=lambda value: value.count('/'), reverse=True): self.delete_tree(path)
        if m['uids']:
            result = self.auth('/accounts:batchDelete', {'localIds': list(m['uids'].values()), 'force': True})
            if result.get('errors'): raise RuntimeError('Owned bulk Auth cleanup failed')
        self.check('zeroOwnedAuthAccounts', all(not self.lookup(uid) for uid in m['uids'].values()))
        self.check('zeroKnownOwnedDocuments', all(self.document(path)[0] == 404 for path in documents))
        if self.creds_path.exists(): self.creds_path.unlink()
        m['status'] = 'cleaned'; m['cleanupDocuments'] = sorted(documents); self.save()
        return {'cleaned': True, 'authAccountsRemoved': len(m['uids']), 'knownDocumentsRemoved': len(documents), 'credentialsRemoved': not self.creds_path.exists(),
            'sharedRateCounters': 'untouched; normal TTL retained', 'syntheticOnly': True}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=['prepare', 'check', 'cleanup', 'verify-cleanup'], required=True)
    parser.add_argument('--run-dir', required=True); parser.add_argument('--credential-file', required=True)
    args = parser.parse_args()
    fixture = Acceptance(args.run_dir, args.credential_file)
    try:
        result = {'prepare': fixture.prepare, 'check': fixture.check_api, 'cleanup': fixture.cleanup, 'verify-cleanup': fixture.verify_cleanup}[args.mode]()
        result['verifiedAt'] = time.time(); scope.audit.write(fixture.run / (args.mode + '-report.json'), result)
        print(json.dumps(result)); return 0
    except Exception:
        result = {'passed': False, 'mode': args.mode, 'failureStage': fixture.stage, 'checks': fixture.checks,
            'error': 'Inspect owned manifest and retry cleanup; provider/credential bodies are intentionally excluded'}
        scope.audit.write(fixture.run / (args.mode + '-report.json'), result); print(json.dumps(result)); return 1
if __name__ == '__main__': raise SystemExit(main())
