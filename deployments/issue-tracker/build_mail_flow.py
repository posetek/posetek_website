"""Build a NEW private Power Automate import package; never imports or deploys.

Uses the Microsoft.Flow layout verified from the exported PoseTek writer.
Unconfigured packages remain explicit templates. Keep configured ZIPs and config
outside Git; the only connector is the existing Dylan Office 365 Outlook session.
"""
import argparse
import json
from pathlib import Path
import uuid
import zipfile

ROOT = Path(__file__).resolve().parents[2]
ENDPOINT = 'https://us-central1-kickai-69dd0.cloudfunctions.net/ingestUserIssueTrackerMail'


def build(output, private_config=None):
    output = output.resolve()
    if not output.is_relative_to(ROOT / '.netlify') or output.exists() or output.suffix != '.zip':
        raise ValueError('Choose a NEW ignored .netlify/*.zip output')
    cfg = json.loads(private_config.read_text(encoding='utf-8-sig')) if private_config else {}
    configured = bool(cfg.get('ingressSecret'))
    if cfg.keys() - {'ingressSecret', 'outlookConnectionName'}:
        raise ValueError('Unsupported configuration fields')
    if configured and (not isinstance(cfg['ingressSecret'], str) or not 32 <= len(cfg['ingressSecret']) <= 512 or cfg['ingressSecret'].startswith('REPLACE_')):
        raise ValueError('Invalid private ingress secret configuration')
    connection_name = cfg.get('outlookConnectionName', 'REPLACE_EXISTING_DYLAN_OUTLOOK_CONNECTION')
    if not isinstance(connection_name, str) or not connection_name or len(connection_name) > 200:
        raise ValueError('Invalid existing Outlook connection reference')
    flow, api, connection = (str(uuid.uuid4()) for _ in range(3))
    definition = json.loads((Path(__file__).parent / 'mail-intake-definition.json').read_text())
    if configured:
        definition['parameters']['trackerIngressSecret']['defaultValue'] = cfg['ingressSecret']
    api_id = '/providers/Microsoft.PowerApps/apis/shared_office365'
    title = 'PoseTek issue tracker - Outlook arrivals'
    manifest = {'schema': '1.0', 'details': {'displayName': title, 'description': 'All Inbox arrivals enqueue an authenticated immutable-ID lookup; independent whole-mailbox recovery covers trigger misses.', 'creator': 'PoseTek', 'sourceEnvironment': ''},
                'resources': {
                    flow: {'type': 'Microsoft.Flow/flows', 'suggestedCreationType': 'New', 'creationType': 'Existing, New, Update', 'details': {'displayName': title}, 'configurableBy': 'User', 'hierarchy': 'Root', 'dependsOn': [api, connection]},
                    api: {'id': api_id, 'name': 'shared_office365', 'type': 'Microsoft.PowerApps/apis', 'suggestedCreationType': 'Existing', 'details': {'displayName': 'Office 365 Outlook'}, 'configurableBy': 'System', 'hierarchy': 'Child', 'dependsOn': []},
                    connection: {'type': 'Microsoft.PowerApps/apis/connections', 'suggestedCreationType': 'Existing', 'creationType': 'Existing', 'details': {'displayName': 'dylank@posetek.net'}, 'configurableBy': 'User', 'hierarchy': 'Child', 'dependsOn': [api]}}}
    document = {'name': flow, 'id': '/providers/Microsoft.Flow/flows/' + flow, 'type': 'Microsoft.Flow/flows', 'properties': {
        'apiId': '/providers/Microsoft.PowerApps/apis/shared_logicflows', 'displayName': title, 'definition': definition,
        'connectionReferences': {'shared_office365': {'connectionName': connection_name, 'source': 'Embedded', 'id': api_id, 'tier': 'NotSpecified', 'apiName': 'office365', 'isProcessSimpleApiReferenceConversionAlreadyDone': False}},
        'flowFailureAlertSubscribed': False, 'isManaged': False}}
    base = f'Microsoft.Flow/flows/{flow}/'
    files = {'manifest.json': manifest, 'Microsoft.Flow/flows/manifest.json': {'packageSchemaVersion': '1.0', 'flowAssets': {'assetPaths': [flow]}},
             base + 'definition.json': document, base + 'apisMap.json': {'shared_office365': api}, base + 'connectionsMap.json': {'shared_office365': connection}}
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'x', zipfile.ZIP_DEFLATED) as archive:
        for name, data in files.items():
            archive.writestr(name, json.dumps(data, indent=2) + '\n')
    return {'output': str(output), 'configured': configured, 'flowResourceId': flow, 'imported': False, 'files': len(files)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--private-config', type=Path)
    args = parser.parse_args()
    print(json.dumps(build(args.output, args.private_config)))
