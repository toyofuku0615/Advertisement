import copy
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from scripts.prepare_public import prepare_public, sanitize_explanations
from scripts.collect import merge_dataset
from scripts.culture_windows import publication_allowed, publication_key
from tests.test_explanations import dataset, previous


def policy(visibility='public', ai_allowed=True):
    return {'visibility': visibility, 'aiAllowed': ai_allowed, 'termsUrl': 'https://example.org/terms',
            'license': 'DEMO test permission', 'allowedFields': ['metadata', 'headline', 'link', 'metrics'],
            'checkedAt': '2026-11-10T00:00:00Z', 'note': 'DEMO only, never production'}


def public_fixture():
    value = dataset()
    value.update({'schemaVersion': 1, 'generatedAt': '2026-11-10T00:00:00Z', 'geoObservations': [], 'collectionRuns': []})
    value['topics'][0]['observationIds'] = [value['observations'][0]['id']]
    value['observations'][0]['sourceId'] = 'DEMO-source-item'
    return value


class PublicPreparationTest(unittest.TestCase):
    def test_removed_private_item_stays_restricted_after_a_legacy_refetch(self):
        data = public_fixture()
        data['observations'][0].update({'sourceId': 'DEMO-secret-source-id', 'title': 'DEMO_PRIVATE_HEADLINE', 'sourceUrl': 'https://example.org/private-item', 'publication': policy('private')})
        fresh = copy.deepcopy(data['observations'][0])
        fresh.pop('publication')
        fresh['id'] = 'DEMO-next-observation-id'
        fresh['fetchedAt'] = '2026-11-10T00:01:00Z'
        published = prepare_public(data)
        self.assertEqual(published['observations'], [])
        self.assertEqual(published['publicationRestrictions'], [{'key': publication_key(fresh), 'publicAllowed': False, 'aiAllowed': False}])
        serialized = json.dumps(published)
        for private_value in ('DEMO-secret-source-id', 'DEMO_PRIVATE_HEADLINE', 'https://example.org/private-item'):
            self.assertNotIn(private_value, serialized)
        merged = merge_dataset(published, [(data['topics'], [fresh], [])], [], now=datetime(2026, 11, 10, tzinfo=timezone.utc))
        again = prepare_public(merged)
        self.assertEqual(again['observations'], [])
        self.assertEqual(again['publicationRestrictions'], published['publicationRestrictions'])

    def test_ai_denial_survives_actual_publication_and_refetch_without_item_policy(self):
        data = public_fixture()
        cache = previous(data)
        cache['explanations'][0]['overview']['text'] = 'DEMO_PRIVATE_DERIVED_TEXT'
        data['observations'][0]['publication'] = policy(ai_allowed=False)
        published = prepare_public(data)
        fresh = copy.deepcopy(data['observations'][0])
        fresh.pop('publication')
        fresh['fetchedAt'] = '2026-11-10T00:01:00Z'
        merged = merge_dataset(published, [(data['topics'], [fresh], [])], [], now=datetime(2026, 11, 10, tzinfo=timezone.utc))
        again = prepare_public(merged)
        self.assertEqual(len(again['observations']), 1)
        self.assertTrue(publication_allowed(again['observations'][0]))
        self.assertFalse(publication_allowed(again['observations'][0], for_ai=True))
        self.assertEqual(again['publicationRestrictions'], [{'key': publication_key(fresh), 'publicAllowed': True, 'aiAllowed': False}])
        self.assertNotIn('DEMO_PRIVATE_DERIVED_TEXT', json.dumps(sanitize_explanations(cache, again)))

    def test_independently_private_geo_stays_restricted_without_hiding_public_observation(self):
        data = public_fixture()
        geo = {'id': 'DEMO-geo', 'topicId': data['topics'][0]['id'], 'source': 'google-trends', 'sourceUrl': 'https://example.org/geo-private', 'regionCode': 'JP', 'regionMeaning': 'search-market', 'date': '2026-11-10', 'fetchedAt': '2026-11-10T00:00:00Z', 'layer': 'search-interest', 'value': 7, 'unit': 'DEMO index', 'normalization': 'DEMO', 'population': 'DEMO', 'publication': policy('private')}
        data['geoObservations'] = [geo]
        published = prepare_public(data)
        self.assertEqual(len(published['observations']), 1)
        self.assertEqual(published['geoObservations'], [])
        fresh = copy.deepcopy(geo)
        fresh.pop('publication')
        merged = merge_dataset(published, [(data['topics'], [], [fresh])], [], now=datetime(2026, 11, 10, tzinfo=timezone.utc))
        again = prepare_public(merged)
        self.assertEqual(len(again['observations']), 1)
        self.assertEqual(again['geoObservations'], [])
        self.assertEqual(again['publicationRestrictions'], published['publicationRestrictions'])

    def test_generic_new_source_permission_cannot_clear_an_item_denial(self):
        data = public_fixture()
        data['observations'][0]['publication'] = policy('private')
        published = prepare_public(data)
        fresh = {**data['observations'][0], 'publication': policy()}
        merged = merge_dataset(published, [(data['topics'], [fresh], [])], [], now=datetime(2026, 11, 10, tzinfo=timezone.utc))
        again = prepare_public(merged)
        self.assertEqual(again['observations'], [])
        self.assertEqual(again['publicationRestrictions'], published['publicationRestrictions'])

    def test_legacy_data_has_no_empty_restriction_extension_and_malformed_ledger_fails_closed(self):
        data = public_fixture()
        self.assertNotIn('publicationRestrictions', prepare_public(data))
        for rule in ({'key': 'raw-private-id', 'publicAllowed': False, 'aiAllowed': False}, {'key': 'a' * 64, 'publicAllowed': True, 'aiAllowed': True}, {'key': 'a' * 64, 'publicAllowed': False, 'aiAllowed': True}):
            data['publicationRestrictions'] = [rule]
            before = copy.deepcopy(data)
            with self.assertRaises(ValueError):
                prepare_public(data)
            self.assertEqual(data, before)

    def test_excludes_only_unconfigured_social_publication_and_keeps_provenance(self):
        data = {'topics': [{'id': 'a', 'observationIds': ['1']}, {'id': 'b', 'observationIds': ['2']}, {'id': 'g', 'observationIds': []}], 'observations': [{'id': '1', 'topicId': 'a', 'source': 'bluesky', 'sourceUrl': 'https://bsky.app'}, {'id': '2', 'topicId': 'b', 'source': 'google-trends', 'sourceUrl': 'https://trends.google.com', 'fetchedAt': '2026-10-21T00:00:00Z'}], 'geoObservations': [{'topicId': 'g', 'source': 'google-trends-archive', 'value': 42}], 'sources': [{'id': 'bluesky', 'enabled': True}, {'id': 'google-trends', 'enabled': True}], 'collectionRuns': [{'source': 'bluesky'}, {'source': 'google-trends'}]}
        result = prepare_public(data)
        self.assertEqual([row['id'] for row in result['topics']], ['b', 'g'])
        self.assertEqual(result['observations'], [data['observations'][1]])
        self.assertEqual(result['geoObservations'], data['geoObservations'])
        self.assertFalse(result['sources'][0]['enabled'])
        self.assertTrue(data['sources'][0]['enabled'])
        again = prepare_public(result)
        self.assertEqual(again['observations'], result['observations'])
        self.assertEqual(len([r for r in again['collectionRuns'] if r['source'] == 'bluesky']), 1)

    def test_explicit_private_and_unknown_records_remove_aggregates_without_removing_public_siblings(self):
        for visibility in ('private', 'unknown'):
            data = public_fixture()
            data['observations'][0].update({'publication': policy(visibility), 'title': 'DEMO_PRIVATE_HEADLINE'})
            sibling = {**copy.deepcopy(data['observations'][0]), 'id': 'public-sibling', 'sourceId': 'DEMO-public-item', 'sourceUrl': 'https://example.org/public', 'title': 'DEMO public headline', 'publication': policy()}
            data['observations'].append(sibling)
            data['topics'][0]['observationIds'].append(sibling['id'])
            data['geoObservations'] = [{'id': 'aggregate', 'topicId': sibling['topicId'], 'source': sibling['source'], 'value': 2}]
            before = copy.deepcopy(data)
            result = prepare_public(data)
            self.assertEqual([row['id'] for row in result['observations']], ['public-sibling'])
            self.assertEqual(result['topics'][0]['observationIds'], ['public-sibling'])
            self.assertEqual(result['geoObservations'], [])
            self.assertNotIn('DEMO_PRIVATE_HEADLINE', json.dumps(result))
            self.assertEqual(data, before)

    def test_private_window_membership_does_not_make_canonical_public_observation_private(self):
        data = public_fixture()
        data['cultureWindows'] = [{'id': 'DEMO-window', 'enabled': True, 'sources': [{'id': 'DEMO-binding', 'source': 'google-trends', 'enabled': True, 'publication': policy('private')}]}]
        data['windowObservations'] = [{'id': 'DEMO-link', 'windowId': 'DEMO-window', 'sourceBindingId': 'DEMO-binding', 'observationId': data['observations'][0]['id'], 'publication': policy()}]
        data['windowCollectionRuns'] = [{'id': 'DEMO-run', 'windowId': 'DEMO-window', 'sourceBindingId': 'DEMO-binding', 'count': 1, 'retainedCount': 0}]
        result = prepare_public(data)
        self.assertEqual(result['observations'], data['observations'])
        self.assertEqual(result['windowObservations'], [])
        self.assertEqual(result['windowCollectionRuns'], [])
        self.assertEqual(result['cultureWindows'][0]['sources'], [])

    def test_public_disabled_binding_keeps_honest_disabled_run_and_no_membership(self):
        data = public_fixture()
        data['cultureWindows'] = [{'id': 'DEMO-window', 'enabled': True, 'sources': [{'id': 'DEMO-binding', 'source': 'google-trends', 'enabled': False, 'publication': policy()}]}]
        data['windowObservations'] = [{'id': 'DEMO-link', 'windowId': 'DEMO-window', 'sourceBindingId': 'DEMO-binding', 'observationId': data['observations'][0]['id'], 'publication': policy()}]
        data['windowCollectionRuns'] = [{'id': 'DEMO-run', 'windowId': 'DEMO-window', 'sourceBindingId': 'DEMO-binding', 'count': 1, 'retainedCount': 1, 'status': 'success'}]
        result = prepare_public(data)
        self.assertEqual(result['windowObservations'], [])
        self.assertEqual(result['windowCollectionRuns'][0]['status'], 'disabled')
        self.assertEqual(result['windowCollectionRuns'][0]['count'], 0)
        self.assertEqual(result['windowCollectionRuns'][0]['retainedCount'], 0)

    def test_ai_permission_is_independent_and_old_derived_text_is_removed(self):
        data = public_fixture()
        cache = previous(data)
        cache['explanations'][0]['overview']['text'] = 'DEMO_PRIVATE_DERIVED_TEXT'
        data['observations'][0]['publication'] = policy(ai_allowed=False)
        result = prepare_public(data)
        self.assertEqual(len(result['observations']), 1)
        sanitized = sanitize_explanations(cache, result)
        self.assertEqual(sanitized['explanations'][0]['status'], 'unavailable')
        self.assertEqual(sanitized['explanations'][0]['evidence'], [])
        self.assertNotIn('DEMO_PRIVATE_DERIVED_TEXT', json.dumps(sanitized))

    def test_pages_cli_sanitizes_sibling_cache_without_a_model_or_private_headline_leak(self):
        data = public_fixture()
        cache = previous(data)
        cache['explanations'][0]['overview']['text'] = 'DEMO_PRIVATE_DERIVED_TEXT'
        data['observations'][0]['publication'] = policy('private')
        sibling = {**copy.deepcopy(data['observations'][0]), 'id': 'public-sibling', 'sourceId': 'DEMO-public-item', 'title': 'DEMO public headline', 'publication': policy(), 'relatedLinks': []}
        data['observations'].append(sibling)
        data['topics'][0]['observationIds'].append(sibling['id'])
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'dataset.json'
            cache_path = target.with_name('explanations.json')
            target.write_text(json.dumps(data), encoding='utf-8')
            cache_path.write_text(json.dumps(cache), encoding='utf-8')
            run = subprocess.run([sys.executable, 'scripts/prepare_public.py', '--input', str(target)], cwd=Path(__file__).resolve().parents[1], capture_output=True, timeout=30)
            self.assertEqual(run.returncode, 0, run.stderr.decode(errors='replace'))
            result = json.loads(target.read_text(encoding='utf-8'))
            sanitized = json.loads(cache_path.read_text(encoding='utf-8'))
            self.assertEqual(len(result['observations']), 1)
            self.assertEqual(sanitized['explanations'][0]['status'], 'unavailable')
            self.assertNotIn('DEMO_PRIVATE_DERIVED_TEXT', cache_path.read_text(encoding='utf-8'))


if __name__ == '__main__':
    unittest.main()
