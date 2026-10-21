import type { Dataset, GeoObservation, Observation } from '../types';
import { safeUrl } from './utils';

/** Read model: evidence identity is separate from multilingual topic identity. */
export interface Evidence {
 id:string; observationId:string; source:string; sourceRecordId:string; sourceUrl:string;
 fetchedAt:string; observedAt:string; population:string; method:string; license:string;
}
export interface ContentItem {
 id:string; observationId:string; topicId:string; source:string;
 kind:'post'|'video'|'article'|'search-record'; title:string; url:string;
 publishedAt:string|null; relatedLinks:{title:string;url:string}[];
}
type Row = Record<string,unknown>;
const isRow=(value:unknown):value is Row=>typeof value==='object'&&value!==null&&!Array.isArray(value);
function requireThat(value:unknown,label:string):asserts value { if(!value)throw new Error(`データ形式エラー: ${label}`); }
const text=(value:unknown):value is string=>typeof value==='string';
const date=(value:unknown)=>text(value)&&Boolean(value)&&Number.isFinite(Date.parse(value));
const link=(value:unknown)=>text(value)&&Boolean(safeUrl(value));
function identity(rows:Row[],name:string){const ids=new Set<string>();for(const row of rows){requireThat(text(row.id)&&row.id&&!ids.has(row.id),`${name}のIDが空、または重複しています`);ids.add(row.id);}return ids;}
/** Validate externally supplied static JSON before it reaches any analysis or view. */
export function parseDataset(value:unknown):Dataset {
 requireThat(isRow(value)&&value.schemaVersion===1,'schemaVersion が未対応です');
 for(const key of ['topics','observations','geoObservations','sources','collectionRuns'])requireThat(Array.isArray(value[key])&&(value[key] as unknown[]).every(isRow),`${key} 配列が必要です`);
 requireThat(date(value.generatedAt),'生成日時が不正です');
 const topics=value.topics as Row[],observations=value.observations as Row[],geo=value.geoObservations as Row[],sources=value.sources as Row[],runs=value.collectionRuns as Row[];
 const topicIds=identity(topics,'トピック'),observationIds=identity(observations,'観測'),sourceIds=identity(sources,'情報源');identity(geo,'地域観測');identity(runs,'収集履歴');
 for(const source of sources)requireThat(text(source.name)&&['search','social','news','survey'].includes(String(source.kind))&&link(source.url)&&link(source.termsUrl)&&text(source.license),'情報源の名称・種類・利用条件が不正です');
 for(const topic of topics){requireThat(text(topic.title)&&topic.title&&text(topic.category)&&Array.isArray(topic.aliases)&&topic.aliases.every(a=>isRow(a)&&text(a.id)&&text(a.text)&&text(a.language)),'トピックのタイトル・別名が不正です');requireThat(Array.isArray(topic.observationIds)&&topic.observationIds.every(id=>text(id)&&observationIds.has(id)),'トピックの観測参照が不正です');}
 for(const o of observations){
  requireThat(text(o.topicId)&&topicIds.has(o.topicId)&&text(o.source)&&sourceIds.has(o.source),'観測のトピック・情報源が存在しません');
  requireThat(text(o.title)&&text(o.sourceId)&&link(o.sourceUrl)&&date(o.observedAt)&&date(o.fetchedAt)&&(o.publishedAt===''||date(o.publishedAt)),'観測の原典・日時が不正です');
  requireThat(isRow(o.metric)&&(o.metric.value===null||(typeof o.metric.value==='number'&&Number.isFinite(o.metric.value)&&o.metric.value>=0))&&text(o.metric.name)&&text(o.metric.unit)&&text(o.metric.normalization),'観測の指標値・定義が不正です');
  requireThat((o.regionCode===null||text(o.regionCode))&&['search-market','publisher-country','not-geolocated'].includes(String(o.regionMeaning))&&text(o.population)&&text(o.method)&&text(o.license)&&['fresh','stale'].includes(String(o.status))&&o.reliability==='observed','観測の母集団・地域定義・品質区分が不正です');
 }
 for(const g of geo){
  requireThat(text(g.topicId)&&topicIds.has(g.topicId)&&text(g.source)&&link(g.sourceUrl)&&date(g.date)&&date(g.fetchedAt)&&text(g.regionCode)&&/^[A-Z]{2}(?:-\d{2})?$/.test(g.regionCode),'地域観測の原典・日時・地域が不正です');
  requireThat(['search-interest','news-publisher'].includes(String(g.layer))&&typeof g.value==='number'&&Number.isFinite(g.value)&&g.value>=0&&text(g.unit)&&text(g.normalization)&&text(g.population),'地域観測の指標・定義が不正です');
  requireThat(g.layer==='search-interest'?g.regionMeaning==='search-market'&&g.value<=100:g.regionMeaning==='publisher-country','検索市場と報道機関所在国が混同されています');
 }
 for(const r of runs)requireThat(text(r.source)&&date(r.startedAt)&&date(r.finishedAt)&&['success','error','disabled'].includes(String(r.status))&&typeof r.count==='number'&&Number.isInteger(r.count)&&r.count>=0,'収集履歴の日時・状態が不正です');
 return value as unknown as Dataset;
}
export async function loadDataset(url:string,signal?:AbortSignal):Promise<Dataset>{const response=await fetch(url,{signal,cache:'no-cache'});if(!response.ok)throw new Error(`データ読込 HTTP ${response.status}`);return parseDataset(await response.json());}
export function evidenceFor(dataset:Dataset):Evidence[]{
 return [...dataset.observations.map(o=>({id:`evidence-${o.id}`,observationId:o.id,source:o.source,sourceRecordId:o.sourceId,sourceUrl:o.sourceUrl,fetchedAt:o.fetchedAt,observedAt:o.observedAt,population:o.population,method:o.method,license:o.license})),...dataset.geoObservations.map(g=>({id:`evidence-${g.id}`,observationId:g.id,source:g.source,sourceRecordId:g.id,sourceUrl:g.sourceUrl,fetchedAt:g.fetchedAt,observedAt:g.date,population:g.population,method:g.source==='csv-import'?'利用者によるCSV取り込み（原典未照合）':'公開地域集計',license:dataset.sources.find(s=>s.id===g.source)?.license||'取り込み時に原典の利用権限を確認'}))];
}
export function contentItemsFor(dataset:Dataset):ContentItem[]{return dataset.observations.map(o=>({id:`content-${o.source}-${o.sourceId}`,observationId:o.id,topicId:o.topicId,source:o.source,kind:o.source==='youtube'?'video':dataset.sources.find(s=>s.id===o.source)?.kind==='social'?'post':dataset.sources.find(s=>s.id===o.source)?.kind==='news'?'article':'search-record',title:o.title,url:o.sourceUrl,publishedAt:o.publishedAt||null,relatedLinks:(o.relatedLinks||[]).filter(l=>safeUrl(l.url))}));}
export function observationsForTopic(dataset:Dataset,topicId:string):{observations:Observation[];geo:GeoObservation[]}{return{observations:dataset.observations.filter(o=>o.topicId===topicId),geo:dataset.geoObservations.filter(o=>o.topicId===topicId)};}
