import { describe, expect, it } from 'vitest';
import type { CultureWindow, Dataset, Observation, PublicationPolicy, WindowObservation } from '../types';
import config from '../../config/culture_windows.json';
import { awareTimestamp, publicationAllowed, publicSourceUrl } from './culture-windows';
import { parseDataset } from './repository';

// All observations and permissions below are DEMO test inputs, never published.
const when = '2026-10-21T09:31:21Z';
function policy(): PublicationPolicy {
  return { visibility: 'public', aiAllowed: true, termsUrl: 'https://example.org/terms', license: 'DEMO permission only', allowedFields: ['metadata', 'headline', 'link', 'metrics'], checkedAt: when, note: 'DEMO test policy, not a source licence' };
}
function original(): Observation {
  return { id: 'DEMO-observation', topicId: 'DEMO-topic', source: 'google-trends', sourceId: 'DEMO-item', sourceUrl: 'https://trends.google.com/trending/rss?geo=US', title: 'DEMO query', publishedAt: '', observedAt: '2026-10-21T09:20:00Z', fetchedAt: when, regionCode: 'US', regionMeaning: 'search-market', metric: { name: 'DEMO measure', value: null, unit: 'DEMO unit', normalization: 'DEMO none' }, population: 'DEMO market, not students', reliability: 'observed', method: 'DEMO parser fixture', license: 'DEMO', status: 'fresh' };
}
function legacy(): Dataset {
  return { schemaVersion: 1, generatedAt: when, topics: [{ id: 'DEMO-topic', title: 'DEMO query', category: '未分類', aliases: [], observationIds: ['DEMO-observation'] }], observations: [original()], geoObservations: [], collectionRuns: [], sources: [{ id: 'google-trends', name: 'DEMO source', kind: 'search', url: 'https://trends.google.com/', termsUrl: 'https://example.org/terms', metricDescription: 'DEMO', license: 'DEMO', enabled: true }] };
}
function window(): CultureWindow {
  return { id: 'DEMO-window', name: 'DEMO campus research', description: 'DEMO editorial observation purpose', countryCodes: ['US'], languages: ['en'], categories: ['ライフスタイル'], enabled: true, scopeNote: 'DEMO: market geography never establishes the age or residence of a person', sources: [{ id: 'DEMO-binding', source: 'google-trends', adapter: 'legacy-google-trends', enabled: true, endpoint: 'https://trends.google.com/trending/rss?geo=US', countryCodes: ['US'], verification: { status: 'verified', method: 'recorded-collection', checkedAt: when, evidenceUrl: 'https://example.org/demo-evidence', note: 'DEMO only, no network request made' }, publication: policy(), disabledReason: null }] };
}
function membership(): WindowObservation {
  const row = original();
  return { id: 'DEMO-membership', windowId: 'DEMO-window', sourceBindingId: 'DEMO-binding', observationId: row.id, source: row.source, sourceItemId: row.sourceId, sourceUrl: row.sourceUrl, publishedAt: null, observedAt: row.observedAt, fetchedAt: row.fetchedAt, language: null, regionScope: { kind: 'search-market', countryCodes: ['US'] }, evidenceType: 'search-trend', publication: policy(), status: 'fresh' };
}
function extended(): Dataset {
  return { ...legacy(), cultureWindows: [window()], windowObservations: [membership()], windowCollectionRuns: [{ id: 'DEMO-run', windowId: 'DEMO-window', sourceBindingId: 'DEMO-binding', source: 'google-trends', adapter: 'legacy-google-trends', startedAt: when, finishedAt: when, status: 'success', count: 1, retainedCount: 0, method: 'existing-observation-projection' }] };
}

describe('optional culture-window read model', () => {
  it('keeps old schemaVersion1 JSON and canonical identity unchanged, without a migration', () => {
    const data = legacy();
    const before = JSON.stringify(data);
    expect(parseDataset(data)).toBe(data);
    expect(JSON.stringify(data)).toBe(before);
    expect(Object.hasOwn(data, 'cultureWindows')).toBe(false);
    expect(data.observations[0].id).toBe('DEMO-observation');
  });

  it('accepts the additive model with nullable publication time and unknown language', () => {
    const data = extended();
    expect(parseDataset(data)).toBe(data);
    expect(data.windowObservations![0].publishedAt).toBeNull();
    expect(data.windowObservations![0].language).toBeNull();
    expect(data.observations).toHaveLength(1);
  });

  it('validates the actual six-window configuration without inventing demographic evidence', () => {
    const data = { ...legacy(), sources: [...legacy().sources, { ...legacy().sources[0], id: 'gdelt', name: 'DEMO news source', kind: 'news' as const }], cultureWindows: config.windows, windowObservations: [], windowCollectionRuns: [] };
    expect(parseDataset(data).cultureWindows).toHaveLength(6);
    expect(config.windows.every(item => item.scopeNote.includes('属性'))).toBe(true);
  });

  it('does not accept missing extension arrays or malformed IDs', () => {
    expect(() => parseDataset({ ...legacy(), cultureWindows: [] })).toThrow('3種類');
    const data = extended();
    data.cultureWindows![0].id = 'DEMO window with spaces';
    expect(() => parseDataset(data)).toThrow('名称');
  });

  it('deduplicates one source item within a window but permits shared canonical evidence across windows', () => {
    const duplicate = extended();
    duplicate.windowObservations!.push({ ...membership(), id: 'DEMO-second-id' });
    expect(() => parseDataset(duplicate)).toThrow('重複');
    const shared = extended();
    shared.cultureWindows!.push({ ...window(), id: 'DEMO-other-window' });
    shared.windowObservations!.push({ ...membership(), id: 'DEMO-other-membership', windowId: 'DEMO-other-window' });
    expect(parseDataset(shared).observations).toHaveLength(1);
    expect(shared.windowObservations).toHaveLength(2);
  });

  it('rejects orphan references and attempts to substitute a source item or original URL', () => {
    for (const patch of [{ observationId: 'missing' }, { sourceItemId: 'invented' }, { sourceUrl: 'https://example.org/invented' }, { sourceBindingId: 'missing' }]) {
      const data = extended();
      Object.assign(data.windowObservations![0], patch);
      expect(() => parseDataset(data)).toThrow();
    }
  });

  it('recognizes equivalent timezone spellings as the same observed instant', () => {
    const data = extended();
    const row = { ...original(), id: 'DEMO-other-observation', observedAt: '2026-10-21T18:20:00+09:00' };
    data.observations.push(row);
    data.topics[0].observationIds.push(row.id);
    data.windowObservations!.push({ ...membership(), id: 'DEMO-other-membership', observationId: row.id, observedAt: row.observedAt });
    expect(() => parseDataset(data)).toThrow('重複');
  });

  it('does not relabel search data as community evidence or expand its source selection', () => {
    const wrongType = extended();
    wrongType.windowObservations![0].evidenceType = 'community-post';
    expect(() => parseDataset(wrongType)).toThrow('根拠種別');
    const wrongScope = extended();
    wrongScope.cultureWindows![0].countryCodes.push('GB');
    wrongScope.cultureWindows![0].sources[0].countryCodes = ['GB'];
    expect(() => parseDataset(wrongScope)).toThrow('対象国');
    const old = extended();
    old.observations[0].status = 'stale';
    expect(() => parseDataset(old)).toThrow('古い正規観測');
  });

  it('cannot grant broader publication or AI rights than either source or canonical observation', () => {
    const metadataOnly = extended();
    metadataOnly.cultureWindows![0].sources[0].publication.allowedFields = ['metadata', 'link'];
    expect(() => parseDataset(metadataOnly)).toThrow('利用権限');
    const noAI = extended();
    noAI.observations[0].publication = { ...policy(), aiAllowed: false };
    expect(() => parseDataset(noAI)).toThrow('利用権限');
    const carriedNoAI = extended();
    carriedNoAI.observations[0].publicationRestriction = { publicAllowed: true, aiAllowed: false };
    expect(() => parseDataset(carriedNoAI)).toThrow('AI制限');
    carriedNoAI.windowObservations![0].publication.aiAllowed = false;
    expect(parseDataset(carriedNoAI).windowObservations![0].publication.aiAllowed).toBe(false);
    const differentTerms = extended();
    differentTerms.windowObservations![0].publication.termsUrl = 'https://example.org/another-policy';
    expect(() => parseDataset(differentTerms)).toThrow('利用条件');
  });

  it('never interprets a window language or geography as the language of an observed person', () => {
    const data = extended();
    data.windowObservations![0].language = 'en';
    expect(() => parseDataset(data)).toThrow('言語');
    data.observations[0].language = 'English';
    expect(parseDataset(data).windowObservations![0].language).toBe('en');
    data.windowObservations![0].regionScope.kind = 'publisher-country';
    expect(() => parseDataset(data)).toThrow('地域の意味');
  });

  it('rejects local/date-only/overflow timestamps and publication after retrieval', () => {
    expect(awareTimestamp('2026-10-21T09:31:21')).toBe(false);
    expect(awareTimestamp('2026-02-30T09:31:21Z')).toBe(false);
    expect(awareTimestamp('2026-10-21')).toBe(false);
    expect(awareTimestamp('2026-10-21T18:31:21+09:00')).toBe(true);
    const data = extended();
    data.observations[0].publishedAt = '2026-10-22T00:00:00Z';
    data.windowObservations![0].publishedAt = data.observations[0].publishedAt;
    expect(() => parseDataset(data)).toThrow('未来');
  });

  it('allows partial source failure with retained stale observations without claiming a new fetch', () => {
    const data = extended();
    data.windowObservations![0].status = 'stale';
    Object.assign(data.windowCollectionRuns![0], { status: 'partial', count: 0, retainedCount: 1, error: 'DEMO upstream failed' });
    expect(parseDataset(data).windowCollectionRuns![0].count).toBe(0);
    data.windowCollectionRuns![0].finishedAt = '2026-10-20T00:00:00Z';
    expect(() => parseDataset(data)).toThrow('日時順序');
  });

  it('does not accept unverified, disabled, or restricted bindings as observed data', () => {
    const unverified = extended();
    unverified.cultureWindows![0].sources[0].verification.status = 'unverified';
    expect(() => parseDataset(unverified)).toThrow('未確認');
    const disabled = extended();
    Object.assign(disabled.cultureWindows![0].sources[0], { enabled: false, disabledReason: 'DEMO unavailable' });
    expect(() => parseDataset(disabled)).toThrow('無効');
    const restricted = extended();
    restricted.windowObservations![0].publication.visibility = 'private';
    expect(() => parseDataset(restricted)).toThrow('公開不可');
  });

  it('supports empty disabled future adapters without pretending to collect any observations', () => {
    const data = extended();
    data.windowObservations = [];
    Object.assign(data.cultureWindows![0].sources[0], { enabled: false, adapter: 'rss', verification: { status: 'unverified', method: null, checkedAt: null, evidenceUrl: null, note: 'DEMO not implemented' }, disabledReason: 'DEMO not implemented' });
    Object.assign(data.windowCollectionRuns![0], { adapter: 'rss', status: 'disabled', count: 0, retainedCount: 0 });
    expect(parseDataset(data).windowObservations).toHaveLength(0);
    data.windowCollectionRuns![0].count = 1;
    expect(() => parseDataset(data)).toThrow('取得件数');
  });
});

describe('explicit publication boundaries', () => {
  it('retains legacy behavior and fails closed on missing/malformed explicit policies', () => {
    expect(publicationAllowed({})).toBe(true);
    expect(publicationAllowed({}, { legacyDefault: false })).toBe(false);
    for (const publication of [undefined, null, {}, { ...policy(), visibility: 'unknown' }, { ...policy(), visibility: 'private' }, { ...policy(), checkedAt: '' }, { ...policy(), allowedFields: ['headline'] }]) {
      expect(publicationAllowed({ publication })).toBe(false);
    }
    const data = legacy();
    data.observations[0].publication = { ...policy(), visibility: 'private' };
    expect(() => parseDataset(data)).toThrow('公開不可');
  });

  it('separates public metadata permission from permission to supply headlines to AI', () => {
    expect(publicationAllowed({ publication: policy() }, { forAI: true })).toBe(true);
    const metadataOnly = { ...policy(), allowedFields: ['metadata', 'link'] };
    expect(publicationAllowed({ publication: metadataOnly })).toBe(true);
    expect(publicationAllowed({ publication: metadataOnly }, { forAI: true })).toBe(false);
    expect(publicationAllowed({ publication: { ...policy(), aiAllowed: false } }, { forAI: true })).toBe(false);
  });

  it('rejects credential-bearing, local, or secret-bearing endpoints before exposing them', () => {
    for (const url of ['https://user:secret@example.org/', 'http://127.0.0.1/feed', 'http://[::1]/feed', 'http://192.168.1.10/feed', 'http://localhost/feed', 'javascript:alert(1)', 'https://example.org/feed?api_key=private', 'https://example.org/\\feed']) {
      expect(publicSourceUrl(url)).toBe(false);
    }
    expect(publicSourceUrl('https://example.org/feed?language=en')).toBe(true);
    const data = extended();
    data.cultureWindows![0].sources[0].endpoint = 'https://example.org/feed?access_token=private';
    expect(() => parseDataset(data)).toThrow('URL');
  });

  it('rejects unknown configuration and policy fields rather than publishing nested credentials', () => {
    for (const target of ['window', 'binding', 'verification', 'policy']) {
      const data = extended();
      const source = data.cultureWindows![0].sources[0];
      const record = target === 'window' ? data.cultureWindows![0] : target === 'binding' ? source : target === 'verification' ? source.verification : source.publication;
      Object.assign(record, { headers: { Authorization: 'DEMO secret must never be published' } });
      expect(() => parseDataset(data)).toThrow();
    }
    expect(publicationAllowed({ publication: { ...policy(), Authorization: 'DEMO secret' } })).toBe(false);
  });

  it('requires permission for every field category in a serialized canonical row', () => {
    const metadataOnly = { ...policy(), allowedFields: ['metadata', 'link'] };
    expect(publicationAllowed({ publication: metadataOnly })).toBe(true);
    expect(publicationAllowed({ ...original(), publication: metadataOnly })).toBe(false);
    expect(publicationAllowed({ topicId: 'DEMO-topic', value: 1, publication: metadataOnly })).toBe(false);
    expect(publicationAllowed({ topicId: 'DEMO-topic', value: 1, publication: { ...policy(), allowedFields: ['metadata', 'link', 'metrics'] } })).toBe(true);
    const data = legacy();
    data.observations[0].publication = metadataOnly as PublicationPolicy;
    expect(() => parseDataset(data)).toThrow('公開不可');
  });

  it('applies a carried restriction before a missing or newly permissive publication policy', () => {
    const aiDenied = { publicAllowed: true, aiAllowed: false };
    expect(publicationAllowed({ publicationRestriction: aiDenied })).toBe(true);
    expect(publicationAllowed({ publicationRestriction: aiDenied }, { forAI: true })).toBe(false);
    expect(publicationAllowed({ publicationRestriction: aiDenied, publication: policy() }, { forAI: true })).toBe(false);
    for (const guard of [{ publicAllowed: false, aiAllowed: false }, { publicAllowed: false, aiAllowed: true }, { publicAllowed: true }, { publicAllowed: true, aiAllowed: true, token: 'DEMO secret' }, null]) {
      expect(publicationAllowed({ publicationRestriction: guard })).toBe(false);
    }
    const data = legacy();
    data.observations[0].publicationRestriction = aiDenied;
    expect(parseDataset(data)).toBe(data);
    data.observations[0].publicationRestriction = { publicAllowed: false, aiAllowed: false };
    expect(() => parseDataset(data)).toThrow('公開不可');
  });

  it('validates an opaque denial ledger even when there are no culture-window arrays', () => {
    const data = { ...legacy(), publicationRestrictions: [{ key: 'a'.repeat(64), publicAllowed: true, aiAllowed: false }] };
    expect(parseDataset(data)).toBe(data);
    expect(Object.hasOwn(data, 'cultureWindows')).toBe(false);
    data.publicationRestrictions.push({ key: 'b'.repeat(64), publicAllowed: false, aiAllowed: false });
    expect(parseDataset(data).publicationRestrictions).toHaveLength(2);
    for (const invalid of [
      [{ key: 'raw-DEMO-source-id', publicAllowed: false, aiAllowed: false }],
      [{ key: 'a'.repeat(64), publicAllowed: true, aiAllowed: true }],
      [{ key: 'a'.repeat(64), publicAllowed: false, aiAllowed: true }],
      [{ key: 'a'.repeat(64), publicAllowed: false, aiAllowed: false, sourceUrl: 'https://example.org/private' }],
      [data.publicationRestrictions[0], data.publicationRestrictions[0]],
    ]) expect(() => parseDataset({ ...legacy(), publicationRestrictions: invalid })).toThrow('制限台帳');
  });
});
