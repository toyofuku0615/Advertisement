#!/usr/bin/env python3
"""Prepare an explicitly limited, source-attributed dataset for public hosting.

Bluesky is opt-in for local collection until operator email/takedown handling exists.
This script never invents observations and leaves the local collectors available.
"""
import argparse
import copy
import json
from datetime import datetime, timezone
from pathlib import Path

if __package__:
    from .culture_windows import publication_allowed, publication_key, validate_restriction
    from .generate_explanations import reconcile
else:
    from culture_windows import publication_allowed, publication_key, validate_restriction
    from generate_explanations import reconcile


def preserve_publication_restrictions(data):
    """Keep item-level denials after removing the corresponding private row.

    A later legacy RSS/API refresh has no reviewed item policy. Only a hash of
    source plus sourceItemId and two deny flags survive, never private content,
    raw IDs, source URLs, or review notes. Publication does not clear a denial.
    """
    rules = {}

    def restrict(key, public_allowed, ai_allowed):
        old = rules.get(key, {'publicAllowed': True, 'aiAllowed': True})
        public_allowed = old['publicAllowed'] and public_allowed
        ai_allowed = old['aiAllowed'] and ai_allowed and public_allowed
        if not public_allowed or not ai_allowed:
            rules[key] = {'key': key, 'publicAllowed': public_allowed, 'aiAllowed': ai_allowed}

    raw_rules = data.get('publicationRestrictions', [])
    if not isinstance(raw_rules, list):
        raise ValueError('公開制限の台帳形式が不正です。')
    for rule in raw_rules:
        validate_restriction(rule, ledger=True)
        restrict(rule['key'], rule['publicAllowed'], rule['aiAllowed'])

    records = [*data['observations'], *data['geoObservations']]

    def item_key(row):
        try:
            return publication_key(row)
        except (ValueError, TypeError, KeyError):
            return None

    for row in records:
        key = item_key(row)
        if key is None:
            # Old permissive helper fixtures have no stable source ID. They are
            # still filtered below; a malformed identity cannot create a ledger.
            continue
        if key in rules:
            row['publicationRestriction'] = {name: rules[key][name] for name in ('publicAllowed', 'aiAllowed')}
        if 'publication' in row or 'publicationRestriction' in row:
            allowed = publication_allowed(row)
            restrict(key, allowed, allowed and publication_allowed(row, for_ai=True))

    # All copies of one source item receive the strictest reviewed denial,
    # independently of observation ordering or changing observation timestamps.
    for row in records:
        key = item_key(row)
        if key in rules:
            row['publicationRestriction'] = {name: rules[key][name] for name in ('publicAllowed', 'aiAllowed')}
    if rules:
        data['publicationRestrictions'] = [rules[key] for key in sorted(rules)]
    else:
        data.pop('publicationRestrictions', None)


def prepare_public(data):
    result = copy.deepcopy(data)
    preserve_publication_restrictions(result)
    denied = [row for row in result['observations'] if row['source'] == 'bluesky' or not publication_allowed(row)]
    # An aggregate with unspecified members cannot safely retain a private
    # observation's contribution. Drop its topic/source aggregate conservatively.
    denied_groups = {(row['topicId'], row['source']) for row in denied}
    result['observations'] = [row for row in result['observations'] if row['source'] != 'bluesky' and publication_allowed(row)]
    result['geoObservations'] = [row for row in result['geoObservations'] if row['source'] != 'bluesky' and publication_allowed(row) and (row['topicId'], row['source']) not in denied_groups]
    observations = {row['id']: row for row in result['observations']}
    topics = {row['topicId'] for row in [*result['observations'], *result['geoObservations']]}
    result['topics'] = [row for row in result['topics'] if row['id'] in topics]
    for row in result['topics']:
        row['observationIds'] = [oid for oid in row['observationIds'] if oid in observations]
    for source in result['sources']:
        if source['id'] == 'bluesky':
            source['enabled'] = False
            source['metricDescription'] = '公開版では未有効化。運用者の連絡先・削除窓口の整備後に再開。原典URLの手動保存は利用可能。'
    result['collectionRuns'] = [row for row in result['collectionRuns'] if row['source'] != 'bluesky']
    now = datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
    result['collectionRuns'].insert(0, {'id': 'bluesky-public-disabled', 'source': 'bluesky', 'scope': 'public', 'regionCode': None, 'startedAt': now, 'finishedAt': now, 'status': 'disabled', 'count': 0, 'error': '公開版では運用者の連絡先・削除窓口の整備前のため無効。原典URLの手動保存を利用できます。'})
    if any(key in result for key in ('cultureWindows', 'windowObservations', 'windowCollectionRuns')):
        # Window membership does not own the canonical record's rights. An
        # unpublished/disabled window loses its links, not independently public
        # observations that happen to belong to it.
        windows = result.get('cultureWindows', [])
        allowed_bindings = {}
        active_bindings = set()
        for window in windows:
            window['sources'] = [binding for binding in window.get('sources', []) if publication_allowed(binding, legacy_default=False)]
            for binding in window['sources']:
                if binding.get('source') == 'bluesky':
                    binding['enabled'] = False
                    binding['disabledReason'] = '公開版では運用者の連絡先・削除窓口の整備前のため無効。'
                key = (window.get('id'), binding.get('id'))
                allowed_bindings[key] = binding
                if window.get('enabled') is True and binding.get('enabled') is True and binding.get('source') != 'bluesky':
                    active_bindings.add(key)
        result['cultureWindows'] = windows
        result['windowObservations'] = [row for row in result.get('windowObservations', []) if row.get('observationId') in observations and (row.get('windowId'), row.get('sourceBindingId')) in active_bindings and publication_allowed(row, legacy_default=False)]
        # Counts/errors from a non-public binding are not public evidence either.
        result['windowCollectionRuns'] = [row for row in result.get('windowCollectionRuns', []) if (row.get('windowId'), row.get('sourceBindingId')) in allowed_bindings]
        for run in result['windowCollectionRuns']:
            if (run['windowId'], run['sourceBindingId']) not in active_bindings:
                run.update({'status': 'disabled', 'count': 0, 'retainedCount': 0})
                continue
            links = [row for row in result['windowObservations'] if row['windowId'] == run['windowId'] and row.get('sourceBindingId') == run['sourceBindingId']]
            run['count'] = min(run.get('count', 0), len(links))
            run['retainedCount'] = min(run.get('retainedCount', 0), len(links))
    return result


def sanitize_explanations(bundle, public_data):
    """Reconcile with public/AI-allowed evidence without invoking any model.

    reconcile removes a complete cached explanation if any referenced record was
    removed or lost AI permission. Keeping a stale copy would leak derived text.
    Missing topics receive an explicit unavailable entry, never invented claims.
    """
    return reconcile(public_data, bundle)


def atomic_json(target, value):
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(target.name + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(target)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=Path('public/data/dataset.json'))
    parser.add_argument('--output', type=Path)
    parser.add_argument('--explanations', type=Path, help='Input cache; defaults to explanations.json beside the dataset, if present')
    parser.add_argument('--explanations-output', type=Path, help='Defaults beside the output dataset')
    args = parser.parse_args()
    data = json.loads(args.input.read_text(encoding='utf-8'))
    result = prepare_public(data)
    target = args.output or args.input
    cache_path = args.explanations or args.input.parent / 'explanations.json'
    if args.explanations and not cache_path.is_file():
        parser.error('Specified AI cache does not exist; no public files were replaced')
    cleaned_cache = None
    if cache_path.exists():
        cleaned_cache = sanitize_explanations(json.loads(cache_path.read_text(encoding='utf-8')), result)
    # Sanitize both in memory before writing either; malformed caches fail closed.
    # If interrupted after replacing the cache, only already-filtered evidence is
    # public. The reverse order could expose an older restricted AI explanation.
    if cleaned_cache is not None:
        cache_target = args.explanations_output or target.parent / 'explanations.json'
        atomic_json(cache_target, cleaned_cache)
    atomic_json(target, result)
    print(f'Public dataset: {len(result["topics"])} topics, {len(result["observations"])} observations, {len(result["geoObservations"])} regional observations')


if __name__ == '__main__':
    main()
