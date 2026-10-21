import { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as LibreMap } from 'maplibre-gl';
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { FeatureCollection, Geometry, GeoJsonProperties } from 'geojson';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDownToLine, ArrowUpFromLine, Check, ChevronDown, ExternalLink, Globe2, Layers, MapPin, Pause, Play, Plus, Search, SlidersHorizontal, X } from 'lucide-react';
import { useApp } from '../lib/store';
import { downloadCsv, formatDate, safeUrl, REGIONS } from '../lib/utils';
import { parseGeoCsv, regionName, stableHash, geoComparisonKey, geoCsvRows, type GeoCsvResult } from '../lib/imports';
import type { GeoObservation } from '../types';
import 'maplibre-gl/dist/maplibre-gl.css';
import './SpreadMap.css';

type World = FeatureCollection<Geometry,GeoJsonProperties>;
maplibregl.setWorkerUrl(mapWorkerUrl);
const emptyWorld:World={type:'FeatureCollection',features:[]};
const colors=['#007c6c','#e99b34','#6d7bec'];
const groupId=geoComparisonKey;
function uncertainty(rows:GeoObservation[]) { return rows.some(r=>r.source.includes('archive') || r.originalSource?.includes('archive') || /未詳|未確認|不明|unknown|undocumented|unverified/i.test(r.normalization)); }
function bucket(date:string,interval:string) {
  if (interval==='year') return date.slice(0,4);
  if (interval==='month') return date.slice(0,7);
  if (interval==='week') {const d=new Date(date+'T00:00:00Z');const day=(d.getUTCDay()+6)%7;d.setUTCDate(d.getUTCDate()-day);return d.toISOString().slice(0,10);}
  return date;
}
function displayDate(date:string,annual:boolean) {return annual?`${date.slice(0,4)}年`:date;}

export default function SpreadMap() {
  const {dataset,updateLocal,notify,selectedTopicId,selectTopic}=useApp();
  const topics=dataset.topics.filter(t=>dataset.geoObservations.some(o=>o.topicId===t.id));
  const [query,setQuery]=useState('');
  const [topicId,setTopicId]=useState(selectedTopicId || topics[0]?.id || '');
  const [layer,setLayer]=useState<'search-interest'|'news-publisher'>('search-interest');
  const [group,setGroup]=useState(''); const [interval,setInterval]=useState('day');
  const [index,setIndex]=useState(0);const [playing,setPlaying]=useState(false);const [country,setCountry]=useState('JP');
  const [countries,setCountries]=useState(['JP','US','KR']);
  const [mapReady,setMapReady]=useState(false);const [mapError,setMapError]=useState('');
  const [world,setWorld]=useState<World>(emptyWorld);
  const [showImport,setShowImport]=useState(false);const [showAliases,setShowAliases]=useState(false);
  const [aliasText,setAliasText]=useState('');const [aliasLang,setAliasLang]=useState('en');
  const host=useRef<HTMLDivElement>(null);const map=useRef<LibreMap|null>(null);
  const topic=dataset.topics.find(t=>t.id===topicId);
  const allTopicRows=dataset.geoObservations.filter(r=>r.topicId===topicId);
  const groups=useMemo(()=>[...new Map(allTopicRows.filter(r=>r.layer===layer).map(r=>[groupId(r),r])).entries()],[allTopicRows,layer]);
  const activeGroup=groups.some(([id])=>id===group)?group:groups[0]?.[0] || '';
  const rows=allTopicRows.filter(r=>r.layer===layer&&groupId(r)===activeGroup);
  const rawDates=[...new Set(rows.map(r=>r.date.slice(0,10)))].sort();
  const annual=rows.length>0&&rows.every(r=>r.date.slice(5,10)==='01-01'&&(r.source.includes('archive')||r.originalSource?.includes('archive')));
  const dates=useMemo(()=>{const b=new Map<string,string>();for(const d of rawDates) b.set(bucket(d,annual?'year':interval),d);return [...b.values()].sort();},[rawDates,interval,annual]);
  const date=dates[Math.min(index,Math.max(0,dates.length-1))] || '';
  const selectedRows=rows.filter(r=>r.date.slice(0,10)===date);
  const countryRow=selectedRows.find(r=>r.regionCode===country);
  const availabilityOnly=uncertainty(rows);
  const availableCountries=[...new Set(rows.map(r=>r.regionCode))].sort();
  const currentValues=new Map(selectedRows.map(r=>[r.regionCode,r.value]));
  const filteredTopics=dataset.topics.filter(t=>!query || [t.title,...t.aliases.map(a=>a.text)].some(v=>v.toLowerCase().includes(query.toLowerCase())));

  useEffect(()=>{if(!topicId&&topics[0])setTopicId(topics[0].id);},[topics,topicId]);
  useEffect(()=>{setIndex(0);setPlaying(false);},[topicId,layer,activeGroup,interval]);
  useEffect(()=>{if(!playing || dates.length<2)return;const timer=window.setInterval(()=>setIndex(i=>i+1>=dates.length?(setPlaying(false),0):i+1),1300);return()=>clearInterval(timer);},[playing,dates.length]);
  useEffect(()=>{const controller=new AbortController();fetch(`${import.meta.env.BASE_URL}data/world.geojson`,{signal:controller.signal}).then(r=>{if(!r.ok)throw new Error(`地理データ HTTP ${r.status}`);return r.json();}).then((data:World)=>setWorld(data)).catch(e=>{if(e.name!=='AbortError')setMapError('世界地図を読み込めませんでした。地域別一覧は引き続き利用できます。');});return()=>controller.abort();},[]);
  useEffect(()=>{
    if(!host.current)return;
    try {
      const instance=new maplibregl.Map({container:host.current,style:{version:8,sources:{world:{type:'geojson',data:emptyWorld}},layers:[{id:'ocean',type:'background',paint:{'background-color':'#e9eff0'}},{id:'countries',type:'fill',source:'world',paint:{'fill-color':['case',['==',['get','hasData'],true],['case',['==',['get','availability'],true],'#6ba892',['interpolate',['linear'],['get','value'],0,'#d7ecdc',25,'#a9d7bb',50,'#6bac92',75,'#318c72',100,'#075e50']],'#d5dfe0'],'fill-opacity':0.95}},{id:'borders',type:'line',source:'world',paint:{'line-color':'#f7faf7','line-width':0.7}},{id:'selected',type:'line',source:'world',filter:['==',['get','code'],'JP'],paint:{'line-color':'#183e40','line-width':2}}]},bounds:[[-175,-58],[180,80]],fitBoundsOptions:{padding:{top:72,bottom:38,left:12,right:12}},minZoom:-1.5,maxZoom:6,renderWorldCopies:false,canvasContextAttributes:{preserveDrawingBuffer:true},attributionControl:false});
      instance.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');
      instance.addControl(new maplibregl.AttributionControl({compact:true,customAttribution:'Natural Earth · Public domain'}),'bottom-left');
      instance.on('load',()=>setMapReady(true));
      instance.on('click','countries',e=>{const code=e.features?.[0]?.properties?.code;if(typeof code==='string'&&code!=='-99')setCountry(code);});
      instance.on('mouseenter','countries',()=>{instance.getCanvas().style.cursor='pointer';});
      instance.on('mouseleave','countries',()=>{instance.getCanvas().style.cursor='';});
      instance.on('error',()=>setMapError('地図描画でエラーが発生しました。WebGL対応ブラウザで再読み込みするか、地域別一覧をご利用ください。'));
      map.current=instance;
      const observer=new ResizeObserver(()=>instance.resize());observer.observe(host.current);
      return()=>{observer.disconnect();instance.remove();map.current=null;setMapReady(false);};
    } catch {setMapError('このブラウザではWebGL地図を表示できません。地域別一覧・時系列・CSV出力は利用できます。');}
  },[]);
  useEffect(()=>{
    if(!mapReady||!map.current)return;
    const maximum=Math.max(1,...selectedRows.map(r=>r.value));
    const data:World={...world,features:world.features.map(f=>{const code=String(f.properties?.ISO_A2_EH || f.properties?.ISO_A2 || '');const value=currentValues.get(code);return {...f,properties:{code,name:f.properties?.NAME_JA || f.properties?.NAME_EN,hasData:value!==undefined,availability:availabilityOnly,value:value===undefined?0:(rows[0]?.unit==='index'?value:value/maximum*100)}};})};
    (map.current.getSource('world') as GeoJSONSource|undefined)?.setData(data);
    map.current.setFilter('selected',['==',['get','code'],country]);
  },[mapReady,world,date,topicId,activeGroup,country,selectedRows,availabilityOnly,rows,currentValues]);

  function chooseTopic(id:string) {setTopicId(id);selectTopic(id);}
  function exportCsv() {
    downloadCsv('culture-radar-geo.csv',geoCsvRows(rows,topic?.title || topicId));
    notify('選択した情報源・正規化条件の元観測をCSVに出力しました。');
  }
  function exportPng() {
    if(!map.current||!mapReady)return;
    try {
      const original=map.current.getCanvas();const canvas=document.createElement('canvas');const scale=original.width/original.clientWidth;
      canvas.width=original.width;canvas.height=original.height+Math.round(160*scale);
      const ctx=canvas.getContext('2d');if(!ctx)throw new Error('canvas');ctx.drawImage(original,0,0);ctx.fillStyle='#f6f8f4';ctx.fillRect(0,original.height,canvas.width,canvas.height-original.height);ctx.fillStyle='#173336';ctx.font=`${14*scale}px sans-serif`;
      const sourceName=dataset.sources.find(s=>s.id===rows[0]?.source)?.name || rows[0]?.source || '観測なし';
      const lines=[`CULTURE RADAR | ${topic?.title || '観測なし'} | ${displayDate(date,annual)} | ${layer==='search-interest'?'検索関心':'報道機関所在国'}`,availabilityOnly?'観測の有無のみ。国間の指数値比較・伝播経路の断定不可。':'検索指数は同一エクスポートの比較条件内のみ。灰色=データなし。',`${sourceName}${annual?' · Google Trends Data · CC BY 4.0':''} | 取得 ${rows[0]?.fetchedAt || '—'}`,`原典: ${rows[0]?.sourceUrl || '—'}`,`Natural Earth · Public domain | 全地域の原典情報はCSVと併せて保存。出力 ${new Date().toISOString()}`];
      lines.forEach((line,i)=>ctx.fillText(line,16*scale,original.height+(25+i*28)*scale,canvas.width-32*scale));
      const a=document.createElement('a');a.download='culture-radar-map.png';a.href=canvas.toDataURL('image/png');a.click();notify('地図をPNG出力しました。原典情報はCSVとあわせて保存してください。');
    } catch {notify('PNGを出力できませんでした。WebGL対応ブラウザで再読み込みしてください。');}
  }
  function saveAlias() {
    const text=aliasText.trim();if(!topic||!text)return;
    if(topic.aliases.some(a=>a.text===text)){notify('同じ表記が登録済みです。');return;}
    const aliases=[...topic.aliases,{id:`alias-${stableHash(text+aliasLang)}`,text,language:aliasLang}];
    updateLocal(s=>({...s,topicMappings:[...s.topicMappings.filter(m=>m.topicId!==topicId),{topicId,aliases}]}));setAliasText('');notify('表記を追加しました。原典データや観測IDは変更していません。');
  }
  function removeAlias(id:string) {if(!topic)return;const aliases=topic.aliases.filter(a=>a.id!==id);updateLocal(s=>({...s,topicMappings:[...s.topicMappings.filter(m=>m.topicId!==topicId),{topicId,aliases}]}));}
  function toggleCountry(code:string) {setCountries(previous=>previous.includes(code)?previous.filter(c=>c!==code):previous.length<3?[...previous,code]:[...previous.slice(1),code]);}

  return <div className="spread-page">
    <div className="page-header"><div><div className="eyebrow">GEOGRAPHIC OBSERVATORY</div><h1>SPREAD MAP<span className="map-title-ja">世界のどこで、観測されたか。</span></h1><p className="muted">地域と時間を行き来して、文化の兆しを読み解く。</p></div><button className="button" onClick={()=>setShowImport(v=>!v)}><ArrowUpFromLine size={16}/> CSVを取り込む</button></div>
    <div className="panel map-controls"><label className="map-search"><Search size={18}/><input aria-label="地図のトピック検索" value={query} onChange={e=>setQuery(e.target.value)} placeholder="トピック候補を絞る（選択すると地図を変更）"/></label><label className="map-topic-select"><select aria-label="地図のトピック" className="field" value={topicId} onChange={e=>chooseTopic(e.target.value)}><option value="">トピックを選ぶ</option>{topic&&!filteredTopics.some(t=>t.id===topicId)&&<option value={topicId}>{topic.title}（表示中）</option>}{filteredTopics.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select><ChevronDown size={14}/></label><button className="button map-alias-trigger" onClick={()=>setShowAliases(v=>!v)}><SlidersHorizontal size={15}/>表記を管理</button></div>
    {query&&filteredTopics.length===0&&<p className="notice">「{query}」に対応する観測データがありません。地図の表示中トピックは「{topic?.title || '未選択'}」です。任意キーワードの検索関心は公式CSVで取り込めます。</p>}{showAliases&&<div className="panel map-aliases"><div className="section-heading"><h3>トピック表記の管理</h3><span className="badge">ユーザーによる対応付け</span></div><p className="muted">似た単語を自動で同一現象にはしません。追加した表記は検索用です。別トピックの観測値を自動合算しません。</p><div className="map-chips">{topic?.aliases.map(a=><span className="badge" key={a.id}>{a.text} <small>{a.language}</small><button aria-label={`${a.text}を分離`} onClick={()=>removeAlias(a.id)}><X size={12}/></button></span>)}</div><div className="map-alias-form"><input className="field" value={aliasText} onChange={e=>setAliasText(e.target.value)} placeholder="例: matcha / 抹茶 / 말차" aria-label="追加する表記"/><select aria-label="表記の言語" className="field" value={aliasLang} onChange={e=>setAliasLang(e.target.value)}><option value="ja">日本語</option><option value="en">English</option><option value="ko">한국어</option><option value="other">その他</option></select><button className="button" onClick={saveAlias} disabled={!topic||!aliasText.trim()}><Plus size={15}/>追加</button></div></div>}
    {showImport&&<CsvImporter onClose={()=>setShowImport(false)} onImported={chooseTopic}/>}
    <div className="map-workspace">
      <div className="panel map-main"><div className="map-topline"><div className="map-layer-tabs" role="group" aria-label="地図のデータレイヤー"><button className={layer==='search-interest'?'active':''} onClick={()=>setLayer('search-interest')}><Search size={14}/>検索関心</button><button className={layer==='news-publisher'?'active':''} onClick={()=>setLayer('news-publisher')}><Layers size={14}/>ニュース報道</button></div><div className="map-export-actions"><button className="button-icon" title="地図をPNG出力" aria-label="地図をPNG出力" onClick={exportPng} disabled={!mapReady}><ArrowDownToLine size={15}/> PNG</button><button className="button-icon" aria-label="地図データをCSV出力" onClick={exportCsv} disabled={!rows.length}><ArrowDownToLine size={15}/> CSV</button></div></div>
        {groups.length>1&&<label className="map-source-select" title="独立したエクスポート・原典URL・観測母集団は分離します。同じ説明文でも自動合算しません。">比較条件<select className="field" value={activeGroup} onChange={e=>setGroup(e.target.value)}>{groups.map(([id,r],i)=><option key={id} value={id}>{dataset.sources.find(s=>s.id===r.source)?.name || r.source} · 条件 {i+1}</option>)}</select></label>}
        <div className="map-topic-heading"><strong>{topic?.title || 'トピックを選択してください'}</strong><span>{rows.length?`${availableCountries.length}地域 · ${rawDates.length}観測時点`:'地域別の観測データなし'}</span></div><div className="map-canvas-wrap"><div ref={host} className="map-canvas" role="img" aria-label="国別観測地図。国をクリックすると観測詳細を表示"/><div className="map-overline"><span className="map-live-dot"/>{annual?'HISTORICAL ARCHIVE':layer==='search-interest'?'SEARCH OBSERVATIONS':'NEWS PUBLISHER LOCATIONS'}</div><div className="map-date-mark">{date?displayDate(date,annual):'NO OBSERVATIONS'}</div>{(!rows.length||mapError)&&<div className="map-empty-overlay"><Globe2 size={32}/><h3>{mapError?'地図表示を利用できません':'この条件の地域データはありません'}</h3><p>{mapError||'検索関心は公式CSVを取り込むと表示できます。ニュース報道は収集に成功したデータのみ表示します。'}</p>{!mapError&&<button className="button" onClick={()=>setShowImport(true)}>CSVを取り込む</button>}</div>}<div className="map-legend"><span><i style={{background:'#d5dfe0'}}/>データなし</span><span><i style={{background:'#6ba892'}}/>{availabilityOnly?'観測あり（強弱は非表示）':'観測値：低'}</span>{!availabilityOnly&&<span><i style={{background:'#075e50'}}/>高</span>}</div></div>
        <div className="map-timeline"><button className="map-play" aria-label={playing?'時系列を停止':'時系列を再生'} disabled={dates.length<2} onClick={()=>setPlaying(v=>!v)}>{playing?<Pause size={18}/>:<Play size={18}/>}</button><div className="map-range"><label htmlFor="map-time">観測時点 <strong>{date?displayDate(date,annual):'データなし'}</strong></label><input id="map-time" type="range" min={0} max={Math.max(0,dates.length-1)} value={Math.min(index,Math.max(0,dates.length-1))} onChange={e=>{setPlaying(false);setIndex(Number(e.target.value));}} disabled={dates.length<2}/><div className="map-range-labels"><span>{dates[0]?displayDate(dates[0],annual):'—'}</span><span>{dates.length}観測時点・補間なし</span><span>{dates.at(-1)?displayDate(dates.at(-1)!,annual):'—'}</span></div></div><label className="map-interval">表示間隔<select className="field" aria-label="時系列の表示間隔" value={annual?'year':interval} onChange={e=>setInterval(e.target.value)} disabled={annual}><option value="day">日</option><option value="week">週</option><option value="month">月</option><option value="year">年</option></select></label></div>
        <p className="map-timeline-note muted">{annual?'実在する2012–2023年の年次資料。日・週・月のデータは含みません。':'各期間の最終観測日を選択します。空白日は補間せず、報道量を検索関心へ換算しません。'}<br/>地理境界はNatural Earth 1:110m。小国・一部の島国は地図形状が省略されるため、地域選択・元観測一覧で確認してください。</p>
      </div>
      <aside className="panel map-detail"><div className="eyebrow">REGION DETAILS</div><h2><MapPin size={20}/>{regionName(country)}</h2><select className="field" aria-label="詳細を表示する地域" value={country} onChange={e=>setCountry(e.target.value)}>{[...new Set([country,...availableCountries,...Object.keys(REGIONS)])].map(c=><option value={c} key={c}>{regionName(c)}</option>)}</select>{countryRow?<><div className="map-detail-value">{countryRow.value.toLocaleString()}<span>{countryRow.unit==='index'?'検索指数':countryRow.unit}</span></div><span className="badge">{countryRow.source==='csv-import'?'ユーザー取り込み・原典未検証':'実際の公開観測'}</span><dl><dt>観測時点</dt><dd>{displayDate(countryRow.date.slice(0,10),annual)}{annual?'（年次集計）':''}</dd><dt>取得日時</dt><dd>{formatDate(countryRow.fetchedAt)}</dd><dt>情報源</dt><dd>{countryRow.source==='csv-import'?`ユーザーCSV（申告元: ${countryRow.originalSource || '未指定'}）`:dataset.sources.find(s=>s.id===countryRow.source)?.name || countryRow.source}</dd><dt>地域の意味</dt><dd>{countryRow.regionMeaning==='publisher-country'?'報道機関の所在国。出来事の場所・読者の所在国ではありません。':'検索が行われた地域。人口に対する検索件数ではありません。'}</dd><dt>観測母集団</dt><dd>{countryRow.population}</dd><dt>正規化・比較条件</dt><dd>{countryRow.normalization}</dd></dl><a className="button" href={safeUrl(countryRow.sourceUrl)} target="_blank" rel="noreferrer">原典データを確認<ExternalLink size={14}/></a></>:<div className="map-no-country"><Globe2 size={28}/><h3>この時点のデータなし</h3><p className="muted">欠損は0ではありません。別の観測時点・情報源を選んでください。</p></div>}
      </aside>
    </div>
    {availabilityOnly&&rows.length>0&&<div className="notice map-method-note"><strong>このアーカイブは国際的な人気順位には使えません。</strong>原典の正規化範囲が未詳のため、地図は観測の有無だけを表示します。指数値は各国の時系列を読む参考資料です。時系列の先行・遅行だけで伝播経路は断定できません。</div>}
    <div className="panel map-comparison"><div className="section-heading"><div><div className="eyebrow">TEMPORAL CONTEXT</div><h2>それぞれの地域の変化を読む</h2></div><span className="badge">最大3地域・欠損を接続しません</span></div><div className="map-chips">{availableCountries.map(c=><button key={c} className={`map-country-chip ${countries.includes(c)?'selected':''}`} onClick={()=>toggleCountry(c)}>{countries.includes(c)&&<Check size={12}/>} {regionName(c)}</button>)}</div>{!rows.length?<p className="muted">時系列データはまだありません。数値や推移を自動生成せず、CSVの取り込みを待っています。</p>:<div className="map-chart-grid">{countries.filter(c=>availableCountries.includes(c)).map((c,i)=>{const data=rawDates.map(d=>({date:displayDate(d,annual),value:rows.find(r=>r.regionCode===c&&r.date.slice(0,10)===d)?.value ?? null}));return <div className="map-country-chart" key={c}><h3><span style={{background:colors[i]}}/>{regionName(c)}</h3><ResponsiveContainer width="100%" height={185}><AreaChart data={data} margin={{top:12,left:-25,right:12,bottom:0}}><CartesianGrid vertical={false} strokeDasharray="3 5" stroke="#dfe5df"/><XAxis dataKey="date" tick={{fontSize:10}} minTickGap={30} axisLine={false} tickLine={false}/><YAxis domain={rows[0]?.unit==='index'?[0,100]:[0,'auto']} tick={{fontSize:10}} axisLine={false} tickLine={false}/><Tooltip formatter={v=>[v ?? 'データなし',rows[0]?.unit==='index'?'検索指数':'記事数']}/><Area type="linear" dataKey="value" stroke={colors[i]} fill={colors[i]} fillOpacity={0.09} strokeWidth={2} connectNulls={false} isAnimationActive={false}/></AreaChart></ResponsiveContainer><p className="muted">{availabilityOnly?'国別の独立した参考系列。国間の値比較不可。':rows[0]?.unit==='index'?'この比較条件内の相対検索指数。絶対検索数ではありません。':'観測された記事数。生活者人気を意味しません。'}</p></div>;})}</div>}</div>
    {selectedRows.some(r=>r.regionCode.startsWith('JP-'))&&<div className="notice">都道府県データは上の地域選択・時系列で確認できます。都道府県境界の地図レイヤーは未対応です。</div>}
    <div className="panel map-observation-list"><div className="section-heading"><h2>選択時点の元観測</h2><span className="muted">{selectedRows.length}地域 / {date?displayDate(date,annual):'—'}</span></div><div className="map-table-scroll"><table><thead><tr><th>国・地域</th><th>指標値</th><th>観測日</th><th>取得日時</th><th>原典</th></tr></thead><tbody>{selectedRows.sort((a,b)=>regionName(a.regionCode).localeCompare(regionName(b.regionCode),'ja')).map(r=><tr key={r.id}><td><button className="map-table-country" onClick={()=>setCountry(r.regionCode)}>{regionName(r.regionCode)}</button></td><td>{r.value} <small>{r.unit}</small></td><td>{displayDate(r.date.slice(0,10),annual)}</td><td>{formatDate(r.fetchedAt)}</td><td><a href={safeUrl(r.sourceUrl)} target="_blank" rel="noreferrer">原典 <ExternalLink size={12}/></a></td></tr>)}</tbody></table>{!selectedRows.length&&<p className="muted">表示できる観測はありません。</p>}</div></div>
  </div>;
}

function CsvImporter({onClose,onImported}:{onClose:()=>void;onImported:(id:string)=>void}) {
  const {dataset,updateLocal,notify}=useApp();
  const [fileText,setFileText]=useState('');const [fileName,setFileName]=useState('');
  const [topicName,setTopicName]=useState('');const [sourceUrl,setSourceUrl]=useState('https://trends.google.com/trends/explore');
  const [fetchedAt,setFetchedAt]=useState(new Date().toISOString().slice(0,16));const [endDate,setEndDate]=useState('');
  const [region,setRegion]=useState('');const [normalization,setNormalization]=useState('');
  const [layer,setLayer]=useState<'search-interest'|'news-publisher'>('search-interest');
  const [preview,setPreview]=useState<GeoCsvResult|null>(null);
  const clearPreview=()=>setPreview(null);
  async function read(file:File|undefined) {if(!file)return;setFileName(file.name);setPreview(null);setFileText('');if(file.size>5_000_000){notify('CSVは5 MB以下にしてください。');return;}try{setFileText(await file.text());}catch{notify('CSVファイルを読み込めませんでした。別のファイルで再試行してください。');}}
  function inspect() {
    const existing=dataset.topics.find(t=>t.title===topicName.trim());
    setPreview(parseGeoCsv(fileText,{topic:topicName,topicId:existing?.id,sourceUrl,fetchedAt:fetchedAt?`${fetchedAt}:00Z`:'',normalization,date:endDate,region,layer}));
  }
  function save() {if(!preview||preview.errors.length||!preview.rows.length)return;updateLocal(s=>{const ids=new Set(preview.rows.map(r=>r.id));return {...s,importedGeo:[...s.importedGeo.filter(r=>!ids.has(r.id)),...preview.rows],customTopics:dataset.topics.some(t=>t.id===preview.topic.id)?s.customTopics:[...s.customTopics,preview.topic]};});notify(`${preview.rows.length}観測をブラウザに保存しました。`);onImported(preview.topic.id);onClose();}
  return <section className="panel map-importer"><div className="section-heading"><div><div className="eyebrow">BRING YOUR OWN EVIDENCE</div><h2>公式CSVを、地図のエビデンスに。</h2></div><button className="button-icon" aria-label="CSV取り込みを閉じる" onClick={onClose}><X size={18}/></button></div><p className="muted">Google Trendsの地域別・1地域の時系列、または date,region,value のCSVに対応。取り込む前に原典と比較条件を記録します。</p><div className="map-import-grid"><label>CSVファイル<input className="field" aria-label="地図CSVファイル" type="file" accept=".csv,text/csv" onChange={e=>void read(e.target.files?.[0])}/><small className="muted">{fileName||'最大5 MB・UTF-8'}</small></label><label>トピック名<input className="field" aria-label="CSVトピック名" value={topicName} onChange={e=>{setTopicName(e.target.value);clearPreview();}} placeholder="例: 抹茶"/></label><label>原典URL<input className="field" type="url" aria-label="CSV原典URL" value={sourceUrl} onChange={e=>{setSourceUrl(e.target.value);clearPreview();}}/></label><label>取得日時（UTC）<input className="field" type="datetime-local" aria-label="CSV取得日時UTC" value={fetchedAt} onChange={e=>{setFetchedAt(e.target.value);clearPreview();}}/></label><label>地域別CSVの観測期間終了日<input className="field" type="date" aria-label="CSV観測期間終了日" value={endDate} onChange={e=>{setEndDate(e.target.value);clearPreview();}}/></label><label>時系列CSVの対象地域<input className="field" aria-label="時系列CSVの対象地域" value={region} onChange={e=>{setRegion(e.target.value);clearPreview();}} placeholder="例: JP / United States / 東京都"/></label><label className="map-import-wide">正規化範囲・比較条件<textarea className="field" aria-label="CSV正規化範囲" rows={2} value={normalization} onChange={e=>{setNormalization(e.target.value);clearPreview();}} placeholder="同じエクスポートのキーワード、対象期間、検索種別、カテゴリーを記録。国ごとの個別エクスポートはその国を明記。"/></label><label>データの意味<select className="field" aria-label="CSVデータレイヤー" value={layer} onChange={e=>{setLayer(e.target.value as typeof layer);clearPreview();}}><option value="search-interest">Google Trends 検索関心（0–100）</option><option value="news-publisher">ニュース記事数（報道機関所在国）</option></select></label></div><div className="map-import-actions"><button className="button" disabled={!fileText} onClick={inspect}><Search size={15}/>内容を検証</button><a href="https://support.google.com/trends/answer/4365533?hl=ja" target="_blank" rel="noreferrer">Google Trendsのエクスポート手順 <ExternalLink size={13}/></a></div>{preview&&<div className="map-import-preview" role="status">{preview.errors.map((e,i)=><p key={i} className="map-import-error">{e}</p>)}{preview.warnings.slice(0,10).map((e,i)=><p key={i} className="muted">{e}</p>)}{preview.warnings.length>10&&<p className="muted">ほか{preview.warnings.length-10}件の注意があります。</p>}{!preview.errors.length&&<><strong>{preview.rows.length}件の有効な観測 · {new Set(preview.rows.map(r=>r.regionCode)).size}地域</strong><div className="map-table-scroll"><table><thead><tr><th>地域</th><th>日付</th><th>値</th><th>定義</th></tr></thead><tbody>{preview.rows.slice(0,5).map(r=><tr key={r.id}><td>{regionName(r.regionCode)}</td><td>{r.date}</td><td>{r.value}</td><td>{r.normalization}<br/><small>取得UTC: {r.fetchedAt}</small><br/><small>{r.layer} / {r.unit} / {r.regionMeaning}</small><br/><a href={safeUrl(r.sourceUrl)} target="_blank" rel="noreferrer">原典URL</a></td></tr>)}</tbody></table></div><button className="button button-primary" onClick={save}><Check size={15}/>確認して取り込む</button></>}</div>}</section>;
}
