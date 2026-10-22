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


def prepare_public(data):
    result = copy.deepcopy(data)
    result['observations'] = [row for row in result['observations'] if row['source'] != 'bluesky']
    result['geoObservations'] = [row for row in result['geoObservations'] if row['source'] != 'bluesky']
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
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=Path('public/data/dataset.json'))
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    data = json.loads(args.input.read_text(encoding='utf-8'))
    result = prepare_public(data)
    target = args.output or args.input
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Public dataset: {len(result["topics"])} topics, {len(result["observations"])} observations, {len(result["geoObservations"])} regional observations')


if __name__ == '__main__':
    main()
