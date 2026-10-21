import { describe, expect, it } from 'vitest';
import Papa from 'papaparse';
import { parseGeoCsv, resolveRegion, validISODate, geoComparisonKey, geoCsvRows } from './imports';
const options={topic:'matcha',sourceUrl:'https://trends.google.com/trends/explore?q=matcha',fetchedAt:'2026-10-21T04:00:00Z',normalization:'same export, period2026-09-01..2026-09-30',date:'2026-09-30'};
describe('geography and Google Trends CSV semantics',()=>{
 it('reads official preamble, UTF8 BOM, countries and suppressed missing values',()=>{
  const r=parseGeoCsv('\uFEFFカテゴリ: すべてのカテゴリ\n\n国,matcha\n日本,100\n米国,<1\n韓国,\nイギリス,32',options);
  expect(r.errors).toEqual([]);expect(r.rows.map(x=>[x.regionCode,x.value])).toEqual([['JP',100],['GB',32]]);expect(r.warnings.length).toBeGreaterThan(2);
 });
 it('requires explicit region for time series and never infers from header',()=>{
  expect(parseGeoCsv('Week,matcha: (United States)\n2026-10-04,50',options).errors[0]).toContain('明示的');
  const r=parseGeoCsv('Week,matcha: (United States)\n2026-10-04,50',{...options,region:'JP'});expect(r.rows[0].regionCode).toBe('JP');
 });
 it('rejects invalid dates, index range, protocols and multiple series',()=>{
  expect(validISODate('2026-02-30')).toBe(false);
  expect(parseGeoCsv('date,region,value\n2026-10-01,US,101',options).rows).toEqual([]);
  expect(parseGeoCsv('国,matcha\n日本,50',{...options,sourceUrl:'javascript:alert(1)'}).errors.length).toBeGreaterThan(0);
  expect(parseGeoCsv('Week,a,b\n2026-10-04,50,40',{...options,region:'US'}).errors.length).toBeGreaterThan(0);
 });
 it('deduplicates, handles quoted fields, keeps source and normalization',()=>{
  const r=parseGeoCsv('date,region,value,topic,sourceUrl,normalization\n2026-10-01,US,40,matcha,https://example.org/data,"same, scope"\n2026-10-01,US,40,matcha,https://example.org/data,"same, scope"',options);
  expect(r.rows).toHaveLength(1);expect(r.rows[0].normalization).toBe('same, scope');expect(r.rows[0].regionMeaning).toBe('search-market');expect(r.rows[0].fetchedAt).toBe('2026-10-21T04:00:00.000Z');
 });
 it('keeps measured zero while skipping missing; matches prefectures',()=>{
  const r=parseGeoCsv('地域,matcha\n東京都,0\nKanagawa,20\nunknown,30',options);expect(r.rows.map(x=>[x.regionCode,x.value])).toEqual([['JP-13',0],['JP-14',20]]);
  expect(resolveRegion('South Korea')).toBe('KR');expect(resolveRegion('GB')).toBe('GB');
 });
 it('rejects whole import if some rows invalid instead of silent partial update',()=>{
  const r=parseGeoCsv('date,region,value\n2026-10-01,US,50\n2026-10-99,JP,30',options);expect(r.errors).not.toHaveLength(0);expect(r.rows).toHaveLength(0);
 });
});

describe('comparison provenance',()=>{
 const a=parseGeoCsv('国,matcha\n日本,50',options).rows[0];
 it('separates independent exports despite same normalization text',()=>{
  expect(geoComparisonKey(a)).not.toBe(geoComparisonKey({...a,importId:'another-export'}));
  expect(geoComparisonKey(a)).not.toBe(geoComparisonKey({...a,sourceUrl:'https://example.org/other'}));
  expect(geoComparisonKey(a)).not.toBe(geoComparisonKey({...a,regionMeaning:'publisher-country'}));
 });
 it('keeps countries from the same file and scope comparable without mixing units',()=>{
  expect(geoComparisonKey(a)).toBe(geoComparisonKey({...a,regionCode:'US',value:20}));
  expect(geoComparisonKey(a)).not.toBe(geoComparisonKey({...a,unit:'articles'}));
 });
});

describe('official annual archive grouping',()=>{
 it('keeps annual and country population labels in one availability scope, not one group per row',()=>{
  const original={...parseGeoCsv('国,matcha\n日本,50',options).rows[0],source:'google-trends-archive',importId:undefined,normalization:'正規化範囲は原典未詳。国間値比較不可。',sourceUrl:'https://github.com/googletrends/data/blob/pinned/file.csv',population:'Google Trends 公開履歴、AU、2012年の年次バケット。',regionCode:'AU',date:'2012-01-01'};
  const later={...original,regionCode:'JP',date:'2023-01-01',population:'Google Trends 公開履歴、JP、2023年の年次バケット。'};
  expect(geoComparisonKey(original)).toBe(geoComparisonKey(later));
 });
});

describe('canonical export and reimport preserves data meaning',()=>{
 const measured={...parseGeoCsv('国,matcha\n日本,50',options).rows[0],source:'gdelt',regionMeaning:'publisher-country',layer:'news-publisher' as const,unit:'articles',value:15,fetchedAt:'2026-09-10T12:34:56Z',population:'GDELT indexed online news, publishers in JP; not event location',normalization:'raw nonoverlapping article count, daily UTC',importId:undefined};
 it('rejects news exported CSV when selected UI defaults to search rather than relabeling values',()=>{
  const csv=Papa.unparse(geoCsvRows([measured],'matcha'));
  const result=parseGeoCsv(csv,options);
  expect(result.rows).toHaveLength(0);expect(result.errors.join(' ')).toContain('layer');
 });
 it('roundtrips row retrieval, source URL, population, unit and news country semantics',()=>{
  const csv=Papa.unparse(geoCsvRows([measured],'matcha'));
  const result=parseGeoCsv(csv,{...options,layer:'news-publisher'});
  expect(result.errors).toEqual([]);
  expect(result.rows[0]).toMatchObject({source:'csv-import',originalSource:'gdelt',sourceUrl:measured.sourceUrl,population:measured.population,unit:'articles',layer:'news-publisher',regionMeaning:'publisher-country',value:15,normalization:measured.normalization,fetchedAt:'2026-09-10T12:34:56.000Z'});
  // A second export/reimport retains the claimed original API and the import's provenance.
  const second=parseGeoCsv(Papa.unparse(geoCsvRows(result.rows,'matcha')),{...options,layer:'news-publisher'});
  expect(second.rows[0].originalSource).toBe('gdelt');expect(second.rows[0].originalImportId).toBe(result.rows[0].importId);
 });
 it('rejects schema mismatches, invalid row retrieval and missing provenance instead of falling back',()=>{
  for(const overrides of [{unit:'index'},{regionMeaning:'event-location'},{fetchedAt:'2026-02-31'},{sourceUrl:''},{normalization:''},{population:''}]) {
   const result=parseGeoCsv(Papa.unparse(geoCsvRows([{...measured,...overrides}],'matcha')),{...options,layer:'news-publisher'});
   expect(result.errors.length).toBeGreaterThan(0);expect(result.rows).toHaveLength(0);
  }
 });
});
