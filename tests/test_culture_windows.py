"""Synthetic DEMO culture-window fixtures are isolated from public data."""
import copy
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
import tempfile
import unittest

from scripts.culture_windows import (
    AdapterRegistry, LegacyObservationAdapter, WindowValidationError, attach_windows,
    load_windows, publication_allowed, publication_key, validate_config,
    validate_restrictions, validate_window_data, valid_url,
)

NOW = datetime(2026, 11, 10, 5, tzinfo=timezone.utc)


def policy(visibility='public', ai=True):
    return {'visibility': visibility, 'aiAllowed': ai, 'termsUrl': 'https://example.org/DEMO-terms', 'license': 'DEMO test metadata only', 'allowedFields': ['metadata', 'link', 'metrics'], 'checkedAt': '2026-11-09T00:00:00Z', 'note': 'DEMO test policy only'}


def binding(source='google-trends', countries=None):
    return {'id': 'DEMO-source', 'source': source, 'adapter': 'legacy-google-trends' if source == 'google-trends' else 'legacy-gdelt', 'enabled': True, 'endpoint': 'https://example.org/DEMO-feed', 'countryCodes': countries or ['JP'], 'verification': {'status': 'verified', 'method': 'recorded-collection', 'checkedAt': '2026-11-09T00:00:00Z', 'evidenceUrl': 'https://example.org/DEMO-evidence', 'note': 'DEMO successful collection fixture'}, 'publication': policy(), 'disabledReason': None}


def window(source='google-trends', countries=None):
    countries = countries or ['JP']
    return {'id': 'DEMO-window', 'name': 'DEMO observation window', 'description': 'DEMO test fixture', 'countryCodes': countries, 'languages': ['ja'], 'categories': ['DEMO'], 'sources': [binding(source, countries)], 'enabled': True, 'scopeNote': 'DEMO search market, not measured demographics'}


def data(source='google-trends', region='JP'):
    return {'schemaVersion': 1, 'generatedAt': '2026-11-10T04:00:00Z', 'topics': [{'id': 'DEMO-topic'}], 'observations': [{'id': 'DEMO-observation', 'topicId': 'DEMO-topic', 'source': source, 'sourceId': 'DEMO-item', 'sourceUrl': 'https://example.org/DEMO-item', 'publishedAt': '2026-11-10T02:00:00Z' if source == 'google-trends' else '', 'observedAt': '2026-11-10T02:00:00Z', 'fetchedAt': '2026-11-10T03:00:00Z', 'regionCode': region, 'regionMeaning': 'search-market' if source == 'google-trends' else 'publisher-country', 'status': 'fresh'}], 'geoObservations': [], 'sources': [], 'collectionRuns': []}


class WindowConfigTest(unittest.TestCase):
    def test_loads_real_six_window_config_and_preserves_input(self):
        path = Path(__file__).resolve().parents[1] / 'config/culture_windows.json'
        windows = load_windows(path)
        self.assertEqual(len(windows), 6)
        self.assertEqual(len({row['id'] for row in windows}), 6)
        self.assertEqual({row['name'] for row in windows}, {'US Campus & Youth', 'K-Beauty & Lifestyle', 'UK Music & Subculture', 'European Creative', 'Southeast Asian Culture', 'Japan Baseline'})
        for row in windows:
            for source in row['sources']:
                self.assertTrue(valid_url(source['endpoint']))
                if source['enabled']:
                    self.assertEqual(source['verification']['status'], 'verified')
                    self.assertTrue(publication_allowed(source, legacy_default=False))

    def test_rejects_duplicate_window_and_binding_ids(self):
        first = window()
        for windows in [[first, first], [{**first, 'sources': [binding(), binding()]}]]:
            with self.assertRaises(WindowValidationError):
                validate_config({'schemaVersion': 1, 'windows': windows})

    def test_unverified_sources_cannot_be_enabled(self):
        row = window()
        row['sources'][0]['verification']['status'] = 'unverified'
        with self.assertRaises(WindowValidationError):
            validate_config({'schemaVersion': 1, 'windows': [row]})
        row['sources'][0].update(enabled=False, disabledReason='DEMO not yet verified')
        self.assertEqual(len(validate_config({'schemaVersion': 1, 'windows': [row]})), 1)

    def test_missing_bad_dates_unknown_rights_and_secret_urls_fail(self):
        for change in [lambda b: b.pop('publication'), lambda b: b['publication'].update(visibility='unknown'), lambda b: b['verification'].update(checkedAt='2026-11-09'), lambda b: b.update(endpoint='https://example.org/feed?api_key=DEMO-secret')]:
            row = window()
            change(row['sources'][0])
            with self.assertRaises(WindowValidationError):
                validate_config({'schemaVersion': 1, 'windows': [row]})
        for url in ['javascript:alert(1)', 'https://user:password@example.org', 'http://127.0.0.1/feed', 'http://[::1]/', 'https://example.org/feed\n', 'https://example.org/?token=DEMO', 'http://192.168.1.1/feed']:
            self.assertFalse(valid_url(url))

    def test_config_file_errors_do_not_expose_contents(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'config.json'
            path.write_text('DEMO-secret-invalid-json', encoding='utf-8')
            with self.assertRaises(WindowValidationError) as caught:
                load_windows(path)
            self.assertNotIn('DEMO-secret', str(caught.exception))

    def test_unknown_config_fields_are_rejected_before_they_can_be_published(self):
        for level in ('root', 'window', 'binding', 'verification', 'publication'):
            value = {'schemaVersion': 1, 'windows': [window()]}
            targets = {'root': value, 'window': value['windows'][0], 'binding': value['windows'][0]['sources'][0], 'verification': value['windows'][0]['sources'][0]['verification'], 'publication': value['windows'][0]['sources'][0]['publication']}
            targets[level]['headers'] = {'Authorization': 'DEMO-secret'}
            with self.subTest(level=level), self.assertRaises(WindowValidationError) as error:
                validate_config(value)
            self.assertNotIn('DEMO-secret', str(error.exception))

    def test_secret_queries_and_obfuscated_local_ip_hosts_are_not_public_urls(self):
        for key in ('api-key', 'access-token', 'accesstoken', 'signature', 'sig', 'credential', 'API%5fKEY'):
            self.assertFalse(valid_url(f'https://example.org/feed?{key}=DEMO-secret'), key)
        for host in ('127.1', '0x7f.0.0.1', '0177.0.0.1', '2130706433', '%31%32%37.0.0.1', '１２７.０.０.１', '224.0.0.1', '[::ffff:127.0.0.1]'):
            self.assertFalse(valid_url(f'http://{host}/feed'), host)
        self.assertTrue(valid_url('https://trends.google.com/trending/rss?geo=JP'))
        self.assertTrue(valid_url('https://8.8.8.8/feed'))


class WindowProjectionTest(unittest.TestCase):
    def test_legacy_json_works_without_optional_fields(self):
        legacy = data()
        original = copy.deepcopy(legacy)
        validate_window_data(legacy)
        self.assertEqual(legacy, original)

    def test_membership_preserves_canonical_ids_dates_and_unknown_language(self):
        original = data()
        before = copy.deepcopy(original)
        result = attach_windows(original, [window()], NOW)
        self.assertEqual(original, before)
        self.assertEqual(result['observations'], original['observations'])
        row = result['windowObservations'][0]
        self.assertEqual(row['observationId'], 'DEMO-observation')
        self.assertEqual(row['sourceItemId'], 'DEMO-item')
        self.assertEqual(row['regionScope'], {'kind': 'search-market', 'countryCodes': ['JP']})
        self.assertIsNone(row['language'])  # window.languages and JP never infer it.
        self.assertEqual(row['evidenceType'], 'search-trend')
        self.assertEqual(result['windowCollectionRuns'][0]['method'], 'existing-observation-projection')

    def test_news_country_is_publisher_country_and_unknown_publish_date_is_null(self):
        original = data('gdelt', 'US')
        original['observations'][0]['language'] = 'Japanese'
        result = attach_windows(original, [window('gdelt', ['US'])], NOW)
        row = result['windowObservations'][0]
        self.assertEqual(row['regionScope']['kind'], 'publisher-country')
        self.assertEqual(row['language'], 'ja')
        self.assertIsNone(row['publishedAt'])
        self.assertEqual(row['evidenceType'], 'news-mention')

    def test_refetch_deduplicates_and_reuses_stable_membership_id(self):
        original = data()
        first = attach_windows(original, [window()], NOW)
        newer = {**original['observations'][0], 'fetchedAt': '2026-11-10T04:00:00Z'}
        original['observations'].append(newer)
        # Canonical merge normally removes duplicate IDs before projection.
        result = attach_windows(original, [window()], NOW)
        self.assertEqual(len(result['windowObservations']), 1)
        self.assertEqual(result['windowObservations'][0]['fetchedAt'], newer['fetchedAt'])
        self.assertEqual(result['windowObservations'][0]['id'], first['windowObservations'][0]['id'])

    def test_equivalent_timezone_notation_is_the_same_deduplication_key(self):
        original = data()
        alternate = {**original['observations'][0], 'id': 'DEMO-timezone-copy', 'observedAt': '2026-11-10T11:00:00+09:00', 'fetchedAt': '2026-11-10T04:00:00Z'}
        original['observations'].append(alternate)
        result = attach_windows(original, [window()], NOW)
        self.assertEqual(len(result['windowObservations']), 1)
        self.assertEqual(result['windowObservations'][0]['observationId'], alternate['id'])

    def test_two_windows_can_share_one_canonical_observation(self):
        second = window()
        second['id'] = 'DEMO-second-window'
        result = attach_windows(data(), [window(), second], NOW)
        self.assertEqual(len(result['observations']), 1)
        self.assertEqual(len(result['windowObservations']), 2)
        self.assertEqual(len({row['id'] for row in result['windowObservations']}), 2)

    def test_disabled_windows_and_unimplemented_adapters_never_report_collection_success(self):
        stopped = window()
        stopped['enabled'] = False
        future = window()
        future['id'] = 'DEMO-future'
        future['sources'][0]['adapter'] = 'rss'
        result = attach_windows(data(), [stopped, future], NOW)
        self.assertEqual(result['windowObservations'], [])
        self.assertEqual([row['status'] for row in result['windowCollectionRuns']], ['disabled', 'disabled'])

    def test_private_and_unknown_observations_are_not_projected(self):
        for tag in [policy('private'), policy('unknown'), None, {'visibility': 'public'}]:
            original = data()
            original['observations'][0]['publication'] = tag
            result = attach_windows(original, [window()], NOW)
            self.assertEqual(result['windowObservations'], [])
            self.assertEqual(len(result['observations']), 1)  # Window membership does not rewrite canonical data.

    def test_canonical_ai_restriction_propagates_to_window_membership(self):
        original = data()
        original['observations'][0]['publicationRestriction'] = {'publicAllowed': True, 'aiAllowed': False}
        result = attach_windows(original, [window()], NOW)
        self.assertFalse(result['windowObservations'][0]['publication']['aiAllowed'])
        result['windowObservations'][0]['publication']['aiAllowed'] = True
        with self.assertRaises(WindowValidationError):
            validate_window_data(result)

    def test_invalid_observation_does_not_stop_other_windows(self):
        original = data()
        original['observations'][0]['fetchedAt'] = 'missing'
        other = data('gdelt', 'US')['observations'][0]
        other.update(id='DEMO-news', sourceId='DEMO-news-item')
        original['observations'].append(other)
        result = attach_windows(original, [window(), {**window('gdelt', ['US']), 'id': 'DEMO-news-window'}], NOW)
        self.assertEqual(len(result['windowObservations']), 1)
        self.assertEqual([run['status'] for run in result['windowCollectionRuns']], ['error', 'success'])

    def test_partial_fetch_failure_retains_old_data_without_claiming_new_fetch(self):
        original = data()
        original['collectionRuns'] = [{'source': 'google-trends', 'regionCode': 'JP', 'scope': 'JP', 'status': 'error', 'finishedAt': '2026-11-10T04:00:00Z'}]
        result = attach_windows(original, [window()], NOW)
        self.assertEqual(result['windowObservations'][0]['status'], 'stale')
        run = result['windowCollectionRuns'][0]
        self.assertEqual((run['status'], run['count'], run['retainedCount']), ('partial', 0, 1))

    def test_empty_is_not_zero_interest_or_collection_success(self):
        result = attach_windows(data(), [window(countries=['US'])], NOW)
        self.assertEqual(result['windowObservations'], [])
        self.assertEqual(result['windowCollectionRuns'][0]['status'], 'empty')

    def test_bad_dates_urls_and_region_meanings_are_excluded_with_error(self):
        for patch in [{'publishedAt': '2026-11-11T00:00:00Z'}, {'observedAt': '2026-11-10T02:00:00'}, {'fetchedAt': '2026-11-11T00:00:00Z'}, {'sourceUrl': 'https://u:p@example.org'}, {'regionMeaning': 'publisher-country'}]:
            original = data()
            original['observations'][0].update(patch)
            result = attach_windows(original, [window()], NOW)
            self.assertEqual(result['windowObservations'], [])
            self.assertEqual(result['windowCollectionRuns'][0]['status'], 'error')

    def test_extension_validation_rejects_broken_refs_duplicate_memberships_and_tampering(self):
        valid = attach_windows(data(), [window()], NOW)
        changes = [lambda d: d['windowObservations'][0].update(observationId='missing'), lambda d: d['windowObservations'].append(copy.deepcopy(d['windowObservations'][0])), lambda d: d['windowObservations'][0].update(language='ja'), lambda d: d['windowObservations'][0]['regionScope'].update(kind='publisher-country'), lambda d: d.pop('cultureWindows')]
        for change in changes:
            broken = copy.deepcopy(valid)
            change(broken)
            with self.assertRaises(WindowValidationError):
                validate_window_data(broken)

    def test_scope_and_evidence_type_cannot_be_relabelled(self):
        for change in [lambda d: d['windowObservations'][0].update(evidenceType='community-post'), lambda d: d['cultureWindows'][0].update(countryCodes=['US'])]:
            broken = attach_windows(data(), [window()], NOW)
            change(broken)
            with self.assertRaises(WindowValidationError):
                validate_window_data(broken)

    def test_membership_cannot_broaden_source_or_canonical_rights(self):
        target = window()
        target['sources'][0]['publication']['aiAllowed'] = False
        valid = attach_windows(data(), [target], NOW)
        for change in [{'allowedFields': ['metadata', 'link', 'headline']}, {'aiAllowed': True}, {'license': 'DEMO invented license'}, {'termsUrl': 'https://example.org/DEMO-other-terms'}]:
            broken = copy.deepcopy(valid)
            broken['windowObservations'][0]['publication'].update(change)
            with self.assertRaises(WindowValidationError):
                validate_window_data(broken)
        original = data()
        original['observations'][0]['publication'] = {**policy(ai=False), 'allowedFields': ['link']}
        valid = attach_windows(original, [window()], NOW)
        self.assertEqual(valid['windowObservations'][0]['publication']['allowedFields'], ['link'])
        valid['windowObservations'][0]['publication']['allowedFields'].append('metadata')
        with self.assertRaises(WindowValidationError):
            validate_window_data(valid)

    def test_empty_binding_countries_inherit_the_window_scope(self):
        target = window()
        target['sources'][0]['countryCodes'] = []
        original = data()
        us = {**original['observations'][0], 'id': 'DEMO-US', 'sourceId': 'DEMO-US-item', 'regionCode': 'US'}
        original['observations'].append(us)
        result = attach_windows(original, [target], NOW)
        self.assertEqual([row['observationId'] for row in result['windowObservations']], ['DEMO-observation'])

    def test_adapter_failure_is_isolated_and_does_not_claim_fetch_success(self):
        class FailingAdapter:
            source, evidence_type, region_kind = 'google-trends', 'search-trend', 'search-market'
            def observations(self, dataset, binding):
                raise OSError('DEMO private connection error')
        registry = AdapterRegistry()
        registry.register('legacy-google-trends', FailingAdapter())
        registry.register('legacy-gdelt', LegacyObservationAdapter('gdelt', 'news-mention', 'publisher-country'))
        original = data()
        original['observations'].append({**data('gdelt', 'US')['observations'][0], 'id': 'DEMO-news', 'sourceId': 'DEMO-news-item'})
        result = attach_windows(original, [window(), {**window('gdelt', ['US']), 'id': 'DEMO-news-window'}], NOW, registry)
        self.assertEqual([run['status'] for run in result['windowCollectionRuns']], ['error', 'success'])
        self.assertNotIn('private connection', json.dumps(result))


class PublicationAndAdapterTest(unittest.TestCase):
    def test_legacy_public_behavior_and_explicit_ai_denial_are_distinct(self):
        self.assertTrue(publication_allowed({}))
        self.assertFalse(publication_allowed({}, legacy_default=False))
        public_ai_denied = {'publication': policy(ai=False)}
        self.assertTrue(publication_allowed(public_ai_denied))
        self.assertFalse(publication_allowed(public_ai_denied, for_ai=True))
        self.assertFalse(publication_allowed({'publication': None}))
        headline_denied = {'publication': policy(ai=True)}
        self.assertFalse(publication_allowed(headline_denied, for_ai=True))
        headline_denied['publication']['allowedFields'].append('headline')
        self.assertTrue(publication_allowed(headline_denied, for_ai=True))

    def test_adapter_registry_cannot_silently_replace_a_source(self):
        registry = AdapterRegistry()
        registry.register('DEMO-adapter', LegacyObservationAdapter('google-trends', 'search-trend', 'search-market'))
        self.assertIsNotNone(registry.get('DEMO-adapter'))
        self.assertIsNone(registry.get('unimplemented'))
        with self.assertRaises(WindowValidationError):
            registry.register('DEMO-adapter', LegacyObservationAdapter('gdelt', 'news-mention', 'publisher-country'))

    def test_explicit_canonical_rights_must_cover_every_serialized_field(self):
        for marker in ({'title': 'DEMO sensitive title'}, {'metric': {'value': 3}}):
            row = {'topicId': 'DEMO-topic', **marker, 'publication': policy()}
            self.assertFalse(publication_allowed(row))
            row['publication']['allowedFields'].append('headline')
            self.assertTrue(publication_allowed(row))
            row['publication']['allowedFields'].remove('metrics')
            self.assertFalse(publication_allowed(row))
        # A source binding or window membership has no canonical headline/metric.
        self.assertTrue(publication_allowed({'publication': policy()}))
        geo = {'topicId': 'DEMO', 'layer': 'news-publisher', 'publication': policy()}
        self.assertTrue(publication_allowed(geo))
        geo['publication']['allowedFields'].remove('metrics')
        self.assertFalse(publication_allowed(geo))

    def test_record_restriction_guard_cannot_be_bypassed_by_legacy_absence(self):
        denied = {'publicationRestriction': {'publicAllowed': False, 'aiAllowed': False}}
        self.assertFalse(publication_allowed(denied))
        self.assertFalse(publication_allowed(denied, for_ai=True))
        ai_denied = {'publicationRestriction': {'publicAllowed': True, 'aiAllowed': False}}
        self.assertTrue(publication_allowed(ai_denied))
        self.assertFalse(publication_allowed(ai_denied, for_ai=True))
        for guard in (None, {'publicAllowed': True}, {'publicAllowed': False, 'aiAllowed': True}, {'publicAllowed': True, 'aiAllowed': False, 'token': 'DEMO-secret'}, {'publicAllowed': 1, 'aiAllowed': False}):
            self.assertFalse(publication_allowed({'publicationRestriction': guard}))

    def test_publication_ledger_contains_only_stable_hashes_and_denials(self):
        source = {'source': 'gdelt', 'sourceId': 'https://example.org/DEMO-secret-article'}
        key = publication_key(source)
        self.assertEqual(key, hashlib.sha256(('gdelt\0' + source['sourceId']).encode()).hexdigest())
        ledger = [{'key': key, 'publicAllowed': False, 'aiAllowed': False}]
        validate_restrictions({'publicationRestrictions': ledger})
        validate_window_data({'publicationRestrictions': ledger})  # Must run even without v2 arrays.
        self.assertNotIn('DEMO-secret', json.dumps(ledger))
        geo = {'source': 'gdelt', 'id': 'DEMO-geo', 'layer': 'news-publisher'}
        self.assertEqual(publication_key(geo), hashlib.sha256(b'geo\0gdelt\0DEMO-geo').hexdigest())
        self.assertNotEqual(publication_key(geo), key)
        with self.assertRaises(WindowValidationError):
            publication_key({'source': 'gdelt'})

    def test_publication_ledger_rejects_unknown_fields_duplicates_and_grants(self):
        valid = {'key': 'a' * 64, 'publicAllowed': True, 'aiAllowed': False}
        for change in [{'key': 'raw-source-URL'}, {'publicAllowed': True, 'aiAllowed': True}, {'publicAllowed': False, 'aiAllowed': True}, {'publicAllowed': 1}, {'sourceUrl': 'https://example.org/DEMO-secret'}]:
            with self.subTest(change=change), self.assertRaises(WindowValidationError):
                validate_window_data({'publicationRestrictions': [{**valid, **change}]})
        with self.assertRaises(WindowValidationError):
            validate_restrictions({'publicationRestrictions': [valid, valid]})


if __name__ == '__main__':
    unittest.main()
