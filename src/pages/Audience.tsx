import { useMemo, useState } from 'react';
import './AudienceCompare.css';
import { ArrowUpRight, BookOpen, Download, FileSpreadsheet, Trash2, Users, X } from 'lucide-react';
import { useApp } from '../lib/store';
import { downloadText, formatDate, safeUrl } from '../lib/utils';
import { parseSurveyCsv, SURVEY_COLUMNS, surveyMatches } from '../lib/surveys';
import type { AudienceEvidence } from '../types';

const references = [
  {name:'生活定点',owner:'博報堂生活総合研究所',url:'https://seikatsusoken.jp/teiten/',note:'参照専用。商用利用・改変・AI入力・スクレイピングは事前許諾が必要なため、このアプリには取り込みません。'},
  {name:'通信利用動向調査',owner:'総務省',url:'https://www.soumu.go.jp/johotsusintokei/statistics/statistics05.html',note:'世帯・企業・個人の情報通信利用。集計区分を確認。'},
  {name:'政府統計の総合窓口',owner:'e-Stat',url:'https://www.e-stat.go.jp/',note:'公的統計。各統計表の調査対象・利用条件を確認。'},
  {name:'Public opinion research',owner:'Pew Research Center',url:'https://www.pewresearch.org/',note:'米国・各国の意識調査。標本設計・国別調査方法を確認。'},
  {name:'Media use and attitudes',owner:'Ofcom',url:'https://www.ofcom.org.uk/',note:'英国のメディア利用調査。年齢区分・母集団を確認。'},
];
const baseCountries:Record<string,string>={JP:'日本',US:'アメリカ',KR:'韓国',GB:'イギリス',FR:'フランス',DE:'ドイツ',AU:'オーストラリア',CA:'カナダ',IN:'インド',BR:'ブラジル'};
const label = (v:string)=>v==='all'?'全体':v;

export default function Audience(){
  const {dataset,local,updateLocal,notify,navigate,selectTopic}=useApp();
  const [region,setRegion]=useState('all');const [age,setAge]=useState('all');const [gender,setGender]=useState('all');const [segment,setSegment]=useState('all');
  const [interests,setInterests]=useState('');const [category,setCategory]=useState('all');const [start,setStart]=useState('');const [end,setEnd]=useState('');
  const [preview,setPreview]=useState<AudienceEvidence[]>([]);const [errors,setErrors]=useState<string[]>([]);const [fileName,setFileName]=useState('');
  const countries=[...new Set([...Object.keys(baseCountries),...local.audienceEvidence.map(e=>e.regionCode)])];
  const ages=[...new Set(['10-19','20-29','30-39','40-49','50-59','60+',...local.audienceEvidence.map(e=>e.age)])].filter(x=>x!=='all');
  const segments=[...new Set(['学生','社会人','子育て世帯',...local.audienceEvidence.map(e=>e.segment)])].filter(x=>x!=='all');
  const evidence=local.audienceEvidence.filter(e=>surveyMatches(e,{region,age,gender,segment,start,end}));
  const topics=useMemo(()=>dataset.topics.filter(t=>{
    if(category!=='all'&&t.category!==category)return false;
    const q=interests.trim().toLocaleLowerCase();if(q&&![t.title,...t.aliases.map(a=>a.text)].some(v=>v.toLocaleLowerCase().includes(q)))return false;
    return dataset.observations.some(o=>o.topicId===t.id&&(region==='all'||o.regionCode===region)&&(!start||o.observedAt.slice(0,10)>=start)&&(!end||o.observedAt.slice(0,10)<=end))||dataset.geoObservations.some(o=>o.topicId===t.id&&(region==='all'||o.regionCode===region)&&(!start||o.date.slice(0,10)>=start)&&(!end||o.date.slice(0,10)<=end));
  }).slice(0,12),[dataset,region,interests,category,start,end]);
  const importFile=async(file:File|undefined)=>{if(!file)return;setPreview([]);setFileName('');if(file.size>5_000_000){setErrors(['ファイルは5MB以内にしてください。']);return;}try{const parsed=parseSurveyCsv(await file.text());setPreview(parsed.rows);setErrors(parsed.errors);setFileName(file.name);}catch{setErrors(['ファイルを読み込めませんでした。文字コードは UTF-8 を使用してください。']);}};
  const confirmImport=()=>{updateLocal(prev=>({...prev,audienceEvidence:[...prev.audienceEvidence.filter(e=>!preview.some(p=>p.id===e.id)),...preview]}));notify(`調査データ ${preview.length} 件を端末に保存しました`);setPreview([]);setFileName('');};
  return <div className="audience-page">
    <div className="page-header"><div><div className="eyebrow">AUDIENCE INTELLIGENCE</div><h1>生活者から、世界を見る。</h1><p className="muted">誰の価値観なのか。属性の根拠を確かめながら、観測する視点を変える。</p></div><Users size={30} aria-hidden="true"/></div>
    <section className="panel audience-filters" aria-label="生活者の観測条件"><div className="section-heading"><h2>観測する生活者</h2><span className="badge">属性の自動推定なし</span></div><div className="form-grid">
      <label>国・地域<select className="field" value={region} onChange={e=>setRegion(e.target.value)}><option value="all">すべての地域</option>{countries.map(c=><option key={c} value={c}>{baseCountries[c]||c}</option>)}</select></label>
      <label>年代<select className="field" value={age} onChange={e=>setAge(e.target.value)}><option value="all">年代を指定しない</option>{ages.map(a=><option key={a}>{a}</option>)}</select></label>
      <label>性別<select className="field" value={gender} onChange={e=>setGender(e.target.value)}><option value="all">性別を指定しない</option>{[...new Set(['女性','男性','その他',...local.audienceEvidence.map(e=>e.gender)])].filter(g=>g!=='all').map(g=><option key={g}>{g}</option>)}</select></label>
      <label>セグメント<select className="field" value={segment} onChange={e=>setSegment(e.target.value)}><option value="all">指定しない</option>{segments.map(s=><option key={s}>{s}</option>)}</select></label>
      <label>関心・キーワード<input className="field" value={interests} onChange={e=>setInterests(e.target.value)} placeholder="例：抹茶、音楽、環境"/></label>
      <label>商品カテゴリー<select className="field" value={category} onChange={e=>setCategory(e.target.value)}><option value="all">すべて</option>{local.categories.map(c=><option key={c}>{c}</option>)}</select></label>
      <label>調査期間：開始<input type="date" className="field" value={start} onChange={e=>setStart(e.target.value)}/></label>
      <label>調査期間：終了<input type="date" className="field" value={end} onChange={e=>setEnd(e.target.value)}/></label>
    </div>{start&&end&&start>end&&<p className="notice" role="alert">開始日は終了日以前に設定してください。</p>}</section>
    <div className="evidence-levels"><div className="panel"><span className="badge evidence-a">A · 実測</span><strong>対象属性を調査した結果</strong><p>母集団・調査方法を伴う公開調査。{evidence.length} 件が条件に一致。</p></div><div className="panel"><span className="badge evidence-b">B · 代理指標</span><strong>関連コミュニティの観測</strong><p>投稿者の属性は不明です。属性の確認されたコミュニティ資料は未登録。</p></div><div className="panel"><span className="badge evidence-c">C · 関連性の仮説</span><strong>キーワード・地域の一致</strong><p>この条件に関連しうる話題です。対象層の人気・支持を示しません。</p></div></div>
    <section><div className="section-heading"><h2><BookOpen size={18}/> 生活者の価値観を、実測から</h2><span className="muted">A / 公開調査・利用者インポート</span></div>
    {!evidence.length?<div className="panel empty-state"><Users size={32}/><h3>属性別の実測データなし</h3><p>選択した属性・期間に一致する調査は登録されていません。公式調査のCSVを取り込むと、出典と母集団を確認できます。</p><p className="muted">全体集計を20代や学生の結果として代用しません。</p></div>:<div className="grid-two">{evidence.map(e=><article className="panel survey-card" key={e.id}><div className="section-heading"><span className="badge evidence-a">A · 利用者申告の調査値</span><button className="button icon-button" aria-label={`${e.title}を削除`} onClick={()=>{updateLocal(p=>({...p,audienceEvidence:p.audienceEvidence.filter(x=>x.id!==e.id)}));notify('調査データを削除しました');}}><Trash2 size={14}/></button></div><h3>{e.title}</h3><p>{e.question}</p><small className="muted">原典の内容は自動照合していません。</small><div className="survey-value">{e.value.toLocaleString()}<small>{e.unit}</small></div><dl className="detail-list"><div><dt>対象</dt><dd>{baseCountries[e.regionCode]||e.regionCode} · {label(e.age)} · {label(e.gender)} · {label(e.segment)}</dd></div><div><dt>母集団</dt><dd>{e.population}</dd></div><div><dt>標本数</dt><dd>{e.sampleSize===null?'不明（比較保留）':`n=${e.sampleSize.toLocaleString()}`}</dd></div><div><dt>調査時期</dt><dd>{e.surveyDate}</dd></div><div><dt>調査方法</dt><dd>{e.methodology}</dd></div><div><dt>取得日時</dt><dd>{formatDate(e.fetchedAt)}</dd></div></dl><a className="source-link" href={safeUrl(e.sourceUrl)} target="_blank" rel="noopener noreferrer">原典を確認 <ArrowUpRight size={14}/></a></article>)}</div>}</section>
    <section className="panel"><div className="section-heading"><h2><FileSpreadsheet size={18}/> 調査CSVを取り込む</h2><button className="button" onClick={()=>downloadText('culture-radar-survey-template.csv','\uFEFF'+SURVEY_COLUMNS.join(',')+'\n','text/csv;charset=utf-8')}><Download size={15}/> ヘッダーをダウンロード</button></div><p className="muted">公式サイトで利用条件を確認し、利用・再利用の権限がある集計表を入力してください。元の設問、対象、調査日、取得日時を保持します。端末内に保存し、サーバーには送信しません。</p><label className="file-upload">調査CSVファイル<input type="file" accept=".csv,text/csv" onChange={e=>{void importFile(e.target.files?.[0]);e.target.value='';}}/></label><details><summary>CSVの仕様</summary><p className="muted">必須列：{SURVEY_COLUMNS.filter(c=>!['title','age','gender','segment','sampleSize'].includes(c)).join(', ')}。sampleSize 不明は空欄、属性の全体集計は all。regionCode は JP / US 等。surveyDate は YYYY-MM または YYYY-MM-DD。fetchedAt は ISO 取得日時。comparabilityKey は同一設問・調査設計・調査回を識別する任意IDです。自動的に比較可能性を保証するものではありません。</p></details>
      {!!errors.length&&<div className="notice" role="alert"><strong>取り込みを保留しています</strong><ul>{errors.slice(0,8).map((e,i)=><li key={i}>{e}</li>)}</ul></div>}
      {!!preview.length&&!errors.length&&<div className="import-preview"><h3>{fileName} · {preview.length} 件</h3><p>確認：{preview[0].title} / {preview[0].sourceUrl} / {preview[0].surveyDate}</p><button className="button button-primary" onClick={confirmImport}>確認して保存</button><button className="button" onClick={()=>{setPreview([]);setFileName('');}}><X size={14}/> キャンセル</button></div>}
    </section>
    <section><div className="section-heading"><h2>この視点に関連する話題</h2><span className="badge evidence-c">C · 属性との関係は未検証</span></div><p className="muted">地域観測・キーワード・カテゴリーで絞り込みます。年代・性別・セグメントによる人気ランキングではありません。ニュースの地域は報道機関の所在国です。</p>{!topics.length?<div className="panel empty-state"><h3>条件に合う観測はありません</h3><p>キーワードや地域を変更するか、RADARで情報源の収集状況を確認してください。</p></div>:<div className="grid-two">{topics.map(t=><article key={t.id} className="panel"><span className="badge">{t.category}</span><h3>{t.title}</h3><p className="muted">地域・語句の一致から探索する候補。選択属性の支持を示す根拠はありません。</p><small className="muted">観測期間：{dataset.observations.filter(o=>o.topicId===t.id).map(o=>o.observedAt.slice(0,10)).sort()[0]||'データなし'} 以降</small><button className="button" onClick={()=>{selectTopic(t.id);navigate('insight');}}>根拠と仮説を調べる <ArrowUpRight size={15}/></button></article>)}</div>}</section>
    <section><div className="section-heading"><h2>原典となる公開調査</h2><span className="muted">公式サイトへの参照</span></div><div className="reference-grid">{references.map(r=><a key={r.url} href={r.url} target="_blank" rel="noopener noreferrer" className="panel reference-card"><span className="eyebrow">{r.owner}</span><h3>{r.name}<ArrowUpRight size={16}/></h3><p className="muted">{r.note}</p></a>)}</div><p className="muted small">調査値の自動取得・転載は行いません。各サイトの利用規約、引用要件、商用利用の条件は公式サイトで確認してください。</p></section>
  </div>;
}
