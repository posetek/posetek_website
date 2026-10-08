from copy import deepcopy
import unittest
import storage

class FakeApi:
    def __init__(self):
        self.rows = {storage.BASE + group + '/indexes': {'indexes': []} for group in storage.INDEXES}
        self.rows.update({storage.BASE + group + '/fields/expiresAt': {} for group in storage.TTL_COLLECTIONS})
        self.rows[storage.BASE + 'members/fields/userUID'] = {'indexConfig': {'indexes': [
            {'name': 'existing-field-index', 'state': 'READY', 'queryScope': 'COLLECTION', 'fields': [{'fieldPath': 'userUID', 'order': 'ASCENDING'}]},
            {'state': 'READY', 'queryScope': 'COLLECTION', 'fields': [{'fieldPath': 'userUID', 'order': 'DESCENDING'}]},
        ], 'usesAncestorConfig': True}}
        self.calls = []
        self.before_member_reread = None
    def request(self, method, url, body=None):
        self.calls.append((method, url, deepcopy(body)))
        if method == 'GET':
            if url.endswith('members/fields/userUID') and self.before_member_reread and sum(call[1] == url for call in self.calls) > 1:
                self.before_member_reread(self.rows[url])
            return deepcopy(self.rows[url])
        return {'name': 'operation-test'}
    def ready(self):
        for group, definitions in storage.INDEXES.items():
            self.rows[storage.BASE + group + '/indexes'] = {'indexes': [
                {**deepcopy(definition), 'state': 'READY', 'fields': deepcopy(definition['fields']) + [{'fieldPath': '__name__', 'order': 'DESCENDING'}]}
                for definition in definitions]}
        for group in storage.TTL_COLLECTIONS:
            self.rows[storage.BASE + group + '/fields/expiresAt'] = {'ttlConfig': {'state': 'ACTIVE'}}
        self.rows[storage.BASE + 'members/fields/userUID']['indexConfig']['indexes'].append({**deepcopy(storage.MEMBER_INDEX), 'state': 'READY'})

class StorageTests(unittest.TestCase):
    def test_default_is_read_only_and_reports_missing(self):
        api = FakeApi(); report = storage.configure(api)
        self.assertFalse(report['ready'])
        self.assertTrue(all(method == 'GET' for method, _, _ in api.calls))
        self.assertEqual(report['memberUserUidCollectionGroupIndex'], 'missing')

    def test_only_two_new_ttl_collections_and_two_composite_indexes(self):
        api = FakeApi(); report = storage.configure(api, apply=True)
        posts = [(url, body) for method, url, body in api.calls if method == 'POST']
        ttl = [(url, body) for method, url, body in api.calls if method == 'PATCH' and 'ttlConfig' in url]
        self.assertEqual(len(posts), 2); self.assertEqual(len(ttl), 2)
        self.assertEqual({url.split('/fields/')[0].rsplit('/', 1)[-1] for url, _ in ttl}, set(storage.TTL_COLLECTIONS))
        self.assertEqual(report['ttl'], dict.fromkeys(storage.TTL_COLLECTIONS, 'requested'))

    def test_member_addition_preserves_all_existing_indexes(self):
        api = FakeApi(); before = deepcopy(api.rows[storage.BASE + 'members/fields/userUID'])
        storage.configure(api, apply=True)
        patch = next(body for method, url, body in api.calls if method == 'PATCH' and 'indexConfig' in url)
        self.assertEqual(patch['indexConfig']['indexes'][:-1], [storage.writable_index(item) for item in before['indexConfig']['indexes']])
        self.assertEqual(patch['indexConfig']['indexes'][-1], storage.MEMBER_INDEX)
        self.assertEqual(api.rows[storage.BASE + 'members/fields/userUID'], before)

    def test_ready_configuration_is_not_reapplied(self):
        api = FakeApi(); api.ready()
        report = storage.configure(api, apply=True)
        self.assertTrue(report['ready'])
        self.assertTrue(all(method == 'GET' for method, _, _ in api.calls))

    def test_member_configuration_race_refuses_patch(self):
        api = FakeApi()
        api.before_member_reread = lambda row: row['indexConfig']['indexes'].append({'queryScope': 'COLLECTION_GROUP', 'fields': [{'fieldPath': 'userUID', 'order': 'DESCENDING'}]})
        with self.assertRaisesRegex(RuntimeError, 'configuration changed'): storage.configure(api, apply=True)
        self.assertFalse(any(method == 'PATCH' and 'indexConfig' in url for method, url, _ in api.calls))

    def test_different_sort_direction_does_not_count_as_required_index(self):
        api = FakeApi(); api.ready()
        api.rows[storage.BASE + 'accountRecoveryRequests/indexes']['indexes'][0]['fields'][1]['order'] = 'ASCENDING'
        self.assertFalse(storage.configure(api)['ready'])

    def test_creation_does_not_report_pending_as_ready(self):
        api = FakeApi(); api.ready()
        api.rows[storage.BASE + 'accountAccessGrants/indexes']['indexes'][0]['state'] = 'CREATING'
        self.assertFalse(storage.configure(api)['ready'])

if __name__ == '__main__': unittest.main()
