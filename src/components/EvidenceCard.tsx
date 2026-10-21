import { useState } from 'react';
import { ArrowUpRight, Bookmark, ChevronDown, FileText, Globe2, Search, MessageCircle } from 'lucide-react';
import type { Observation, Topic } from '../types';
import { useApp } from '../lib/store';
import { formatDate, id, isArchive, REGIONS, safeUrl } from '../lib/utils';
import TopicContext from './TopicContext';
export default function EvidenceCard({topic,observation}:{topic:Topic;observation:Observation}) {
 const {dataset,local,updateLocal,notify,selectTopic,navigate}=useApp(); const [expanded,setExpanded]=useState(false);
 const source=dataset.sources.find(s=>s.id===observation.source); const saved=local.saved.some(s=>s.kind==='topic'&&s.topicId===topic.id);
 const url=safeUrl(observation.sourceUrl); const archive=isArchive(observation.source); const kind=source?.kind??'search';
 const Icon=kind==='social'?MessageCircle:kind==='news'?FileText:Search;
 const lowerBound=observation.metric.unit==='searches-lower-bound';
 const unitLabel=lowerBound?'検索回数・概数下限':observation.metric.unit==='likes'?'いいね':observation.metric.unit==='views'?'再生回数':observation.metric.unit==='index'?'検索指数':observation.metric.unit;
 const curated=observation.population.includes('curated')||observation.method.includes('getAuthorFeed');
 function save(){updateLocal(l=>({...l,saved:saved?l.saved.filter(s=>!(s.kind==='topic'&&s.topicId===topic.id)):[...l.saved,{id:id(),kind:'topic',title:topic.title,content:'',topicId:topic.id,createdAt:new Date().toISOString(),lastSeenAt:new Date().toISOString()}]}));notify(saved?'保存を解除しました':'話題をリサーチに保存しました');}
 return <article className="evidence-card"><div className="card-top"><span className={`source-chip ${kind}`}><Icon size={12}/>{source?.name??observation.source}</span><button className={`icon-button ${saved?'is-saved':''}`} aria-label={`${topic.title}を${saved?'保存解除':'保存'}`} onClick={save}><Bookmark size={17} fill={saved?'currentColor':'none'}/></button></div>
 <div className="card-kicker"><span>{topic.category} · 分類C（ルール推定）</span><span>·</span><span>{archive?'公式アーカイブ':observation.status==='stale'?'更新停止・古い観測':'取得済みの観測'}</span></div>
 <button className="topic-title" onClick={()=>{selectTopic(topic.id);navigate('insight');}}>{topic.title}<ArrowUpRight size={19}/></button>
 {kind==='social'&&<p className="observation-title">{observation.title}</p>}<TopicContext topic={topic} observation={observation} variant="card"/>{curated&&<p className="curated-label">限定アカウントの観測 · 流行順位ではありません</p>}
 <div className="metric-row"><div><strong>{observation.metric.value===null?'—':new Intl.NumberFormat('ja-JP',{maximumFractionDigits:2}).format(observation.metric.value)}{lowerBound&&observation.metric.value!==null?'+':''}</strong><span>{unitLabel}</span></div><span className="region"><Globe2 size={13}/>{observation.regionCode?(REGIONS[observation.regionCode]??observation.regionCode):'地域は未特定'}</span></div>
 <p className="metric-definition">{observation.metric.name} · {observation.regionMeaning==='publisher-country'?'報道機関の所在国':observation.regionMeaning==='search-market'?'検索対象市場':'利用者の居住地を示しません'}</p>
 <div className="card-bottom"><a href={url||undefined} aria-disabled={!url} target="_blank" rel="noreferrer">原典を読む <ArrowUpRight size={13}/></a><button onClick={()=>setExpanded(!expanded)} aria-expanded={expanded}>出典・指標 <ChevronDown size={13}/></button></div>
 {expanded&&<div className="evidence-details"><dl><dt>原典ID</dt><dd>{observation.sourceId}</dd><dt>公開日時</dt><dd>{formatDate(observation.publishedAt)}{archive?'（年次集計・公開日時は不明）':''}</dd><dt>観測日時</dt><dd>{formatDate(observation.observedAt)}</dd><dt>取得日時</dt><dd>{formatDate(observation.fetchedAt)} JST</dd><dt>母集団</dt><dd>{observation.population}</dd><dt>正規化</dt><dd>{observation.metric.normalization}</dd><dt>取得方法</dt><dd>{observation.method}</dd><dt>利用条件</dt><dd>{observation.license}</dd><dt>根拠ID</dt><dd>{observation.id}</dd></dl>{observation.relatedLinks?.map(l=><a key={l.url} href={safeUrl(l.url)||undefined} target="_blank" rel="noreferrer">{l.title} ↗</a>)}</div>}
 </article>;
}
