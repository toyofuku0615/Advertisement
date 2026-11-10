"""DEMO inputs stay in tests; no fake AI response enters public data."""
import copy
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from urllib.error import HTTPError, URLError
from scripts.generate_explanations import (ExplanationError, MAX_INFERENCE_BYTES, SYSTEM_PROMPT, build_evidence, call_ollama, inference_evidence, input_fingerprint, reconcile, validate_content)


def dataset():
    return {'topics': [{'id': 'demo-topic', 'title': 'DEMO matcha', 'category': '食品・飲料'}], 'observations': [{'id': 'demo-observation', 'topicId': 'demo-topic', 'source': 'google-trends', 'sourceUrl': 'https://trends.google.com/trending/rss?geo=JP', 'title': 'DEMO matcha', 'observedAt': '2026-10-21T00:00:00Z', 'fetchedAt': '2026-10-21T01:00:00Z', 'relatedLinks': [{'title': 'DEMO matcha tea recipe', 'url': 'https://example.org/demo'}]}], 'sources': [{'id': 'google-trends', 'enabled': True}]}


def content():
    return {'overview': {'text': '抹茶のレシピに関する話題です。', 'kind': 'source_summary', 'evidenceIds': ['news-demo-observation-0']}, 'contexts': [{'text': 'レシピを探す場面が考えられます。', 'kind': 'interpretation', 'evidenceIds': ['news-demo-observation-0']}], 'attention': None, 'marketing': None, 'caveats': ['これはテスト専用のDEMO出力です。']}


def previous(data=None):
    data = data or dataset()
    topic = data['topics'][0]
    evidence = build_evidence(topic, data)
    item = {'topicId': topic['id'], 'inputHash': input_fingerprint(topic, evidence), 'generatedAt': '2026-10-21T02:00:00Z', 'provider': 'DEMO TEST ONLY', 'model': 'DEMO mock', 'status': 'ready', **content(), 'evidence': evidence}
    return {'schemaVersion': 1, 'explanations': [item]}


class ExplanationTest(unittest.TestCase):
    def multi_topic_data(self):
        data = dataset()
        data['topics'].append({'id': 'selected-topic', 'title': 'DEMO rare coin'})
        data['observations'].append({**data['observations'][0], 'id': 'selected-observation', 'topicId': 'selected-topic'})
        return data

    def grounded_demo(self, topic, evidence, **kwargs):
        value = content()
        for claim in [value['overview'], *value['contexts']]:
            claim['evidenceIds'] = [evidence[0]['id']]
        return value

    def test_selected_topic_is_generated_without_attempting_earlier_topic(self):
        data = self.multi_topic_data()
        calls = []
        def infer(topic, evidence, **kwargs):
            calls.append(topic['id'])
            self.assertEqual(topic['id'], 'selected-topic')
            return self.grounded_demo(topic, evidence)
        result = reconcile(data, provider='ollama', model='DEMO', topic_ids=['selected-topic'], max_topics=1, infer=infer)
        self.assertEqual(calls, ['selected-topic'])
        self.assertEqual([row['topicId'] for row in result['explanations']], ['demo-topic', 'selected-topic'])
        self.assertEqual([row['status'] for row in result['explanations']], ['unavailable', 'ready'])
        self.assertEqual(result['explanations'][1]['generationAttempt']['status'], 'success')

    def test_force_is_limited_to_selected_topic_and_other_ready_cache_is_preserved(self):
        data = self.multi_topic_data()
        old = reconcile(data, provider='ollama', model='DEMO', infer=self.grounded_demo)
        calls = []
        def infer(topic, evidence, **kwargs):
            calls.append(topic['id'])
            return self.grounded_demo(topic, evidence)
        result = reconcile(data, old, provider='ollama', model='DEMO', force=True, topic_ids=['selected-topic'], infer=infer)
        self.assertEqual(calls, ['selected-topic'])
        self.assertEqual(result['explanations'][0], old['explanations'][0])

    def test_failed_attempt_survives_no_model_reconciliation_and_does_not_starve_next_topic(self):
        data = self.multi_topic_data()
        first = []
        def fail(topic, evidence, **kwargs):
            first.append(topic['id'])
            raise ExplanationError('DEMO generation failure')
        failed = reconcile(data, provider='ollama', model='DEMO', max_topics=1, infer=fail)
        self.assertEqual(first, ['demo-topic'])
        item = failed['explanations'][0]
        self.assertEqual(item['generatedAt'], '')
        self.assertEqual(item['generationAttempt']['status'], 'error')
        cached = reconcile(data, failed)
        self.assertEqual(cached['explanations'][0]['generationAttempt'], item['generationAttempt'])
        calls = []
        def infer(topic, evidence, **kwargs):
            calls.append(topic['id'])
            return self.grounded_demo(topic, evidence)
        result = reconcile(data, cached, provider='ollama', model='DEMO', max_topics=1, infer=infer)
        self.assertEqual(calls, ['selected-topic'])
        self.assertEqual(result['explanations'][1]['status'], 'ready')

    def test_newest_unattempted_topic_is_prioritized_without_reordering_public_output(self):
        data = self.multi_topic_data()
        data['observations'][1]['observedAt'] = '2026-10-22T00:00:00Z'
        calls = []
        def infer(topic, evidence, **kwargs):
            calls.append(topic['id'])
            return self.grounded_demo(topic, evidence)
        result = reconcile(data, provider='ollama', model='DEMO', max_topics=1, infer=infer)
        self.assertEqual(calls, ['selected-topic'])
        self.assertEqual([row['topicId'] for row in result['explanations']], [row['id'] for row in data['topics']])

    def test_selection_never_bypasses_privacy_cleanup_of_unselected_topic(self):
        data = self.multi_topic_data()
        old = reconcile(data, provider='ollama', model='DEMO', infer=self.grounded_demo)
        old['explanations'][1]['overview']['text'] = 'DEMO_PRIVATE_TEXT'
        data['observations'][1]['publicationRestriction'] = {'publicAllowed': False, 'aiAllowed': False}
        result = reconcile(data, old, provider='ollama', model='DEMO', topic_ids=['demo-topic'], infer=self.grounded_demo)
        self.assertEqual(result['explanations'][1]['status'], 'unavailable')
        self.assertNotIn('DEMO_PRIVATE_TEXT', json.dumps(result))

    def test_invalid_or_unknown_selection_cannot_replace_cache(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as temporary:
            data_path, cache_path = Path(temporary) / 'dataset.json', Path(temporary) / 'cache.json'
            data_path.write_text(json.dumps(dataset()), encoding='utf-8')
            cache_path.write_text(json.dumps(previous()), encoding='utf-8')
            before = cache_path.read_bytes()
            for selected in ['missing-topic', 'bad;command']:
                result = subprocess.run([sys.executable, 'scripts/generate_explanations.py', '--dataset', str(data_path), '--cache', str(cache_path), '--provider', 'ollama', '--model', 'DEMO', '--topic-id', selected], cwd=root, capture_output=True, timeout=30)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(cache_path.read_bytes(), before)

    def test_strict_selected_missing_evidence_fails_without_calling_model_or_inventing_provider_error(self):
        from unittest.mock import Mock, patch
        from scripts import generate_explanations as generator
        data = dataset()
        data['observations'][0]['publicationRestriction'] = {'publicAllowed': True, 'aiAllowed': False}
        with tempfile.TemporaryDirectory() as temporary:
            data_path, cache_path = Path(temporary) / 'dataset.json', Path(temporary) / 'cache.json'
            data_path.write_text(json.dumps(data), encoding='utf-8')
            inference = Mock(side_effect=AssertionError('A blocked source must not invoke a model'))
            args = ['generate_explanations.py', '--dataset', str(data_path), '--cache', str(cache_path), '--provider', 'ollama', '--model', 'DEMO', '--topic-id', 'demo-topic']
            for extra, expected in [([], 0), (['--strict'], 1)]:
                with patch.object(sys, 'argv', [*args, *extra]), patch.dict(reconcile.__kwdefaults__, {'infer': inference}):
                    self.assertEqual(generator.main(), expected)
                result = json.loads(cache_path.read_text(encoding='utf-8'))
                self.assertEqual(result['providerStatus']['status'], 'disabled')
                self.assertEqual(result['explanations'][0]['status'], 'unavailable')
                self.assertEqual(result['explanations'][0]['generatedAt'], '')
            inference.assert_not_called()

    def test_explicit_publication_and_ai_denials_do_not_preserve_stale_private_claims(self):
        policy = {'visibility': 'public', 'aiAllowed': True, 'termsUrl': 'https://example.org/terms', 'license': 'DEMO', 'allowedFields': ['metadata', 'headline', 'link'], 'checkedAt': '2026-11-10T00:00:00Z', 'note': 'DEMO only'}
        for patch in ({'visibility': 'private'}, {'visibility': 'unknown'}, {'aiAllowed': False}, {'allowedFields': ['metadata', 'link']}):
            data = dataset()
            cache = previous(data)
            cache['explanations'][0]['overview']['text'] = 'DEMO_PRIVATE_DERIVED_TEXT'
            data['observations'][0]['publication'] = {**policy, **patch}
            self.assertEqual(build_evidence(data['topics'][0], data), [])
            result = reconcile(data, cache)
            self.assertEqual(result['explanations'][0]['status'], 'unavailable')
            self.assertNotIn('DEMO_PRIVATE_DERIVED_TEXT', json.dumps(result))

    def test_removed_evidence_is_not_retained_in_stale_ai_output_for_mixed_topics(self):
        data = dataset()
        cache = previous(data)
        data['observations'] = [{**data['observations'][0], 'id': 'public-replacement', 'relatedLinks': []}]
        result = reconcile(data, cache)
        self.assertEqual(result['explanations'][0]['status'], 'unavailable')
        self.assertEqual({row['observationId'] for row in result['explanations'][0]['evidence']}, {'public-replacement'})

    def test_evidence_order_ids_and_source_rights(self):
        data = dataset()
        data['observations'].append({**data['observations'][0], 'id': 'second', 'source': 'youtube'})
        data['observations'][0]['relatedLinks'].extend([{'title': 'unsafe', 'url': 'javascript:alert(1)'}, {'title': 'permission restricted', 'url': 'https://seikatsusoken.jp/teiten/'}])
        evidence = build_evidence(data['topics'][0], data)
        self.assertEqual([row['id'] for row in evidence], ['obs-demo-observation', 'news-demo-observation-0'])
        self.assertTrue(all(row['fetchedAt'] for row in evidence))
        data['sources'][0]['enabled'] = False
        self.assertEqual(build_evidence(data['topics'][0], data), [])

    def test_fingerprint_ignores_fetch_time_but_detects_changed_headlines(self):
        data = dataset(); topic = data['topics'][0]
        evidence = build_evidence(topic, data); current = input_fingerprint(topic, evidence)
        changed = copy.deepcopy(evidence); changed[0]['fetchedAt'] = '2026-10-22T00:00:00Z'
        self.assertEqual(current, input_fingerprint(topic, changed))
        changed[1]['title'] = 'DEMO a different context'
        self.assertNotEqual(current, input_fingerprint(topic, changed))

    def test_no_provider_calls_and_real_cached_metadata_preserved(self):
        old = previous()
        def never(*args, **kwargs):
            self.fail('LLM must not be called by default')
        bundle = reconcile(dataset(), old, infer=never)
        self.assertEqual(bundle['explanations'][0]['status'], 'ready')
        self.assertEqual(bundle['explanations'][0]['provider'], 'DEMO TEST ONLY')
        self.assertEqual(bundle['explanations'][0]['generatedAt'], '2026-10-21T02:00:00Z')
        self.assertEqual(bundle['providerStatus']['provider'], 'cached')
        self.assertEqual(bundle['providerStatus']['status'], 'ready')

    def test_changed_inputs_are_stale_not_rebranded_as_new_inference(self):
        data = dataset(); old = previous(data)
        data['observations'][0]['relatedLinks'][0]['title'] = 'DEMO new research headline'
        bundle = reconcile(data, old)
        item = bundle['explanations'][0]
        self.assertEqual(item['status'], 'stale')
        self.assertEqual(item['inputHash'], old['explanations'][0]['inputHash'])
        self.assertEqual(item['evidence'], old['explanations'][0]['evidence'])
        self.assertEqual(item['overview']['text'], old['explanations'][0]['overview']['text'])
        self.assertEqual(bundle['providerStatus']['status'], 'disabled')

    def test_new_topics_remain_unavailable_without_fake_ai_text(self):
        bundle = reconcile(dataset())
        item = bundle['explanations'][0]
        self.assertEqual(item['status'], 'unavailable')
        self.assertEqual(item['provider'], 'none')
        self.assertEqual(item['generatedAt'], '')
        self.assertEqual(item['contexts'], [])
        self.assertIn('生成されていません', item['overview']['text'])

    def test_rejects_hallucinated_ids_numbers_and_unlabelled_interpretation(self):
        data = dataset(); evidence = build_evidence(data['topics'][0], data)
        for patch in [{'evidenceIds': ['invented']}, {'text': '人気が99%増えました。'}, {'kind': 'interpretation'}]:
            bad = content(); bad['overview'].update(patch)
            with self.assertRaises(ExplanationError):
                validate_content(bad, data['topics'][0], evidence)

    def test_sensitive_news_never_returns_marketing_suggestion(self):
        data = dataset(); data['topics'][0]['title'] = '地震の被害'
        evidence = build_evidence(data['topics'][0], data)
        value = content(); value['marketing'] = {'text': '広告に利用する。', 'kind': 'interpretation', 'evidenceIds': ['obs-demo-observation']}
        safe = validate_content(value, data['topics'][0], evidence)
        self.assertIsNone(safe['marketing'])
        self.assertTrue(any('停止' in item for item in safe['caveats']))

    def test_ollama_schema_prompt_and_loopback_only(self):
        data = dataset(); evidence = build_evidence(data['topics'][0], data)
        def opener(request, timeout):
            if request.full_url.endswith('/api/show'):
                return io.BytesIO(b'{"model_info":{"architecture":"DEMO"}}')
            self.assertEqual(request.full_url, 'http://127.0.0.1:11434/api/chat')
            payload = json.loads(request.data)
            self.assertEqual(payload['messages'][0]['content'], SYSTEM_PROMPT)
            self.assertFalse(payload['stream'])
            self.assertEqual(payload['format'], 'json')
            self.assertNotIn('Authorization', request.headers)
            return io.BytesIO(json.dumps({'done': True, 'message': {'content': json.dumps(content())}}).encode())
        result = call_ollama(data['topics'][0], evidence, endpoint='http://127.0.0.1:11434', model='DEMO-local-model', opener=opener)
        self.assertEqual(result['overview']['text'], content()['overview']['text'])
        with self.assertRaises(ExplanationError):
            call_ollama(data['topics'][0], evidence, endpoint='https://paid.example.org', model='DEMO')
        with self.assertRaises(ExplanationError):
            call_ollama(data['topics'][0], evidence, endpoint='http://localhost:11434', model='model:cloud')

    def test_connection_error_preserves_cache_and_reports_provider_failure(self):
        data = dataset(); old = previous(data); data['topics'][0]['title'] = 'DEMO new query'
        def fail(*args, **kwargs):
            raise ExplanationError('ローカルLLMに接続できません。')
        result = reconcile(data, old, provider='ollama', model='DEMO local model', infer=fail)
        self.assertEqual(result['providerStatus']['status'], 'error')
        self.assertEqual(result['explanations'][0]['status'], 'stale')
        self.assertEqual(result['explanations'][0]['generatedAt'], old['explanations'][0]['generatedAt'])

    def test_local_small_model_input_is_bounded_and_qwen_thinking_is_disabled(self):
        data = dataset()
        evidence = build_evidence(data['topics'][0], data)
        evidence = [{**evidence[0], 'id': f'DEMO-{i}', 'title': '長い日本語見出し' * 100} for i in range(40)]
        original = copy.deepcopy(evidence)
        supplied = inference_evidence(evidence)
        self.assertLessEqual(len(supplied), 8)
        self.assertLessEqual(len(json.dumps(supplied, ensure_ascii=False).encode()), MAX_INFERENCE_BYTES)
        self.assertEqual(supplied[-1]['id'], 'DEMO-39')
        self.assertEqual(evidence, original)
        self.assertTrue(all('url' not in row and 'fetchedAt' not in row for row in supplied))
        def opener(request, timeout):
            if request.full_url.endswith('/api/show'):
                return io.BytesIO(b'{"model_info":{"general.architecture":"qwen3"},"capabilities":["completion","thinking"]}')
            payload = json.loads(request.data)
            self.assertIs(payload['think'], False)
            self.assertEqual(payload['options']['num_ctx'], 8192)
            value = content()
            for claim in [value['overview'], *value['contexts']]:
                claim['evidenceIds'] = [supplied[-1]['id']]
            return io.BytesIO(json.dumps({'done': True, 'message': {'content': json.dumps(value)}}).encode())
        call_ollama(data['topics'][0], evidence, endpoint='http://127.0.0.1:11434', model='qwen3:4b', opener=opener)

    def test_model_cannot_cite_an_omitted_headline(self):
        data = dataset()
        evidence = build_evidence(data['topics'][0], data)
        evidence.extend([{**evidence[0], 'id': f'DEMO-newer-{i}'} for i in range(12)])
        def opener(request, timeout):
            if request.full_url.endswith('/api/show'):
                return io.BytesIO(b'{"model_info":{"architecture":"DEMO"}}')
            value = content()
            value['overview']['evidenceIds'] = [evidence[0]['id']]
            return io.BytesIO(json.dumps({'done': True, 'message': {'content': json.dumps(value)}}).encode())
        with self.assertRaises(ExplanationError):
            call_ollama(data['topics'][0], evidence, endpoint='http://127.0.0.1:11434', model='DEMO', opener=opener)

    def test_invalid_json_and_timeout_are_safe_errors(self):
        data = dataset(); evidence = build_evidence(data['topics'][0], data)
        for fake in [lambda *a, **k: io.BytesIO(b'not JSON'), lambda *a, **k: (_ for _ in ()).throw(URLError('private diagnostic secret'))]:
            with self.assertRaises(ExplanationError) as error:
                call_ollama(data['topics'][0], evidence, endpoint='http://localhost:11434', model='DEMO', opener=fake)
            self.assertNotIn('private diagnostic secret', str(error.exception))

    def test_generation_bound_limits_requests_without_fabricating_remaining_topics(self):
        data = dataset(); data['topics'].append({'id': 'extra-topic', 'title': 'DEMO other'})
        data['observations'].append({**data['observations'][0], 'id': 'other', 'topicId': 'extra-topic'})
        calls = []
        def infer(topic, evidence, **kwargs):
            calls.append(topic['id'])
            value = content()
            for item in [value['overview'], *value['contexts']]:
                item['evidenceIds'] = [evidence[0]['id']]
            return value
        result = reconcile(data, provider='ollama', model='DEMO local model', max_topics=1, infer=infer)
        self.assertEqual(calls, ['demo-topic'])
        self.assertEqual([x['status'] for x in result['explanations']], ['ready', 'unavailable'])

    def test_cache_matching_ignores_fetch_time_but_rebinds_current_provenance(self):
        data = dataset(); old = previous(data)
        data['observations'][0]['fetchedAt'] = '2026-10-22T00:00:00Z'
        item = reconcile(data, old)['explanations'][0]
        self.assertEqual(item['status'], 'ready')
        self.assertEqual(item['evidence'][0]['fetchedAt'], '2026-10-22T00:00:00Z')
        self.assertEqual(item['generatedAt'], old['explanations'][0]['generatedAt'])

    def test_cache_rejects_missing_dates_and_fingerprints(self):
        for patch in [{'generatedAt': 'not a timestamp'}, {'inputHash': 'invented'}, {'model': ''}]:
            old = previous(); old['explanations'][0].update(patch)
            self.assertEqual(reconcile(dataset(), old)['explanations'][0]['status'], 'unavailable')

    def test_medical_politics_and_gambling_stop_advertising_suggestions(self):
        for title in ['ワクチンの話題', '内乱の報道', '백신', '정치', '도박', 'lottery results']:
            data = dataset(); data['topics'][0]['title'] = title
            value = content(); value['marketing'] = {'text': '商品に結びつける仮説。', 'kind': 'interpretation', 'evidenceIds': ['obs-demo-observation']}
            result = validate_content(value, data['topics'][0], build_evidence(data['topics'][0], data))
            self.assertIsNone(result['marketing'])

    def test_cloud_alias_is_rejected_before_inference(self):
        data = dataset(); evidence = build_evidence(data['topics'][0], data)
        calls = []
        def opener(request, timeout):
            calls.append(request.full_url)
            return io.BytesIO(b'{"remote_host":"https://cloud.example.org","model_info":{"architecture":"DEMO"}}')
        with self.assertRaises(ExplanationError):
            call_ollama(data['topics'][0], evidence, endpoint='http://localhost:11434', model='innocent-looking-alias', opener=opener)
        self.assertEqual(calls, ['http://localhost:11434/api/show'])

    def test_corrupt_cache_schema_is_not_silently_overwritten(self):
        with self.assertRaises(ExplanationError):
            reconcile(dataset(), {'schemaVersion': 2, 'explanations': []})

    def test_long_running_topic_bounds_context_without_losing_canonical_observations(self):
        data = dataset()
        original = data['observations'][0]
        data['observations'] = [{**original, 'id': f'DEMO-{index:04d}', 'relatedLinks': []} for index in range(560)]
        evidence = build_evidence(data['topics'][0], data)
        self.assertEqual(len(evidence), 500)
        self.assertEqual(evidence[0]['id'], 'obs-DEMO-0060')
        bundle = reconcile(data)
        self.assertEqual(bundle['explanations'][0]['status'], 'unavailable')
        self.assertEqual(len(bundle['explanations'][0]['evidence']), 500)
        self.assertEqual(len(data['observations']), 560)


if __name__ == '__main__':
    unittest.main()
