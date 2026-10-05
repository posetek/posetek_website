"""Synthetic-only operator erasure checks. No credentials or network requests."""
from copy import deepcopy
import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import erase

UID = 'synthetic-account'
FIRST = '11111111-1111-4111-8111-111111111111'
SECOND = '22222222-2222-4222-8222-222222222222'
STAMP = '2026-10-05T00:00:00.123456Z'


def row(id=FIRST, *, version=2, mode='account', uid=UID):
    return {'name': erase.PARENT + '/' + erase.RESPONSES + '/' + id, 'updateTime': STAMP,
            'fields': {'formVersion': {'integerValue': str(version)}, 'identityMode': {'stringValue': mode},
                       'author': {'mapValue': {'fields': {'uid': {'stringValue': uid}}}}}}


def session(document):
    return {'name': document['name'].replace('/' + erase.RESPONSES + '/', '/' + erase.SESSIONS + '/'),
            'updateTime': STAMP, 'fields': {key: deepcopy(document['fields'][key]) for key in ('formVersion', 'identityMode')}}


class FakeApi:
    def __init__(self, documents):
        self.documents = deepcopy(documents)
        self.sessions = {session(doc)['name']: session(doc) for doc in documents}
        self.calls, self.fail_commit, self.lost_commit, self.commit_attempts = [], None, None, 0

    def request(self, method, path, body=None):
        self.calls.append((method, path, deepcopy(body)))
        if path.endswith(':runQuery'):
            query = body['structuredQuery']
            after = query.get('startAt', {}).get('values', [{}])[0].get('referenceValue', '')
            rows = sorted((doc for doc in self.documents if doc['name'] > after), key=lambda doc: doc['name'])
            return [{'document': deepcopy(doc)} for doc in rows[:query['limit']]] + [{'readTime': STAMP}]
        if method == 'GET':
            return deepcopy(self.sessions.get(path[:-len(erase.SESSION_MASK)]))
        if path.endswith(':commit'):
            self.commit_attempts += 1
            if self.commit_attempts == self.fail_commit:
                raise RuntimeError('Provider error with private information')
            response, diagnostic = [write['delete'] for write in body['writes']]
            self.documents = [doc for doc in self.documents if doc['name'] != response]
            self.sessions.pop(diagnostic, None)
            if self.commit_attempts == self.lost_commit:
                raise RuntimeError('Lost response after accepted deletion')
            return {'commitTime': STAMP}
        raise AssertionError('Unexpected request')


class ErasureTests(unittest.TestCase):
    def test_query_is_exact_uid_minimal_projection_and_single_equality(self):
        query = erase.query_body(' account/with spaces ')['structuredQuery']
        self.assertEqual(query['where']['fieldFilter'], {'field': {'fieldPath': 'author.uid'}, 'op': 'EQUAL', 'value': {'stringValue': ' account/with spaces '}})
        self.assertEqual(query['select']['fields'], [{'fieldPath': field} for field in ('formVersion', 'identityMode', 'author.uid')])
        self.assertEqual(query['from'], [{'collectionId': erase.RESPONSES}])
        self.assertNotIn('allDescendants', query['from'][0])
        self.assertNotIn('answers', str(query))

    def test_invalid_uid_and_foreign_nested_or_non_uuid_paths_fail_closed(self):
        for uid in ('', ' ', 'a' * 129, 'account\nother', None):
            with self.subTest(uid=uid), self.assertRaises(ValueError):
                erase.query_body(uid)
        for name in (erase.PARENT + '/players/' + FIRST, erase.PARENT + '/' + erase.RESPONSES + '/' + FIRST + '/nested/id',
                     erase.PARENT.replace('kickai-69dd0', 'other-project') + '/' + erase.RESPONSES + '/' + FIRST,
                     erase.PARENT + '/' + erase.RESPONSES + '/not-a-uuid'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                erase.document_path(name, erase.RESPONSES)

    def test_preview_selects_only_v2_exact_account_and_never_writes(self):
        api = FakeApi([row(), row(SECOND, version=1), row('33333333-3333-4333-8333-333333333333', mode='anonymous'),
                       row('44444444-4444-4444-8444-444444444444', uid='another-account')])
        receipt = erase.erase(api, UID)
        self.assertEqual(receipt, {'mode': 'preview', 'completed': True, 'matchedResponses': 1, 'matchedSessions': 1,
                                  'responseDeletesAcknowledged': 0, 'sessionDeletesAcknowledged': 0})
        self.assertFalse(any(path.endswith(':commit') for _, path, _ in api.calls))
        self.assertEqual(len([call for call in api.calls if call[0] == 'GET']), 1)
        self.assertNotIn(UID, str(receipt))

    def test_apply_deletes_only_exact_response_and_same_uuid_session_atomically(self):
        api = FakeApi([row(), row(SECOND, version=1)])
        result = erase.erase(api, UID, apply=True)
        commit = next(body for _, path, body in api.calls if path.endswith(':commit'))
        self.assertEqual(commit, {'writes': [
            {'delete': erase.PARENT + '/' + erase.RESPONSES + '/' + FIRST, 'currentDocument': {'updateTime': STAMP}},
            {'delete': erase.PARENT + '/' + erase.SESSIONS + '/' + FIRST, 'currentDocument': {'updateTime': STAMP}},
        ]})
        self.assertEqual(len(api.documents), 1)
        self.assertEqual(api.documents[0]['fields']['formVersion'], {'integerValue': '1'})
        self.assertEqual(result['responseDeletesAcknowledged'], 1)
        self.assertEqual(result['sessionDeletesAcknowledged'], 1)

    def test_absent_session_is_guarded_against_concurrent_recreation(self):
        api = FakeApi([row()])
        api.sessions.clear()
        result = erase.erase(api, UID, apply=True)
        commit = next(body for _, path, body in api.calls if path.endswith(':commit'))
        self.assertEqual(commit['writes'][1]['currentDocument'], {'exists': False})
        self.assertEqual(result['matchedSessions'], 0)
        self.assertEqual(result['sessionDeletesAcknowledged'], 0)

    def test_corrupt_or_anonymous_session_and_response_revision_prevent_all_writes(self):
        for mutation in ('session_path', 'session_mode', 'session_version', 'response_revision'):
            api = FakeApi([row()])
            diagnostic = next(iter(api.sessions.values()))
            if mutation == 'session_path': diagnostic['name'] += '/nested/id'
            if mutation == 'session_mode': diagnostic['fields']['identityMode'] = {'stringValue': 'anonymous'}
            if mutation == 'session_version': diagnostic['fields']['formVersion'] = {'integerValue': '1'}
            if mutation == 'response_revision': api.documents[0]['updateTime'] = ''
            with self.subTest(mutation=mutation), self.assertRaises(erase.ErasureError):
                erase.erase(api, UID, apply=True)
            self.assertFalse(any(path.endswith(':commit') for _, path, _ in api.calls))

    def test_query_pagination_advances_with_validated_document_reference(self):
        api = FakeApi([row(FIRST), row(SECOND)])
        with patch.object(erase, 'PAGE_SIZE', 1):
            result = erase.erase(api, UID)
        queries = [body for _, path, body in api.calls if path.endswith(':runQuery')]
        self.assertEqual(result['matchedResponses'], 2)
        self.assertEqual(queries[1]['structuredQuery']['startAt'], {'values': [{'referenceValue': row()['name']}], 'before': False})

    def test_partial_apply_failure_has_safe_counts_and_retry_only_deletes_remaining(self):
        api = FakeApi([row(FIRST), row(SECOND)])
        api.fail_commit = 2
        with self.assertRaises(erase.ErasureError) as caught:
            erase.erase(api, UID, apply=True)
        self.assertFalse(caught.exception.receipt['completed'])
        self.assertEqual(caught.exception.receipt['responseDeletesAcknowledged'], 1)
        self.assertNotIn('private', str(caught.exception))
        api.fail_commit = None
        retried = erase.erase(api, UID, apply=True)
        self.assertTrue(retried['completed'])
        self.assertEqual(retried['matchedResponses'], 1)
        self.assertEqual(api.documents, [])
        self.assertEqual(api.sessions, {})

    def test_lost_commit_response_is_not_claimed_and_retry_does_not_repeat_deletion(self):
        api = FakeApi([row()])
        api.lost_commit = 1
        with self.assertRaises(erase.ErasureError) as caught:
            erase.erase(api, UID, apply=True)
        self.assertEqual(caught.exception.receipt['responseDeletesAcknowledged'], 0)
        self.assertFalse(caught.exception.receipt['completed'])
        result = erase.erase(api, UID, apply=True)
        self.assertTrue(result['completed'])
        self.assertEqual(result['matchedResponses'], 0)
        self.assertEqual(api.commit_attempts, 1)

    def test_invalid_query_document_and_safety_bound_prevent_all_writes(self):
        api = FakeApi([row()])
        api.documents[0]['name'] += '/child/id'
        with self.assertRaises(erase.ErasureError):
            erase.erase(api, UID, apply=True)
        self.assertFalse(any(path.endswith(':commit') for _, path, _ in api.calls))
        api = FakeApi([row(FIRST), row(SECOND)])
        with patch.object(erase, 'PAGE_SIZE', 1), patch.object(erase, 'MAX_RESPONSES', 1), self.assertRaises(erase.ErasureError):
            erase.erase(api, UID, apply=True)
        self.assertFalse(any(path.endswith(':commit') for _, path, _ in api.calls))

    def test_cli_defaults_to_preview_and_writes_only_counts_in_private_receipt(self):
        parent = erase.audit.ROOT / '.netlify' / 'feedback-erasure-tests'
        parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=parent) as directory:
            run = Path(directory) / 'preview'
            api = FakeApi([row()])
            output = io.StringIO()
            with patch.object(erase, 'Api', return_value=api), contextlib.redirect_stdout(output):
                status = erase.main(['--uid', UID, '--credential-file', str(Path(directory) / 'owner.json'), '--run-dir', str(run)])
            self.assertEqual(status, 0)
            receipt = json.loads((run / 'erasure.json').read_text())
            self.assertEqual(receipt['mode'], 'preview')
            self.assertEqual(json.loads(output.getvalue()), receipt)
            self.assertNotIn(UID, output.getvalue())
            self.assertNotIn(FIRST, output.getvalue())
            self.assertFalse(any(path.endswith(':commit') for _, path, _ in api.calls))

    def test_receipt_and_credentials_are_restricted_to_ignored_private_paths(self):
        with self.assertRaises(RuntimeError):
            erase.audit.private(erase.HERE / 'public-receipt.json')
        parent = erase.audit.ROOT / '.netlify' / 'feedback-erasure-tests'
        parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=parent) as directory:
            self.assertEqual(erase.audit.private(directory), Path(directory).resolve())


if __name__ == '__main__':
    unittest.main()
