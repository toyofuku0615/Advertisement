"""DEMO-only subprocess files: Windows-like non-UTF8 defaults must not corrupt JSON."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


class UnicodePipelineTest(unittest.TestCase):
    def test_public_preparation_and_explanation_reconciliation_use_utf8_explicitly(self):
        # ASCII defaults are stricter than Japanese Windows CP932: both reject Korean.
        # These scripts must decode/encode multilingual files independently of locale.
        environment = {**os.environ, 'LC_ALL': 'C', 'LANG': 'C', 'PYTHONUTF8': '0', 'PYTHONCOERCECLOCALE': '0'}
        data = {
            'schemaVersion': 1, 'generatedAt': '2026-10-21T00:00:00Z',
            'topics': [{'id': 'DEMO', 'title': 'DEMO 抹茶 말차', 'observationIds': ['DEMO-observation']}],
            'observations': [{'id': 'DEMO-observation', 'topicId': 'DEMO', 'source': 'google-trends',
                              'title': 'DEMO 抹茶 말차', 'sourceUrl': 'https://example.org/demo',
                              'observedAt': '2026-10-21T00:00:00Z', 'fetchedAt': '2026-10-21T01:00:00Z'}],
            'geoObservations': [], 'collectionRuns': [], 'sources': [{'id': 'google-trends', 'enabled': True}],
        }
        with tempfile.TemporaryDirectory() as temporary:
            dataset = Path(temporary) / 'dataset.json'
            cache = Path(temporary) / 'explanations.json'
            dataset.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
            commands = [
                ['scripts/prepare_public.py', '--input', str(dataset)],
                ['scripts/generate_explanations.py', '--dataset', str(dataset), '--cache', str(cache)],
            ]
            for arguments in commands:
                result = subprocess.run([sys.executable, *arguments], cwd=ROOT, env=environment,
                                        capture_output=True, timeout=30)
                self.assertEqual(result.returncode, 0, result.stderr.decode('utf-8', errors='replace'))
            self.assertEqual(json.loads(dataset.read_text(encoding='utf-8'))['topics'][0]['title'], 'DEMO 抹茶 말차')
            item = json.loads(cache.read_text(encoding='utf-8'))['explanations'][0]
            self.assertEqual(item['status'], 'unavailable')
            self.assertEqual(item['evidence'][0]['title'], 'DEMO 抹茶 말차')


if __name__ == '__main__':
    unittest.main()
