import Papa from 'papaparse';
import { resolveRegion } from './imports';
import type { AudienceEvidence } from '../types';

export interface SurveyParseResult { rows: AudienceEvidence[]; errors: string[] }
export const SURVEY_COLUMNS = ['title','sourceUrl','fetchedAt','surveyDate','regionCode','age','gender','segment','population','sampleSize','question','value','unit','methodology','comparabilityKey'];
const required = ['sourceUrl','fetchedAt','surveyDate','regionCode','population','question','value','unit','methodology','comparabilityKey'];
export function isSourceUrl(value: string): boolean {
  try { const url = new URL(value); return ['http:','https:'].includes(url.protocol) && !!url.hostname && !url.username && !url.password; } catch { return false; }
}
function validSurveyDate(value:string):boolean {
  if(!/^\d{4}-\d{2}(-\d{2})?$/.test(value))return false;
  const iso=value.length===7?`${value}-01`:value;const d=new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===iso;
}
function validFetchedAt(value:string):boolean { return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value))&&validSurveyDate(value.slice(0,10)); }
const hash = (value: string) => { let h=2166136261; for(const c of value) h=Math.imul(h^c.charCodeAt(0),16777619); return (h>>>0).toString(36); };
export function parseSurveyCsv(text: string): SurveyParseResult {
  const result = Papa.parse<Record<string,string>>(text.replace(/^\uFEFF/, ''), { header:true, skipEmptyLines:'greedy', transformHeader: v => v.trim().replace(/^sourceURL$/, 'sourceUrl') });
  const errors: string[] = result.errors.map(e=>`CSV ${e.row===undefined?'':e.row+2}行: ${e.message}`);
  const fields=result.meta.fields ?? [];
  for(const column of required) if(!fields.includes(column)) errors.push(`必須列「${column}」がありません。`);
  if(errors.length) return {rows:[],errors};
  const rows:AudienceEvidence[]=[]; const seen=new Set<string>();
  result.data.forEach((raw,index)=>{
    const r = Object.fromEntries(Object.entries(raw).map(([key,value])=>[key,typeof value==='string'?value.trim():'']));
    const rowErrors:string[]=[];
    for(const column of required) if(!r[column]) rowErrors.push(`${column} が空です`);
    if(!isSourceUrl(r.sourceUrl)) rowErrors.push('原典URLは認証情報を含まない http(s) URL にしてください');
    else if(/(^|\.)seikatsusoken\.jp$/.test(new URL(r.sourceUrl).hostname)) rowErrors.push('生活定点はこのアプリでは公式リンクの参照専用です。商用利用・改変・AI入力等の事前許諾を必要とするため、CSV取り込みは対応していません');
    if(!validSurveyDate(r.surveyDate ?? '')) rowErrors.push('surveyDate は YYYY-MM または YYYY-MM-DD です');
    if(!validFetchedAt(r.fetchedAt ?? '')) rowErrors.push('fetchedAt は実際の取得日時を ISO 形式で指定してください');
    if(!/^[A-Z]{2}$/.test(r.regionCode)||resolveRegion(r.regionCode)!==r.regionCode) rowErrors.push('regionCode は大文字2文字の国コードです');
    const value = Number(r.value);
    if(r.value===''||!Number.isFinite(value)) rowErrors.push('value は有限の数値にしてください');
    if(['%','percent','percentage'].includes(r.unit.toLowerCase()) && (value<0||value>100)) rowErrors.push('割合は 0〜100 で指定してください');
    const sampleSize = r.sampleSize ? Number(r.sampleSize) : null;
    if(sampleSize!==null && (!Number.isInteger(sampleSize)||sampleSize<1)) rowErrors.push('sampleSize は正の整数か空欄にしてください');
    if(rowErrors.length) { errors.push(`${index+2}行: ${rowErrors.join(' / ')}`); return; }
    const identity=[r.sourceUrl,r.surveyDate,r.regionCode,r.age,r.gender,r.segment,r.question].join('|');
    if(seen.has(identity)) return; seen.add(identity);
    rows.push({id:`survey-${hash(identity)}`,title:r.title||r.question,sourceUrl:r.sourceUrl,fetchedAt:new Date(r.fetchedAt).toISOString(),surveyDate:r.surveyDate,regionCode:r.regionCode,age:r.age||'all',gender:r.gender||'all',segment:r.segment||'all',population:r.population,sampleSize,question:r.question,value,unit:r.unit,methodology:r.methodology,comparabilityKey:r.comparabilityKey});
  });
  return {rows,errors};
}
export type ComparisonDimension='country'|'age'|'segment';
export interface SurveyComparison { comparable:boolean; reasons:string[]; difference:number|null }
export function compareSurveys(a:AudienceEvidence,b:AudienceEvidence,dimension:ComparisonDimension='country'):SurveyComparison {
  const reasons:string[]=[];
  if(!a.comparabilityKey || a.comparabilityKey!==b.comparabilityKey) reasons.push('同じ比較設計として確認された comparabilityKey ではありません');
  if(a.methodology!==b.methodology) reasons.push('調査方法が異なります');
  if(a.question!==b.question) reasons.push('設問が異なります');
  if(a.unit!==b.unit) reasons.push('単位が異なります');
  if(a.surveyDate!==b.surveyDate) reasons.push('調査時期が異なります');
  if(a.sampleSize===null||b.sampleSize===null) reasons.push('サンプルサイズが不明です');
  else if(a.sampleSize<30||b.sampleSize<30) reasons.push('各群 n=30 未満のため、このツールでは比較を保留します');
  if(dimension!=='country' && a.regionCode!==b.regionCode) reasons.push('対象地域が異なります');
  if(dimension!=='age' && a.age!==b.age) reasons.push('年代が異なります');
  if(a.gender!==b.gender) reasons.push('性別の対象範囲が異なります');
  if(dimension!=='segment' && a.segment!==b.segment) reasons.push('生活者セグメントが異なります');
  return {comparable:reasons.length===0,reasons,difference:reasons.length ? null : a.value-b.value};
}
export function surveyMatches(e:AudienceEvidence, filters:{region:string;age:string;gender:string;segment:string;start?:string;end?:string}):boolean {
  return (filters.region==='all'||e.regionCode===filters.region)
    && (filters.age==='all'||e.age===filters.age)
    && (filters.gender==='all'||e.gender===filters.gender)
    && (filters.segment==='all'||e.segment===filters.segment)
    && (!filters.start||e.surveyDate>=filters.start)
    && (!filters.end||e.surveyDate<=filters.end);
}
