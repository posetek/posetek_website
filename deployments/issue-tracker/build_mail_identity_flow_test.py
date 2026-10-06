"""Offline identity-flow guards; tenant import/export and live probes are gates."""
import json
from pathlib import Path
import tempfile
import unittest
import zipfile
import build_mail_identity_flow as m
from build_mail_read_flow_test import Expressions, all_actions

def request_permitted(ids, source='restId', target='restImmutableEntryId'):
    d = m.definition(); values = {'Validate_schema': {'schemaVersion': 1,
        'requestId': '11111111-2222-4333-8444-555555555555', 'inputIds': ids, 'sourceIdType': source, 'targetIdType': target}}
    a = d['actions']['Invalid_message_IDs']['inputs']
    values['Invalid_message_IDs'] = [value for value in ids if Expressions(values, value).evaluate(a['where'])]
    values['Invalid_request_characters'] = []
    return Expressions(values).evaluate(d['actions']['Request_is_allowed']['inputs'])

class IdentityFlowTests(unittest.TestCase):
    def test_emitted_id_guard_rejects_malformed_duplicate_empty_and_oversized_arrays(self):
        for source in ['restId', 'restImmutableEntryId']:
            target = 'restImmutableEntryId' if source == 'restId' else 'restId'
            self.assertTrue(request_permitted(['A_B-+=', 'Another_id', 'opaque/base64+id=='], source, target))
        for ids in [[], ['A', 'A'], ['A'] * 101, [''], ['A' * 1025], ['A\nB'], ['A B'], ['https://host/id'], ['A%2fB'], ['☃']]:
            self.assertFalse(request_permitted(ids), ids)
        self.assertFalse(request_permitted(['A'], 'entryId'))
        for source in ['restId', 'restImmutableEntryId']:
            self.assertFalse(request_permitted(['A'], source, source))
        self.assertFalse(request_permitted(['A'], target='entryId'))

    def test_flow_accepts_no_caller_route_or_credentials_and_has_only_fixed_graph_operations(self):
        d = m.definition(); self.assertFalse(m.SCHEMA['additionalProperties'])
        self.assertEqual(set(m.SCHEMA['properties']), {'schemaVersion', 'requestId', 'inputIds', 'sourceIdType', 'targetIdType'})
        trigger = d['triggers']['manual']; self.assertEqual(trigger['inputs']['triggerAllowedUsers'], m.CALLER)
        self.assertEqual(trigger['inputs']['triggerAuthenticationType'], 'User'); self.assertNotIn('concurrency', trigger['runtimeConfiguration'])
        operations = []
        for _, a in all_actions(d['actions']):
            if a['type'] == 'If': self.assertNotIn('runtimeConfiguration', a)
            else: self.assertEqual(a['runtimeConfiguration'], m.SECURE_INPUTS if a['type'] in ['ParseJson', 'Compose', 'Response'] else m.SECURE)
            if a['type'] == 'OpenApiConnection': operations.append(a['inputs'])
        self.assertEqual([(v['parameters']['request/method'], v['parameters']['request/url']) for v in operations], [
            ('GET', 'https://graph.microsoft.com/v1.0/me?$select=id,userPrincipalName,mail'),
            ('POST', 'https://graph.microsoft.com/v1.0/me/translateExchangeIds')])
        for inputs in operations:
            self.assertEqual(inputs['host']['apiId'], m.API); self.assertEqual(inputs['host']['operationId'], 'InvokeHttp')
            self.assertEqual(inputs['retryPolicy'], {'type': 'none'}); self.assertNotIn('Authorization', inputs['parameters']['request/headers'])

    def test_native_invokehttp_request_parameter_names_and_text_body(self):
        route = m.definition()['actions']['Allow_only_fixed_translation']['actions']
        read = route['Read_connection_user']['inputs']['parameters']
        translate = route['Allow_only_Dylan_connection']['actions']['Translate_Dylan_IDs']['inputs']['parameters']
        self.assertEqual(set(read), {'request/method', 'request/url', 'request/headers'})
        self.assertEqual(set(translate), {'request/method', 'request/url', 'request/headers', 'request/body'})
        self.assertEqual(read['request/headers'], {'Accept': 'application/json'})
        self.assertEqual(translate['request/headers'], {'Accept': 'application/json', 'Content-Type': 'application/json'})
        self.assertEqual(translate['request/body'], "@string(outputs('Fixed_translation_body'))")
        self.assertIsInstance(translate['request/body'], str)
        for parameters in (read, translate):
            self.assertFalse({'method', 'url', 'headers', 'body'} & parameters.keys())

    def test_connection_and_reply_bind_mailbox_and_exact_documented_translation(self):
        route = m.definition()['actions']['Allow_only_fixed_translation']['actions']
        self.assertIn(m.MAILBOX, route['Connection_is_Dylan']['inputs'])
        steps = route['Allow_only_Dylan_connection']['actions']
        self.assertEqual(steps['Fixed_translation_body']['inputs']['targetIdType'], "@body('Validate_schema')?['targetIdType']")
        reply = steps['Return_exact_translation']['inputs']['body']
        self.assertEqual(reply['mailbox'], m.MAILBOX); self.assertEqual(reply['mailboxUser'], "@body('Parse_connection_user')")
        self.assertEqual(reply['data'], "@body('Parse_translation')")
        self.assertEqual(steps['Return_exact_translation']['runAfter'], {'Parse_translation': ['Succeeded']})
        self.assertEqual(reply['targetIdType'], "@body('Validate_schema')?['targetIdType']")
        self.assertEqual(steps['Translation_failed']['inputs']['body'], m.TRANSLATION_FAILED_BODY)
        self.assertEqual(steps['Translation_failed']['inputs']['statusCode'], 502)

    def test_two_way_schema_and_exact_observed_mismatch_seam(self):
        self.assertEqual(m.SCHEMA['properties']['sourceIdType']['enum'], ['restId', 'restImmutableEntryId'])
        self.assertEqual(m.SCHEMA['properties']['targetIdType']['enum'], ['restId', 'restImmutableEntryId'])
        body = m.TRANSLATION_FAILED_BODY
        for token in ["['statusCode'],400", "['code'],'InvalidArgument'", "['sourceIdType'],'restId'",
            'Invalid value for arg: storeObjectId.IdType, value:ImmutableId, expected:EntryId',
            '"error":"mail_identity_source_type_mismatch"', '{"error":"mail_identity_translation_failed"}',
            '"schemaVersion":1', '"graphStatus":400', '"graphCode":"InvalidArgument"',
            '"sourceIdType":"restId"', '"targetIdType":"restImmutableEntryId"',
            "'requestId',body('Validate_schema')?['requestId']"]:
            self.assertIn(token, body)

    def test_package_is_new_stopped_private_and_cannot_override_principal(self):
        with tempfile.TemporaryDirectory(dir=m.ROOT / '.netlify') as directory:
            path = Path(directory); cfg = path / 'config.json'
            cfg.write_text(json.dumps({'graphConnectionName': 'shared-webcontents-11111111-2222-4333-8444-555555555555'}))
            output = path / 'identity.zip'; result = m.build(output, cfg)
            self.assertFalse(result['imported'])
            with zipfile.ZipFile(output) as archive:
                self.assertEqual(len(archive.namelist()), 5)
                doc = json.loads(archive.read(next(name for name in archive.namelist() if name.endswith('/definition.json'))))
                self.assertEqual(doc['properties']['state'], 'Stopped'); self.assertEqual(doc['properties']['definition'], m.definition())
            with self.assertRaises(ValueError): m.build(output, cfg)
            cfg.write_text(json.dumps({'callerObjectId': 'other'}))
            with self.assertRaises(ValueError): m.build(path / 'other.zip', cfg)
        with self.assertRaises(ValueError): m.build(m.ROOT / 'public.zip')

    def test_actual_native_connection_resource_id_and_invalid_lookalikes(self):
        with tempfile.TemporaryDirectory(dir=m.ROOT / '.netlify') as directory:
            path = Path(directory); cfg = path / 'config.json'
            cfg.write_text(json.dumps({'graphConnectionName': 'a8c3eaaf22d94fa78efa41f879d15f0a'}))
            output = path / 'native.zip'; m.build(output, cfg)
            with zipfile.ZipFile(output) as archive:
                doc = json.loads(archive.read(next(name for name in archive.namelist() if name.endswith('/definition.json'))))
                self.assertEqual(doc['properties']['connectionReferences']['shared_webcontents']['connectionName'], 'a8c3eaaf22d94fa78efa41f879d15f0a')
            for value in ['a' * 31, 'a' * 33, 'g' * 32, 'shared_webcontents_1', 'a' * 32 + '\n', 'shared-webcontents-' + '-' * 36]:
                cfg.write_text(json.dumps({'graphConnectionName': value}))
                with self.subTest(value=value), self.assertRaises(ValueError): m.build(path / 'invalid.zip', cfg)

if __name__ == '__main__': unittest.main()
