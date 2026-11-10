"""DEMO-only integration files; CLI checks never request external sources."""
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timezone

from scripts.collect import empty_dataset, merge_dataset, timestamp

ROOT = Path(__file__).resolve().parents[1]


class CulturePipelineTest(unittest.TestCase):
    def invoke(self, output, *arguments):
        return subprocess.run([sys.executable, 'scripts/collect.py', '--only-archive', '--output', str(output), *arguments],
                              cwd=ROOT, capture_output=True, text=True, encoding='utf-8', timeout=30)

    def test_existing_cli_projects_windows_and_stays_compatible_with_legacy_optout(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / 'dataset.json'
            output.write_text(json.dumps(empty_dataset()), encoding='utf-8')
            result = self.invoke(output)
            self.assertEqual(result.returncode, 0, result.stderr)
            projected = json.loads(output.read_text(encoding='utf-8'))
            self.assertEqual(projected['schemaVersion'], 1)
            self.assertEqual(len(projected['cultureWindows']), 6)
            self.assertEqual(projected['windowObservations'], [])
            self.assertTrue(all(run['status'] == 'empty' for run in projected['windowCollectionRuns']))
            # A disabled extension neither reads an absent config nor changes old fields.
            result = self.invoke(output, '--no-culture-windows', '--culture-windows-config', str(Path(temporary) / 'missing.json'))
            self.assertEqual(result.returncode, 0, result.stderr)
            legacy = json.loads(output.read_text(encoding='utf-8'))
            self.assertNotIn('cultureWindows', legacy)
            self.assertEqual(legacy['observations'], projected['observations'])

    def test_invalid_config_does_not_replace_previous_data(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / 'dataset.json'
            output.write_text(json.dumps(empty_dataset()), encoding='utf-8')
            original = output.read_bytes()
            config = Path(temporary) / 'invalid.json'
            config.write_text('{"schemaVersion":999,"windows":[]}', encoding='utf-8')
            result = self.invoke(output, '--culture-windows-config', str(config))
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(output.read_bytes(), original)
            self.assertIn('no sources requested', result.stderr)

    def test_legacy_refresh_preserves_explicit_rights_by_source_item(self):
        now = datetime.now(timezone.utc)
        when = timestamp(now)
        policy = {'visibility': 'private', 'aiAllowed': False, 'termsUrl': 'https://example.org/DEMO-terms',
                  'license': 'DEMO test only', 'allowedFields': [], 'checkedAt': when, 'note': 'DEMO do not publish'}
        previous = empty_dataset()
        previous['topics'] = [{'id': 'DEMO-topic', 'title': 'DEMO', 'category': '未分類', 'aliases': [], 'observationIds': ['DEMO-old']}]
        original = {'id': 'DEMO-old', 'source': 'google-trends', 'sourceId': 'DEMO-item', 'topicId': 'DEMO-topic',
                    'sourceUrl': 'https://example.org/DEMO', 'observedAt': when, 'fetchedAt': when, 'publication': policy}
        previous['observations'] = [original]
        incoming = {**original, 'id': 'DEMO-new'}
        incoming.pop('publication')
        untouched = copy.deepcopy(incoming)
        merged = merge_dataset(previous, [([], [incoming], [])], [], now)
        self.assertEqual(next(row for row in merged['observations'] if row['id'] == 'DEMO-new')['publication'], policy)
        self.assertEqual(incoming, untouched)


if __name__ == '__main__':
    unittest.main()
