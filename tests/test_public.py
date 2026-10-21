import unittest
from scripts.prepare_public import prepare_public


class PublicPreparationTest(unittest.TestCase):
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


if __name__ == '__main__':
    unittest.main()
