"""Local updater tests. All DEMO data/remotes live in temporary directories."""
import copy
import io
import json
import subprocess
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch
from urllib.error import URLError

from scripts import pc_updater as updater
from scripts.generate_explanations import build_evidence, input_fingerprint, reconcile


def config():
    return {'schemaVersion': 1, 'model': 'DEMO-local:small', 'intervalHours': 6, 'maxTopics': 12, 'timeoutSeconds': 120, 'repositoryUrl': updater.DEFAULT_REPOSITORY, 'branch': 'main'}


def demo_data():
    return {
        'schemaVersion': 1, 'generatedAt': '2026-10-21T02:00:00Z',
        'topics': [{'id': 'demo', 'title': 'DEMO tea', 'category': 'DEMO category', 'aliases': [], 'observationIds': ['obs']}],
        'observations': [{'id': 'obs', 'topicId': 'demo', 'source': 'google-trends', 'sourceId': 'DEMO source id',
                          'sourceUrl': 'https://example.org/demo', 'title': 'DEMO tea recipe', 'publishedAt': '',
                          'observedAt': '2026-10-21T00:00:00Z', 'fetchedAt': '2026-10-21T01:00:00Z',
                          'regionCode': 'JP', 'regionMeaning': 'search-market', 'population': 'DEMO only',
                          'method': 'DEMO fixture', 'license': 'DEMO only', 'status': 'fresh', 'reliability': 'observed',
                          'metric': {'name': 'DEMO metric', 'value': 1, 'unit': 'DEMO count', 'normalization': 'DEMO only'}}],
        'geoObservations': [], 'sources': [{'id': 'google-trends', 'enabled': True, 'name': 'DEMO source',
                                          'kind': 'search', 'url': 'https://example.org/demo',
                                          'termsUrl': 'https://example.org/terms', 'license': 'DEMO only'}],
        'collectionRuns': [],
    }


def demo_bundle(data=None):
    data = data or demo_data()
    topic = data['topics'][0]
    evidence = build_evidence(topic, data)
    item = {'topicId': 'demo', 'inputHash': input_fingerprint(topic, evidence), 'generatedAt': '2026-10-21T02:00:00Z', 'provider': 'DEMO TEST ONLY', 'model': 'DEMO local', 'status': 'ready', 'overview': {'text': 'お茶のレシピに関する見出しです。', 'kind': 'source_summary', 'evidenceIds': ['obs-obs']}, 'contexts': [{'text': 'レシピを探す場面が考えられます。', 'kind': 'interpretation', 'evidenceIds': ['obs-obs']}], 'attention': None, 'marketing': None, 'caveats': ['DEMO TEST ONLY'], 'evidence': evidence}
    return {'schemaVersion': 1, 'generatedAt': '2026-10-21T02:00:00Z', 'explanations': [item], 'providerStatus': {'status': 'ready', 'provider': 'DEMO TEST ONLY', 'model': 'DEMO local', 'message': 'DEMO TEST ONLY', 'checkedAt': '2026-10-21T02:00:00Z'}}


def write_public(repository):
    updater.atomic_json(repository / updater.PUBLIC_FILES[0], demo_data())
    updater.atomic_json(repository / updater.PUBLIC_FILES[1], demo_bundle())


class ConfigAndSchedulingTest(unittest.TestCase):
    def test_rejects_cloud_aliases_credentials_and_unsafe_branches(self):
        for patch_value in [{'model': 'bad:cloud'}, {'model': 'bad-cloud'}, {'model': '../shell;command'}, {'repositoryUrl': 'https://secret@github.com/owner/repo.git'}, {'repositoryUrl': 'https://github.com/owner/repo.git?token=secret'}, {'repositoryUrl': 'https://other.example.org/owner/repo.git'}, {'branch': '../main'}, {'maxTopics': True}, {'intervalHours': 0}, {'timeoutSeconds': 121}]:
            with self.subTest(patch=patch_value), self.assertRaises(updater.UpdaterError):
                updater.validate_config({**config(), **patch_value})

    def test_initialize_never_overwrites_existing_settings(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'settings.json'
            self.assertEqual(updater.main(['--config', str(path), '--initialize', '--model', 'DEMO:local']), 0)
            before = path.read_bytes()
            self.assertEqual(updater.main(['--config', str(path), '--initialize', '--model', 'different']), 1)
            self.assertEqual(path.read_bytes(), before)
            self.assertEqual(set(json.loads(before)), set(config()))

    def test_watch_catches_up_after_sleep_but_respects_failure_backoff(self):
        now = datetime(2026, 10, 21, 12, tzinfo=timezone.utc).timestamp()
        self.assertTrue(updater.is_due(config(), {}, now))
        self.assertFalse(updater.is_due(config(), {'lastSuccessAt': '2026-10-21T11:00:00Z'}, now))
        self.assertFalse(updater.is_due(config(), {'lastSuccessAt': '2026-10-20T00:00:00Z', 'lastAttemptAt': '2026-10-21T11:59:00Z'}, now))
        self.assertTrue(updater.is_due(config(), {'lastSuccessAt': '2026-10-20T00:00:00Z', 'lastAttemptAt': '2026-10-21T11:40:00Z'}, now))
        self.assertFalse(updater.is_due(config(), {'state': 'partial', 'lastSuccessAt': '2026-10-21T11:00:00Z', 'lastAttemptAt': '2026-10-21T11:59:00Z'}, now))
        self.assertTrue(updater.is_due(config(), {'state': 'partial', 'lastSuccessAt': '2026-10-21T11:00:00Z', 'lastAttemptAt': '2026-10-21T11:40:00Z'}, now))

    def test_os_lock_prevents_overlap_and_releases_after_exception(self):
        with tempfile.TemporaryDirectory() as directory:
            lock = Path(directory) / 'lock'
            with updater.single_instance(lock):
                with self.assertRaises(updater.UpdaterError):
                    with updater.single_instance(lock):
                        self.fail('second process must not enter')
            with updater.single_instance(lock):
                pass

    def test_long_failed_run_waits_fifteen_minutes_after_finishing(self):
        now = datetime(2026, 10, 21, 12, tzinfo=timezone.utc).timestamp()
        state = {'state': 'partial', 'lastAttemptAt': '2026-10-21T11:30:00Z', 'lastFinishedAt': '2026-10-21T11:59:00Z'}
        self.assertFalse(updater.is_due(config(), state, now))
        self.assertTrue(updater.is_due(config(), state, now + 14 * 60))

    def test_local_model_preflight_never_calls_inference(self):
        calls = []
        def opener(request, timeout):
            calls.append(request.full_url)
            self.assertEqual(json.loads(request.data), {'model': 'DEMO local'})
            return io.BytesIO(b'{"model_info":{"architecture":"DEMO"}}')
        updater.check_model('DEMO local', opener=opener)
        self.assertEqual(calls, ['http://127.0.0.1:11434/api/show'])

    def test_local_model_preflight_rejects_cloud_alias_and_redacts_connection_error(self):
        with self.assertRaises(updater.UpdaterError):
            updater.check_model('DEMO alias', opener=lambda *args, **kwargs: io.BytesIO(b'{"remote_host":"https://cloud.example.org","model_info":{"architecture":"DEMO"}}'))
        def fail(*args, **kwargs):
            raise URLError('secret-value-private-diagnostic')
        with self.assertRaises(updater.UpdaterError) as error:
            updater.check_model('DEMO', opener=fail)
        self.assertNotIn('secret-value', str(error.exception))

    def test_subprocess_failure_does_not_expose_output_or_credentials(self):
        result = subprocess.CompletedProcess([], 1, 'private-output', 'credential-secret')
        with patch.object(updater.subprocess, 'run', return_value=result) as command:
            with self.assertRaises(updater.UpdaterError) as error:
                updater.run_command(['git', 'status'])
            self.assertNotIn('credential', str(error.exception))
            self.assertFalse(command.call_args.kwargs['shell'])
            self.assertEqual(command.call_args.kwargs['env']['GIT_TERMINAL_PROMPT'], '0')

    def test_windows_subprocesses_do_not_open_console_windows(self):
        result = subprocess.CompletedProcess([], 0, '', '')
        with patch.object(updater.sys, 'platform', 'win32'), patch.object(updater.subprocess, 'CREATE_NO_WINDOW', 0x08000000, create=True), patch.object(updater.subprocess, 'run', return_value=result) as command:
            updater.run_command(['git', 'status'])
        self.assertEqual(command.call_args.kwargs['creationflags'], 0x08000000)


class PublicValidationTest(unittest.TestCase):
    def test_unavailable_is_explicit_and_malformed_missing_data_cannot_be_published(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory)
            write_public(repository)
            bundle = reconcile(demo_data())
            updater.atomic_json(repository / updater.PUBLIC_FILES[1], bundle)
            updater.validate_public_files(repository)
            for change in [{'provider': 'Invented'}, {'inputHash': 'bad'}, {'generatedAt': '2026-10-21T02:00:00Z'}, {'contexts': [{'text': 'fake'}]}, {'caveats': []}]:
                with self.subTest(change=change):
                    bad = copy.deepcopy(bundle)
                    bad['explanations'][0].update(change)
                    updater.atomic_json(repository / updater.PUBLIC_FILES[1], bad)
                    with self.assertRaises(updater.UpdaterError):
                        updater.validate_public_files(repository)

    def test_rejects_invalid_geography_dates_and_source_relationships(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory)
            for change in [{'source': 'missing'}, {'observedAt': 'invalid date'}, {'metric': {'value': float('nan'), 'name': 'DEMO', 'unit': 'count', 'normalization': 'DEMO'}}]:
                with self.subTest(change=change):
                    data = demo_data()
                    data['observations'][0].update(change)
                    updater.atomic_json(repository / updater.PUBLIC_FILES[0], data)
                    updater.atomic_json(repository / updater.PUBLIC_FILES[1], demo_bundle(data))
                    with self.assertRaises(updater.UpdaterError):
                        updater.validate_public_files(repository)
            data = demo_data()
            geo = {'id': 'DEMO-geo', 'topicId': 'demo', 'source': 'google-trends', 'sourceUrl': 'https://example.org/demo', 'date': '2026-10-21', 'fetchedAt': '2026-10-21T00:00:00Z', 'regionCode': 'JP', 'layer': 'news-publisher', 'regionMeaning': 'search-market', 'value': 1, 'unit': 'count', 'normalization': 'DEMO', 'population': 'DEMO'}
            data['geoObservations'] = [geo]
            updater.atomic_json(repository / updater.PUBLIC_FILES[0], data)
            updater.atomic_json(repository / updater.PUBLIC_FILES[1], demo_bundle(data))
            with self.assertRaises(updater.UpdaterError):
                updater.validate_public_files(repository)

    def test_valid_cache_and_rejects_tampered_current_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory)
            write_public(repository)
            updater.validate_public_files(repository)
            bundle = demo_bundle()
            bundle['explanations'][0]['inputHash'] = 'a' * 64
            updater.atomic_json(repository / updater.PUBLIC_FILES[1], bundle)
            with self.assertRaises(updater.UpdaterError):
                updater.validate_public_files(repository)

    def test_rejects_fabricated_citation_and_missing_topic_relationship(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory)
            write_public(repository)
            bundle = demo_bundle()
            bundle['explanations'][0]['overview']['evidenceIds'] = ['invented']
            updater.atomic_json(repository / updater.PUBLIC_FILES[1], bundle)
            with self.assertRaises(updater.UpdaterError):
                updater.validate_public_files(repository)
            updater.atomic_json(repository / updater.PUBLIC_FILES[1], {'schemaVersion': 1, 'explanations': []})
            with self.assertRaises(updater.UpdaterError):
                updater.validate_public_files(repository)

    def test_reuses_newer_retained_ai_cache_and_keeps_snapshot_untouched(self):
        with tempfile.TemporaryDirectory() as directory:
            repository, retained = Path(directory) / 'current', Path(directory) / 'retained'
            write_public(repository)
            write_public(retained)
            bundle = demo_bundle()
            bundle['explanations'][0]['generatedAt'] = '2026-10-21T03:00:00Z'
            updater.atomic_json(retained / updater.PUBLIC_FILES[1], bundle)
            original = (retained / updater.PUBLIC_FILES[1]).read_bytes()
            updater.merge_retained_cache(repository, retained)
            self.assertEqual(updater.read_json(repository / updater.PUBLIC_FILES[1])['explanations'][0]['generatedAt'], '2026-10-21T03:00:00Z')
            self.assertEqual((retained / updater.PUBLIC_FILES[1]).read_bytes(), original)


class GitIsolationTest(unittest.TestCase):
    """Exercise real Git fast-forward, push race and recovery without public writes."""
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.remote = self.root / 'remote.git'
        updater.git(['init', '--bare', str(self.remote)])
        self.seed = self.root / 'seed'
        updater.git(['init', '--initial-branch=main', str(self.seed)])
        updater.git(['config', 'user.name', 'DEMO TEST'], cwd=self.seed)
        updater.git(['config', 'user.email', 'demo@example.org'], cwd=self.seed)
        write_public(self.seed)
        (self.seed / 'README.md').write_text('DEMO TEST ONLY\n')
        updater.git(['add', '.'], cwd=self.seed)
        updater.git(['commit', '-m', 'DEMO seed'], cwd=self.seed)
        updater.git(['remote', 'add', 'origin', str(self.remote)], cwd=self.seed)
        updater.git(['push', '-u', 'origin', 'main'], cwd=self.seed)
        self.config = {**config(), 'repositoryUrl': str(self.remote)}
        self.runtime = self.root / 'runtime'
        self.runtime.mkdir()

    def change_json(self, repository):
        data = updater.read_json(repository / updater.PUBLIC_FILES[0])
        data['generatedAt'] = '2026-10-21T03:00:00Z'
        updater.atomic_json(repository / updater.PUBLIC_FILES[0], data)

    def test_only_public_json_is_committed_and_pushes_without_force(self):
        repository, retained = updater.ensure_checkout(self.config, self.runtime)
        self.assertIsNone(retained)
        self.change_json(repository)
        self.assertTrue(updater.publish(repository, 'main'))
        self.assertEqual(updater.git(['show', '--format=', '--name-only', 'HEAD'], cwd=repository).stdout.strip(), updater.PUBLIC_FILES[0])
        self.assertEqual(updater.changed_paths(repository), set())
        self.assertFalse(updater.publish(repository, 'main'))

    def test_run_once_with_demo_pipeline_really_pushes_only_to_temporary_bare_git(self):
        path = self.root / 'settings.json'
        def fake_pipeline(configuration, repository, retained):
            self.change_json(repository)
            return updater.validate_public_files(repository)
        with patch.object(updater, 'load_config', return_value=self.config), patch.object(updater, 'check_model'), patch.object(updater, 'run_pipeline', side_effect=fake_pipeline):
            self.assertEqual(updater.run_once(path), 0)
        pushed = updater.git(['--git-dir', str(self.remote), 'show', 'main:' + updater.PUBLIC_FILES[0]])
        self.assertEqual(json.loads(pushed.stdout)['generatedAt'], '2026-10-21T03:00:00Z')
        state = updater.read_status(updater.runtime_dir(path))
        self.assertEqual(state['state'], 'success')
        self.assertIn('lastPushedAt', state)

    def test_unknown_user_file_is_preserved_and_never_committed(self):
        repository, _ = updater.ensure_checkout(self.config, self.runtime)
        user_file = repository / 'private-memo.txt'
        user_file.write_text('DEMO private memo')
        with self.assertRaises(updater.UpdaterError):
            updater.publish(repository, 'main')
        with self.assertRaises(updater.UpdaterError):
            updater.ensure_checkout(self.config, self.runtime)
        self.assertEqual(user_file.read_text(), 'DEMO private memo')

    def test_non_fast_forward_keeps_generated_commit_then_recovers_with_fresh_clone(self):
        repository, _ = updater.ensure_checkout(self.config, self.runtime)
        self.change_json(repository)
        (self.seed / 'README.md').write_text('DEMO simultaneous cloud update\n')
        updater.git(['add', 'README.md'], cwd=self.seed)
        updater.git(['commit', '-m', 'DEMO concurrent change'], cwd=self.seed)
        updater.git(['push', 'origin', 'main'], cwd=self.seed)
        with self.assertRaises(updater.UpdaterError):
            updater.publish(repository, 'main')
        generated_commit = updater.git(['rev-parse', 'HEAD'], cwd=repository).stdout.strip()
        fresh, retained = updater.ensure_checkout(self.config, self.runtime)
        self.assertIsNotNone(retained)
        self.assertEqual(updater.git(['rev-parse', 'HEAD'], cwd=retained).stdout.strip(), generated_commit)
        self.assertEqual(updater.read_json(retained / updater.PUBLIC_FILES[0])['generatedAt'], '2026-10-21T03:00:00Z')
        self.assertEqual((fresh / 'README.md').read_text(), 'DEMO simultaneous cloud update\n')
        self.assertEqual(updater.changed_paths(fresh), set())

    def test_code_commit_in_dedicated_clone_requires_manual_resolution(self):
        repository, _ = updater.ensure_checkout(self.config, self.runtime)
        (repository / 'README.md').write_text('DEMO user code edit')
        updater.git(['add', 'README.md'], cwd=repository)
        updater.git(['-c', 'user.name=DEMO', '-c', 'user.email=demo@example.org', 'commit', '-m', 'DEMO code'], cwd=repository)
        with self.assertRaises(updater.UpdaterError):
            updater.ensure_checkout(self.config, self.runtime)
        self.assertEqual((repository / 'README.md').read_text(), 'DEMO user code edit')


class RunStateTest(unittest.TestCase):
    def test_ai_failure_publishes_valid_data_but_returns_failure_and_retries(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'settings.json'
            updater.atomic_json(path, config())
            runtime = updater.runtime_dir(path)
            updater.atomic_json(runtime / 'status.json', {'lastSuccessAt': '2026-10-20T00:00:00Z'})
            bundle = demo_bundle()
            bundle['providerStatus']['status'] = 'error'
            with patch.object(updater, 'check_model'), patch.object(updater, 'ensure_checkout', return_value=(Path(directory), None)), patch.object(updater, 'run_pipeline', return_value=(demo_data(), bundle)), patch.object(updater, 'publish', return_value=True) as publish:
                self.assertEqual(updater.run_once(path), 1)
            publish.assert_called_once()
            state = updater.read_status(runtime)
            self.assertEqual(state['state'], 'partial')
            self.assertEqual(state['aiStatus'], 'error')
            self.assertEqual(state['lastSuccessAt'], '2026-10-20T00:00:00Z')
            self.assertIn('lastPushedAt', state)
            self.assertIn('lastDataUpdatedAt', state)
            self.assertIn('15分', state['message'])

    def test_failed_push_never_advances_success_time_or_logs_raw_error(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'settings.json'
            updater.atomic_json(path, config())
            runtime = updater.runtime_dir(path)
            updater.atomic_json(runtime / 'status.json', {'lastSuccessAt': '2026-10-20T00:00:00Z'})
            with patch.object(updater, 'check_model'), patch.object(updater, 'ensure_checkout', return_value=(Path(directory), None)), patch.object(updater, 'run_pipeline', return_value=(demo_data(), demo_bundle())), patch.object(updater, 'publish', side_effect=updater.UpdaterError('GitHubへの保存に失敗しました。')):
                self.assertEqual(updater.run_once(path), 1)
            state = updater.read_status(runtime)
            self.assertEqual(state['state'], 'error')
            self.assertEqual(state['lastSuccessAt'], '2026-10-20T00:00:00Z')
            self.assertNotIn('lastPushedAt', state)

    def test_success_records_github_push_but_does_not_claim_pages_completed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'settings.json'
            updater.atomic_json(path, config())
            with patch.object(updater, 'check_model'), patch.object(updater, 'ensure_checkout', return_value=(Path(directory), None)), patch.object(updater, 'run_pipeline', return_value=(demo_data(), demo_bundle())), patch.object(updater, 'publish', return_value=True):
                self.assertEqual(updater.run_once(path), 0)
            state = updater.read_status(updater.runtime_dir(path))
            self.assertEqual(state['state'], 'success')
            self.assertIn('lastPushedAt', state)
            self.assertIn('数分', state['message'])
            self.assertEqual(state['readyExplanations'], 1)

    def test_doctor_does_not_create_runtime_or_publish(self):
        with patch.object(updater, 'check_model') as model, patch.object(updater, 'git') as command, patch.object(updater, 'publish') as publish:
            updater.doctor(config())
        model.assert_called_once_with(config()['model'])
        self.assertEqual(command.call_count, 2)
        self.assertEqual(command.call_args.args[0][0], 'ls-remote')
        publish.assert_not_called()


if __name__ == '__main__':
    unittest.main()
