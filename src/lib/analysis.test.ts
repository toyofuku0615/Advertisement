import { describe, expect, it } from 'vitest';
import type { AudienceEvidence, Observation, Topic } from '../types';
import { audienceEvidenceFor, brandSafety, calculateMomentum, calculateNovelty, calculatePersistence, diffusion, groupComparable } from './analysis';

const sample = (id: string, days: number, value: number | null, overrides: Partial<Observation> = {}): Observation => ({
  id, topicId: 'topic', source: 'google-trends', sourceId: id, sourceUrl: 'https://trends.google.com/trends/', title: '実測',
  publishedAt: '2026-10-01T00:00:00Z', observedAt: new Date(Date.UTC(2026, 9, 21) - days * 86400000).toISOString(),
  fetchedAt: '2026-10-21T00:00:00Z', regionCode: 'JP', regionMeaning: 'search-market',
  metric: { name: 'interest', value, unit: 'index', normalization: 'same-request' },
  population: 'searches', reliability: 'observed', method: 'CSV', license: 'source terms', status: 'fresh', ...overrides,
});
const asOf = '2026-10-21T00:00:00.000Z';

describe('evidence-aware metrics', () => {
  it('does not invent missing baseline momentum', () => {
    expect(calculateMomentum([sample('one', 1, 20)], asOf).value).toBeNull();
    expect(calculateNovelty().value).toBeNull();
  });
  it('requires ten observations in each period, same sampling and metric', () => {
    const recent = Array.from({ length: 10 }, (_, i) => sample(`r${i}`, 1 + i / 10, 30));
    const base = Array.from({ length: 10 }, (_, i) => sample(`b${i}`, 8 + i / 10, 20));
    const metric = calculateMomentum([...base, ...recent], asOf);
    expect(metric.value).toBe(50);
    expect(metric.evidenceIds).toHaveLength(20);
    expect(calculateMomentum([...base, ...recent.slice(1)], asOf).value).toBeNull();
    expect(calculateMomentum([...base, ...recent, sample('us', 1, 20, { regionCode: 'US' })], asOf).value).toBeNull();
  });
  it('does not inflate samples with duplicate retries, null or invalid dates', () => {
    const observation = sample('retry', 1, 12);
    const groups = groupComparable([observation, { ...observation, id: 'retry2' }, sample('null', 1, null), sample('date', 1, 4, { observedAt: 'broken' })]);
    expect([...groups.values()][0]).toHaveLength(1);
  });
  it('refuses zero baseline and does not mix normalized request groups', () => {
    const recent = Array.from({ length: 10 }, (_, i) => sample(`r${i}`, 2 + i / 10, 30));
    const base = Array.from({ length: 10 }, (_, i) => sample(`b${i}`, 9 + i / 10, 0));
    expect(calculateMomentum([...base, ...recent], asOf).value).toBeNull();
    expect(groupComparable([sample('a', 1, 20), sample('b', 2, 10, { metric: { name: 'interest', value: 10, unit: 'index', normalization: 'different-request' } })]).size).toBe(2);
  });
  it('persistence requires four observed sufficiently sampled weeks', () => {
    const observations = Array.from({ length: 4 }, (_, week) => Array.from({ length: 10 }, (_, i) => sample(`${week}-${i}`, week * 7 + 1 + i / 10, week === 3 ? 5 : 20))).flat();
    expect(calculatePersistence(observations, asOf).value).toBe(75);
    expect(calculatePersistence(observations.slice(1), asOf).value).toBeNull();
  });
  it('keeps publisher countries distinct from search markets', () => {
    const result = diffusion([sample('JP', 1, 10), sample('US', 1, 1, { source: 'gdelt', regionCode: 'US', regionMeaning: 'publisher-country' })], []);
    expect(result.searchMarkets).toEqual(['JP']);
    expect(result.publisherCountries).toEqual(['US']);
  });
  it('does not mix different topics or count two Bluesky endpoints as independent sources', () => {
    expect(groupComparable([sample('a', 1, 10), sample('b', 1, 10, { topicId: 'different' })]).size).toBe(2);
    const result = diffusion([sample('a', 1, 10, { source: 'bluesky' }), sample('b', 1, 10, { source: 'bluesky-author' })], []);
    expect(result.sources).toEqual(['Bluesky']);
  });
  it('does not derive momentum, persistence or diffusion metrics from YouTube API data', () => {
    const youtube = Array.from({ length: 40 }, (_, i) => sample(`yt-${i}`, 1 + i / 2, 100, { source: 'youtube' }));
    expect(calculateMomentum(youtube, asOf).value).toBeNull();
    expect(calculateMomentum(youtube, asOf).reason).toContain('YouTube');
    expect(calculatePersistence(youtube, asOf).value).toBeNull();
    expect(diffusion(youtube, []).sources).toEqual([]);
    expect(diffusion(youtube, []).evidenceIds).toEqual([]);
  });
  it('refuses unknown normalization, undefined RSS windows and cumulative social counts', () => {
    const unknown = sample('unknown', 1, 30, { metric: { name: 'index', value: 30, unit: 'index', normalization: '正規化範囲は原典未詳' } });
    expect(calculateMomentum([unknown], asOf).reason).toContain('正規化');
    const rss = sample('rss', 1, 10000, { metric: { name: 'traffic', value: 10000, unit: 'searches-lower-bound', normalization: 'RSS public traffic' } });
    expect(calculateMomentum([rss], asOf).reason).toContain('観測窓');
    const reactions = sample('post', 1, 40, { source: 'bluesky', metric: { name: 'likes', value: 40, unit: 'likes', normalization: '取得時点累計' } });
    expect(calculatePersistence([reactions], asOf).reason).toContain('累計');
  });
  it('does not infer a demographic from a general population survey', () => {
    const evidence: AudienceEvidence = { id: 'e', title: 'survey', sourceUrl: 'https://example.org/survey', fetchedAt: asOf, surveyDate: '2025', regionCode: 'US', age: 'all', gender: 'all', segment: 'all', population: 'adults', sampleSize: 1000, question: 'q', value: 30, unit: '%', methodology: 'random survey', comparabilityKey: 'q' };
    expect(audienceEvidenceFor([evidence], 'US', '20s', 'student')).toEqual([]);
  });
  it('stops opportunity suggestions for potentially unsafe news', () => {
    const topic: Topic = { id: 't', title: 'earthquake', aliases: [], category: '社会', observationIds: [] };
    expect(brandSafety(topic).flagged).toBe(true);
    const feed: Topic = { ...topic, title: 'カルチャー観測', category: 'ライフスタイル' };
    expect(brandSafety(feed, [{ title: '災害からの復興について' }]).flagged).toBe(true);
  });
});
