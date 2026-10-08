from copy import deepcopy
import json
import unittest
import erase

UID = 'owned-exact-UID'
ID = '12345678-1234-4234-8234-123456789012'
def document(identifier=ID, uid=UID, version='1'):
    return {'name': erase.PARENT + '/' + erase.COLLECTION + '/' + identifier, 'updateTime': '2026-10-08T01:00:00.123Z',
        'fields': {'schemaVersion': {'integerValue': version}, 'targetUID': {'stringValue': uid}}}
class FakeApi:
    def __init__(self, rows=None): self.rows = [document()] if rows is None else rows; self.calls = []; self.fail_commit = False
    def request(self, method, path, body=None):
        self.calls.append((method, path, deepcopy(body)))
        if path.endswith(':runQuery'): return [{'document': row} for row in self.rows]
        if self.fail_commit: raise RuntimeError('Lost synthetic acknowledgement')
        return {'writeResults': [{}]}

class ErasureTests(unittest.TestCase):
    def test_preview_queries_exact_bound_uid_and_no_contacts(self):
        api = FakeApi(); result = erase.erase(api, UID)
        self.assertEqual(result['matchedRequests'], 1); self.assertEqual(result['requestDeletesAcknowledged'], 0)
        self.assertEqual(len(api.calls), 1)
        body = api.calls[0][2]['structuredQuery']
        self.assertEqual(body['where']['fieldFilter']['value'], {'stringValue': UID})
        self.assertEqual(body['select']['fields'], [{'fieldPath': 'schemaVersion'}, {'fieldPath': 'targetUID'}])
        self.assertNotIn(UID, json.dumps(result))
    def test_apply_revision_guards_each_exact_request(self):
        api = FakeApi(); result = erase.erase(api, UID, apply=True)
        self.assertEqual(result['requestDeletesAcknowledged'], 1)
        self.assertEqual(api.calls[1][2], {'writes': [{'delete': document()['name'], 'currentDocument': {'updateTime': document()['updateTime']}}]})
    def test_other_uid_unbound_claim_and_future_schema_preserved(self):
        unbound = document(identifier='32345678-1234-4234-8234-123456789012'); del unbound['fields']['targetUID']; unbound['fields']['claimedEmail'] = {'stringValue': 'owned@example.test'}
        api = FakeApi([document(uid='other'), document(identifier='22345678-1234-4234-8234-123456789012', version='2'), unbound])
        result = erase.erase(api, UID, apply=True)
        self.assertEqual(result['matchedRequests'], 0); self.assertEqual(len(api.calls), 1)
    def test_lost_delete_response_never_counts_as_acknowledged(self):
        api = FakeApi(); api.fail_commit = True
        with self.assertRaises(erase.ErasureError) as raised: erase.erase(api, UID, apply=True)
        self.assertEqual(raised.exception.receipt['requestDeletesAcknowledged'], 0)
        self.assertFalse(raised.exception.receipt['completed'])
        self.assertNotIn(UID, str(raised.exception))
    def test_unexpected_document_collection_refused(self):
        row = document(); row['name'] = row['name'].replace('/accountRecoveryRequests/', '/players/')
        with self.assertRaises(erase.ErasureError): erase.erase(FakeApi([row]), UID, apply=True)
    def test_missing_revision_refused(self):
        row = document(); del row['updateTime']
        with self.assertRaises(erase.ErasureError): erase.erase(FakeApi([row]), UID, apply=True)
    def test_duplicate_document_refused(self):
        with self.assertRaises(erase.ErasureError): erase.erase(FakeApi([document(), document()]), UID, apply=True)
    def test_empty_query_is_complete(self):
        result = erase.erase(FakeApi([]), UID, apply=True)
        self.assertTrue(result['completed']); self.assertEqual(result['matchedRequests'], 0)
    def test_uid_is_not_normalized(self):
        self.assertEqual(erase.query_body('Exact-Case')['structuredQuery']['where']['fieldFilter']['value'], {'stringValue': 'Exact-Case'})
        for uid in ('', ' ', 'line\nbreak', 'x'*129):
            with self.subTest(uid=repr(uid)):
                with self.assertRaises(ValueError): erase.validate_uid(uid)

if __name__ == '__main__': unittest.main()
