"""Create a new private GET-only delegated Outlook proxy package. Never imports.

Expressions independently allowlist URL characters and the exact Dylan message
route. They do not depend on unsupported trigger-schema regex validation.
"""
import argparse
import json
from pathlib import Path
import re
import uuid
import zipfile

ROOT = Path(__file__).resolve().parents[2]
CALLER = 'cd9fa4b9-7716-4534-9cf1-620422f48aba'
MAILBOX = 'dylank@posetek.net'
API = '/providers/Microsoft.PowerApps/apis/shared_office365'
BASE = 'https://graph.microsoft.com/v1.0/users/dylank@posetek.net/messages'
URL_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~:/?[]@!$&'()*+,;=%"
ITEM_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_+/=-'
SECURE = {'secureData': {'properties': ['inputs', 'outputs']}}
SECURE_INPUTS = {'secureData': {'properties': ['inputs']}}
SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': ['schemaVersion', 'requestId', 'url'], 'properties': {
    'schemaVersion': {'type': 'integer', 'enum': [1]}, 'requestId': {'type': 'string', 'minLength': 36, 'maxLength': 36},
    'url': {'type': 'string', 'minLength': len(BASE), 'maxLength': 8192}}}


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def action(kind, inputs, after=None, **extra):
    # Microsoft supports only Secure Inputs for these data operations; that
    # setting also hides their outputs. Query/managed connectors support both.
    security = SECURE_INPUTS if kind in ('ParseJson', 'Compose') else SECURE
    return {'type': kind, 'runAfter': after or {}, 'inputs': inputs, 'runtimeConfiguration': security, **extra}


def bad_characters(source, allowed, after):
    return action('Query', {'from': f'@range(0,length({source}))',
        'where': f'@not(contains({literal(allowed)},substring({source},item(),1)))'}, {after: ['Succeeded']})


def response(status, body, after=None):
    return {'type': 'Response', 'kind': 'Http', 'runAfter': after or {}, 'inputs': {'statusCode': status, 'headers': {'Content-Type': 'application/json'}, 'body': body}, 'runtimeConfiguration': SECURE_INPUTS}


def definition():
    url = "body('Validate_schema')?['url']"
    req = "body('Validate_schema')?['requestId']"
    path = "outputs('Message_path')"
    tail = "outputs('Message_id')"
    decoded = "outputs('Decoded_message_id')"
    allowed = [f'equals(length(body({literal(name)})),0)' for name in ['Invalid_URL_characters', 'Invalid_ID_characters', 'Invalid_request_characters']]
    allowed += [f'equals(body(\'Validate_schema\')?[\'schemaVersion\'],1)', f'equals(length({req}),36)']
    allowed += [f"equals(substring({req},{n},1),'-')" for n in [8,13,18,23]]
    allowed += [f"equals(length(split({req},'-')),5)", f'lessOrEquals(length({url}),8192)',
        f"equals(length(split({tail},'/')),1)",
        f"or(equals({path},{literal(BASE)}),and(equals(take({path},{len(BASE)+1}),{literal(BASE+'/')}),greater(length({tail}),0),lessOrEquals(length({tail}),6144)))"]
    read = action('OpenApiConnection', {'parameters': {'Uri': '@' + url, 'Method': 'GET',
        'CustomHeader1': 'Prefer: IdType="ImmutableId", outlook.body-content-type="html"'},
        'host': {'apiId': API, 'connectionName': 'shared_office365', 'operationId': 'HttpRequest'},
        'retryPolicy': {'type': 'none'}, 'authentication': "@parameters('$authentication')"})
    actions = {
        'Validate_schema': action('ParseJson', {'content': '@triggerBody()', 'schema': SCHEMA}),
        # Only this comparison copy is normalized. The original URL is sent unchanged.
        'Message_path': action('Compose', f"@replace(first(split({url},'?')),'dylank%40posetek.net','dylank@posetek.net')", {'Validate_schema':['Succeeded']}),
        # slice explicitly permits a start beyond the collection path's end;
        # substring has bounds-sensitive native behavior unlike Python slicing.
        'Message_id': action('Compose', f'@slice({path},{len(BASE)+1})', {'Message_path':['Succeeded']}),
        'Decoded_message_id': action('Compose', f"@replace(replace(replace(replace(replace(replace({tail},'%2B','+'),'%2b','+'),'%2F','/'),'%2f','/'),'%3D','='),'%3d','=')", {'Message_id':['Succeeded']}),
        'Invalid_URL_characters': bad_characters(url, URL_CHARS, 'Decoded_message_id'),
        # Collection requests have no ID. Scan one known-allowed sentinel too,
        # so range always gets a positive count without changing the predicate.
        'Invalid_ID_characters': bad_characters(f"concat({decoded},'A')", ITEM_CHARS, 'Invalid_URL_characters'),
        'Invalid_request_characters': bad_characters(req, '0123456789abcdefABCDEF-', 'Invalid_ID_characters'),
        'Route_is_allowed': action('Compose', '@and(' + ','.join(allowed) + ')', {'Invalid_request_characters':['Succeeded']}),
        # If supports neither secure setting. Only the boolean decision enters
        # it; the predicate's URL/message-ID inputs stay in secured Compose.
        'Allow_only_Dylan_message_GET': {'type': 'If', 'runAfter': {'Route_is_allowed':['Succeeded']}, 'expression': "@equals(outputs('Route_is_allowed'),true)",
            'actions': {
                'Read_Dylan_messages': read,
                'Return_complete_read': response(200, {'schemaVersion':1, 'requestId':'@'+req, 'mailbox':MAILBOX,
                    'graphStatus':"@outputs('Read_Dylan_messages')?['statusCode']", 'data':"@body('Read_Dylan_messages')"}, {'Read_Dylan_messages':['Succeeded']}),
                'Return_read_failure': response(502, {'error':'mail_read_failed'}, {'Read_Dylan_messages':['Failed','TimedOut']})},
            'else': {'actions': {'Reject_route': response(400, {'error':'invalid_mail_read_request'})}}},
        'Reject_schema': response(400, {'error':'invalid_mail_read_request'}, {'Validate_schema':['Failed','TimedOut']})}
    return {'$schema':'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        'contentVersion':'1.0.0.0', 'parameters': {'$authentication':{'defaultValue':{},'type':'SecureObject'}, '$connections':{'defaultValue':{},'type':'Object'}},
        'triggers': {'manual': {'type':'Request','kind':'Http','inputs': {'schema':SCHEMA,'triggerAuthenticationType':'User','triggerAllowedUsers':CALLER},
            # No concurrency control: this tenant requires that for a synchronous
            # Response. GET-only transport has no duplicate-write hazard.
            'runtimeConfiguration':SECURE}}, 'actions':actions, 'outputs':{}}


def build(output, private_config=None):
    output = output.resolve()
    if not output.is_relative_to(ROOT / '.netlify') or output.exists() or output.suffix != '.zip':
        raise ValueError('Choose a NEW ignored .netlify/*.zip output')
    cfg = json.loads(private_config.read_text(encoding='utf-8-sig')) if private_config else {}
    if cfg.keys() - {'outlookConnectionName'}:
        raise ValueError('Unsupported private configuration field')
    connection_name = cfg.get('outlookConnectionName', 'REPLACE_EXISTING_DYLAN_OUTLOOK_CONNECTION')
    if cfg and not re.fullmatch(r'shared-office365-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', connection_name):
        raise ValueError('Invalid existing Outlook connection reference')
    flow, api, connection = (str(uuid.uuid4()) for _ in range(3))
    title = 'PoseTek tracker - read Dylan mailbox'
    manifest = {'schema':'1.0','details': {'displayName':title,'description':'Read-only fixed Dylan message GET proxy; source leases/cursors remain in the backend.','creator':'PoseTek','sourceEnvironment':''}, 'resources': {
        flow:{'type':'Microsoft.Flow/flows','suggestedCreationType':'New','creationType':'New','details':{'displayName':title},'configurableBy':'User','hierarchy':'Root','dependsOn':[api,connection]},
        api:{'id':API,'name':'shared_office365','type':'Microsoft.PowerApps/apis','suggestedCreationType':'Existing','details':{'displayName':'Office 365 Outlook'},'configurableBy':'System','hierarchy':'Child','dependsOn':[]},
        connection:{'type':'Microsoft.PowerApps/apis/connections','suggestedCreationType':'Existing','creationType':'Existing','details':{'displayName':MAILBOX},'configurableBy':'User','hierarchy':'Child','dependsOn':[api]}}}
    document = {'name':flow,'id':'/providers/Microsoft.Flow/flows/'+flow,'type':'Microsoft.Flow/flows','properties': {
        'apiId':'/providers/Microsoft.PowerApps/apis/shared_logicflows','displayName':title,'state':'Stopped','definition':definition(),
        'connectionReferences':{'shared_office365':{'connectionName':connection_name,'source':'Embedded','id':API,'tier':'NotSpecified','apiName':'office365','isProcessSimpleApiReferenceConversionAlreadyDone':False}},
        'flowFailureAlertSubscribed':False,'isManaged':False}}
    base = f'Microsoft.Flow/flows/{flow}/'
    files = {'manifest.json':manifest, 'Microsoft.Flow/flows/manifest.json':{'packageSchemaVersion':'1.0','flowAssets':{'assetPaths':[flow]}},
        base+'definition.json':document, base+'apisMap.json':{'shared_office365':api}, base+'connectionsMap.json':{'shared_office365':connection}}
    output.parent.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(output,'x',zipfile.ZIP_DEFLATED) as archive:
        for name,data in files.items(): archive.writestr(name,json.dumps(data,indent=2)+'\n')
    return {'output':str(output),'configured':bool(cfg),'flowResourceId':flow,'imported':False,'files':len(files)}


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--output',required=True,type=Path)
    parser.add_argument('--private-config',type=Path)
    args=parser.parse_args()
    print(json.dumps(build(args.output,args.private_config)))
