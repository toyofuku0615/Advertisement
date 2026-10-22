#!/usr/bin/env python3
"""Update CULTURE RADAR while this PC is awake, using only installed local Ollama.

No credentials or models are downloaded. The dedicated checkout and run state stay
under .local; only the two validated public JSON files are committed and pushed.
"""
from __future__ import annotations

import argparse
import contextlib
import importlib.util
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = ROOT / '.local/pc-updater.json'
DEFAULT_REPOSITORY = 'https://github.com/toyofuku0615/Advertisement.git'
PUBLIC_FILES = ('public/data/dataset.json', 'public/data/explanations.json')
MAX_JSON_BYTES = 32 * 1024 * 1024


class UpdaterError(RuntimeError):
    """Only fixed, non-secret diagnostics may be shown to the user."""


def timestamp(now: float | None = None) -> str:
    return datetime.fromtimestamp(time.time() if now is None else now, timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def read_json(path: Path) -> dict:
    if path.stat().st_size > MAX_JSON_BYTES:
        raise UpdaterError('JSONファイルがサイズ上限を超えています。')
    value = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(value, dict):
        raise UpdaterError('JSONファイルの形式を確認してください。')
    return value


def atomic_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def validate_config(value: dict) -> dict:
    required = {'schemaVersion', 'model', 'intervalHours', 'maxTopics', 'timeoutSeconds', 'repositoryUrl', 'branch'}
    if set(value) != required or value.get('schemaVersion') != 1:
        raise UpdaterError('更新設定の形式が不正です。--initialize で設定を作成してください。')
    model = value.get('model')
    if not isinstance(model, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}', model) or ':cloud' in model.lower() or model.lower().endswith('-cloud'):
        raise UpdaterError('インストール済みのローカルモデル名を指定してください。cloudモデルは使えません。')
    if isinstance(value['intervalHours'], bool) or not isinstance(value['intervalHours'], (float, int)) or not 0.25 <= value['intervalHours'] <= 168:
        raise UpdaterError('更新間隔は0.25〜168時間にしてください。')
    for key, upper in [('maxTopics', 100), ('timeoutSeconds', 120)]:
        if type(value[key]) is not int or not 1 <= value[key] <= upper:
            raise UpdaterError('生成件数またはタイムアウトの設定が範囲外です。')
    try:
        parsed = urlparse(value['repositoryUrl'])
    except (ValueError, TypeError):
        raise UpdaterError('GitHubリポジトリURLを確認してください。') from None
    if parsed.scheme != 'https' or parsed.hostname != 'github.com' or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.port or not re.fullmatch(r'/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\.git', parsed.path):
        raise UpdaterError('資格情報を含まないGitHub HTTPSリポジトリURLを指定してください。')
    branch = value['branch']
    if not isinstance(branch, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._/-]{0,99}', branch) or '..' in branch or branch.endswith(('/', '.')):
        raise UpdaterError('公開ブランチ名を確認してください。')
    return value.copy()


def load_config(path: Path) -> dict:
    try:
        return validate_config(read_json(path))
    except (OSError, ValueError, TypeError):
        raise UpdaterError('更新設定を読めません。--initialize --model モデル名 を実行してください。') from None


def runtime_dir(config_path: Path) -> Path:
    return config_path.parent / 'pc-updater'


def run_command(args: list[str], *, cwd: Path | None = None, timeout: float = 120, check: bool = True) -> subprocess.CompletedProcess:
    environment = os.environ.copy()
    # Do not prompt for a password from a login background task or log raw Git errors.
    environment.update({'GIT_TERMINAL_PROMPT': '0', 'GCM_INTERACTIVE': 'Never', 'PYTHONUTF8': '1'})
    try:
        result = subprocess.run(args, cwd=cwd, env=environment, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=timeout, shell=False,
                                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0) if sys.platform == 'win32' else 0)
    except (OSError, subprocess.TimeoutExpired):
        raise UpdaterError('処理を起動できないか、制限時間に達しました。接続と導入済みツールを確認してください。') from None
    if check and result.returncode:
        raise UpdaterError('処理が完了しませんでした。Git認証・通信・ローカルモデルの状態を確認してください。')
    return result


def git(args: list[str], *, cwd: Path | None = None, timeout: float = 120, check: bool = True) -> subprocess.CompletedProcess:
    return run_command(['git', *args], cwd=cwd, timeout=timeout, check=check)


def check_model(model: str, *, opener=urlopen) -> None:
    request = Request('http://127.0.0.1:11434/api/show', data=json.dumps({'model': model}).encode(), headers={'Content-Type': 'application/json'}, method='POST')
    try:
        with opener(request, timeout=15) as response:
            payload = response.read(256 * 1024 + 1)
        if len(payload) > 256 * 1024:
            raise UpdaterError('Ollamaのモデル情報がサイズ上限を超えています。')
        info = json.loads(payload)
        if not isinstance(info, dict) or info.get('remote_model') or info.get('remote_host') or not isinstance(info.get('model_info'), dict) or not info['model_info']:
            raise UpdaterError('クラウド転送のない、導入済みローカルモデルを確認できません。')
    except HTTPError:
        raise UpdaterError('指定したモデルを確認できません。Ollamaを起動し、モデルを導入してください。') from None
    except (URLError, OSError, ValueError):
        raise UpdaterError('Ollamaに接続できません。PC上のOllamaを起動してください。') from None


@contextlib.contextmanager
def single_instance(path: Path):
    """Native locks release automatically when the PC or updater process stops."""
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = path.open('a+b')
    locked = False
    try:
        handle.seek(0, os.SEEK_END)
        if handle.tell() == 0:
            handle.write(b'0')
            handle.flush()
        handle.seek(0)
        try:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            locked = True
        except (OSError, BlockingIOError):
            raise UpdaterError('別の更新処理が実行中です。完了を待ってください。') from None
        yield
    finally:
        if locked:
            handle.seek(0)
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        handle.close()


def log(runtime: Path, message: str) -> None:
    line = f'{timestamp()} {message}'
    try:
        print(line, flush=True)
    except (OSError, AttributeError):  # pythonw has no stdout on Windows.
        pass
    runtime.mkdir(parents=True, exist_ok=True)
    target = runtime / 'updater.log'
    if target.exists() and target.stat().st_size > 1024 * 1024:
        os.replace(target, runtime / 'updater.previous.log')
    with target.open('a', encoding='utf-8') as handle:
        handle.write(line + '\n')


def read_status(runtime: Path) -> dict:
    try:
        return read_json(runtime / 'status.json')
    except (OSError, ValueError, UpdaterError):
        return {}


def is_due(config: dict, status: dict, now: float) -> bool:
    def elapsed(key: str) -> float:
        try:
            return now - datetime.fromisoformat(status[key].replace('Z', '+00:00')).timestamp()
        except (KeyError, TypeError, ValueError):
            return float('inf')
    interval = config['intervalHours'] * 3600
    # Failed/offline attempts retry at most once every 15 minutes; no busy loop.
    needs_retry = status.get('state') in ('error', 'partial')
    backoff_key = 'lastFinishedAt' if needs_retry and status.get('lastFinishedAt') else 'lastAttemptAt'
    return (needs_retry or elapsed('lastSuccessAt') >= interval) and elapsed(backoff_key) >= min(900, interval)


def changed_paths(repository: Path) -> set[str]:
    result = git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], cwd=repository)
    entries = [entry for entry in result.stdout.split('\0') if entry]
    paths = set()
    for entry in entries:
        if len(entry) < 4 or entry[:2] not in (' M', 'M ', 'MM', '??'):
            raise UpdaterError('専用作業フォルダーに想定外の変更があります。手動の変更を保護するため停止しました。')
        paths.add(entry[3:])
    return paths


def ensure_checkout(config: dict, runtime: Path) -> tuple[Path, Path | None]:
    """Never reset, force-push, or rebase a user's work to recover a push race.

    An unpublished generated checkout is retained whole, then a fresh clone is
    used. Its valid cached explanations can be reused in the next generation.
    """
    repository = runtime / 'repository'
    retained = None
    if repository.exists():
        if not (repository / '.git').is_dir():
            raise UpdaterError('専用作業フォルダーがGitリポジトリではありません。内容を保護して停止しました。')
        origin = git(['remote', 'get-url', 'origin'], cwd=repository).stdout.strip()
        branch = git(['branch', '--show-current'], cwd=repository).stdout.strip()
        if origin != config['repositoryUrl'] or branch != config['branch']:
            raise UpdaterError('専用作業フォルダーのリポジトリまたはブランチが設定と異なります。')
        dirty = changed_paths(repository)
        if dirty - set(PUBLIC_FILES):
            raise UpdaterError('専用作業フォルダーにJSON以外の変更があります。内容を保護して停止しました。')
        git(['fetch', 'origin', config['branch']], cwd=repository, timeout=180)
        counts = git(['rev-list', '--left-right', '--count', f'HEAD...origin/{config["branch"]}'], cwd=repository).stdout.split()
        if len(counts) != 2 or not all(part.isdigit() for part in counts):
            raise UpdaterError('リポジトリの同期状態を確認できません。')
        ahead = int(counts[0])
        if ahead:
            own_changes = set(git(['diff', '--name-only', f'origin/{config["branch"]}...HEAD'], cwd=repository).stdout.splitlines())
            if own_changes - set(PUBLIC_FILES):
                raise UpdaterError('未公開のコード変更があります。内容を保護して停止しました。')
        if dirty or ahead:
            retained = runtime / ('retained-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8])
            repository.rename(retained)
        else:
            git(['pull', '--ff-only', 'origin', config['branch']], cwd=repository, timeout=180)
    if not repository.exists():
        # A failed clone is preserved for diagnosis; a later run stops rather than
        # deleting a directory whose ownership/content cannot be established.
        git(['clone', '--branch', config['branch'], '--single-branch', '--', config['repositoryUrl'], str(repository)], cwd=runtime, timeout=180)
    return repository, retained


def merge_retained_cache(repository: Path, retained: Path | None) -> None:
    if retained is None:
        return
    try:
        current = read_json(repository / PUBLIC_FILES[1])
        previous = read_json(retained / PUBLIC_FILES[1])
        if current.get('schemaVersion') != 1 or previous.get('schemaVersion') != 1:
            return
        items = {item['topicId']: item for item in current['explanations']}
        for item in previous['explanations']:
            old = items.get(item['topicId'])
            if item.get('status') in ('ready', 'stale') and (old is None or item.get('generatedAt', '') > old.get('generatedAt', '')):
                items[item['topicId']] = item
        current['explanations'] = list(items.values())
        atomic_json(repository / PUBLIC_FILES[1], current)
    except (OSError, ValueError, TypeError, KeyError):
        # The retained checkout remains intact even when its cache is unreadable.
        return


def validate_public_files(repository: Path) -> tuple[dict, dict]:
    """Check the static reader's required fields before publishing either JSON.

    Generated claims additionally use the shared evidence/citation validator.
    Missing explanations stay explicit; they may never carry fabricated output.
    """
    dataset = read_json(repository / PUBLIC_FILES[0])
    bundle = read_json(repository / PUBLIC_FILES[1])
    spec = importlib.util.spec_from_file_location('_pc_updater_explanation_validation', ROOT / 'scripts/generate_explanations.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    def require(condition: bool) -> None:
        if not condition:
            raise UpdaterError('公開データの形式・原典・参照関係を検証できません。公開を停止しました。')

    def text(value):
        return isinstance(value, str)

    def date(value):
        if not text(value) or not value:
            return False
        try:
            datetime.fromisoformat(value.replace('Z', '+00:00'))
            return True
        except ValueError:
            return False

    def number(value):
        return type(value) in (int, float) and math.isfinite(value) and value >= 0

    def identities(rows):
        require(isinstance(rows, list) and all(isinstance(row, dict) for row in rows))
        ids = [row.get('id') for row in rows]
        require(all(text(value) and value for value in ids))
        require(len(set(ids)) == len(ids))
        return set(ids)

    require(dataset.get('schemaVersion') == 1 and bundle.get('schemaVersion') == 1)
    require(date(dataset.get('generatedAt')) and date(bundle.get('generatedAt')))
    topic_ids = identities(dataset.get('topics'))
    observation_ids = identities(dataset.get('observations'))
    source_ids = identities(dataset.get('sources'))
    identities(dataset.get('geoObservations'))
    identities(dataset.get('collectionRuns'))
    for source in dataset['sources']:
        require(text(source.get('name')) and source.get('kind') in ('search', 'social', 'news', 'survey'))
        require(module.safe_url(source.get('url')) and module.safe_url(source.get('termsUrl')) and text(source.get('license')))
    for topic in dataset['topics']:
        require(text(topic.get('title')) and bool(topic['title']) and text(topic.get('category')))
        require(isinstance(topic.get('aliases'), list) and all(isinstance(alias, dict) and all(text(alias.get(key)) for key in ('id', 'text', 'language')) for alias in topic['aliases']))
        require(isinstance(topic.get('observationIds'), list) and all(text(value) and value in observation_ids for value in topic['observationIds']))
    for row in dataset['observations']:
        require(text(row.get('topicId')) and row['topicId'] in topic_ids and text(row.get('source')) and row['source'] in source_ids)
        require(all(text(row.get(key)) for key in ('title', 'sourceId', 'population', 'method', 'license')))
        require(module.safe_url(row.get('sourceUrl')) and date(row.get('observedAt')) and date(row.get('fetchedAt')) and (row.get('publishedAt') == '' or date(row.get('publishedAt'))))
        metric = row.get('metric')
        require(isinstance(metric, dict) and (metric.get('value') is None or number(metric.get('value'))) and all(text(metric.get(key)) for key in ('name', 'unit', 'normalization')))
        require((row.get('regionCode') is None or text(row['regionCode'])) and row.get('regionMeaning') in ('search-market', 'publisher-country', 'not-geolocated'))
        require(row.get('status') in ('fresh', 'stale') and row.get('reliability') == 'observed')
        require(isinstance(row.get('relatedLinks', []), list) and all(isinstance(link, dict) and text(link.get('title')) and module.safe_url(link.get('url')) for link in row.get('relatedLinks', [])))
    for row in dataset['geoObservations']:
        require(text(row.get('topicId')) and row['topicId'] in topic_ids and text(row.get('source')) and row['source'] in source_ids)
        require(module.safe_url(row.get('sourceUrl')) and date(row.get('date')) and date(row.get('fetchedAt')))
        require(text(row.get('regionCode')) and bool(re.fullmatch(r'[A-Z]{2}(?:-\d{2})?', row['regionCode'])))
        require(number(row.get('value')) and all(text(row.get(key)) for key in ('unit', 'normalization', 'population')))
        require((row.get('layer') == 'search-interest' and row.get('regionMeaning') == 'search-market' and row['value'] <= 100) or (row.get('layer') == 'news-publisher' and row.get('regionMeaning') == 'publisher-country'))
    for row in dataset['collectionRuns']:
        require(text(row.get('source')) and row['source'] in source_ids and date(row.get('startedAt')) and date(row.get('finishedAt')))
        require(row.get('status') in ('success', 'error', 'disabled') and type(row.get('count')) is int and row['count'] >= 0)
    provider = bundle.get('providerStatus')
    require(isinstance(provider, dict) and provider.get('status') in ('ready', 'disabled', 'error'))
    require(all(text(provider.get(key)) for key in ('provider', 'model', 'message')) and date(provider.get('checkedAt')))
    explanations = bundle.get('explanations')
    require(isinstance(explanations, list) and all(isinstance(item, dict) for item in explanations))
    require(len(explanations) == len(topic_ids) and all(text(item.get('topicId')) for item in explanations) and {item['topicId'] for item in explanations} == topic_ids)
    topics = {item['id']: item for item in dataset['topics']}
    for item in explanations:
        state = item.get('status')
        require(state in ('ready', 'stale', 'unavailable'))
        require(text(item.get('inputHash')) and bool(re.fullmatch(r'[0-9a-f]{64}', item['inputHash'])))
        require(text(item.get('provider')) and text(item.get('model')))
        evidence = item.get('evidence')
        require(isinstance(evidence, list))
        if evidence:
            try:
                module.validate_evidence(evidence)
            except module.ExplanationError:
                raise UpdaterError('AI解説の原典を検証できません。公開を停止しました。') from None
        if state == 'unavailable':
            overview = item.get('overview')
            require(item['provider'] == 'none' and item['model'] == '' and item.get('generatedAt') == '')
            require(isinstance(overview, dict) and text(overview.get('text')) and overview.get('evidenceIds') == [])
            require(item.get('contexts') == [] and item.get('attention') is None and item.get('marketing') is None)
            require(isinstance(item.get('caveats'), list) and bool(item['caveats']) and all(text(value) for value in item['caveats']))
            continue
        topic = topics[item['topicId']]
        try:
            module.validate_content(item, topic, evidence)
            require(module.valid_timestamp(item.get('generatedAt')) and bool(item['provider']) and bool(item['model']))
            if state == 'ready':
                require(item['inputHash'] == module.input_fingerprint(topic, module.build_evidence(topic, dataset)))
        except module.ExplanationError:
            raise UpdaterError('AI解説の根拠検証に失敗しました。公開を停止しました。') from None
    return dataset, bundle


def run_pipeline(config: dict, repository: Path, retained: Path | None) -> tuple[dict, dict]:
    run_command([sys.executable, str(repository / 'scripts/collect.py'), '--sources', 'google-trends', 'gdelt', 'youtube'], cwd=repository, timeout=900)
    run_command([sys.executable, str(repository / 'scripts/prepare_public.py')], cwd=repository)
    merge_retained_cache(repository, retained)
    run_command([sys.executable, str(repository / 'scripts/generate_explanations.py'), '--provider', 'ollama', '--model', config['model'], '--max-topics', str(config['maxTopics']), '--timeout', str(config['timeoutSeconds'])], cwd=repository, timeout=config['maxTopics'] * config['timeoutSeconds'] + 120)
    return validate_public_files(repository)


def publish(repository: Path, branch: str) -> bool:
    paths = changed_paths(repository)
    if paths - set(PUBLIC_FILES):
        raise UpdaterError('公開対象JSON以外の変更を検出しました。自動コミットを停止しました。')
    if not paths:
        return False
    git(['add', '--', *PUBLIC_FILES], cwd=repository)
    git(['-c', 'user.name=CULTURE RADAR local updater', '-c', 'user.email=culture-radar-local@users.noreply.github.com', 'commit', '-m', 'data: refresh observations and local Ollama context'], cwd=repository)
    result = git(['push', 'origin', f'HEAD:{branch}'], cwd=repository, timeout=180, check=False)
    if result.returncode:
        raise UpdaterError('GitHubへの保存に失敗しました。認証・通信または同時更新を確認してください。生成済みデータはPCに保持し、次回再試行します。')
    return True


def doctor(config: dict, *, checkout: Path | None = None) -> None:
    if shutil.which('git') is None:
        raise UpdaterError('Gitが見つかりません。GitとGitHubの認証を設定してください。')
    git(['--version'])
    check_model(config['model'])
    git(['ls-remote', '--exit-code', '--heads', config['repositoryUrl'], config['branch']], timeout=60)
    print('OllamaのローカルモデルとGitHubの読み取り接続を確認しました。')
    print('書き込み権限と公開完了は、--once による実際の更新で確認します。')


def run_once(config_path: Path, *, force: bool = True) -> int:
    runtime = runtime_dir(config_path)
    config = load_config(config_path)
    try:
        with single_instance(runtime / 'update.lock'):
            state = read_status(runtime)
            if not force and not is_due(config, state, time.time()):
                return 0
            state.update({'schemaVersion': 1, 'state': 'running', 'lastAttemptAt': timestamp(), 'message': 'PC上でデータとローカルAI解説を更新しています。'})
            atomic_json(runtime / 'status.json', state)
            log(runtime, state['message'])
            try:
                if shutil.which('git') is None:
                    raise UpdaterError('Gitが見つかりません。Gitを導入してください。')
                check_model(config['model'])
                repository, retained = ensure_checkout(config, runtime)
                if retained:
                    log(runtime, '前回の未公開データを保持し、最新の公開データを元に再試行します。')
                    state['retainedCheckout'] = retained.name
                dataset, bundle = run_pipeline(config, repository, retained)
                changed = publish(repository, config['branch'])
                ai_failed = bundle['providerStatus']['status'] == 'error'
                state.update({'state': 'partial' if ai_failed else 'success', 'lastDataUpdatedAt': timestamp(), 'message': 'データをGitHubに保存しましたが、AI解説の生成に失敗した項目があります。前回の解説と未生成表示を保持し、15分後に再試行します。' if ai_failed else ('GitHubへの保存が完了しました。公開処理には数分かかる場合があります。' if changed else '検証済みデータに公開対象の変更はありませんでした。'), 'topicCount': len(dataset['topics']), 'readyExplanations': sum(item['status'] == 'ready' for item in bundle['explanations']), 'aiStatus': bundle['providerStatus']['status']})
                if not ai_failed:
                    state['lastSuccessAt'] = timestamp()
                if changed:
                    state['lastPushedAt'] = timestamp()
                state['lastFinishedAt'] = timestamp()
                atomic_json(runtime / 'status.json', state)
                log(runtime, state['message'])
                return 1 if ai_failed else 0
            except (UpdaterError, OSError, ValueError, KeyError, TypeError) as error:
                message = str(error) if isinstance(error, UpdaterError) else '更新処理の形式・ファイルを確認できません。前回の公開データを保持しています。'
                state.update({'state': 'error', 'message': message, 'lastFinishedAt': timestamp()})
                atomic_json(runtime / 'status.json', state)
                log(runtime, message)
                return 1
    except UpdaterError as error:
        log(runtime, str(error))
        return 1


def watch(config_path: Path) -> int:
    # On wake/resume, the next poll uses elapsed wall-clock time and catches up.
    while True:
        try:
            run_once(config_path, force=False)
        except (UpdaterError, OSError, ValueError):
            log(runtime_dir(config_path), '更新設定を読めません。設定を確認すると次の確認時に再開します。')
        time.sleep(60)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, default=DEFAULT_CONFIG)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--initialize', action='store_true')
    mode.add_argument('--doctor', action='store_true')
    mode.add_argument('--once', action='store_true')
    mode.add_argument('--watch', action='store_true')
    parser.add_argument('--model')
    parser.add_argument('--interval-hours', type=float, default=6)
    parser.add_argument('--max-topics', type=int, default=12)
    args = parser.parse_args(argv)
    path = args.config.expanduser().resolve()
    try:
        if args.initialize:
            if path.exists():
                raise UpdaterError('設定ファイルが既にあります。既存設定を保護するため上書きしません。変更する場合は設定JSONを編集してください。')
            config = validate_config({'schemaVersion': 1, 'model': args.model, 'intervalHours': args.interval_hours, 'maxTopics': args.max_topics, 'timeoutSeconds': 120, 'repositoryUrl': DEFAULT_REPOSITORY, 'branch': 'main'})
            atomic_json(path, config)
            print('PC用の非公開設定を保存しました。--doctor で接続を確認してください。')
            return 0
        if args.model:
            raise UpdaterError('--model は --initialize と一緒に指定してください。')
        config = load_config(path)
        if args.doctor:
            doctor(config)
            return 0
        return watch(path) if args.watch else run_once(path)
    except KeyboardInterrupt:
        return 130
    except (UpdaterError, OSError, ValueError) as error:
        message = str(error) if isinstance(error, UpdaterError) else '設定ファイルの読み書きに失敗しました。'
        try:
            print(message, file=sys.stderr)
        except (OSError, AttributeError):
            pass
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
