"""Synthetic parser fixtures are tests only; never shipped in production data."""
import io
import json
import socket
import unittest
from datetime import datetime, timezone
from email.message import Message
from urllib.error import HTTPError, URLError
from unittest.mock import Mock

from scripts.collect import (
    ARCHIVE_NORMALIZATION, CollectionError, empty_dataset, fetch_bytes, merge_dataset,
    parse_archive, parse_bluesky, parse_bluesky_author, parse_datetime, parse_gdelt, parse_traffic, parse_trends,
    parse_youtube, safe_url, timestamp, topic_key, verify_archive,
)

NOW = "2026-10-21T09:00:00Z"
RSS = b'''<rss xmlns:ht="https://trends.google.com/trending/rss"><channel><item>
<title>Test-only matcha</title><link>https://trends.google.com/trending?geo=JP</link>
<pubDate>Wed, 21 Oct 2026 14:00:00 +0900</pubDate><ht:approx_traffic>20K+</ht:approx_traffic>
<ht:news_item><ht:news_item_title>Test news</ht:news_item_title><ht:news_item_url>https://example.org/test-only</ht:news_item_url></ht:news_item>
</item></channel></rss>'''


class ParserTests(unittest.TestCase):
    def test_rss_country_date_and_lower_bound(self):
        topics, rows, geos = parse_trends(RSS, "JP", NOW)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["publishedAt"], "2026-10-21T05:00:00Z")
        self.assertEqual(rows[0]["regionCode"], "JP")
        self.assertEqual(rows[0]["regionMeaning"], "search-market")
        self.assertEqual(rows[0]["metric"]["value"], 20000)
        self.assertEqual(rows[0]["metric"]["unit"], "searches-lower-bound")
        self.assertEqual(rows[0]["relatedLinks"][0]["url"], "https://example.org/test-only")
        self.assertEqual(geos, [])  # RSS is NOT arbitrary-keyword regional interest.

    def test_rss_missing_values_and_invalid_dates(self):
        _, rows, _ = parse_trends(RSS.replace(b"20K+", b"unknown"), "US", NOW)
        self.assertIsNone(rows[0]["metric"]["value"])
        _, rows, _ = parse_trends(RSS.replace(b"Wed, 21 Oct 2026 14:00:00 +0900", b"bad date"), "JP", NOW)
        self.assertEqual(rows, [])

    def test_schema_change_not_silent_empty(self):
        for operation in [lambda: parse_trends(b"<html>oops</html>", "JP", NOW), lambda: parse_bluesky({"changed": []}, "test", NOW), lambda: parse_gdelt({"changed": []}, "test", NOW), lambda: parse_youtube({"changed": []}, "JP", NOW)]:
            with self.assertRaises(CollectionError):
                operation()

    def test_bluesky_no_invented_demographics_or_geolocation(self):
        payload = {"posts": [{"uri": "at://did:plc:test/app.bsky.feed.post/abc123", "author": {"handle": "test-only.bsky.social"}, "record": {"text": "Test only", "createdAt": "2026-10-20T23:30:00-04:00"}, "likeCount": 3}]}
        _, rows, geo = parse_bluesky(payload, "test-only", NOW)
        self.assertEqual(rows[0]["publishedAt"], "2026-10-21T03:30:00Z")
        self.assertEqual(rows[0]["metric"]["value"], 3)
        self.assertIsNone(rows[0]["regionCode"])
        self.assertEqual(rows[0]["regionMeaning"], "not-geolocated")
        self.assertEqual(geo, [])

    def test_gdelt_country_is_publisher_not_event_and_dedup(self):
        article = {"title": "Test-only news about Japan", "url": "https://example.org/test-only", "sourcecountry": "United States", "language": "Japanese", "seendate": "20261021T013000Z"}
        _, rows, geo = parse_gdelt({"articles": [article, article]}, "test-only", NOW)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["regionCode"], "US")
        self.assertEqual(rows[0]["regionMeaning"], "publisher-country")
        self.assertEqual(rows[0]["language"], "Japanese")
        self.assertEqual(rows[0]["publishedAt"], "")
        self.assertEqual(geo[0]["regionCode"], "US")
        self.assertEqual(geo[0]["layer"], "news-publisher")
        self.assertEqual(geo[0]["value"], 1)

    def test_unknown_publisher_country_remains_unmapped(self):
        _, rows, geo = parse_gdelt({"articles": [{"title": "Test only", "url": "https://example.org/t", "sourcecountry": "Unknown place", "seendate": "20261021T013000Z"}]}, "test-only", NOW)
        self.assertIsNone(rows[0]["regionCode"])
        self.assertEqual(geo, [])

    def test_author_feed_is_not_described_as_search_or_popularity(self):
        post = {"uri": "at://did:plc:test/app.bsky.feed.post/abc123", "author": {"handle": "test-only.bsky.social"}, "record": {"text": "Test only", "createdAt": NOW}, "likeCount": 3}
        topics, rows, _ = parse_bluesky_author({"feed": [{"post": post}]}, "test-only.bsky.social", NOW)
        self.assertIn("編集指定", rows[0]["population"])
        self.assertIn("getAuthorFeed", rows[0]["method"])
        self.assertIsNone(rows[0]["regionCode"])

    def test_invalid_origin_is_rejected(self):
        self.assertIsNone(safe_url("javascript:alert(1)"))
        self.assertIsNone(safe_url("https://user:secret@example.org"))
        self.assertIsNotNone(safe_url("https://example.org/test"))

    def test_no_automatic_multilingual_merge(self):
        self.assertNotEqual(topic_key("matcha"), topic_key("抹茶"))
        self.assertEqual(topic_key("MATCHA"), topic_key("matcha"))

    def test_traffic_and_timezone_validation(self):
        self.assertEqual(parse_traffic("1.5M+"), 1_500_000)
        self.assertIsNone(parse_traffic("unknown"))
        with self.assertRaises(ValueError):
            parse_datetime("2026-10-21T05:00:00")

    def test_archive_genuine_shape_zero_is_not_missing_as_zero(self):
        raw = b",topic,country,index_trends,year,country_code\n1,Plastic pollution,Japan,48.2,2022,jp\n2,Plastic pollution,Japan,0,2023,jp\n3,Low-emission vehicle,United States,100,2023,us\n"
        topics, rows, geo, selected = parse_archive(raw, NOW)
        self.assertEqual(len(topics), 2)
        self.assertEqual(len(geo), 2)
        self.assertEqual(geo[0]["normalization"], ARCHIVE_NORMALIZATION)
        self.assertEqual(geo[0]["date"], "2022-01-01")
        self.assertTrue(all(row["source"] == "google-trends-archive" for row in geo))
        self.assertEqual(rows[0]["status"], "stale")
        self.assertIsNone(rows[0]["metric"]["value"])
        self.assertIn(b",0,2023,jp", selected)

    def test_archive_download_must_match_pinned_official_checksum(self):
        with self.assertRaisesRegex(CollectionError, "checksum mismatch"):
            verify_archive(b"test-only altered source must never be attributed to Google")

    def test_merge_dedup_and_expiry_and_stale(self):
        topics, rows, _ = parse_trends(RSS, "JP", NOW)
        old = empty_dataset()
        old["observations"] = [{**rows[0], "id": "expired", "observedAt": "2026-01-01T00:00:00Z"}]
        result = merge_dataset(old, [(topics, rows, []), (topics, rows, [])], [], datetime(2026, 10, 21, tzinfo=timezone.utc))
        self.assertEqual(len(result["observations"]), 1)
        self.assertEqual(len(result["topics"][0]["observationIds"]), 1)
        result2 = merge_dataset(result, [], [{"source": "google-trends", "status": "error"}], datetime(2026, 10, 21, tzinfo=timezone.utc))
        self.assertEqual(result2["observations"][0]["status"], "stale")

    def test_bluesky_cache_refresh_replaces_sample_and_expires(self):
        post = {"uri": "at://did:plc:test/app.bsky.feed.post/abc123", "author": {"handle": "test-only.bsky.social"}, "record": {"text": "Test only", "createdAt": NOW}, "likeCount": 3}
        topics, rows, _ = parse_bluesky_author({"feed": [{"post": post}]}, "test-only.bsky.social", NOW)
        old = empty_dataset()
        old["topics"], old["observations"] = topics, rows
        new_rows = [{**rows[0], "id": "fresh-snapshot", "fetchedAt": "2026-10-21T10:00:00Z"}]
        result = merge_dataset(old, [(topics, new_rows, [])], [], datetime(2026, 10, 21, 10, tzinfo=timezone.utc))
        self.assertEqual(len(result["observations"]), 1)
        self.assertEqual(result["observations"][0]["id"], "fresh-snapshot")
        expired = merge_dataset(result, [], [], datetime(2026, 10, 23, tzinfo=timezone.utc))
        self.assertEqual(expired["observations"], [])


class NetworkTests(unittest.TestCase):
    def test_429_retry_after_is_respected(self):
        headers = Message()
        headers["Retry-After"] = "2"
        error = HTTPError("https://example.org/test", 429, "Too many requests", headers, None)
        opener = Mock(side_effect=[error, io.BytesIO(b"{}")])
        sleeper = Mock()
        self.assertEqual(fetch_bytes("https://example.org/test", opener=opener, sleep=sleeper), b"{}")
        sleeper.assert_called_once_with(2)
        self.assertEqual(opener.call_count, 2)

    def test_long_retry_after_defers_collection_instead_of_retrying_too_early(self):
        headers = Message()
        headers["Retry-After"] = "120"
        error = HTTPError("https://example.org/test", 429, "Too many requests", headers, None)
        opener, sleeper = Mock(side_effect=error), Mock()
        with self.assertRaisesRegex(CollectionError, "defer"):
            fetch_bytes("https://example.org/test", opener=opener, sleep=sleeper)
        self.assertEqual(opener.call_count, 1)
        sleeper.assert_not_called()

    def test_policy_denial_no_retry_or_proxy_bypass(self):
        opener = Mock(side_effect=URLError("Tunnel connection failed: 403 Forbidden"))
        sleeper = Mock()
        with self.assertRaisesRegex(CollectionError, "denied"):
            fetch_bytes("https://example.org/test", opener=opener, sleep=sleeper)
        self.assertEqual(opener.call_count, 1)
        sleeper.assert_not_called()

    def test_timeout_bounded_retries(self):
        opener = Mock(side_effect=socket.timeout())
        with self.assertRaisesRegex(CollectionError, "timeout"):
            fetch_bytes("https://example.org/test", opener=opener, sleep=Mock())
        self.assertEqual(opener.call_count, 3)

    def test_credential_url_is_never_in_errors(self):
        opener = Mock(side_effect=HTTPError("https://example.org?key=test-only-secret", 403, "Denied", Message(), None))
        with self.assertRaises(CollectionError) as ctx:
            fetch_bytes("https://example.org?key=test-only-secret", opener=opener, sleep=Mock())
        self.assertNotIn("test-only-secret", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
