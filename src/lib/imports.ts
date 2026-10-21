import Papa from 'papaparse';
import type { GeoObservation, Topic } from '../types';

export interface GeoCsvOptions {
  topic: string; topicId?: string; sourceUrl: string; fetchedAt: string; normalization: string;
  date?: string; region?: string; layer?: 'search-interest' | 'news-publisher';
}
export interface GeoCsvResult { rows: GeoObservation[]; topic: Topic; errors: string[]; warnings: string[]; kind: 'regional' | 'timeline' | 'canonical' | 'unknown' }
const codes = 'AF AL DZ AS AD AO AI AQ AG AR AM AW AU AT AZ BS BH BD BB BY BE BZ BJ BM BT BO BA BW BV BR IO BN BG BF BI KH CM CA CV KY CF TD CL CN CX CC CO KM CG CD CK CR CI HR CU CY CZ DK DJ DM DO EC EG SV GQ ER EE ET FK FO FJ FI FR GF PF TF GA GM GE DE GH GI GR GL GD GP GU GT GG GN GW GY HT HM VA HN HK HU IS IN ID IR IQ IE IM IL IT JM JP JE JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MO MK MG MW MY MV ML MT MH MQ MR MU YT MX FM MD MC MN ME MS MA MZ MM NA NR NP NL NC NZ NI NE NG NU NF MP NO OM PK PW PS PA PG PY PE PH PN PL PT PR QA RE RO RU RW BL SH KN LC MF PM VC WS SM ST SA SN RS SC SL SG SX SK SI SB SO ZA GS SS ES LK SD SR SJ SZ SE CH SY TW TJ TZ TH TL TG TK TO TT TN TR TM TC TV UG UA AE GB US UM UY UZ VU VE VN VG VI WF EH YE ZM ZW XK'.split(' ');
const aliases: Record<string,string> = { 'United States of America':'US', USA:'US', UK:'GB', 'South Korea':'KR', 'Korea, South':'KR', 'Republic of Korea':'KR', 'Korea, Republic of':'KR', 'North Korea':'KP', 'Hong Kong SAR China':'HK', 'Taiwan, Province of China':'TW', 'Czech Republic':'CZ', 'Vietnam':'VN', 'Russia':'RU', 'Türkiye':'TR', 'Ivory Coast':'CI', '世界全体':'WORLD', Worldwide:'WORLD' };
const prefectures = ['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県'];
const prefectureEnglish = ['Hokkaido','Aomori','Iwate','Miyagi','Akita','Yamagata','Fukushima','Ibaraki','Tochigi','Gunma','Saitama','Chiba','Tokyo','Kanagawa','Niigata','Toyama','Ishikawa','Fukui','Yamanashi','Nagano','Gifu','Shizuoka','Aichi','Mie','Shiga','Kyoto','Osaka','Hyogo','Nara','Wakayama','Tottori','Shimane','Okayama','Hiroshima','Yamaguchi','Tokushima','Kagawa','Ehime','Kochi','Fukuoka','Saga','Nagasaki','Kumamoto','Oita','Miyazaki','Kagoshima','Okinawa'];
const regionNames = new Map<string,string>();
for (const code of codes) {
  regionNames.set(code.toLocaleLowerCase(), code);
  for (const lang of ['ja','en','ko']) {
    try { const name = new Intl.DisplayNames([lang], { type:'region' }).of(code); if (name) regionNames.set(name.toLocaleLowerCase(),code); } catch { /* supported country codes only */ }
  }
}
for (const [name,code] of Object.entries(aliases)) regionNames.set(name.toLocaleLowerCase(),code);
prefectures.forEach((name,i)=>{ const code=`JP-${String(i+1).padStart(2,'0')}`; regionNames.set(name,code); regionNames.set(name.replace(/[都府県]$/,''),code); regionNames.set(prefectureEnglish[i].toLowerCase(),code); regionNames.set(code.toLowerCase(),code); });
export function resolveRegion(name:string):string | null { return regionNames.get(name.trim().toLocaleLowerCase()) ?? null; }
export function regionName(code:string):string { if (/^JP-\d{2}$/.test(code)) return prefectures[Number(code.slice(3))-1] ?? code; try {return new Intl.DisplayNames(['ja'],{type:'region'}).of(code) || code;} catch {return code;} }
export function stableHash(value:string):string { let hash=2166136261; for (let i=0;i<value.length;i++) {hash^=value.charCodeAt(i);hash=Math.imul(hash,16777619);} return (hash>>>0).toString(36); }
function validUrl(url:string):boolean {try { const u=new URL(url);return ['https:','http:'].includes(u.protocol) && !u.username && !u.password; } catch {return false;} }
export function validISODate(value:string):boolean { const match=/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(value); if (!match) return false; const date=new Date(value);return Number.isFinite(date.valueOf()) && date.toISOString().slice(0,10)===`${match[1]}-${match[2]}-${match[3]}`; }
function dateValue(value:string):string | null { const s=value.trim(); if (/^\d{4}$/.test(s)) return `${s}-01-01`; if (/^\d{4}-\d{2}$/.test(s)) return validISODate(`${s}-01`) ? `${s}-01`:null; return validISODate(s) ? s.slice(0,10):null; }

/** Parse Google Trends regional/timeline export or explicit canonical CSV. No missing value is converted to zero. */
export function parseGeoCsv(text:string,options:GeoCsvOptions):GeoCsvResult {
  const title=options.topic.trim();
  const topicId=options.topicId || `import-${stableHash(title)}`;
  const topic:Topic={id:topicId,title,category:'未分類',aliases:[],observationIds:[]};
  const out:GeoCsvResult={rows:[],topic,errors:[],warnings:[],kind:'unknown'};
  if (!title) out.errors.push('トピック名を入力してください。');
  if (!validUrl(options.sourceUrl.trim())) out.errors.push('原典URLは http(s) の公開URLを指定してください。');
  if (!validISODate(options.fetchedAt)) out.errors.push('取得日時を正しいISO日付で指定してください。');
  if (!options.normalization.trim()) out.errors.push('正規化範囲・比較条件を記録してください。');
  if (text.length>5_000_000) {out.errors.push('CSVは5 MB以下にしてください。');return out;}
  const parsed=Papa.parse<string[]>(text.replace(/^\uFEFF/,''),{skipEmptyLines:'greedy',delimiter:','});
  if (parsed.errors.some(e=>['MissingQuotes','UndetectableDelimiter'].includes(e.code))) out.errors.push('CSVの引用符または区切り文字を確認してください。');
  const input=parsed.data;
  const headerIndex=input.findIndex(row=>{
    const first=(row[0] || '').trim().toLowerCase();
    return (row.map(v=>v.trim().toLowerCase()).includes('date') && row.map(v=>v.trim().toLowerCase()).includes('region') && row.map(v=>v.trim().toLowerCase()).includes('value')) || /^(country|region|subregion|country\/region|国|地域|国や地域|小区域|都道府県|国または地域|day|week|month|日|週|月)$/.test(first);
  });
  if (headerIndex<0) {out.errors.push('対応するCSVヘッダーがありません。Google Trendsの地域別/時系列CSV、または date,region,value の形式を使用してください。');return out;}
  const headers=input[headerIndex].map(v=>v.trim());
  const lower=headers.map(v=>v.toLowerCase());
  const canonical=['date','region','value'].every(v=>lower.includes(v));
  out.kind=canonical ? 'canonical':/^(day|week|month|日|週|月)$/.test(lower[0]) ? 'timeline':'regional';
  const layer=options.layer || 'search-interest';
  if (out.kind==='timeline' && !options.region) out.errors.push('時系列CSVには対象国・都道府県を明示的に指定してください。列名から国を推測しません。');
  if (out.kind==='timeline' && headers.length!==2) out.errors.push('時系列CSVは日付と1系列の2列にしてください。複数系列は、系列ごとに国・比較条件を指定して取り込んでください。');
  if (out.kind==='regional' && !dateValue(options.date || '')) out.errors.push('地域別CSVは期間別のスナップショットです。観測期間の終了日を入力してください。');
  if (out.kind==='regional' && headers.length!==2) out.errors.push('地域別CSVは地域名と1つの指標の2列にしてください。');
  if (out.errors.length) return out;
  const valueColumn=canonical ? lower.indexOf('value'):1;
  const dateColumn=canonical ? lower.indexOf('date'):0;
  const regionColumn=canonical ? lower.indexOf('region'):0;
  const importId=`csv-${stableHash(`${text}|${JSON.stringify(options)}`)}`;
  const seen=new Set<string>();
  for (let n=headerIndex+1;n<input.length;n++) {
    const row=input[n]; if (!row.some(v=>v.trim())) continue;
    const read=(name:string):string | undefined => canonical&&lower.includes(name) ? (row[lower.indexOf(name)] || '').trim():undefined;
    const declaredLayer=read('layer') ?? layer;
    if (!['search-interest','news-publisher'].includes(declaredLayer)) {out.errors.push(`${n+1}行目: layerは search-interest または news-publisher を指定してください。`);continue;}
    if (declaredLayer!==layer) {out.errors.push(`${n+1}行目: CSVのlayer「${declaredLayer}」と選択したデータレイヤーが異なります。検索関心とニュース報道を変換せず、対応するレイヤーを選択してください。`);continue;}
    const expectedUnit=layer==='search-interest'?'index':'articles';
    const unit=read('unit') ?? expectedUnit;
    if (unit!==expectedUnit) {out.errors.push(`${n+1}行目: unit「${unit}」は選択したlayerと一致しません（${expectedUnit}が必要）。`);continue;}
    const expectedMeaning=layer==='search-interest'?'search-market':'publisher-country';
    const regionMeaning=read('regionmeaning') ?? expectedMeaning;
    if (regionMeaning!==expectedMeaning) {out.errors.push(`${n+1}行目: regionMeaning「${regionMeaning}」はこのレイヤーと異なります。報道国と出来事の場所は混同できません。`);continue;}
    const rowFetchedAt=read('fetchedat') ?? options.fetchedAt;
    if (!validISODate(rowFetchedAt)) {out.errors.push(`${n+1}行目: fetchedAtは正しいISO取得日時を指定してください。`);continue;}
    const defaultPopulation=layer==='search-interest'?'ユーザー取込：Google Trendsエクスポートの指定期間・地域における検索（抽出・正規化済み）。原典未検証。':'ユーザー取込：CSVに記録された報道機関所在国の記事観測。出来事の場所ではありません。原典未検証。';
    const population=read('population') ?? defaultPopulation;
    if (!population) {out.errors.push(`${n+1}行目: 観測母集団 population が空欄です。`);continue;}
    const declaredSource=read('source');
    const originalSource=read('originalsource') || (declaredSource&&declaredSource!=='csv-import'?declaredSource:undefined);
    if (originalSource && (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(originalSource))) {out.errors.push(`${n+1}行目: 情報源IDが不正です。`);continue;}
    const originalImportId=read('originalimportid') || read('importid') || undefined;
    const numeric=(row[valueColumn] || '').trim();
    if (!numeric || /^(<|≤)|^(n\/a|nan|—|-|null)$/i.test(numeric)) {out.warnings.push(`${n+1}行目: 欠損・抑制値「${numeric || '空欄'}」を除外しました。0には置換していません。`);continue;}
    const value=Number(numeric.replace(/,/g,'').replace(/%$/,''));
    if (!Number.isFinite(value) || value<0 || (layer==='search-interest' && value>100) || (layer==='news-publisher' && !Number.isInteger(value))) {out.errors.push(`${n+1}行目: 指標値が不正です（検索指数0–100、記事数は0以上の整数）。`);continue;}
    const region=resolveRegion(out.kind==='timeline' ? options.region! : row[regionColumn] || '');
    if (!region || region==='WORLD') {out.warnings.push(`${n+1}行目: 対応する国/都道府県がない「${row[regionColumn] || options.region || ''}」を除外しました。`);continue;}
    const date=dateValue(out.kind==='regional' ? options.date!:row[dateColumn] || '');
    if (!date) {out.errors.push(`${n+1}行目: 日付はYYYY-MM-DD / YYYY-MM / YYYYで指定してください。`);continue;}
    const rowTopic=canonical && lower.includes('topic') ? row[lower.indexOf('topic')]?.trim():null;
    if (rowTopic && rowTopic!==title) {out.errors.push(`${n+1}行目: topicが入力したトピック名と異なります。トピックごとに取り込んでください。`);continue;}
    const sourceUrl=read('sourceurl') ?? options.sourceUrl;
    const normalization=read('normalization') ?? options.normalization;
    if (!normalization.trim()) {out.errors.push(`${n+1}行目: normalization（正規化範囲）が空欄です。`);continue;}
    if (!validUrl(sourceUrl)) {out.errors.push(`${n+1}行目: 原典URLが不正です。`);continue;}
    const key=JSON.stringify([topicId,region,date,sourceUrl,normalization,layer,unit,regionMeaning,originalSource]);
    if (seen.has(key)) {out.warnings.push(`${n+1}行目: 同一地域・日付・原典の重複を除外しました。`);continue;}
    seen.add(key);
    out.rows.push({id:`csv-${stableHash(key)}`,topicId,source:'csv-import',sourceUrl,regionCode:region,regionMeaning,date,fetchedAt:new Date(rowFetchedAt).toISOString(),layer,value,unit,normalization:normalization.trim(),population,importId,...(originalSource?{originalSource}:{}),...(originalImportId?{originalImportId}:{})});
  }
  if (!out.rows.length && !out.errors.length) out.errors.push('有効な観測値がありません。欠損値や地域名を確認してください。');
  if (out.kind==='regional') out.warnings.push('地域別エクスポートの観測期間全体を1つのスナップショットとして扱います。期間内の日別推移は生成しません。');
  if (out.rows.some(r=>r.regionCode.startsWith('JP-'))) out.warnings.push('都道府県データは地域別一覧・時系列で表示します。都道府県境界の地図レイヤーは未対応です。');
  if (out.errors.length) out.rows=[];
  return out;
}

/** Independent exports are incomparable until curated into one documented comparison scope. */
export function geoComparisonKey(row:GeoObservation):string {
  return JSON.stringify([row.source,row.originalSource || null,row.unit,row.normalization,row.sourceUrl,row.layer,row.regionMeaning,row.source==='csv-import' ? row.importId || row.id : null]);
}

/** Canonical export is deliberately lossless for meaning/provenance; reimport is still user-supplied evidence. */
export function geoCsvRows(rows:GeoObservation[],title:string):(string|number)[][] {
  return [['date','region','value','topic','sourceUrl','normalization','fetchedAt','layer','unit','regionMeaning','population','source','originalSource','importId','originalImportId'],...rows.map(r=>[r.date,r.regionCode,r.value,title,r.sourceUrl,r.normalization,r.fetchedAt,r.layer,r.unit,r.regionMeaning,r.population,r.source,r.originalSource || '',r.importId || '',r.originalImportId || ''])];
}
