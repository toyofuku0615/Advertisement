import type { AudienceEvidence, Dataset, GeoObservation, Observation, Topic } from '../types';

export interface MetricResult {
  value: number | null;
  unit: string;
  reason: string;
  evidenceIds: string[];
  period?: string;
}

export const MIN_PERIOD_SAMPLES = 10;
const DAY = 86_400_000;
const isYouTube = (source: string) => source.toLowerCase().startsWith('youtube');
export function validDate(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Samples may only be compared inside the same source, region, metric and population. */
export function seriesKey(o: Observation): string {
  return [o.topicId, o.source, o.regionCode || 'unlocated', o.regionMeaning, o.metric.name, o.metric.unit, o.metric.normalization, o.population].join('\u001f');
}

export function groupComparable(observations: Observation[]): Map<string, Observation[]> {
  const grouped = new Map<string, Observation[]>();
  for (const observation of observations) {
    if (observation.metric.value === null || !Number.isFinite(observation.metric.value) || observation.metric.value < 0 || validDate(observation.observedAt) === null) continue;
    const key = seriesKey(observation);
    const group = grouped.get(key) || [];
    // One snapshot per upstream item per timestamp: ingestion retries must not raise sample counts.
    if (!group.some(o => o.sourceId === observation.sourceId && o.observedAt === observation.observedAt)) group.push(observation);
    grouped.set(key, group);
  }
  for (const group of grouped.values()) group.sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  return grouped;
}

function notAvailable(reason: string): MetricResult {
  return { value: null, unit: '', reason, evidenceIds: [] };
}
function mean(group: Observation[]): number {
  return group.reduce((sum, observation) => sum + (observation.metric.value ?? 0), 0) / group.length;
}
function quantitativeRestriction(observations: Observation[]): string | null {
  if (observations.some(observation => isYouTube(observation.source))) return 'YouTube APIデータからの独自派生指標は利用規約上の許諾を確認できないため算出しません。';
  if (observations.some(observation => !observation.metric.normalization.trim() || /不明|未詳|unknown|undocumented/i.test(observation.metric.normalization))) return '正規化範囲が不明な観測値から伸び率・持続性は計算しません。';
  if (observations.some(observation => observation.source === 'google-trends' && observation.metric.unit === 'searches-lower-bound')) return '急上昇RSSの概数は観測窓の一定性を確認できないため、比較可能な区間データとして扱いません。';
  if (observations.some(observation => /累計|cumulative|lifetime/i.test(observation.metric.normalization))) return '取得時点の累計反応数は区間の発生量ではありません。同じ区間の増分データと母集団を確認するまで算出しません。';
  return null;
}

/** Relative change in the means of two adjacent 7-day windows; never combines series. */
export function calculateMomentum(observations: Observation[], asOf: string): MetricResult {
  const restriction = quantitativeRestriction(observations);
  if (restriction) return notAvailable(restriction);
  const groups = groupComparable(observations);
  if (groups.size !== 1) return notAvailable(groups.size ? '情報源・地域・母集団・正規化の異なる系列は合算できません。系列を一つ選択してください。' : '数値と観測日時を持つデータがありません。');
  const end = validDate(asOf);
  if (end === null) return notAvailable('基準日時が不正です。');
  const all = [...groups.values()][0];
  const recent = all.filter(o => Date.parse(o.observedAt) > end - 7 * DAY && Date.parse(o.observedAt) <= end);
  const baseline = all.filter(o => Date.parse(o.observedAt) > end - 14 * DAY && Date.parse(o.observedAt) <= end - 7 * DAY);
  if (recent.length < MIN_PERIOD_SAMPLES || baseline.length < MIN_PERIOD_SAMPLES) return notAvailable(`各7日間に最低${MIN_PERIOD_SAMPLES}観測が必要です（直近${recent.length}件・基準${baseline.length}件）。`);
  const base = mean(baseline);
  if (base <= 0) return notAvailable('通常時の平均値が0のため、伸び率を算出できません。');
  return {
    value: ((mean(recent) / base) - 1) * 100,
    unit: '%', reason: '同一系列の直近7日間の平均値 ÷ その前7日間の平均値 − 1。因果関係・総人気は示しません。',
    evidenceIds: [...baseline, ...recent].map(o => o.id), period: `${new Date(end - 14 * DAY).toISOString()} / ${asOf}`,
  };
}

/** Fraction of four observed weeks sustaining at least half of the largest weekly mean. */
export function calculatePersistence(observations: Observation[], asOf: string): MetricResult {
  const restriction = quantitativeRestriction(observations);
  if (restriction) return notAvailable(restriction);
  const groups = groupComparable(observations);
  if (groups.size !== 1) return notAvailable('同じ地域・情報源・指標・母集団・正規化の系列を一つ選択してください。');
  const end = validDate(asOf);
  if (end === null) return notAvailable('基準日時が不正です。');
  const all = [...groups.values()][0];
  const weeks = Array.from({ length: 4 }, (_, i) => all.filter(o => {
    const date = Date.parse(o.observedAt);
    return date > end - (i + 1) * 7 * DAY && date <= end - i * 7 * DAY;
  }));
  if (weeks.some(week => week.length < MIN_PERIOD_SAMPLES)) return notAvailable(`4週すべてに最低${MIN_PERIOD_SAMPLES}観測が必要です（${weeks.map(week => week.length).join(' / ')}件）。`);
  const means = weeks.map(mean);
  const peak = Math.max(...means);
  if (peak <= 0) return notAvailable('4週間の観測値がすべて0です。');
  const sustained = means.filter(value => value >= peak * 0.5).length;
  return { value: sustained / 4 * 100, unit: '%', reason: `週平均の最大値の50%以上を維持した週が4週中${sustained}週。将来の継続を予測する値ではありません。`, evidenceIds: weeks.flat().map(o => o.id) };
}

/** No novelty score is available from incomplete or topic-only history. */
export function calculateNovelty(): MetricResult {
  return notAvailable('新規性の判定には同一収集範囲の180日以上の継続履歴と類似トピック辞書が必要です。現在は算出しません。');
}

export function diffusion(observations: Observation[], geo: GeoObservation[]) {
  const family = (source: string) => source.startsWith('google-trends') ? 'Google Trends' : source.startsWith('bluesky') ? 'Bluesky' : source;
  const permitted = observations.filter(o => !isYouTube(o.source));
  const sources = new Set(permitted.filter(o => o.sourceUrl).map(o => family(o.source)));
  const markets = new Set(permitted.filter(o => o.regionMeaning === 'search-market' && o.regionCode).map(o => o.regionCode as string));
  const publisherCountries = new Set(permitted.filter(o => o.regionMeaning === 'publisher-country' && o.regionCode).map(o => o.regionCode as string));
  for (const g of geo) {
    if (!g.sourceUrl || !Number.isFinite(g.value) || isYouTube(g.source)) continue;
    sources.add(family(g.source));
    if (g.regionMeaning === 'search-market') markets.add(g.regionCode);
    if (g.regionMeaning === 'publisher-country') publisherCountries.add(g.regionCode);
  }
  return { sources: [...sources], searchMarkets: [...markets], publisherCountries: [...publisherCountries],
    evidenceIds: [...permitted.filter(o => o.sourceUrl).map(o => o.id), ...geo.filter(o => o.sourceUrl && !isYouTube(o.source)).map(o => o.id)],
    limitation: '収集元の系統別に示した観測範囲です。情報源間の独立性は保証されません。地域間の数値比較や、人から人への伝播・因果関係を示しません。YouTubeは独自派生指標の許諾を確認できないため対象外です。' };
}

const SENSITIVE = /災害|地震|津波|洪水|台風|事故|殺人|死者|戦争|虐待|差別|自殺|テロ|銃撃|被害|disaster|earthquake|flood|murder|suicide|war\b|shooting|racis|terror|death|dead|abuse/i;
export function brandSafety(topic: Pick<Topic, 'title' | 'category' | 'aliases'>, observations: Pick<Observation, 'title'>[] = []) {
  const flagged = SENSITIVE.test([topic.title, topic.category, ...topic.aliases.map(alias => alias.text), ...observations.map(item => item.title)].join(' '));
  return { flagged, reason: flagged ? '事故・災害・暴力・差別などの可能性を含むため、広告活用案の自動提案を停止しています。内容と文脈を人が確認してください。' : '簡易キーワード検査です。安全性を保証するものではありません。広告利用前に文脈・権利・当事者への影響を確認してください。' };
}

export function audienceEvidenceFor(evidence: AudienceEvidence[], regionCode: string, age: string, segment: string): AudienceEvidence[] {
  // An unfiltered/all age survey must never become measured evidence about a selected age.
  return evidence.filter(item => item.regionCode === regionCode && item.age === age && item.segment === segment && Boolean(item.sourceUrl) && Boolean(item.population) && Boolean(item.methodology));
}

export function topicEvidence(dataset: Dataset, topicId: string, importedGeo: GeoObservation[] = []) {
  return {
    observations: dataset.observations.filter(observation => observation.topicId === topicId),
    geo: [...dataset.geoObservations, ...importedGeo].filter(observation => observation.topicId === topicId),
  };
}

export function describeMetric(observation: Observation): string {
  const number = observation.metric.value;
  return `${observation.metric.name}: ${number === null ? '値なし' : number.toLocaleString('ja-JP')} ${observation.metric.unit}（${observation.population}）`;
}
