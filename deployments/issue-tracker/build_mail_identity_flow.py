"""Build an isolated, stopped, tenant-restricted Exchange ID translation flow.

The preauthorized HTTP with Microsoft Entra ID connector uses the signed-in
Dylan connection. No caller-provided URL, method, headers or auth is accepted.
Tenant save, connector response shape and exact-ID probes remain release gates.
"""
import argparse
import json
from pathlib import Path
import re
import uuid
import zipfile
from build_mail_read_flow import ROOT, CALLER, MAILBOX, SECURE, SECURE_INPUTS, action, response, literal, bad_characters

API = '/providers/Microsoft.PowerApps/apis/shared_webcontents'
IDS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_+/=-'
SCHEMA = {'type': 'object', 'additionalProperties': False,
    'required': ['schemaVersion', 'requestId', 'inputIds', 'sourceIdType', 'targetIdType'], 'properties': {
    'schemaVersion': {'type': 'integer', 'enum': [1]},
    'requestId': {'type': 'string', 'minLength': 36, 'maxLength': 36},
    'inputIds': {'type': 'array', 'minItems': 1, 'maxItems': 100, 'uniqueItems': True,
        'items': {'type': 'string', 'minLength': 1, 'maxLength': 1024}},
    'sourceIdType': {'type': 'string', 'enum': ['restId', 'restImmutableEntryId']},
    'targetIdType': {'type': 'string', 'enum': ['restImmutableEntryId']}}}

def invoke(method, url, body=None, after=None):
    parameters = {'method': method, 'url': url, 'headers': {'Accept': 'application/json'}}
    if body is not None:
        parameters['headers']['Content-Type'] = 'application/json'
        parameters['body'] = body
    return action('OpenApiConnection', {'parameters': parameters,
        'host': {'apiId': API, 'connectionName': 'shared_webcontents', 'operationId': 'InvokeHttp'},
        'retryPolicy': {'type': 'none'}, 'authentication': "@parameters('$authentication')"}, after)

def definition():
    req = "body('Validate_schema')?['requestId']"
    ids = "body('Validate_schema')?['inputIds']"
    remaining = 'item()'
    for character in IDS:
        remaining = f'replace({remaining},{literal(character)},\'\')'
    guards = ["equals(body('Validate_schema')?['schemaVersion'],1)",
        f'equals(length({req}),36)', "equals(length(body('Invalid_request_characters')),0)",
        f'greater(length({ids}),0)', f'lessOrEquals(length({ids}),100)', f'equals(length(union({ids},{ids})),length({ids}))',
        "equals(length(body('Invalid_message_IDs')),0)",
        "or(equals(body('Validate_schema')?['sourceIdType'],'restId'),equals(body('Validate_schema')?['sourceIdType'],'restImmutableEntryId'))",
        "equals(body('Validate_schema')?['targetIdType'],'restImmutableEntryId')"]
    guards += [f"equals(substring({req},{n},1),'-')" for n in [8, 13, 18, 23]]
    route = {'Read_connection_user': invoke('GET', 'https://graph.microsoft.com/v1.0/me?$select=id,userPrincipalName,mail'),
        'Parse_connection_user': action('ParseJson', {'content': "@body('Read_connection_user')", 'schema': {
            'type': 'object', 'required': ['id', 'userPrincipalName'], 'properties': {'id': {'type': 'string', 'minLength': 1},
                'userPrincipalName': {'type': 'string'}, 'mail': {'type': ['string', 'null']}}}}, {'Read_connection_user': ['Succeeded']}),
        'Connection_is_Dylan': action('Compose', f"@equals(toLower(body('Parse_connection_user')?['userPrincipalName']),{literal(MAILBOX)})", {'Parse_connection_user': ['Succeeded']}),
        'Allow_only_Dylan_connection': {'type': 'If', 'runAfter': {'Connection_is_Dylan': ['Succeeded']},
            'expression': "@equals(outputs('Connection_is_Dylan'),true)", 'actions': {
                'Fixed_translation_body': action('Compose', {'inputIds': '@' + ids,
                    'sourceIdType': "@body('Validate_schema')?['sourceIdType']", 'targetIdType': 'restImmutableEntryId'}),
                'Translate_Dylan_IDs': invoke('POST', 'https://graph.microsoft.com/v1.0/me/translateExchangeIds',
                    "@string(outputs('Fixed_translation_body'))", {'Fixed_translation_body': ['Succeeded']}),
                'Parse_translation': action('ParseJson', {'content': "@body('Translate_Dylan_IDs')", 'schema': {
                    'type': 'object', 'required': ['value'], 'properties': {'value': {'type': 'array'}}}}, {'Translate_Dylan_IDs': ['Succeeded']}),
                'Return_exact_translation': response(200, {'schemaVersion': 1, 'requestId': '@' + req, 'mailbox': MAILBOX,
                    'mailboxUser': "@body('Parse_connection_user')", 'graphStatus': 200,
                    'sourceIdType': "@body('Validate_schema')?['sourceIdType']", 'targetIdType': 'restImmutableEntryId',
                    'data': "@body('Parse_translation')"}, {'Parse_translation': ['Succeeded']}),
                'Translation_failed': response(502, {'error': 'mail_identity_translation_failed'}, {'Translate_Dylan_IDs': ['Failed', 'TimedOut']}),
                'Invalid_translation_response': response(502, {'error': 'mail_identity_invalid_response'}, {'Parse_translation': ['Failed', 'TimedOut']})},
            'else': {'actions': {'Wrong_connection': response(403, {'error': 'mail_identity_wrong_connection'})}}},
        'Connection_read_failed': response(502, {'error': 'mail_identity_connection_unavailable'}, {'Read_connection_user': ['Failed', 'TimedOut']}),
        'Invalid_connection_response': response(502, {'error': 'mail_identity_invalid_response'}, {'Parse_connection_user': ['Failed', 'TimedOut']})}
    actions = {'Validate_schema': action('ParseJson', {'content': '@triggerBody()', 'schema': SCHEMA}),
        'Invalid_message_IDs': action('Query', {'from': '@' + ids,
            'where': f'@or(equals(length(item()),0),greater(length(item()),1024),not(equals({remaining},\'\')))'}, {'Validate_schema': ['Succeeded']}),
        'Invalid_request_characters': bad_characters(req, '0123456789abcdefABCDEF-', 'Invalid_message_IDs'),
        'Request_is_allowed': action('Compose', '@and(' + ','.join(guards) + ')', {'Invalid_request_characters': ['Succeeded']}),
        'Allow_only_fixed_translation': {'type': 'If', 'runAfter': {'Request_is_allowed': ['Succeeded']},
            'expression': "@equals(outputs('Request_is_allowed'),true)", 'actions': route,
            'else': {'actions': {'Reject_request': response(400, {'error': 'invalid_mail_identity_request'})}}},
        'Reject_schema': response(400, {'error': 'invalid_mail_identity_request'}, {'Validate_schema': ['Failed', 'TimedOut']})}
    return {'$schema': 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        'contentVersion': '1.0.0.0', 'parameters': {'$authentication': {'defaultValue': {}, 'type': 'SecureObject'}, '$connections': {'defaultValue': {}, 'type': 'Object'}},
        'triggers': {'manual': {'type': 'Request', 'kind': 'Http', 'inputs': {'schema': SCHEMA, 'triggerAuthenticationType': 'User',
            'triggerAllowedUsers': CALLER}, 'runtimeConfiguration': SECURE}}, 'actions': actions, 'outputs': {}}

def build(output, private_config=None):
    output = output.resolve()
    if not output.is_relative_to(ROOT / '.netlify') or output.exists() or output.suffix != '.zip':
        raise ValueError('Choose a NEW ignored .netlify/*.zip output')
    cfg = json.loads(private_config.read_text(encoding='utf-8-sig')) if private_config else {}
    if cfg.keys() - {'graphConnectionName'}: raise ValueError('Unsupported private configuration field')
    name = cfg.get('graphConnectionName', 'REPLACE_EXISTING_DYLAN_GRAPH_CONNECTION')
    if cfg and not re.fullmatch(r'shared-webcontents-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', name):
        raise ValueError('Invalid existing Graph connection reference')
    flow, api, connection = (str(uuid.uuid4()) for _ in range(3))
    title = 'PoseTek tracker - verify Outlook item IDs'
    manifest = {'schema': '1.0', 'details': {'displayName': title, 'description': 'Fixed read-only Exchange ID translation; no message, tracker or send mutation.', 'creator': 'PoseTek', 'sourceEnvironment': ''}, 'resources': {
        flow: {'type': 'Microsoft.Flow/flows', 'suggestedCreationType': 'New', 'creationType': 'New', 'details': {'displayName': title}, 'configurableBy': 'User', 'hierarchy': 'Root', 'dependsOn': [api, connection]},
        api: {'id': API, 'name': 'shared_webcontents', 'type': 'Microsoft.PowerApps/apis', 'suggestedCreationType': 'Existing', 'details': {'displayName': 'HTTP with Microsoft Entra ID (preauthorized)'}, 'configurableBy': 'System', 'hierarchy': 'Child', 'dependsOn': []},
        connection: {'type': 'Microsoft.PowerApps/apis/connections', 'suggestedCreationType': 'Existing', 'creationType': 'Existing', 'details': {'displayName': MAILBOX}, 'configurableBy': 'User', 'hierarchy': 'Child', 'dependsOn': [api]}}}
    document = {'name': flow, 'id': '/providers/Microsoft.Flow/flows/' + flow, 'type': 'Microsoft.Flow/flows', 'properties': {
        'apiId': '/providers/Microsoft.PowerApps/apis/shared_logicflows', 'displayName': title, 'state': 'Stopped', 'definition': definition(),
        'connectionReferences': {'shared_webcontents': {'connectionName': name, 'source': 'Embedded', 'id': API, 'tier': 'NotSpecified', 'apiName': 'webcontents', 'isProcessSimpleApiReferenceConversionAlreadyDone': False}},
        'flowFailureAlertSubscribed': False, 'isManaged': False}}
    base = f'Microsoft.Flow/flows/{flow}/'
    files = {'manifest.json': manifest, 'Microsoft.Flow/flows/manifest.json': {'packageSchemaVersion': '1.0', 'flowAssets': {'assetPaths': [flow]}},
        base + 'definition.json': document, base + 'apisMap.json': {'shared_webcontents': api}, base + 'connectionsMap.json': {'shared_webcontents': connection}}
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'x', zipfile.ZIP_DEFLATED) as archive:
        for file, data in files.items(): archive.writestr(file, json.dumps(data, indent=2) + '\n')
    return {'output': str(output), 'configured': bool(cfg), 'flowResourceId': flow, 'imported': False, 'files': len(files)}

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--private-config', type=Path)
    args = parser.parse_args()
    print(json.dumps(build(args.output, args.private_config)))
