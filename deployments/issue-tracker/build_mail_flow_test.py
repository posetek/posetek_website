import json
from pathlib import Path
import tempfile
import unittest
import zipfile
import build_mail_flow


class MailFlowPackageTests(unittest.TestCase):
    def test_private_template_and_configured_package_preserve_contract(self):
        # Local synthetic files only, never use a real credential or connection.
        with tempfile.TemporaryDirectory(dir=build_mail_flow.ROOT / '.netlify') as temp:
            folder = Path(temp)
            config = folder / 'config.json'
            config.write_text(json.dumps({'ingressSecret': 'synthetic-secret-' * 4, 'outlookConnectionName': 'synthetic-existing-connection'}))
            for configured in [False, True]:
                output = folder / f'flow-{configured}.zip'
                result = build_mail_flow.build(output, config if configured else None)
                self.assertEqual(result['configured'], configured)
                self.assertFalse(result['imported'])
                with zipfile.ZipFile(output) as archive:
                    self.assertEqual(len(archive.namelist()), 5)
                    manifest = json.loads(archive.read('manifest.json'))
                    self.assertEqual(manifest['resources'][result['flowResourceId']]['suggestedCreationType'], 'New')
                    document = json.loads(archive.read(f"Microsoft.Flow/flows/{result['flowResourceId']}/definition.json"))
                    definition = document['properties']['definition']
                    trigger = definition['triggers']['When_a_new_email_arrives']
                    self.assertEqual(trigger['inputs']['parameters'], {'folderPath': 'Inbox', 'includeAttachments': False, 'fetchOnlyWithAttachment': False, 'importance': 'Any'})
                    self.assertEqual(trigger['inputs']['host']['operationId'], 'OnNewEmailV3')
                    action = definition['actions']['Queue_authoritative_mail_lookup']
                    self.assertEqual(action['inputs']['body'], {'schemaVersion': 1, 'mailbox': 'dylank@posetek.net', 'message': {'id': "@triggerBody()?['id']"}})
                    self.assertEqual(action['inputs']['uri'], build_mail_flow.ENDPOINT)
                    self.assertEqual(action['inputs']['retryPolicy']['count'], 4)
                    for step in [trigger, action]:
                        self.assertEqual(step['runtimeConfiguration']['secureData']['properties'], ['inputs', 'outputs'])
                    self.assertEqual(len(definition['actions']), 1)
            with self.assertRaises(ValueError):
                build_mail_flow.build(output, config)

    def test_invalid_secret_or_output_cannot_make_an_import_package(self):
        with tempfile.TemporaryDirectory(dir=build_mail_flow.ROOT / '.netlify') as temp:
            folder = Path(temp)
            config = folder / 'bad.json'
            config.write_text('{"ingressSecret":"short"}')
            with self.assertRaises(ValueError):
                build_mail_flow.build(folder / 'rejected.zip', config)
            self.assertFalse((folder / 'rejected.zip').exists())
            with self.assertRaises(ValueError):
                build_mail_flow.build(build_mail_flow.ROOT / 'rejected.zip')


if __name__ == '__main__':
    unittest.main()
