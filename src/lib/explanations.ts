import type { Claim, Dataset, ExplanationBundle, ExplanationEvidence, Topic, TopicExplanation } from '../types';
import { safeUrl } from './utils';

function permittedUrl(value:string):boolean {const safe=safeUrl(value);if(!safe)return false;const host=new URL(safe).hostname;return host!=='seikatsusoken.jp'&&!host.endsWith('.seikatsusoken.jp');}
/** Canonical counterpart of Python build_evidence. Never fetches article bodies. */
export function buildContextEvidence(topic:Topic,dataset:Dataset):ExplanationEvidence[]{
 const sources=new Map(dataset.sources.map(s=>[s.id,s]));const result:ExplanationEvidence[]=[];
 const observations=dataset.observations.filter(o=>o.topicId===topic.id).slice().sort((a,b)=>a.observedAt<b.observedAt?-1:a.observedAt>b.observedAt?1:a.id<b.id?-1:a.id>b.id?1:0);
 for(const o of observations){
  if(o.source.startsWith('youtube')||sources.get(o.source)?.enabled===false||!permittedUrl(o.sourceUrl))continue;
  const context={source:o.source,observedAt:o.observedAt,fetchedAt:o.fetchedAt,observationId:o.id};
  result.push({id:`obs-${o.id}`,url:o.sourceUrl,title:[...o.title].slice(0,500).join(''),...context});
  (o.relatedLinks||[]).forEach((link,index)=>{if(permittedUrl(link.url))result.push({id:`news-${o.id}-${index}`,url:link.url,title:[...link.title].slice(0,500).join(''),...context});});
 }
 return result;
}
function canonicalJson(value:unknown):string {
 if(Array.isArray(value))return '['+value.map(canonicalJson).join(',')+']';
 if(value!==null&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonicalJson((value as Record<string,unknown>)[key])).join(',')+'}';
 return JSON.stringify(value);
}
export async function contextFingerprint(topic:Topic,evidence:ExplanationEvidence[]):Promise<string>{
 const withoutFetch=evidence.map(({fetchedAt,...rest})=>{void fetchedAt;return rest;});
 const serialized=canonicalJson({topicId:topic.id,title:topic.title,evidence:withoutFetch});
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(serialized));
 return Array.from(new Uint8Array(bytes)).map(n=>n.toString(16).padStart(2,'0')).join('');
}
type Row=Record<string,unknown>;
const row=(v:unknown):v is Row=>typeof v==='object'&&v!==null&&!Array.isArray(v);
const str=(v:unknown):v is string=>typeof v==='string';
const date=(v:unknown)=>str(v)&&Boolean(v)&&Number.isFinite(Date.parse(v));
function requireValue(v:unknown,message:string):asserts v {if(!v)throw new Error(`AI解説のデータ形式を確認してください：${message}`);}
function claim(v:unknown,ids:Set<string>):v is Claim {return row(v)&&str(v.text)&&v.text.trim().length>0&&v.text.length<=1500&&['source_summary','interpretation'].includes(String(v.kind))&&Array.isArray(v.evidenceIds)&&v.evidenceIds.length>0&&v.evidenceIds.every(id=>str(id)&&ids.has(id));}
export function parseExplanationBundle(value:unknown):ExplanationBundle {
 requireValue(row(value)&&value.schemaVersion===1&&date(value.generatedAt)&&Array.isArray(value.explanations),'対応する形式ではありません');
 const provider=value.providerStatus;requireValue(row(provider)&&['ready','disabled','error'].includes(String(provider.status))&&str(provider.provider)&&str(provider.model)&&str(provider.message)&&date(provider.checkedAt),'生成状態が不正です');
 const topicIds=new Set<string>();
 for(const item of value.explanations){
  requireValue(row(item)&&str(item.topicId)&&!topicIds.has(item.topicId)&&str(item.inputHash)&&/^[a-f0-9]{64}$/.test(item.inputHash)&&(date(item.generatedAt)||(item.status==='unavailable'&&item.generatedAt===''))&&str(item.provider)&&str(item.model)&&['ready','stale','unavailable'].includes(String(item.status)),'話題・生成日時・入力ハッシュが不正です');
  topicIds.add(item.topicId);requireValue(Array.isArray(item.evidence)&&(item.evidence.length>0||item.status==='unavailable'),'根拠のない解説です');
  const ids=new Set<string>();
  for(const e of item.evidence){requireValue(row(e)&&str(e.id)&&!ids.has(e.id)&&str(e.url)&&permittedUrl(e.url)&&str(e.title)&&str(e.source)&&date(e.observedAt)&&date(e.fetchedAt)&&str(e.observationId),'原典・日時が不正です');ids.add(e.id);}
  if(item.status==='unavailable'){requireValue(item.provider==='none'&&item.model===''&&item.generatedAt===''&&row(item.overview)&&str(item.overview.text)&&Array.isArray(item.overview.evidenceIds)&&item.overview.evidenceIds.length===0&&Array.isArray(item.contexts)&&item.contexts.length===0&&item.attention===null&&item.marketing===null&&Array.isArray(item.caveats)&&item.caveats.length>0&&item.caveats.every(str),'未生成状態にAIの主張を混在できません');continue;}
  requireValue(Boolean(item.provider)&&Boolean(item.model),'AI生成元がありません');
  requireValue(claim(item.overview,ids)&&Array.isArray(item.contexts)&&item.contexts.length>0&&item.contexts.length<=6&&item.contexts.every(c=>claim(c,ids)),'説明に追跡可能な根拠がありません');
  requireValue((item.attention===null||claim(item.attention,ids))&&(item.marketing===null||claim(item.marketing,ids)),'解釈の根拠が不正です');
  requireValue(item.attention===null||(item.attention as Claim).kind==='interpretation','注目理由は仮説として表示します');
  requireValue(item.marketing===null||(item.marketing as Claim).kind==='interpretation','広告活用は仮説として表示します');
  requireValue(Array.isArray(item.caveats)&&item.caveats.length>0&&item.caveats.every(str),'入力の範囲・限界がありません');
 }
 return value as unknown as ExplanationBundle;
}
/** Changing evidence makes cached claims stale, even when a topic ID stays the same. */
export async function reconcileExplanations(bundle:ExplanationBundle,dataset:Dataset):Promise<ExplanationBundle>{
 const topics=new Map(dataset.topics.map(t=>[t.id,t]));
 const explanations=await Promise.all(bundle.explanations.filter(e=>topics.has(e.topicId)).map(async e=>{
  const topic=topics.get(e.topicId)!;const current=buildContextEvidence(topic,dataset);const fingerprint=await contextFingerprint(topic,current);
  if(fingerprint!==e.inputHash)return {...e,status:'stale' as const};
  // Refresh source retrieval metadata without rewriting generated text or its generation date.
  const latest=new Map(current.map(item=>[item.id,item]));
  return {...e,evidence:e.evidence.map(item=>latest.get(item.id)||item)};
 }));
 return {...bundle,explanations};
}
export async function loadExplanations(url:string,dataset:Dataset,signal?:AbortSignal):Promise<ExplanationBundle>{
 const response=await fetch(url,{signal,cache:'no-cache'});
 if(!response.ok)throw new Error(response.status===404?'このデータにはAI解説がまだありません。関連記事から文脈を確認できます。':`AI解説を読み込めませんでした（HTTP ${response.status}）。関連記事は引き続き確認できます。`);
 return reconcileExplanations(parseExplanationBundle(await response.json()),dataset);
}
export function explanationFor(bundle:ExplanationBundle|null,topicId:string):TopicExplanation|undefined{return bundle?.explanations.find(e=>e.topicId===topicId);}
