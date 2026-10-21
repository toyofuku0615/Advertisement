#!/usr/bin/env python3
"""CULTURE RADAR metadata-only public collectors (Python 3.12, standard library).

No scraping, private endpoints, credentials in JSON, or synthetic fallback data.
An unsuccessful source is recorded; last good observations expire after 30 days.
An explicitly labelled, pinned CC-BY archive is retained independently.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import re
import socket
import time
import unicodedata
import xml.etree.ElementTree as ET
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
UTC = timezone.utc
USER_AGENT = "CultureRadar/1.0 (public metadata research; no full-text archiving)"
MAX_RESPONSE_BYTES = 8 * 1024 * 1024
REGIONS = ("JP", "US", "KR", "GB")
ARCHIVE_COMMIT = "44ce5e8cdb786b6bd5257dd5e9ea6af58fcffe16"
ARCHIVE_SHA256 = "b0d58392bf7299c4d7cef3407018301f5aaf74515742b3720748565d6f2cc45b"
ARCHIVE_FILE = "20220404_environmental_issues_country_timeline.csv"
ARCHIVE_URL = f"https://raw.githubusercontent.com/googletrends/data/{ARCHIVE_COMMIT}/{ARCHIVE_FILE}"
ARCHIVE_SOURCE_URL = f"https://github.com/googletrends/data/blob/{ARCHIVE_COMMIT}/{ARCHIVE_FILE}"
ARCHIVE_NORMALIZATION = "原典の index_trends (0–100)。正規化範囲は原典未詳。国間順位・国間値比較不可。"
ARCHIVE_TOPICS = {
    "Plastic pollution": ("archive-plastic-pollution", "Plastic pollution / プラスチック汚染", "社会・ニュース"),
    "Low-emission vehicle": ("archive-low-emission-vehicle", "Low-emission vehicle / 低排出車", "テクノロジー"),
    "Climate variability and change": ("archive-climate-variability-and-change", "Climate variability and change / 気候変動", "社会・ニュース"),
}
ARCHIVE_REGIONS = {"JP", "US", "KR", "GB", "FR", "DE", "CA", "AU", "IN", "BR", "MX", "ES", "IT", "TW", "SG", "ID", "TH", "VN"}
COUNTRY_CODES = {
    "Japan": "JP", "United States": "US", "United Kingdom": "GB", "South Korea": "KR",
    "China": "CN", "France": "FR", "Germany": "DE", "Canada": "CA", "Australia": "AU",
    "India": "IN", "Brazil": "BR", "Mexico": "MX", "Spain": "ES", "Italy": "IT", "Taiwan": "TW",
    "Singapore": "SG", "Indonesia": "ID", "Thailand": "TH", "Vietnam": "VN", "New Zealand": "NZ",
    "Philippines": "PH", "Malaysia": "MY", "Russia": "RU", "South Africa": "ZA", "Argentina": "AR",
    "Netherlands": "NL", "Sweden": "SE", "Norway": "NO", "Finland": "FI", "Denmark": "DK",
    "Ireland": "IE", "Israel": "IL", "Turkey": "TR", "Türkiye": "TR", "Poland": "PL", "Portugal": "PT",
}
SOURCES = [
    {"id": "google-trends", "name": "Google Trends · 急上昇RSS", "kind": "search", "url": "https://trends.google.com/trending", "termsUrl": "https://support.google.com/trends/answer/4365533", "metricDescription": "急上昇RSSの公開検索トラフィック概数。任意語句の0–100関心指数とは異なる。", "license": "Google Terms of Service; publisher/news content rights remain with owners", "enabled": True},
    {"id": "bluesky", "name": "Bluesky · 公開投稿", "kind": "social", "url": "https://bsky.app", "termsUrl": "https://bsky.social/about/support/tos", "metricDescription": "検索で返された公開投稿の取得時点いいね数。利用者全体や属性別の人気ではない。", "license": "Bluesky developer guidelines / original authors retain content rights", "enabled": True},
    {"id": "gdelt", "name": "GDELT · ニュース", "kind": "news", "url": "https://www.gdeltproject.org", "termsUrl": "https://www.gdeltproject.org/about.html", "metricDescription": "DOC APIが返した最大50件の記事標本。所在国は報道機関の国であり出来事の場所ではない。", "license": "GDELT open data; underlying articles remain publishers' copyright", "enabled": True},
    {"id": "youtube", "name": "YouTube · 地域別人気動画", "kind": "social", "url": "https://www.youtube.com", "termsUrl": "https://developers.google.com/youtube/terms/developer-policies", "metricDescription": "mostPopular公開動画の取得時点再生数。Shorts専用・属性別ランキングではない。", "license": "YouTube API Services Terms; refresh/delete cached API data within 30 days", "enabled": bool(os.environ.get("YOUTUBE_API_KEY"))},
    {"id": "google-trends-archive", "name": "Google Trends · 公式履歴データ 2012–2023", "kind": "search", "url": "https://github.com/googletrends/data", "termsUrl": f"https://github.com/googletrends/data/blob/{ARCHIVE_COMMIT}/LICENSE", "metricDescription": "Google公開の年次 index_trends。正規化の詳細未詳、国間比較不可。最新トレンドではない。0値は低量・欠損を区別できないため地図では未表示。", "license": "CC BY 4.0; Google Trends; selected/reformatted, no endorsement; https://creativecommons.org/licenses/by/4.0/", "enabled": True},
]


class CollectionError(RuntimeError):
    """Safe message without request credentials or response body."""


def timestamp(dt: datetime | None = None) -> str:
    return (dt or datetime.now(UTC)).astimezone(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_datetime(value: str) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("missing datetime")
    value = value.strip()
    if re.fullmatch(r"\d{8}T\d{6}Z", value):
        return datetime.strptime(value, "%Y%m%dT%H%M%SZ").replace(tzinfo=UTC)
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        dt = parsedate_to_datetime(value)
    if dt.tzinfo is None:
        raise ValueError("timezone required")
    return dt.astimezone(UTC)


def stable_id(*parts: Any) -> str:
    text = "\x1f".join(str(x) for x in parts)
    return hashlib.sha256(text.encode()).hexdigest()[:24]


def topic_key(title: str) -> str:
    # Exact NFKC/case folded spelling only. Translation and semantic merging are user-controlled.
    return "topic-" + stable_id(unicodedata.normalize("NFKC", title).casefold().strip())


def safe_url(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    parsed = urlparse(value)
    return value if parsed.scheme in ("https", "http") and parsed.hostname and not parsed.username and not parsed.password else None


def fetch_bytes(url: str, *, opener: Callable = urlopen, sleep: Callable = time.sleep, attempts: int = 3, timeout: float = 18) -> bytes:
    """TLS verification and inherited proxy/CA trust stay enabled. Retry only transient failures."""
    for attempt in range(attempts):
        try:
            with opener(Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json, application/rss+xml, text/csv;q=0.9, */*;q=0.5"}), timeout=timeout) as response:
                data = response.read(MAX_RESPONSE_BYTES + 1)
                if len(data) > MAX_RESPONSE_BYTES:
                    raise CollectionError("Response exceeds 8 MiB safety limit")
                return data
        except HTTPError as error:
            if error.code in (429, 500, 502, 503, 504) and attempt + 1 < attempts:
                retry_after = error.headers.get("Retry-After", "") if error.headers else ""
                if retry_after.isdigit():
                    requested_delay = int(retry_after)
                    if requested_delay > 30:
                        raise CollectionError(f"HTTP {error.code}; Retry-After exceeds bounded retry window; defer until a later collection") from None
                    delay = max(1, requested_delay)
                else:
                    try:
                        requested_delay = (parsedate_to_datetime(retry_after) - datetime.now(UTC)).total_seconds()
                        if requested_delay > 30:
                            raise CollectionError(f"HTTP {error.code}; Retry-After exceeds bounded retry window; defer until a later collection") from None
                        delay = max(1, requested_delay)
                    except (TypeError, ValueError):
                        delay = min(8, 2 ** attempt)
                sleep(delay)
                continue
            raise CollectionError(f"HTTP {error.code}; source unavailable (credentials/response not logged)") from None
        except (TimeoutError, socket.timeout):
            if attempt + 1 < attempts:
                sleep(min(8, 2 ** attempt))
                continue
            raise CollectionError("Network timeout after bounded retries") from None
        except URLError as error:
            message = str(error.reason)
            if "403" in message or "Forbidden" in message:
                raise CollectionError("Network proxy denied destination (403); allow source hostname in environment settings") from None
            if attempt + 1 < attempts:
                sleep(min(8, 2 ** attempt))
                continue
            raise CollectionError("Network/TLS failure after bounded retries; verification remains enabled") from None
    raise CollectionError("Request failed")


def fetch_json(url: str) -> Any:
    try:
        return json.loads(fetch_bytes(url))
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise CollectionError("Source did not return valid JSON; schema may have changed") from None


def category_for(text: str) -> str:
    groups = {
        "食品・飲料": ("matcha", "抹茶", "coffee", "food", "recipe", "chocolate", "cooking"),
        "美容・ファッション": ("skincare", "beauty", "fashion", "makeup", "cosmetic"),
        "音楽": ("music", "song", "album", "concert", "bts", "歌"),
        "スポーツ": ("football", "soccer", "baseball", "nba", "nhl", "野球", "サッカー"),
        "テクノロジー": ("artificial intelligence", "technology", "openai", "chatgpt", "iphone", "bluesky"),
        "旅行": ("travel", "tourism", "旅行"),
    }
    lower = text.casefold()
    return next((category for category, words in groups.items() if any(word in lower for word in words)), "未分類")


def topic_record(title: str, language: str = "und") -> dict:
    topic_id = topic_key(title)
    return {"id": topic_id, "title": title, "category": category_for(title), "aliases": [{"id": stable_id(topic_id, language, title), "text": title, "language": language}], "observationIds": []}


def observation(*, topic: dict, source: str, source_id: str, url: str, title: str, observed_at: str, fetched_at: str, published_at: str = "", region: str | None = None, meaning: str = "not-geolocated", metric_name: str, value: int | float | None, unit: str, normalization: str, population: str, method: str, related_links: list | None = None) -> dict:
    if not safe_url(url):
        raise ValueError("No valid provenance URL")
    parse_datetime(observed_at)
    if published_at:
        parse_datetime(published_at)
    license_text = next(source_row["license"] for source_row in SOURCES if source_row["id"] == source)
    return {"id": stable_id(source, source_id, observed_at), "topicId": topic["id"], "source": source, "sourceId": source_id, "sourceUrl": url, "title": title, "publishedAt": published_at, "observedAt": observed_at, "fetchedAt": fetched_at, "regionCode": region, "regionMeaning": meaning, "metric": {"name": metric_name, "value": value, "unit": unit, "normalization": normalization}, "population": population, "reliability": "observed", "method": method, "license": license_text, "status": "fresh", "relatedLinks": related_links or []}


def parse_traffic(text: str) -> float | None:
    # RSS reports a rounded lower bound, not an exact count.
    match = re.fullmatch(r"([\d,.]+)\s*([KMB]?)\+?", text.strip().upper())
    if not match:
        return None
    return float(match[1].replace(",", "")) * {"": 1, "K": 1_000, "M": 1_000_000, "B": 1_000_000_000}[match[2]]


def parse_trends(payload: bytes, region: str, fetched_at: str) -> tuple[list, list, list]:
    try:
        root = ET.fromstring(payload)
    except ET.ParseError:
        raise CollectionError("Invalid RSS/XML; schema may have changed") from None
    if root.tag not in ("rss", "feed", "{http://www.w3.org/2005/Atom}feed"):
        raise CollectionError("Expected RSS feed; source schema changed")
    topics, observations = [], []
    items = root.findall("./channel/item")
    if not items and root.find("./channel") is None:
        raise CollectionError("RSS channel missing; source schema changed")
    def text(item: ET.Element, name: str) -> str:
        found = next((el for el in item.iter() if el.tag.split("}")[-1] == name), None)
        return found.text.strip() if found is not None and found.text else ""
    for item in items[:30]:
        title, pub = text(item, "title"), text(item, "pubDate")
        if not title or not pub:
            continue  # Do not invent required provenance dates.
        try:
            published = timestamp(parse_datetime(pub))
        except (ValueError, TypeError):
            continue
        topic = topic_record(title, {"JP": "ja", "KR": "ko"}.get(region, "en"))
        url = safe_url(text(item, "link")) or f"https://trends.google.com/trending?geo={region}"
        related = []
        for news in item:
            if news.tag.split("}")[-1] == "news_item":
                news_url = safe_url(text(news, "news_item_url"))
                if news_url:
                    related.append({"title": text(news, "news_item_title") or "関連ニュース", "url": news_url})
        row = observation(topic=topic, source="google-trends", source_id=f"{region}:{title}:{published}", url=url, title=title, observed_at=published, fetched_at=fetched_at, published_at=published, region=region, meaning="search-market", metric_name="RSS検索トラフィック（概数下限）", value=parse_traffic(text(item, "approx_traffic")), unit="searches-lower-bound", normalization="RSSが公開する概数。0–100指数ではなく、RSSの対象期間は原典に依存。", population=f"Google Trends 急上昇検索 / {region}", method="公式 Trending Now RSS。pubDateはRSS話題公開時刻であり急上昇開始時刻の保証なし。カテゴリーはルール推定C。", related_links=related)
        topics.append(topic)
        observations.append(row)
    return topics, observations, []


def collect_trends(region: str, fetched_at: str) -> tuple[list, list, list]:
    return parse_trends(fetch_bytes(f"https://trends.google.com/trending/rss?geo={region}"), region, fetched_at)


def parse_bluesky(payload: Any, keyword: str, fetched_at: str) -> tuple[list, list, list]:
    if not isinstance(payload, dict) or not isinstance(payload.get("posts"), list):
        raise CollectionError("Bluesky posts list missing; schema changed")
    topic = topic_record(keyword, "en")
    observations = []
    for post in payload["posts"][:15]:
        if not isinstance(post, dict):
            continue
        record, author = post.get("record", {}), post.get("author", {})
        if not isinstance(record, dict) or not isinstance(author, dict):
            continue
        uri, handle, created = post.get("uri", ""), author.get("handle", ""), record.get("createdAt", "")
        if not isinstance(uri, str) or not re.fullmatch(r"at://[^/]+/app\.bsky\.feed\.post/[A-Za-z0-9]+", uri):
            continue
        if not isinstance(handle, str) or not re.fullmatch(r"[a-zA-Z0-9._-]+", handle):
            continue
        try:
            published = timestamp(parse_datetime(created))
        except (TypeError, ValueError):
            continue
        count = post.get("likeCount")
        value = count if isinstance(count, int) and count >= 0 else None
        row = observation(topic=topic, source="bluesky", source_id=uri, url=f"https://bsky.app/profile/{quote(handle)}/post/{uri.rsplit('/', 1)[-1]}", title=str(record.get("text", ""))[:120], observed_at=fetched_at, fetched_at=fetched_at, published_at=published, metric_name="公開投稿いいね数", value=value, unit="likes", normalization="取得時点累計。検索標本であり全体人気や属性別人気を表さない。", population=f"Bluesky public searchPosts / query={keyword}", method="公式公開AppView API; 地域・属性を推定しない。投稿抜粋は最大120文字、キャッシュ24時間。原典で最新状態を確認。", related_links=[{"title": f"@{handle}", "url": f"https://bsky.app/profile/{quote(handle)}"}])
        observations.append(row)
    return ([topic] if observations else []), observations, []


def collect_bluesky(keyword: str, fetched_at: str) -> tuple[list, list, list]:
    query = urlencode({"q": keyword, "limit": 15, "sort": "latest"})
    return parse_bluesky(fetch_json(f"https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?{query}"), keyword, fetched_at)


def parse_bluesky_author(payload: Any, actor: str, fetched_at: str) -> tuple[list, list, list]:
    if not isinstance(payload, dict) or not isinstance(payload.get("feed"), list):
        raise CollectionError("Bluesky author feed list missing; source schema changed")
    result = parse_bluesky({"posts": [entry.get("post") for entry in payload["feed"] if isinstance(entry, dict)]}, f"Bluesky · @{actor}", fetched_at)
    for row in result[1]:
        row["population"] = f"Bluesky 編集指定アカウント @{actor} の公開フィード。キーワード検索標本ではない。"
        row["method"] = "公式公開AppView getAuthorFeed API。編集指定アカウントの観測であり、話題全体・属性別・地域別の人気順位ではない。投稿抜粋は最大120文字、24時間キャッシュ。再取得で観測標本を置換。カテゴリーはルール推定C。"
    return result


def collect_bluesky_author(actor: str, fetched_at: str) -> tuple[list, list, list]:
    query = urlencode({"actor": actor, "limit": 12, "filter": "posts_no_replies"})
    return parse_bluesky_author(fetch_json(f"https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?{query}"), actor, fetched_at)


def parse_gdelt(payload: Any, keyword: str, fetched_at: str) -> tuple[list, list, list]:
    if not isinstance(payload, dict) or not isinstance(payload.get("articles"), list):
        raise CollectionError("GDELT articles list missing; source schema changed")
    topic = topic_record(keyword, "en")
    observations, geos, seen = [], [], set()
    counts: Counter = Counter()
    for article in payload["articles"][:50]:
        if not isinstance(article, dict):
            continue
        url = safe_url(article.get("url"))
        if not url or url in seen or not article.get("title"):
            continue
        try:
            date = timestamp(parse_datetime(article.get("seendate", "")))
        except (ValueError, TypeError):
            continue
        seen.add(url)
        country = COUNTRY_CODES.get(article.get("sourcecountry"))
        row = observation(topic=topic, source="gdelt", source_id=url, url=url, title=str(article["title"]), observed_at=date, fetched_at=fetched_at, region=country, meaning="publisher-country" if country else "not-geolocated", metric_name="DOC API返却記事標本", value=1, unit="returned-articles", normalization="クエリあたり直近24時間・最大50件。全報道量ではない。", population=f"GDELT DOC索引の返却記事 / query={keyword}", method="GDELT DOC artlist公式API。seendateはGDELT初観測時刻であり記事公開時刻ではない。sourcecountryは報道機関所在国、言及場所・読者国ではない。")
        row["language"] = str(article.get("language", "unknown"))
        row["publisherCountryOriginal"] = article.get("sourcecountry")
        observations.append(row)
        if country:
            counts[(country, date[:10])] += 1
    api_url = "https://api.gdeltproject.org/api/v2/doc/doc?" + urlencode({"query": keyword, "mode": "artlist", "format": "json", "maxrecords": 50, "timespan": "1d"})
    for (country, date), count in sorted(counts.items()):
        geos.append({"id": stable_id("gdelt-geo", topic["id"], country, date), "topicId": topic["id"], "source": "gdelt", "sourceUrl": api_url, "regionCode": country, "regionMeaning": "publisher-country", "date": date, "fetchedAt": fetched_at, "layer": "news-publisher", "value": count, "unit": "returned-articles", "normalization": "直近24時間のartlist返却標本・最大50件中。0件未返却の地域はデータなし。", "population": "GDELT DOCの返却記事における報道機関の所在国（出来事の場所ではない）"})
    return ([topic] if observations else []), observations, geos


def collect_gdelt(keyword: str, fetched_at: str) -> tuple[list, list, list]:
    query = urlencode({"query": keyword, "mode": "artlist", "format": "json", "maxrecords": 50, "timespan": "1d"})
    return parse_gdelt(fetch_json(f"https://api.gdeltproject.org/api/v2/doc/doc?{query}"), keyword, fetched_at)


def parse_youtube(payload: Any, region: str, fetched_at: str) -> tuple[list, list, list]:
    if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
        raise CollectionError("YouTube items list missing; source schema changed")
    topics, observations = [], []
    for video in payload["items"][:10]:
        snippet = video.get("snippet", {})
        video_id = video.get("id", "")
        if not isinstance(snippet, dict) or not re.fullmatch(r"[A-Za-z0-9_-]{11}", str(video_id)):
            continue
        title = snippet.get("title")
        try:
            published = timestamp(parse_datetime(snippet.get("publishedAt", "")))
            raw_count = video.get("statistics", {}).get("viewCount")
            count = int(raw_count) if raw_count is not None else None
        except (TypeError, ValueError):
            continue
        if not title:
            continue
        topic = topic_record(str(title))
        topic["category"] = "エンタメ"
        row = observation(topic=topic, source="youtube", source_id=video_id, url=f"https://www.youtube.com/watch?v={video_id}", title=str(title), observed_at=fetched_at, fetched_at=fetched_at, published_at=published, region=region, meaning="not-geolocated", metric_name="動画公開再生数", value=count, unit="views", normalization="取得時点累計。対象地域のmostPopular返却動画。地域内視聴数ではない。", population=f"YouTube mostPopular / regionCode={region}; 年代・属性指定なし", method="YouTube Data API v3 videos.list chart=mostPopular。Shorts専用・属性別ランキングではない。API情報は30日以内に更新・削除。")
        topics.append(topic)
        observations.append(row)
    return topics, observations, []


def collect_youtube(region: str, fetched_at: str) -> tuple[list, list, list]:
    key = os.environ.get("YOUTUBE_API_KEY")
    if not key:
        raise CollectionError("YOUTUBE_API_KEY not configured")
    query = urlencode({"part": "snippet,statistics", "chart": "mostPopular", "regionCode": region, "maxResults": 10, "key": key})
    return parse_youtube(fetch_json(f"https://www.googleapis.com/youtube/v3/videos?{query}"), region, fetched_at)


def parse_archive(payload: bytes, fetched_at: str) -> tuple[list, list, list, bytes]:
    """Only selected original rows; exact values retained and zero ambiguity disclosed."""
    try:
        reader = csv.DictReader(io.StringIO(payload.decode("utf-8-sig")))
        if not {"topic", "country", "index_trends", "year", "country_code"}.issubset(reader.fieldnames or []):
            raise CollectionError("Archive CSV fields changed")
        selected = [row for row in reader if row.get("topic") in ARCHIVE_TOPICS and row.get("country_code", "").upper() in ARCHIVE_REGIONS]
    except UnicodeDecodeError:
        raise CollectionError("Archive CSV encoding changed") from None
    topics, observations, geos = [], [], []
    for original, (topic_id, title, category) in ARCHIVE_TOPICS.items():
        rows = [row for row in selected if row["topic"] == original]
        if not rows:
            continue
        topic = {"id": topic_id, "title": title, "category": category, "aliases": [{"id": stable_id(topic_id, original), "text": original, "language": "en"}], "observationIds": []}
        topics.append(topic)
        latest: dict[str, tuple[str, float]] = {}
        for row in rows:
            try:
                year, value = int(row["year"]), float(row["index_trends"])
                if not (2004 <= year <= 2025 and 0 <= value <= 100):
                    continue
            except (TypeError, ValueError):
                continue
            region = row["country_code"].upper()
            date = f"{year:04d}-01-01"
            if value > 0:
                geos.append({"id": stable_id("archive", topic_id, region, date), "topicId": topic_id, "source": "google-trends-archive", "sourceUrl": ARCHIVE_SOURCE_URL, "regionCode": region, "regionMeaning": "search-market", "date": date, "fetchedAt": fetched_at, "layer": "search-interest", "value": value, "unit": "index", "normalization": ARCHIVE_NORMALIZATION, "population": f"Google Trends 公開履歴、{region}、{year}年の年次バケット。日時は年の代表ラベルであり日次実測ではない。"})
            if region not in latest or latest[region][0] < date:
                latest[region] = (date, value)
        for region, (date, value) in latest.items():
            row = observation(topic=topic, source="google-trends-archive", source_id=f"{topic_id}:{region}:{date}", url=ARCHIVE_SOURCE_URL, title=f"{title} · {region} · {date[:4]}年（履歴）", observed_at=f"{date}T00:00:00Z", fetched_at=fetched_at, region=region, meaning="search-market", metric_name="年次 index_trends（履歴）", value=value if value > 0 else None, unit="index", normalization=ARCHIVE_NORMALIZATION, population=f"Google Trends 公開履歴 / {region} / {date[:4]}年", method="Google公式GitHub CC BY4.0データを選択・再整形。2012–2023年の年次履歴であり最新流行ではない。publishedAt不明。0は低量・欠損の判別不可として地図未表示。")
            row["status"] = "stale"
            observations.append(row)
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=["topic", "country", "index_trends", "year", "country_code"])
    writer.writeheader()
    writer.writerows({key: row[key] for key in writer.fieldnames} for row in selected)
    return topics, observations, geos, output.getvalue().encode("utf-8")


def verify_archive(payload: bytes) -> None:
    # Derived from both the pinned official HTTPS artifact and matching Git blob.
    # Never replace this checksum to accept a failed/mutated download.
    if hashlib.sha256(payload).hexdigest() != ARCHIVE_SHA256:
        raise CollectionError("Pinned official archive checksum mismatch; refusing to use unverified data")


def empty_dataset() -> dict:
    return {"schemaVersion": 1, "generatedAt": timestamp(), "topics": [], "observations": [], "geoObservations": [], "collectionRuns": [], "sources": SOURCES}


def merge_dataset(previous: dict, batches: list[tuple[list, list, list]], runs: list[dict], now: datetime | None = None) -> dict:
    now = now or datetime.now(UTC)
    cutoff = now - timedelta(days=30)
    failed_sources = {row["source"] for row in runs if row["status"] == "error"}
    # Public-social excerpts are a short-lived observation cache, not a permanent
    # archive of authors' deleted content. Successful refresh replaces that query/
    # curated-feed sample (absence is NOT asserted to prove a post was deleted).
    refreshed_bluesky_populations = {row["population"] for _, rows, _ in batches for row in rows if row.get("source") == "bluesky"}
    refreshed_bluesky_ids = {row["sourceId"] for _, rows, _ in batches for row in rows if row.get("source") == "bluesky"}
    old_observations = []
    for row in previous.get("observations", []):
        try:
            # An archive is explicitly historical. YouTube cache freshness uses fetchedAt.
            retain = row.get("source") == "google-trends-archive" or parse_datetime(row["fetchedAt"] if row.get("source") == "youtube" else row["observedAt"]) >= cutoff
            if row.get("source") == "bluesky":
                retain = parse_datetime(row["fetchedAt"]) >= now - timedelta(hours=24) and row.get("population") not in refreshed_bluesky_populations and row.get("sourceId") not in refreshed_bluesky_ids
            if retain and safe_url(row.get("sourceUrl")):
                stale = row.get("source") == "google-trends-archive" or row.get("source") in failed_sources or parse_datetime(row["fetchedAt"]) < now - timedelta(hours=24)
                old_observations.append({**row, "status": "stale" if stale else "fresh"})
        except (ValueError, TypeError, KeyError):
            continue
    old_geos = []
    for row in previous.get("geoObservations", []):
        try:
            if row.get("source") == "google-trends-archive" or parse_datetime(f"{row['date']}T00:00:00Z") >= cutoff:
                old_geos.append(row)
        except (ValueError, KeyError, TypeError):
            continue
    observations = {row["id"]: row for row in old_observations}
    geos = {row["id"]: row for row in old_geos}
    topics = {row["id"]: {**row, "observationIds": []} for row in previous.get("topics", [])}
    for batch_topics, batch_observations, batch_geos in batches:
        for row in batch_topics:
            topics[row["id"]] = {**row, "observationIds": []}
        for row in batch_observations:
            observations[row["id"]] = row
        for row in batch_geos:
            geos[row["id"]] = row
    # Rebuild all relationships after deduplication/retention.
    for row in observations.values():
        if row["topicId"] in topics:
            topics[row["topicId"]]["observationIds"].append(row["id"])
    geo_topic_ids = {row["topicId"] for row in geos.values()}
    topics = {key: row for key, row in topics.items() if row["observationIds"] or key in geo_topic_ids}
    return {"schemaVersion": 1, "generatedAt": timestamp(now), "topics": sorted(topics.values(), key=lambda row: row["id"]), "observations": sorted(observations.values(), key=lambda row: row["observedAt"], reverse=True), "geoObservations": sorted(geos.values(), key=lambda row: (row["topicId"], row["date"], row["regionCode"])), "collectionRuns": (runs + previous.get("collectionRuns", []))[:160], "sources": SOURCES}


def atomic_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "public/data/dataset.json")
    parser.add_argument("--archive", action="store_true", help="Fetch the pinned official CC BY4.0 historical dataset; no latest-data substitution")
    parser.add_argument("--archive-file", type=Path, help="Parse an already verified copy of the same official archive")
    parser.add_argument("--only-archive", action="store_true", help="Do not request live sources (keeps any previous run results)")
    parser.add_argument("--strict", action="store_true", help="Exit nonzero when any enabled live source fails; JSON is still safely written")
    parser.add_argument("--keywords", nargs="+", default=["matcha", "skincare", "artificial intelligence"])
    parser.add_argument("--bluesky-actors", nargs="*", default=["bsky.app"], help="Explicitly curated public account feeds; never described as keyword/popularity rankings")
    parser.add_argument("--sources", nargs="+", choices=["google-trends", "bluesky-search", "bluesky-author", "gdelt", "youtube"], default=["google-trends", "bluesky-search", "bluesky-author", "gdelt", "youtube"], help="Retry only diagnosed/changed source operations when needed")
    args = parser.parse_args()
    try:
        previous = json.loads(args.output.read_text()) if args.output.exists() else empty_dataset()
    except (OSError, json.JSONDecodeError):
        raise SystemExit("Existing dataset unreadable; refusing to overwrite it")
    if previous.get("schemaVersion") != 1:
        raise SystemExit("Unsupported existing schemaVersion; refusing to overwrite")
    batches, runs = [], []
    fetched_at = timestamp()

    def run(source: str, region: str | None, label: str, operation: Callable) -> tuple[tuple[list, list, list], dict]:
        started = timestamp()
        record = {"id": stable_id(source, region, label, fetched_at), "source": source, "scope": label, "regionCode": region, "startedAt": started, "finishedAt": started, "status": "success", "count": 0}
        try:
            result = operation()
            record["count"] = len(result[1])
        except (CollectionError, ValueError, OSError, TypeError, KeyError) as error:
            # Intentionally avoid printing URLs/response bodies/secret-bearing request strings.
            record.update({"status": "error", "error": str(error)[:240] if isinstance(error, CollectionError) else f"Parser/filesystem error ({type(error).__name__}); inspect source schema"})
            result = ([], [], [])
        record["finishedAt"] = timestamp()
        print(f"{source:22} {region or label:24} {record['status']:8} {record['count']:3}")
        return result, record

    if not args.only_archive:
        if "google-trends" in args.sources:
            with ThreadPoolExecutor(max_workers=4) as executor:
                futures = [executor.submit(run, "google-trends", region, region, lambda region=region: collect_trends(region, fetched_at)) for region in REGIONS]
                for future in futures:
                    batch, record = future.result()
                    batches.append(batch)
                    runs.append(record)
        for keyword in (args.keywords[:8] if "bluesky-search" in args.sources else []):
            batch, record = run("bluesky", None, keyword, lambda keyword=keyword: collect_bluesky(keyword, fetched_at))
            batches.append(batch)
            runs.append(record)
        for actor in (args.bluesky_actors[:5] if "bluesky-author" in args.sources else []):
            if not re.fullmatch(r"[A-Za-z0-9._-]+", actor):
                raise SystemExit("Invalid Bluesky actor handle")
            batch, record = run("bluesky", None, f"author:{actor}", lambda actor=actor: collect_bluesky_author(actor, fetched_at))
            batches.append(batch)
            runs.append(record)
        for index, keyword in enumerate(args.keywords[:8] if "gdelt" in args.sources else []):
            if index:
                time.sleep(5.5)  # Respect GDELT's documented request pacing; never retry policy denial.
            batch, record = run("gdelt", None, keyword, lambda keyword=keyword: collect_gdelt(keyword, fetched_at))
            batches.append(batch)
            runs.append(record)
        if "youtube" in args.sources and os.environ.get("YOUTUBE_API_KEY"):
            for region in REGIONS:
                batch, record = run("youtube", region, region, lambda region=region: collect_youtube(region, fetched_at))
                batches.append(batch)
                runs.append(record)
        elif "youtube" in args.sources:
            runs.append({"id": stable_id("youtube", fetched_at), "source": "youtube", "regionCode": None, "startedAt": fetched_at, "finishedAt": timestamp(), "status": "disabled", "count": 0, "error": "YOUTUBE_API_KEY未設定。追加費用なしの他情報源は独立して動作します。"})
    if args.archive or args.archive_file:
        def archive_operation() -> tuple[list, list, list]:
            payload = args.archive_file.read_bytes() if args.archive_file else fetch_bytes(ARCHIVE_URL)
            verify_archive(payload)
            archive_topics, archive_observations, archive_geos, selected_csv = parse_archive(payload, fetched_at)
            raw_path = args.output.parent / "archive-environment-selected.csv"
            raw_path.parent.mkdir(parents=True, exist_ok=True)
            raw_path.write_bytes(selected_csv)
            # Provenance persists separately from Topic/alias decisions.
            available_regions = sorted({row["regionCode"] for row in archive_observations})
            atomic_json(args.output.parent / "archive-provenance.json", {"sourceUrl": ARCHIVE_SOURCE_URL, "rawUrl": ARCHIVE_URL, "sourceCommit": ARCHIVE_COMMIT, "sourceSha256": hashlib.sha256(payload).hexdigest(), "fetchedAt": fetched_at, "license": SOURCES[-1]["license"], "modifications": f"Selected three original topic series and requested eighteen countries; {len(available_regions)} are present in the original CSV. Original CSV values preserved. Annual dates are bucket labels; original zero values are omitted from map due to ambiguous low-volume/missing status.", "availableRegions": available_regions, "period": "2012–2023", "normalization": ARCHIVE_NORMALIZATION})
            return archive_topics, archive_observations, archive_geos
        batch, record = run("google-trends-archive", None, "2012–2023 historical", archive_operation)
        batches.append(batch)
        runs.append(record)
    dataset = merge_dataset(previous, batches, runs)
    atomic_json(args.output, dataset)
    live_errors = [row for row in runs if row["status"] == "error" and row["source"] != "google-trends-archive"]
    print(f"Saved {len(dataset['topics'])} topics, {len(dataset['observations'])} observations, {len(dataset['geoObservations'])} geo observations. Enabled live-source failures: {len(live_errors)}")
    return 1 if args.strict and any(row["status"] == "error" for row in runs) else 0


if __name__ == "__main__":
    raise SystemExit(main())
