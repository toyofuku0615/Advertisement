"""Source-attributed culture-window membership, independent of legacy observations.

The installed adapters reuse existing observations. They perform no extra HTTP
requests and make no claims about the demographics of a search market or a news
publisher. New feed/community adapters must explicitly implement this protocol.
"""
from __future__ import annotations

import copy
import hashlib
import ipaddress
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Protocol
from urllib.parse import parse_qsl, urlparse

UTC = timezone.utc
FUTURE_TOLERANCE = timedelta(minutes=5)
PUBLIC_FIELDS = {'metadata', 'headline', 'link', 'metrics'}
SENSITIVE_QUERY = {'key', 'api_key', 'api-key', 'apikey', 'token', 'access_token', 'access-token', 'accesstoken', 'password', 'secret', 'authorization', 'signature', 'sig', 'credential'}
WINDOW_FIELDS = {'id', 'name', 'description', 'countryCodes', 'languages', 'categories', 'sources', 'enabled', 'scopeNote'}
BINDING_FIELDS = {'id', 'source', 'adapter', 'enabled', 'endpoint', 'countryCodes', 'verification', 'publication', 'disabledReason'}
VERIFICATION_FIELDS = {'status', 'method', 'checkedAt', 'evidenceUrl', 'note'}
POLICY_FIELDS = {'visibility', 'aiAllowed', 'termsUrl', 'license', 'allowedFields', 'checkedAt', 'note'}
RESTRICTION_FIELDS = {'publicAllowed', 'aiAllowed'}
REGION_KINDS = {'search-market', 'publisher-country', 'not-geolocated'}
EVIDENCE_TYPES = {'search-trend', 'news-mention', 'community-post', 'video', 'feed-item'}
RUN_STATES = {'success', 'partial', 'empty', 'error', 'disabled'}
LANGUAGES = {'English': 'en', 'Japanese': 'ja', 'Korean': 'ko', 'French': 'fr', 'German': 'de', 'Spanish': 'es', 'Italian': 'it', 'Portuguese': 'pt', 'Chinese': 'zh', 'Thai': 'th', 'Vietnamese': 'vi', 'Indonesian': 'id', 'Malay': 'ms', 'Tagalog': 'tl', 'Dutch': 'nl'}


class WindowValidationError(ValueError):
    """A fixed diagnostic without source text, URLs, or credentials."""


def require(value: bool, message: str) -> None:
    if not value:
        raise WindowValidationError(message)


def aware_datetime(value: object) -> datetime:
    require(isinstance(value, str) and bool(value), '観測窓の日時がありません。')
    require(bool(re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})', value)), '観測窓の日時にはISO形式とタイムゾーンが必要です。')
    try:
        result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        raise WindowValidationError('観測窓の日時形式が不正です。') from None
    require(result.tzinfo is not None and result.utcoffset() is not None, '観測窓の日時にタイムゾーンが必要です。')
    return result.astimezone(UTC)


def timestamp(value: datetime) -> str:
    return value.astimezone(UTC).isoformat(timespec='seconds').replace('+00:00', 'Z')


def valid_url(value: object) -> bool:
    if not isinstance(value, str) or not value or re.search(r'[\x00-\x20\x7f\\]', value):
        return False
    try:
        parsed = urlparse(value)
        if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password:
            return False
        host = parsed.hostname.lower().rstrip('.')
        if '%' in host:
            return False
        if ':' not in host:
            host = host.encode('idna').decode('ascii').lower().rstrip('.')
        if host in ('localhost', 'localhost.localdomain') or host.endswith(('.localhost', '.local')):
            return False
        try:
            address = ipaddress.ip_address(host)
            if not address.is_global or address.is_multicast:
                return False
            if isinstance(address, ipaddress.IPv6Address) and address not in ipaddress.IPv6Network('2000::/3'):
                return False
            if isinstance(address, ipaddress.IPv4Address) and address in ipaddress.IPv4Network('192.0.0.0/24'):
                return False
        except ValueError:
            # WHATWG URLs resolve shortened/octal/hexadecimal IPv4 notation.
            # Do not let Python treat these as DNS names and publish loopback URLs.
            if '.' not in host or re.fullmatch(r'(?:[0-9]+|0x[0-9a-f]+)', host.rsplit('.', 1)[-1]):
                return False
        if parsed.port is not None and not 1 <= parsed.port <= 65535:
            return False
        return not any(key.lower() in SENSITIVE_QUERY for key, _ in parse_qsl(parsed.query))
    except (TypeError, ValueError, UnicodeError):
        return False


def text(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip()) and not re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', value)


def identifier(value: object) -> bool:
    return isinstance(value, str) and bool(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:-]{0,159}', value))


def string_list(value: object, pattern: str | None = None) -> bool:
    return isinstance(value, list) and all(text(item) and (pattern is None or re.fullmatch(pattern, item)) for item in value) and len(value) == len(set(value))


def validate_publication(policy: object) -> None:
    require(isinstance(policy, dict) and set(policy) == POLICY_FIELDS, '公開・AI利用条件に不足または未対応の項目があります。')
    require(policy.get('visibility') in ('public', 'private', 'unknown') and type(policy.get('aiAllowed')) is bool, '公開・AI利用条件の区分が不正です。')
    require(valid_url(policy.get('termsUrl')) and text(policy.get('license')) and text(policy.get('note')), '公開条件の原典・ライセンス・留意事項が不正です。')
    fields = policy.get('allowedFields')
    require(string_list(fields) and set(fields) <= PUBLIC_FIELDS, '公開可能な項目の指定が不正です。')
    require(aware_datetime(policy.get('checkedAt')) <= datetime.now(UTC) + FUTURE_TOLERANCE, '公開条件の確認日時が未来です。')


def validate_restriction(value: object, *, ledger: bool = False) -> None:
    fields = RESTRICTION_FIELDS | ({'key'} if ledger else set())
    require(isinstance(value, dict) and set(value) == fields, '公開制限の項目が不正です。')
    require(all(type(value.get(key)) is bool for key in RESTRICTION_FIELDS), '公開制限は真偽値で指定してください。')
    require(value['publicAllowed'] or not value['aiAllowed'], '非公開データをAI利用可能にできません。')
    if ledger:
        require(isinstance(value.get('key'), str) and bool(re.fullmatch(r'[0-9a-f]{64}', value['key'])), '公開制限キーが不正です。')
        require(not (value['publicAllowed'] and value['aiAllowed']), '公開制限台帳には制限だけを記録してください。')


def publication_key(record: dict) -> str:
    """Hash stable item identity; no raw URLs, source IDs or notes enter the ledger."""
    require(isinstance(record, dict) and text(record.get('source')), '公開制限の情報源IDがありません。')
    if text(record.get('sourceId')):
        identity = record['source'] + '\0' + record['sourceId']
    else:
        require('layer' in record and text(record.get('id')), '公開制限の元データIDがありません。')
        identity = 'geo\0' + record['source'] + '\0' + record['id']
    return hashlib.sha256(identity.encode('utf-8')).hexdigest()


def validate_restrictions(dataset: dict) -> None:
    if 'publicationRestrictions' not in dataset:
        return
    restrictions = dataset['publicationRestrictions']
    require(isinstance(restrictions, list), '公開制限台帳は一覧で指定してください。')
    seen = set()
    for value in restrictions:
        validate_restriction(value, ledger=True)
        require(value['key'] not in seen, '公開制限キーが重複しています。')
        seen.add(value['key'])


def publication_allowed(record: dict, for_ai: bool = False, legacy_default: bool = True) -> bool:
    """No tag means the old policy; any explicit unknown/malformed policy denies."""
    if not isinstance(record, dict):
        return False
    try:
        if 'publicationRestriction' in record:
            guard = record['publicationRestriction']
            validate_restriction(guard)
            if not guard['publicAllowed'] or (for_ai and not guard['aiAllowed']):
                return False
        if 'publication' not in record:
            return legacy_default
        policy = record['publication']
        validate_publication(policy)
        required = {'link'}
        if 'topicId' in record and ('metric' in record or 'title' in record):
            required = PUBLIC_FIELDS  # The entire canonical observation is serialized.
        elif 'topicId' in record and 'layer' in record:
            required = {'metadata', 'link', 'metrics'}
        return policy['visibility'] == 'public' and required <= set(policy['allowedFields']) and (not for_ai or (policy['aiAllowed'] and 'headline' in policy['allowedFields']))
    except (WindowValidationError, TypeError, KeyError):
        return False


def validate_config(value: object) -> list[dict]:
    require(isinstance(value, dict) and set(value) == {'schemaVersion', 'windows'} and value.get('schemaVersion') == 1 and isinstance(value.get('windows'), list), '観測窓設定のバージョン・一覧が不正です。')
    seen = set()
    for window in value['windows']:
        require(isinstance(window, dict) and set(window) == WINDOW_FIELDS and identifier(window.get('id')) and window['id'] not in seen, '観測窓の項目・IDが不正または重複しています。')
        seen.add(window['id'])
        require(all(text(window.get(key)) for key in ('name', 'description', 'scopeNote')) and type(window.get('enabled')) is bool, '観測窓の説明・有効状態が不正です。')
        require(string_list(window.get('countryCodes'), r'[A-Z]{2}') and string_list(window.get('languages'), r'[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*') and string_list(window.get('categories')), '観測窓の国・言語・カテゴリーが不正です。')
        require(isinstance(window.get('sources'), list), '観測窓の情報源一覧がありません。')
        binding_ids = set()
        for binding in window['sources']:
            require(isinstance(binding, dict) and set(binding) == BINDING_FIELDS and identifier(binding.get('id')) and binding['id'] not in binding_ids, '観測窓の情報源の項目・IDが不正または重複しています。')
            binding_ids.add(binding['id'])
            require(identifier(binding.get('source')) and identifier(binding.get('adapter')) and type(binding.get('enabled')) is bool and valid_url(binding.get('endpoint')), '観測窓の情報源・adapter・URLが不正です。')
            require(string_list(binding.get('countryCodes'), r'[A-Z]{2}') and (binding.get('disabledReason') is None or text(binding['disabledReason'])), '情報源の対象国・停止理由が不正です。')
            require(set(binding['countryCodes']) <= set(window['countryCodes']), '情報源の対象国が観測窓の範囲外です。')
            verification = binding.get('verification')
            require(isinstance(verification, dict) and set(verification) == VERIFICATION_FIELDS and verification.get('status') in ('verified', 'unverified', 'failed') and text(verification.get('note')), '情報源の取得確認情報が不正です。')
            require(verification.get('method') in ('recorded-collection', 'live-fetch', None), '情報源の確認方法が不正です。')
            if verification.get('checkedAt') is not None:
                checked = aware_datetime(verification['checkedAt'])
                require(checked <= datetime.now(UTC) + FUTURE_TOLERANCE, '情報源の確認日時が未来です。')
            require(verification.get('evidenceUrl') is None or valid_url(verification['evidenceUrl']), '情報源の確認原典URLが不正です。')
            validate_publication(binding.get('publication'))
            if binding['enabled']:
                require(verification['status'] == 'verified' and verification.get('checkedAt') is not None and verification.get('method') is not None and valid_url(verification.get('evidenceUrl')), '未検証の情報源を有効化できません。')
                require(publication_allowed(binding, legacy_default=False), '公開不可・権利不明の情報源を有効化できません。')
            else:
                require(text(binding.get('disabledReason')), '停止した情報源には理由が必要です。')
    return copy.deepcopy(value['windows'])


def load_windows(path: Path | str) -> list[dict]:
    try:
        value = json.loads(Path(path).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        raise WindowValidationError('観測窓設定を読み込めません。') from None
    return validate_config(value)


class SourceAdapter(Protocol):
    source: str
    evidence_type: str
    region_kind: str

    def observations(self, dataset: dict, binding: dict) -> list[dict]: ...


class LegacyObservationAdapter:
    def __init__(self, source: str, evidence_type: str, region_kind: str):
        self.source, self.evidence_type, self.region_kind = source, evidence_type, region_kind

    def observations(self, dataset: dict, binding: dict) -> list[dict]:
        return [row for row in dataset.get('observations', []) if row.get('source') == self.source and (not binding['countryCodes'] or row.get('regionCode') in binding['countryCodes'])]


class AdapterRegistry:
    def __init__(self):
        self._adapters: dict[str, SourceAdapter] = {}

    def register(self, name: str, adapter: SourceAdapter) -> None:
        require(identifier(name) and name not in self._adapters, 'adapter名が不正または登録済みです。')
        self._adapters[name] = adapter

    def get(self, name: str) -> SourceAdapter | None:
        return self._adapters.get(name)


ADAPTERS = AdapterRegistry()
ADAPTERS.register('legacy-google-trends', LegacyObservationAdapter('google-trends', 'search-trend', 'search-market'))
ADAPTERS.register('legacy-gdelt', LegacyObservationAdapter('gdelt', 'news-mention', 'publisher-country'))


def normalized_language(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    return LANGUAGES.get(value) or (value if re.fullmatch(r'[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*', value) else None)


def make_observation(window: dict, binding: dict, adapter: SourceAdapter, row: dict, now: datetime) -> dict:
    require(all(text(row.get(key)) for key in ('id', 'sourceId', 'source')) and valid_url(row.get('sourceUrl')), '観測のID・情報源・原典URLが不正です。')
    observed, fetched = aware_datetime(row.get('observedAt')), aware_datetime(row.get('fetchedAt'))
    published = row.get('publishedAt') or None
    require(observed <= fetched + FUTURE_TOLERANCE and fetched <= now + FUTURE_TOLERANCE, '観測日時と取得日時の順序が不正です。')
    if published is not None:
        require(aware_datetime(published) <= fetched + FUTURE_TOLERANCE, '公開日時が取得日時より未来です。')
    require(row.get('regionMeaning') == adapter.region_kind and row.get('status') in ('fresh', 'stale'), '観測地域の意味・更新状態が不正です。')
    region = row.get('regionCode')
    require(region is None or (isinstance(region, str) and re.fullmatch(r'[A-Z]{2}', region)), '観測地域コードが不正です。')
    key = '\0'.join((window['id'], row['source'], row['sourceId'], observed.isoformat()))
    policy = copy.deepcopy(binding['publication'])
    if 'publication' in row:
        policy['aiAllowed'] = policy['aiAllowed'] and row['publication']['aiAllowed']
        policy['allowedFields'] = [field for field in policy['allowedFields'] if field in row['publication']['allowedFields']]
    if 'publicationRestriction' in row:
        policy['aiAllowed'] = policy['aiAllowed'] and row['publicationRestriction']['aiAllowed']
    return {'id': 'window-observation-' + hashlib.sha256(key.encode()).hexdigest()[:24], 'windowId': window['id'], 'sourceBindingId': binding['id'], 'observationId': row['id'], 'source': row['source'], 'sourceItemId': row['sourceId'], 'sourceUrl': row['sourceUrl'], 'publishedAt': published, 'observedAt': row['observedAt'], 'fetchedAt': row['fetchedAt'], 'language': normalized_language(row.get('language')), 'regionScope': {'kind': adapter.region_kind, 'countryCodes': [region] if region else []}, 'evidenceType': adapter.evidence_type, 'publication': policy, 'status': row['status']}


def source_failed(dataset: dict, binding: dict) -> bool:
    runs = [row for row in dataset.get('collectionRuns', []) if row.get('source') == binding['source'] and (row.get('regionCode') is None or not binding['countryCodes'] or row.get('regionCode') in binding['countryCodes'])]
    latest = {}
    for row in runs:
        key = (row.get('regionCode'), row.get('scope'))
        if key not in latest or row.get('finishedAt', '') > latest[key].get('finishedAt', ''):
            latest[key] = row
    return any(row.get('status') == 'error' for row in latest.values())


def attach_windows(dataset: dict, windows: list[dict], now: datetime | None = None, registry: AdapterRegistry = ADAPTERS) -> dict:
    windows = validate_config({'schemaVersion': 1, 'windows': windows})
    now = now or datetime.now(UTC)
    require(now.tzinfo is not None, '観測窓処理の日時にタイムゾーンが必要です。')
    result, memberships, runs = copy.deepcopy(dataset), {}, []
    for window in windows:
        for binding in window['sources']:
            run = {'id': 'window-run-' + hashlib.sha256(f"{window['id']}\0{binding['id']}\0{timestamp(now)}".encode()).hexdigest()[:24], 'windowId': window['id'], 'sourceBindingId': binding['id'], 'source': binding['source'], 'adapter': binding['adapter'], 'startedAt': timestamp(now), 'finishedAt': timestamp(now), 'status': 'empty', 'count': 0, 'retainedCount': 0, 'method': 'existing-observation-projection'}
            adapter = registry.get(binding['adapter'])
            if not window['enabled'] or not binding['enabled'] or not publication_allowed(binding, legacy_default=False):
                run.update(status='disabled', error='観測窓・情報源が停止中、または公開許可がありません。')
            elif adapter is None or adapter.source != binding['source']:
                run.update(status='disabled', error='このsource adapterは未実装です。取得済みとは扱いません。')
            else:
                invalid, matched = 0, {}
                selection = {**binding, 'countryCodes': binding['countryCodes'] or window['countryCodes']}
                try:
                    for row in adapter.observations(dataset, selection):
                        if not publication_allowed(row):
                            continue
                        try:
                            observation = make_observation(window, binding, adapter, row, now)
                            old = matched.get(observation['id'])
                            if old is None or aware_datetime(observation['fetchedAt']) > aware_datetime(old['fetchedAt']):
                                matched[observation['id']] = observation
                        except (WindowValidationError, KeyError, TypeError):
                            invalid += 1
                    failed = source_failed(dataset, selection)
                    if failed:
                        for observation in matched.values():
                            observation['status'] = 'stale'
                    retained = sum(row['status'] == 'stale' for row in matched.values())
                    run.update(count=len(matched) - retained, retainedCount=retained, status=('partial' if matched else 'error') if failed or invalid else ('success' if matched else 'empty'))
                    if failed or invalid:
                        run['error'] = '情報源の一部取得失敗または不正な観測があります。保持済みデータと新規取得を区別します。'
                    for key, observation in matched.items():
                        old = memberships.get(key)
                        if old is None or aware_datetime(observation['fetchedAt']) > aware_datetime(old['fetchedAt']):
                            memberships[key] = observation
                except (WindowValidationError, KeyError, TypeError, ValueError, OSError, RuntimeError):
                    run.update(status='error', count=0, retainedCount=0, error='source adapterの処理に失敗しました。他の観測窓は継続します。')
            runs.append(run)
    result.update(cultureWindows=windows, windowObservations=sorted(memberships.values(), key=lambda row: row['id']), windowCollectionRuns=runs)
    validate_window_data(result)
    return result


def validate_window_data(dataset: dict) -> None:
    """Validate only the optional extension; schemaVersion1 legacy files remain valid."""
    validate_restrictions(dataset)
    if not any(key in dataset for key in ('cultureWindows', 'windowObservations', 'windowCollectionRuns')):
        return
    require(all(key in dataset for key in ('cultureWindows', 'windowObservations', 'windowCollectionRuns')), '観測窓データの一部が欠けています。')
    windows = validate_config({'schemaVersion': 1, 'windows': dataset['cultureWindows']})
    window_map = {row['id']: row for row in windows}
    observations = {row['id']: row for row in dataset.get('observations', [])}
    require(isinstance(dataset['windowObservations'], list) and isinstance(dataset['windowCollectionRuns'], list), '観測窓の観測・実行履歴が一覧ではありません。')
    seen, keys = set(), set()
    for row in dataset['windowObservations']:
        require(isinstance(row, dict) and identifier(row.get('id')) and row['id'] not in seen, '観測窓の観測IDが不正または重複しています。')
        seen.add(row['id'])
        require(identifier(row.get('windowId')) and text(row.get('observationId')), '観測窓・原観測の参照IDが不正です。')
        window = window_map.get(row['windowId'])
        canonical = observations.get(row['observationId'])
        require(window is not None and canonical is not None and window['enabled'], '観測窓・原観測への参照がありません。')
        binding = next((item for item in window['sources'] if item['id'] == row.get('sourceBindingId')), None)
        require(binding is not None and binding['enabled'] and publication_allowed(binding, legacy_default=False) and publication_allowed(canonical), '観測窓の所属元・公開状態が不正です。')
        require((not window['countryCodes'] or canonical.get('regionCode') in window['countryCodes']) and (not binding['countryCodes'] or canonical.get('regionCode') in binding['countryCodes']), '原観測の地域が観測窓・情報源の対象外です。')
        require(row.get('source') == canonical.get('source') == binding['source'] and row.get('sourceItemId') == canonical.get('sourceId') and row.get('sourceUrl') == canonical.get('sourceUrl') and valid_url(row.get('sourceUrl')), '原観測と観測窓の情報源が一致しません。')
        require(row.get('publishedAt') == (canonical.get('publishedAt') or None) and row.get('observedAt') == canonical.get('observedAt') and row.get('fetchedAt') == canonical.get('fetchedAt'), '原観測と観測窓の日時が一致しません。')
        observed, fetched = aware_datetime(row['observedAt']), aware_datetime(row['fetchedAt'])
        require(observed <= fetched + FUTURE_TOLERANCE, '観測・取得日時の順序が不正です。')
        if row['publishedAt'] is not None:
            require(aware_datetime(row['publishedAt']) <= fetched + FUTURE_TOLERANCE, '公開・取得日時の順序が不正です。')
        require(row.get('language') is None or (isinstance(row['language'], str) and re.fullmatch(r'[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*', row['language'])), '観測言語が不正です。')
        require(row.get('language') == normalized_language(canonical.get('language')), '観測言語は原典メタデータから指定してください。')
        scope = row.get('regionScope')
        require(isinstance(scope, dict) and scope.get('kind') in REGION_KINDS and scope['kind'] == canonical.get('regionMeaning') and scope.get('countryCodes') == ([canonical['regionCode']] if canonical.get('regionCode') else []), '観測地域の意味が原典と一致しません。')
        require(row.get('evidenceType') in EVIDENCE_TYPES and row.get('status') in ('fresh', 'stale') and publication_allowed(row, legacy_default=False), '観測の根拠区分・公開状態が不正です。')
        expected_type = {'google-trends': 'search-trend', 'gdelt': 'news-mention'}.get(row['source'])
        require(expected_type is None or row['evidenceType'] == expected_type, '検索・ニュースの観測をコミュニティ投稿と混同できません。')
        require(canonical.get('status') != 'stale' or row['status'] == 'stale', '古い原観測を新しい観測として表示できません。')
        policy = row['publication']
        require(set(policy['allowedFields']) <= set(binding['publication']['allowedFields']) and (not policy['aiAllowed'] or binding['publication']['aiAllowed']), '観測窓の公開・AI条件を情報源の許可より拡張できません。')
        require(policy['termsUrl'] == binding['publication']['termsUrl'] and policy['license'] == binding['publication']['license'], '観測窓の公開条件の原典が情報源と一致しません。')
        if 'publication' in canonical:
            canonical_policy = canonical['publication']
            require(set(policy['allowedFields']) <= set(canonical_policy['allowedFields']) and (not policy['aiAllowed'] or canonical_policy['aiAllowed']), '観測窓の公開・AI条件を原観測の許可より拡張できません。')
        if 'publicationRestriction' in canonical:
            require(not policy['aiAllowed'] or canonical['publicationRestriction']['aiAllowed'], '観測窓のAI条件を原観測の永続制限より拡張できません。')
        key = (row['windowId'], row['source'], row['sourceItemId'], observed)
        require(key not in keys, '同じ観測が観測窓に二重登録されています。')
        keys.add(key)
    seen = set()
    for run in dataset['windowCollectionRuns']:
        require(isinstance(run, dict) and identifier(run.get('id')) and run['id'] not in seen, '観測窓の実行履歴IDが不正または重複しています。')
        seen.add(run['id'])
        require(identifier(run.get('windowId')), '実行履歴の観測窓IDが不正です。')
        window = window_map.get(run['windowId'])
        require(window is not None, '実行履歴の観測窓がありません。')
        binding = next((item for item in window['sources'] if item['id'] == run.get('sourceBindingId')), None)
        require(binding is not None and run.get('source') == binding['source'] and run.get('adapter') == binding['adapter'], '実行履歴の情報源が一致しません。')
        require(aware_datetime(run.get('startedAt')) <= aware_datetime(run.get('finishedAt')), '実行履歴の開始・終了日時が不正です。')
        require(run.get('status') in RUN_STATES and all(type(run.get(key)) is int and run[key] >= 0 for key in ('count', 'retainedCount')) and run.get('method') == 'existing-observation-projection', '実行履歴の状態・件数・取得方法が不正です。')
        require(run.get('error') is None or text(run['error']), '実行履歴のエラー説明が不正です。')
