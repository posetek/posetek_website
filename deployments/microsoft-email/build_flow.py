"""Create a NEW private import package; never imports or contacts Microsoft.

The package structure follows an exported PoseTek Automated flow. A private config
may substitute callerObjectId, callbackSecret and outlookConnectionName. It is
never printed, and the generated package must remain outside Git.
"""
import argparse
import json
from pathlib import Path
import uuid
import zipfile

ROOT = Path(__file__).resolve().parents[2]
def build(output, private_config=None):
    output = output.resolve()
    if not output.is_relative_to(ROOT / '.netlify') or output.exists() or output.suffix != '.zip':
        raise ValueError('Choose a NEW ignored .netlify/*.zip output')
    flow, api, connection = (str(uuid.uuid4()) for _ in range(3))
    definition = json.loads((Path(__file__).parent / 'flow-definition.json').read_text())
    cfg = json.loads(private_config.read_text(encoding='utf-8-sig')) if private_config else {}
    if cfg:
        uuid.UUID(cfg['callerObjectId'])
        if len(cfg['callbackSecret']) < 32 or len(cfg['callbackSecret']) > 512:
            raise ValueError('Invalid callback secret configuration')
        definition['triggers']['manual']['inputs']['triggerAllowedUsers'] = cfg['callerObjectId']
        definition['parameters']['emailCallbackSecret']['defaultValue'] = cfg['callbackSecret']
    api_id = '/providers/Microsoft.PowerApps/apis/shared_office365'
    manifest = {'schema': '1.0', 'details': {'displayName': 'PoseTek Microsoft email delivery', 'description': 'One-time server claim, one Outlook send, authenticated receipt; trace confirms delivery.', 'creator': 'PoseTek', 'sourceEnvironment': ''},
                'resources': {
                    flow: {'type': 'Microsoft.Flow/flows', 'suggestedCreationType': 'New', 'creationType': 'Existing, New, Update', 'details': {'displayName': 'PoseTek alerts - Microsoft email delivery'}, 'configurableBy': 'User', 'hierarchy': 'Root', 'dependsOn': [api, connection]},
                    api: {'id': api_id, 'name': 'shared_office365', 'type': 'Microsoft.PowerApps/apis', 'suggestedCreationType': 'Existing', 'details': {'displayName': 'Office 365 Outlook'}, 'configurableBy': 'System', 'hierarchy': 'Child', 'dependsOn': []},
                    connection: {'type': 'Microsoft.PowerApps/apis/connections', 'suggestedCreationType': 'Existing', 'creationType': 'Existing', 'details': {'displayName': 'Dylan Outlook connection with alerts mailbox access'}, 'configurableBy': 'User', 'hierarchy': 'Child', 'dependsOn': [api]}}}
    document = {'name': flow, 'id': '/providers/Microsoft.Flow/flows/' + flow, 'type': 'Microsoft.Flow/flows', 'properties': {
        'apiId': '/providers/Microsoft.PowerApps/apis/shared_logicflows', 'displayName': 'PoseTek alerts - Microsoft email delivery', 'definition': definition,
        'connectionReferences': {'shared_office365': {'connectionName': cfg.get('outlookConnectionName', 'REPLACE_EXISTING_DYLAN_OUTLOOK_CONNECTION'), 'source': 'Embedded', 'id': api_id, 'tier': 'NotSpecified', 'apiName': 'office365', 'isProcessSimpleApiReferenceConversionAlreadyDone': False}},
        'flowFailureAlertSubscribed': True, 'isManaged': False}}
    base = f'Microsoft.Flow/flows/{flow}/'
    files = {'manifest.json': manifest, 'Microsoft.Flow/flows/manifest.json': {'packageSchemaVersion': '1.0', 'flowAssets': {'assetPaths': [flow]}},
             base + 'definition.json': document, base + 'apisMap.json': {'shared_office365': api}, base + 'connectionsMap.json': {'shared_office365': connection}}
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'x', zipfile.ZIP_DEFLATED) as archive:
        for name, data in files.items(): archive.writestr(name, json.dumps(data, indent=2) + '\n')
    return {'output': str(output), 'configured': bool(cfg), 'flowResourceId': flow, 'imported': False, 'files': len(files)}

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--private-config', type=Path)
    args = parser.parse_args()
    print(json.dumps(build(args.output, args.private_config)))
