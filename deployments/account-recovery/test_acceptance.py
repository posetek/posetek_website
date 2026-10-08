"""Checks that fixture tools refuse real identities and emit no secrets."""
import json
import unittest
from unittest.mock import patch
import acceptance

class AcceptanceTests(unittest.TestCase):
    def test_field_encoding_round_trip(self):
        value = {'uid': 'synthetic', 'active': True, 'empty': None, 'count': 2, 'teamIds': ['owned']}
        self.assertEqual(acceptance.decoded(acceptance.encoded(value)), value)
    def test_foreign_uid_cleanup_refused_before_remote_query(self):
        fixture = acceptance.Acceptance.__new__(acceptance.Acceptance)
        fixture.refresh = lambda: None
        fixture.manifest = {'runId': 'owned', 'uids': {'player': 'real-account'}}
        fixture.credentials = {}
        with self.assertRaisesRegex(RuntimeError, 'foreign UID'): fixture.cleanup()
    def test_foreign_credential_cleanup_refused_before_remote_query(self):
        fixture = acceptance.Acceptance.__new__(acceptance.Acceptance)
        fixture.refresh = lambda: None
        fixture.manifest = {'runId': 'owned', 'uids': {'player': 'recoverytest-owned-player'}, 'documents': []}
        fixture.credentials = {'player': {'uid': 'recoverytest-owned-player', 'email': 'real-account@example.test'}}
        with self.assertRaisesRegex(RuntimeError, 'foreign credentials'): fixture.cleanup()
    def test_foreign_document_cleanup_refused_before_remote_query(self):
        fixture = acceptance.Acceptance.__new__(acceptance.Acceptance)
        fixture.refresh = lambda: None
        fixture.manifest = {'runId': 'owned', 'uids': {}, 'documents': ['players/real-player']}
        fixture.credentials = {}
        with self.assertRaisesRegex(RuntimeError, 'unreserved path'): fixture.cleanup()
    def test_exact_owned_cleanup_query_not_collection_scan(self):
        fixture = acceptance.Acceptance.__new__(acceptance.Acceptance); fixture.headers = {'Authorization': 'secret'}
        with patch.object(acceptance, 'call', return_value=(200, [])) as operation:
            self.assertEqual(fixture.query_owned('accountAccessAudit', 'actorUID', 'owned-account'), [])
        query = operation.call_args.args[1]['structuredQuery']
        self.assertEqual(query['where']['fieldFilter']['value'], {'stringValue': 'owned-account'})
        self.assertEqual(query['where']['fieldFilter']['field'], {'fieldPath': 'actorUID'})
    def test_callable_failure_reports_no_provider_body(self):
        fixture = acceptance.Acceptance.__new__(acceptance.Acceptance)
        fixture.sign_in = lambda role: 'private-id-token'
        with patch.object(acceptance, 'call', return_value=(403, {'error': {'message': 'private-provider-body'}})):
            with self.assertRaisesRegex(RuntimeError, 'Synthetic callable failed') as error: fixture.invoke('inspectPlayerRecovery', {}, 'player')
        self.assertNotIn('private', str(error.exception))
    def test_post_reset_sign_in_waits_beyond_second_boundary_before_token(self):
        fixture = acceptance.Acceptance.__new__(acceptance.Acceptance)
        events = []
        fixture.sign_in = lambda role: events.append(('sign-in', role)) or 'private-token'
        with patch.object(acceptance.time, 'sleep', side_effect=lambda seconds: events.append(('wait', seconds))):
            self.assertEqual(fixture.fresh_recovery_sign_in(), 'private-token')
        self.assertEqual(events, [('wait', 1.1), ('sign-in', 'player')])
        self.assertGreater(events[0][1], 1); self.assertLess(events[0][1], 2)
    def test_foreign_player_projection_cleanup_refused(self):
        fixture = acceptance.Acceptance.__new__(acceptance.Acceptance)
        fixture.manifest = {'runId': 'owned', 'uids': {}, 'playerId': 'real-player'}
        with self.assertRaisesRegex(RuntimeError, 'foreign player'): fixture.owned_projection_paths()
    def test_owned_usage_and_social_roots_and_selectors_are_complete(self):
        fixture = acceptance.Acceptance.__new__(acceptance.Acceptance)
        fixture.manifest = {'runId': 'owned', 'uids': {'player': 'recoverytest-owned-user'}, 'playerId': 'recoverytest-owned-player'}
        calls = []
        def query(collection, field, identifier):
            calls.append((collection, field, identifier))
            return [{'name': 'projects/kickai-69dd0/databases/(default)/documents/socialActivities/owned-activity'}] if collection == 'socialActivities' else []
        fixture.query_owned = query
        paths = fixture.owned_projection_paths()
        self.assertTrue({'insightUsageDays/recoverytest-owned-player', 'insightUsageActors/recoverytest-owned-user',
            'socialPreferences/recoverytest-owned-user', 'socialActivitySettings/owned-activity', 'socialActivities/owned-activity'}.issubset(paths))
        self.assertIn(('insightUsageIntervals', 'actorUid', 'recoverytest-owned-user'), calls)
        self.assertIn(('insightUsageIntervals', 'playerId', 'recoverytest-owned-player'), calls)
        self.assertIn(('workoutNotificationOutbox', 'playerId', 'recoverytest-owned-player'), calls)
    def test_provider_query_cannot_escape_owned_collection_namespace(self):
        fixture = acceptance.Acceptance.__new__(acceptance.Acceptance); fixture.headers = {}
        with patch.object(acceptance, 'call', return_value=(200, [{'document': {'name': 'projects/kickai-69dd0/databases/(default)/documents/players/foreign'}}])):
            with self.assertRaisesRegex(RuntimeError, 'foreign namespace'): fixture.query_owned('accountAccessAudit', 'actorUID', 'owned')

if __name__ == '__main__': unittest.main()
