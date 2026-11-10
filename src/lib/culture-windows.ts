/** Optional v2 read model. Canonical observations and browser research retain v1 IDs. */
type Row = Record<string, unknown>;
const isRow = (value: unknown): value is Row => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string';
const nonempty = (value: unknown): value is string => text(value) && value.trim().length > 0 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const own = (value: Row, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const FIELD_NAMES = new Set(['metadata', 'headline', 'link', 'metrics']);
const FUTURE_TOLERANCE = 5 * 60_000;
const POLICY_KEYS = ['visibility', 'aiAllowed', 'termsUrl', 'license', 'allowedFields', 'checkedAt', 'note'];
const WINDOW_KEYS = ['id', 'name', 'description', 'countryCodes', 'languages', 'categories', 'sources', 'enabled', 'scopeNote'];
const BINDING_KEYS = ['id', 'source', 'adapter', 'enabled', 'endpoint', 'countryCodes', 'verification', 'publication', 'disabledReason'];
const VERIFICATION_KEYS = ['status', 'method', 'checkedAt', 'evidenceUrl', 'note'];
const RESTRICTION_KEYS = ['publicAllowed', 'aiAllowed'];
const identifier = (value: unknown): value is string => text(value) && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.exec(value)?.[0] === value;
const LANGUAGE_NAMES: Record<string, string> = { English: 'en', Japanese: 'ja', Korean: 'ko', French: 'fr', German: 'de', Spanish: 'es', Italian: 'it', Portuguese: 'pt', Chinese: 'zh', Thai: 'th', Vietnamese: 'vi', Indonesian: 'id', Malay: 'ms', Tagalog: 'tl', Dutch: 'nl' };

function requireValue(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(`観測窓のデータ形式エラー: ${label}`);
}

function exactKeys(value: Row, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => own(value, key));
}

function validRestriction(value: unknown): value is Row {
  return isRow(value) && exactKeys(value, RESTRICTION_KEYS) && typeof value.publicAllowed === 'boolean'
    && typeof value.aiAllowed === 'boolean' && (value.publicAllowed || !value.aiAllowed);
}

/** Reject date-only/local dates and calendar overflow instead of guessing a timezone. */
export function awareTimestamp(value: unknown): value is string {
  if (!text(value)) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  if (day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return false;
  const zone = match[7];
  return zone === 'Z' || (Number(zone.slice(1, 3)) <= 23 && Number(zone.slice(4)) <= 59);
}

export function publicSourceUrl(value: unknown): value is string {
  if (!nonempty(value) || /[\s\\]/.test(value)) return false;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (host === 'localhost' || host === 'localhost.localdomain' || host.endsWith('.localhost') || host.endsWith('.local')) return false;
    if (host.startsWith('[')) {
      // Global unicast only; localhost, mapped/local/reserved addresses are not public feeds.
      if (!/^\[[23][0-9a-f]{3}:/.test(host) || host.startsWith('[2001:db8:')) return false;
    } else if (/^\d+(?:\.\d+){3}$/.test(host)) {
      const [a, b, c] = host.split('.').map(Number);
      if ([0, 10, 127].includes(a) || a >= 224 || (a === 100 && b >= 64 && b <= 127)
        || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && (b === 168 || (b === 0 && [0, 2].includes(c))))
        || (a === 198 && ([18, 19].includes(b) || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113)) return false;
    } else if (!host.includes('.')) return false;
    for (const key of url.searchParams.keys()) {
      if (/^(?:key|api[_-]?key|apikey|access[_-]?token|token|authorization|password|secret|signature|sig|credential)$/i.test(key)) return false;
    }
    return true;
  } catch { return false; }
}

function uniqueStrings(value: unknown, pattern?: RegExp): value is string[] {
  return Array.isArray(value) && value.every(item => nonempty(item) && (!pattern || pattern.exec(item)?.[0] === item)) && new Set(value).size === value.length;
}

function validPolicy(value: unknown): value is Row {
  return isRow(value) && exactKeys(value, POLICY_KEYS) && ['public', 'private', 'unknown'].includes(String(value.visibility)) && typeof value.aiAllowed === 'boolean'
    && publicSourceUrl(value.termsUrl) && nonempty(value.license) && uniqueStrings(value.allowedFields)
    && value.allowedFields.every(item => FIELD_NAMES.has(item)) && awareTimestamp(value.checkedAt)
    && Date.parse(value.checkedAt) <= Date.now() + FUTURE_TOLERANCE && nonempty(value.note);
}

/** Legacy records without a policy keep their old behavior; every explicit policy fails closed. */
export function publicationAllowed(record: unknown, options: { forAI?: boolean; legacyDefault?: boolean } = {}): boolean {
  if (!isRow(record)) return false;
  if (own(record, 'publicationRestriction')) {
    const restriction = record.publicationRestriction;
    if (!validRestriction(restriction) || restriction.publicAllowed !== true || (options.forAI && restriction.aiAllowed !== true)) return false;
  }
  if (!own(record, 'publication')) return options.legacyDefault ?? true;
  const policy = record.publication;
  if (!validPolicy(policy) || policy.visibility !== 'public') return false;
  const required = ['link'];
  // An explicit policy covers the entire serialized canonical row, not a selected view.
  if (own(record, 'topicId') && (own(record, 'metric') || own(record, 'title'))) required.push('metadata', 'headline', 'metrics');
  else if (own(record, 'topicId') && own(record, 'value')) required.push('metadata', 'metrics');
  if (options.forAI) required.push('headline');
  return required.every(field => (policy.allowedFields as string[]).includes(field)) && (!options.forAI || policy.aiAllowed === true);
}

const countries = (value: unknown): value is string[] => uniqueStrings(value, /^[A-Z]{2}$/);
const languages = (value: unknown): value is string[] => uniqueStrings(value, /^(?:[a-z]{2,3})(?:-[A-Za-z0-9]{2,8})*$/);

function rows(value: unknown, label: string): Row[] {
  requireValue(Array.isArray(value) && value.every(isRow), label);
  const ids = value.map(item => item.id);
  requireValue(ids.every(nonempty) && new Set(ids).size === ids.length, `${label}のID重複・欠損`);
  return value;
}

function binding(value: Row): void {
  requireValue(exactKeys(value, BINDING_KEYS), '情報源に未対応の項目');
  requireValue(identifier(value.source) && identifier(value.adapter) && typeof value.enabled === 'boolean', '情報源の識別・有効状態');
  requireValue(publicSourceUrl(value.endpoint) && countries(value.countryCodes), '情報源URL・国コード');
  requireValue(validPolicy(value.publication), '情報源の利用条件');
  const verification = value.verification;
  requireValue(isRow(verification) && exactKeys(verification, VERIFICATION_KEYS) && ['verified', 'unverified', 'failed'].includes(String(verification.status)), '情報源の確認状態');
  requireValue((verification.method === null || ['recorded-collection', 'live-fetch'].includes(String(verification.method)))
    && (verification.checkedAt === null || awareTimestamp(verification.checkedAt))
    && (verification.evidenceUrl === null || publicSourceUrl(verification.evidenceUrl)) && nonempty(verification.note), '情報源の確認記録');
  if (verification.checkedAt !== null) requireValue(Date.parse(verification.checkedAt as string) <= Date.now() + FUTURE_TOLERANCE, '情報源の確認日時が未来');
  requireValue(value.disabledReason === null || nonempty(value.disabledReason), '情報源の無効理由');
  if (value.enabled) {
    requireValue(verification.status === 'verified' && verification.method !== null && verification.checkedAt !== null && verification.evidenceUrl !== null, '未確認の情報源が有効');
    requireValue(publicationAllowed(value, { legacyDefault: false }), '公開不可の情報源が有効');
  } else requireValue(nonempty(value.disabledReason), '無効な情報源に停止理由がない');
}

/** No coercion/migration: an old Dataset is returned by parseDataset byte-for-byte in shape. */
export function validateCultureWindowData(value: Row): void {
  if (own(value, 'publicationRestrictions')) {
    requireValue(Array.isArray(value.publicationRestrictions), '公開制限台帳が配列でない');
    const restrictionKeys = new Set<string>();
    for (const entry of value.publicationRestrictions) {
      requireValue(isRow(entry) && exactKeys(entry, ['key', ...RESTRICTION_KEYS]) && text(entry.key) && /^[a-f0-9]{64}$/.test(entry.key), '公開制限台帳の識別子・項目が不正');
      requireValue(typeof entry.publicAllowed === 'boolean' && typeof entry.aiAllowed === 'boolean'
        && !(entry.publicAllowed && entry.aiAllowed) && (entry.publicAllowed || !entry.aiAllowed), '公開制限台帳の許可区分が不正');
      requireValue(!restrictionKeys.has(entry.key), '公開制限台帳の識別子重複');
      restrictionKeys.add(entry.key);
    }
  }
  // Public readers must never accept explicitly denied canonical data, even without v2 arrays.
  for (const key of ['observations', 'geoObservations']) {
    if (Array.isArray(value[key])) for (const item of value[key]) {
      requireValue(publicationAllowed(item), '公開不可または権利不明の正規観測');
    }
  }
  const keys = ['cultureWindows', 'windowObservations', 'windowCollectionRuns'];
  if (!keys.some(key => own(value, key))) return;
  requireValue(keys.every(key => own(value, key)), '追加配列は3種類を同時に指定');
  const windows = rows(value.cultureWindows, 'cultureWindows');
  const observations = rows(value.windowObservations, 'windowObservations');
  const runs = rows(value.windowCollectionRuns, 'windowCollectionRuns');
  const canonical = new Map((value.observations as Row[]).map(item => [item.id, item]));
  const windowMap = new Map(windows.map(item => [item.id, item]));
  const bindingMap = new Map<string, Row>();
  for (const window of windows) {
    requireValue(exactKeys(window, WINDOW_KEYS), '観測窓に未対応の項目');
    requireValue(identifier(window.id) && nonempty(window.name) && nonempty(window.description) && nonempty(window.scopeNote) && typeof window.enabled === 'boolean', '観測窓の名称・説明');
    requireValue(countries(window.countryCodes) && languages(window.languages) && uniqueStrings(window.categories), '観測窓の国・言語・カテゴリー');
    for (const source of rows(window.sources, 'sources')) {
      requireValue(identifier(source.id), '情報源のID');
      binding(source);
      requireValue((source.countryCodes as string[]).every(code => (window.countryCodes as string[]).includes(code)), '観測窓と情報源の国コード');
      bindingMap.set(`${window.id}\0${source.id}`, source);
    }
  }
  const deduplication = new Set<string>();
  for (const item of observations) {
    requireValue(identifier(item.id), '窓観測のID');
    const window = windowMap.get(item.windowId);
    const original = canonical.get(item.observationId);
    requireValue(window?.enabled === true && original, '無効な観測窓または正規観測への参照');
    requireValue(item.source === original.source && item.sourceItemId === original.sourceId && item.sourceUrl === original.sourceUrl
      && publicSourceUrl(item.sourceUrl), '原典情報が正規観測と不一致');
    requireValue(awareTimestamp(item.observedAt) && awareTimestamp(item.fetchedAt) && item.observedAt === original.observedAt && item.fetchedAt === original.fetchedAt, '観測・取得日時が正規観測と不一致');
    requireValue(item.publishedAt === (original.publishedAt || null) && (item.publishedAt === null || awareTimestamp(item.publishedAt)), '公開日時が正規観測と不一致');
    requireValue(Date.parse(item.observedAt) <= Date.parse(item.fetchedAt) + FUTURE_TOLERANCE
      && (item.publishedAt === null || Date.parse(item.publishedAt as string) <= Date.parse(item.fetchedAt) + FUTURE_TOLERANCE), '公開・観測日時が取得日時より未来');
    requireValue(item.language === null || (text(item.language) && languages([item.language])), '観測言語');
    const originalLanguage = typeof original.language === 'string' ? LANGUAGE_NAMES[original.language] || (languages([original.language]) ? original.language : null) : null;
    requireValue(item.language === originalLanguage, '観測言語が原典メタデータと不一致');
    requireValue(isRow(item.regionScope) && item.regionScope.kind === original.regionMeaning && countries(item.regionScope.countryCodes), '地域の意味が正規観測と不一致');
    const originalCountries = original.regionCode === null ? [] : [original.regionCode];
    requireValue(JSON.stringify(item.regionScope.countryCodes) === JSON.stringify(originalCountries), '地域を国から推測・変更');
    requireValue(!(window.countryCodes as string[]).length || (window.countryCodes as string[]).includes(original.regionCode as string), '観測窓外の地域');
    requireValue(['search-trend', 'news-mention', 'community-post', 'video', 'feed-item'].includes(String(item.evidenceType)) && ['fresh', 'stale'].includes(String(item.status)), '観測種別・更新状態');
    requireValue(original.status !== 'stale' || item.status === 'stale', '古い正規観測を新しい観測と表示');
    requireValue(publicationAllowed(item, { legacyDefault: false }), '公開不可の窓観測');
    requireValue(identifier(item.sourceBindingId), '観測に情報源の参照がない');
    const source = bindingMap.get(`${item.windowId}\0${item.sourceBindingId}`);
    requireValue(source?.enabled === true && source.source === item.source && publicationAllowed(source, { legacyDefault: false }), '無効な情報源の窓観測');
    requireValue(!(source.countryCodes as string[]).length || (source.countryCodes as string[]).includes(original.regionCode as string), '情報源の対象国から外れた窓観測');
    if (item.source === 'google-trends') requireValue(item.evidenceType === 'search-trend', '検索指標を別の根拠種別へ変更');
    if (item.source === 'gdelt') requireValue(item.evidenceType === 'news-mention', 'ニュース指標を別の根拠種別へ変更');
    if (source.adapter === 'legacy-google-trends') requireValue(item.evidenceType === 'search-trend' && item.regionScope.kind === 'search-market', '検索指標を別の根拠種別へ変更');
    if (source.adapter === 'legacy-gdelt') requireValue(item.evidenceType === 'news-mention' && item.regionScope.kind === 'publisher-country', 'ニュース指標を別の根拠種別へ変更');
    const outputPolicy = item.publication as Row;
    const bindingPolicy = source.publication as Row;
    requireValue(outputPolicy.termsUrl === bindingPolicy.termsUrl && outputPolicy.license === bindingPolicy.license, '窓観測の原典利用条件が情報源と不一致');
    if (own(original, 'publicationRestriction')) {
      const restriction = original.publicationRestriction as Row;
      requireValue(outputPolicy.aiAllowed !== true || restriction.aiAllowed === true, '窓観測の利用権限が元データのAI制限より広い');
    }
    for (const input of [source, original]) if (own(input, 'publication')) {
      const inputPolicy = input.publication as Row;
      requireValue((outputPolicy.allowedFields as string[]).every(field => (inputPolicy.allowedFields as string[]).includes(field))
        && (outputPolicy.aiAllowed !== true || inputPolicy.aiAllowed === true), '窓観測の利用権限が元データより広い');
    }
    // Preserve sub-millisecond precision while comparing equivalent timezone spellings.
    const remainingMicros = (/\.(\d{1,6})/.exec(item.observedAt)?.[1] || '').padEnd(6, '0').slice(3);
    const deduplicationKey = JSON.stringify([item.windowId, item.source, item.sourceItemId, Date.parse(item.observedAt), remainingMicros]);
    requireValue(!deduplication.has(deduplicationKey), '同一原典の窓観測重複');
    deduplication.add(deduplicationKey);
  }
  for (const run of runs) {
    requireValue(identifier(run.id), '実行履歴のID');
    const window = windowMap.get(run.windowId);
    const source = bindingMap.get(`${run.windowId}\0${run.sourceBindingId}`);
    requireValue(window && source && run.source === source.source && run.adapter === source.adapter, '収集実行の参照不一致');
    requireValue(awareTimestamp(run.startedAt) && awareTimestamp(run.finishedAt) && Date.parse(run.startedAt) <= Date.parse(run.finishedAt), '収集実行の日時順序');
    requireValue(['success', 'partial', 'empty', 'error', 'disabled'].includes(String(run.status))
      && Number.isInteger(run.count) && Number(run.count) >= 0 && Number.isInteger(run.retainedCount) && Number(run.retainedCount) >= 0
      && run.method === 'existing-observation-projection' && (run.error === undefined || text(run.error)), '収集実行の状態・件数');
    if (run.status === 'disabled') requireValue(run.count === 0 && run.retainedCount === 0, '無効な情報源の取得件数');
  }
}
