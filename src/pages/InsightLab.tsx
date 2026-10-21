import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, BookOpen, Check, FlaskConical, Info, Save, ShieldAlert, Sparkles } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApp } from '../lib/store';
import { downloadText, formatDate, id, REGIONS, safeUrl } from '../lib/utils';
import { brandSafety, calculateMomentum, calculateNovelty, calculatePersistence, describeMetric, diffusion, groupComparable, topicEvidence } from '../lib/analysis';
import type { GeoObservation, Observation } from '../types';
import './research.css';
import TopicContext from '../components/TopicContext';

interface Reference { id: string; title: string; url: string; date: string; fetched: string; source: string; metric: string; population: string; region: string; normalization: string }
function reference(o: Observation | GeoObservation): Reference {
  if ('metric' in o) return { id: o.id, title: o.title, url: o.sourceUrl, date: o.observedAt, fetched: o.fetchedAt, source: o.source,
    metric: describeMetric(o), population: o.population, region: `${o.regionCode ? REGIONS[o.regionCode] || o.regionCode : '地域不明'} / ${o.regionMeaning}`, normalization: o.metric.normalization };
  return { id: o.id, title: `${REGIONS[o.regionCode] || o.regionCode} / ${o.date.slice(0, 10)}`, url: o.sourceUrl, date: o.date, fetched: o.fetchedAt, source: o.source,
    metric: `${o.value.toLocaleString('ja-JP')} ${o.unit} / ${o.layer}`, population: o.population, region: `${o.regionCode} / ${o.regionMeaning}`, normalization: o.normalization };
}
function NumberedTitle({ number, title, hint }: { number: number; title: string; hint?: string }) {
  return <div className="lab-section-title"><span className="lab-number">{String(number).padStart(2, '0')}</span><div><h2>{title}</h2>{hint && <p className="muted">{hint}</p>}</div></div>;
}

export default function InsightLab() {
  const { dataset, local, updateLocal, notify, selectedTopicId, selectTopic, navigate } = useApp();
  const [seriesId, setSeriesId] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [selectedRefs, setSelectedRefs] = useState<string[]>([]);
  const [editingId, setEditingId] = useState('');
  const topic = dataset.topics.find(item => item.id === selectedTopicId) || dataset.topics[0];
  const evidence = useMemo(() => topic ? topicEvidence(dataset, topic.id) : { observations: [], geo: [] }, [dataset, topic]);
  const refs = useMemo(() => [...evidence.observations, ...evidence.geo].map(reference).filter(item => Boolean(safeUrl(item.url))), [evidence]);
  const evidenceGroups = useMemo(() => [...groupComparable(evidence.observations).entries()], [evidence]);
  const geoGroups = useMemo(() => {
    const grouped = new Map<string, GeoObservation[]>();
    for (const row of evidence.geo) {
      const key = [row.source, row.regionCode, row.layer, row.unit, row.normalization, row.importId || ''].join(' / ');
      grouped.set(key, [...(grouped.get(key) || []), row]);
    }
    return [...grouped.entries()];
  }, [evidence]);
  const chartSeries = [
    ...evidenceGroups.map(([key, rows]) => ({
      id: `observation:${key}`, label: `${rows[0].source} / ${rows[0].regionCode || '地域不明'} / ${rows[0].metric.name}`,
      observations: rows, unit: rows[0].metric.unit, normalization: rows[0].metric.normalization,
      points: rows.map(row => ({ date: row.observedAt.slice(0, 10), value: row.metric.value })),
    })),
    ...geoGroups.map(([key, rows]) => ({
      id: `geo:${key}`, label: `${rows[0].source} / ${rows[0].regionCode} / ${rows[0].unit} / 地域履歴`,
      observations: [] as Observation[], unit: rows[0].unit, normalization: rows[0].normalization,
      points: [...rows].sort((a, b) => a.date.localeCompare(b.date)).map(row => ({ date: row.date.slice(0, 10), value: row.value })),
    })),
  ];
  const activeSeries = chartSeries.find(series => series.id === seriesId) || chartSeries.find(series => new Set(series.points.map(point => point.date)).size > 1) || chartSeries[0];
  const selectedGroup = activeSeries?.observations || [];
  const chartData = activeSeries?.points || [];
  const selectedChart = activeSeries?.unit;
  const hasTemporalData = new Set(chartData.map(point => point.date)).size > 1;
  const spread = diffusion(evidence.observations, evidence.geo);
  const safety = topic ? brandSafety(topic, evidence.observations) : null;
  const momentum = calculateMomentum(selectedGroup, dataset.generatedAt);
  const persistence = calculatePersistence(selectedGroup, dataset.generatedAt);
  const novelty = calculateNovelty();
  const savedHypotheses = local.hypotheses.filter(item => item.topicId === topic?.id);

  useEffect(() => { setSeriesId(''); setHypothesis(''); setEditingId(''); setSelectedRefs([]); }, [topic?.id]);

  function saveHypothesis() {
    if (!topic || !hypothesis.trim()) return;
    const entry = { id: editingId || id('hypothesis'), topicId: topic.id, text: hypothesis.trim(), evidenceIds: selectedRefs.filter(refId => refs.some(ref => ref.id === refId)), updatedAt: new Date().toISOString() };
    updateLocal(current => ({ ...current, hypotheses: [...current.hypotheses.filter(item => item.id !== entry.id), entry] }));
    setHypothesis(''); setEditingId(''); setSelectedRefs([]); notify('仮説と参照IDをブラウザに保存しました。');
  }

  function exportAnalysis() {
    if (!topic) return;
    const markdown = [
      `# ${topic.title} — INSIGHT LAB`, `作成日時: ${new Date().toISOString()}`, '',
      '## 観測された事実', `取得済み観測 ${evidence.observations.length}件 / 地域・日時別観測 ${evidence.geo.length}件。これは保存レコード数であり、人気・人数・記事の総数ではありません。`,
      ...refs.map(item => `- [${item.id}] ${item.title}: ${item.metric}\n  観測 ${item.date} / 取得 ${item.fetched}\n  母集団 ${item.population}\n  地域 ${item.region}\n  正規化 ${item.normalization}\n  ${item.url}`), '',
      '## 仮説（未検証）', ...savedHypotheses.map(item => `- ${item.text}\n  根拠ID: ${item.evidenceIds.join(', ') || 'なし'}`), '',
      '## 限界', '取得範囲内の観測であり、生活者の属性別人気・地域間伝播・広告効果は示していません。検索指数の横断比較には同一正規化が必要です。',
    ].join('\n');
    downloadText(`culture-radar-insight-${topic.id}.md`, markdown, 'text/markdown;charset=utf-8');
  }

  return <div className="research-page">
    <header className="page-header"><div><p className="eyebrow">FROM SIGNAL TO UNDERSTANDING</p><h1>INSIGHT LAB<span className="lab-title-dot">.</span></h1><p className="muted">観測できたことから、まだ分からないことへ。根拠と仮説を分けて考える。</p></div><span className="badge"><FlaskConical size={14} /> 定型分析・有料API不要</span></header>
    <div className="panel lab-topic-bar"><label className="lab-topic-select">分析する話題<select className="field" aria-label="分析する話題" value={topic?.id || ''} onChange={event => selectTopic(event.target.value)}><option value="" disabled>話題を選択</option>{dataset.topics.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><button className="button" disabled={!topic} onClick={exportAnalysis}>分析をMarkdown出力 <ArrowUpRight size={15} /></button></div>
    {topic && <TopicContext topic={topic} variant="full"/>}
    {!topic ? <div className="panel lab-empty"><FlaskConical size={34} /><h2>まず、観測する話題を集めましょう。</h2><p className="muted">データ収集後、またはSPREAD MAPから実データCSVを取り込むと分析できます。架空の分析は生成しません。</p><button className="button button-primary" onClick={() => navigate('map')}>データを取り込む</button></div> : <>
      {safety?.flagged && <div className="notice lab-sensitive"><ShieldAlert size={19} /><p>{safety.reason}</p></div>}
      <div className="lab-layout"><div className="lab-main">
        <section className="panel lab-section"><NumberedTitle number={1} title="観測された事実" hint="取得済みレコードから確認できる範囲。解釈は含みません。" />
          <div className="lab-stat-grid"><div><strong>{evidence.observations.length}</strong><span>取得済み観測レコード</span></div><div><strong>{evidence.geo.length}</strong><span>地域・日時別レコード</span></div><div><strong>{spread.sources.length}</strong><span>情報源系統</span></div></div>
          <p className="muted">レコード数は保存範囲内の件数です。検索人数、話題の総量、記事総数、人気順位ではありません。</p>
          {refs.length ? <div className="lab-fact-list">{refs.slice(0, 3).map(item => <p key={item.id}><span className="badge">実測</span> {item.title}：{item.metric}<a href={safeUrl(item.url)} target="_blank" rel="noreferrer"> 原典 <ArrowUpRight size={12} /></a><small>参照ID: {item.id} ／ 観測: {formatDate(item.date, true)}</small></p>)}</div> : <div className="notice">出典URL付きの実測データがありません。背景や流行の理由を断定できません。</div>}
        </section>
        <section className="panel lab-section"><NumberedTitle number={2} title="数値・時系列" hint="同一情報源・地域・指標・正規化・母集団の中だけで読む。" />
          {chartSeries.length > 0 && <label className="lab-chart-select">表示する系列<select className="field" aria-label="分析の時系列" value={activeSeries?.id || ''} onChange={event => setSeriesId(event.target.value)}>{chartSeries.map(series => <option key={series.id} value={series.id}>{series.label}</option>)}</select></label>}
          {hasTemporalData ? <div className="lab-chart" role="img" aria-label={`${topic.title}の同一地域・情報源の観測履歴`}><ResponsiveContainer width="100%" height={230}><LineChart data={chartData} margin={{ top: 15, right: 16, left: 0, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--line)" /><XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={28} /><YAxis tick={{ fontSize: 11 }} width={40} /><Tooltip formatter={value => [value, selectedChart]} /><Line dataKey="value" name={selectedChart} type="linear" dot={{ r: 3 }} stroke="#528a66" strokeWidth={2} connectNulls={false} /></LineChart></ResponsiveContainer><p className="muted">観測された日時のみを表示。点間の線は視認性のためで、欠損期間の実測値ではありません。年次資料の日付は年の代表ラベルです。</p><p className="muted">正規化: {activeSeries?.normalization || '不明（比較不可）'}。正規化範囲が不明な資料から伸び率・国別順位は計算しません。</p></div> : <p className="notice">異なる日時の観測が2時点以上ありません。同時刻の別投稿を時系列として結びません。値を補間して作りません。</p>}
          <div className="lab-metric-grid">{[{ title: 'Momentum', metric: momentum }, { title: 'Persistence', metric: persistence }, { title: 'Novelty', metric: novelty }].map(({ title, metric }) => <div className="lab-metric" key={title}><span>{title}</span><strong>{metric.value === null ? '算出不可' : `${metric.value.toFixed(1)}${metric.unit}`}</strong><p className="muted">{metric.reason}</p></div>)}</div>
          <details className="lab-method"><summary><Info size={14} /> 観測範囲（Diffusion）と計算の基準</summary><p>検索市場: {spread.searchMarkets.map(code => REGIONS[code] || code).join('、') || '観測なし'}</p><p>報道機関所在国: {spread.publisherCountries.map(code => REGIONS[code] || code).join('、') || '観測なし'}</p><p>{spread.limitation}</p><p>急上昇・持続性の計算基準: {formatDate(dataset.generatedAt)}。各期間で最低10観測を要求。定義・限界はリポジトリの docs/METRICS.md を参照してください。</p></details>
        </section>
        <section className="panel lab-section"><NumberedTitle number={3} title="原典資料" hint="各主張の根拠ID、取得日時、母集団まで追跡する。" />
          <div className="lab-references">{refs.length ? refs.map(item => <details key={item.id} className="lab-reference"><summary><BookOpen size={15} /><span>{item.title}<small>{item.source} · {formatDate(item.date, true)}</small></span><ArrowUpRight size={14} /></summary><dl><dt>根拠ID</dt><dd className="lab-ref-id">{item.id}</dd><dt>指標・単位</dt><dd>{item.metric}</dd><dt>地域の意味</dt><dd>{item.region}</dd><dt>母集団</dt><dd>{item.population}</dd><dt>正規化</dt><dd>{item.normalization || '不明（比較不可）'}</dd><dt>観測日時</dt><dd>{formatDate(item.date)}</dd><dt>取得日時</dt><dd>{formatDate(item.fetched)}</dd></dl><a href={safeUrl(item.url)} target="_blank" rel="noreferrer">原典を開く <ArrowUpRight size={13} /></a></details>) : <p className="muted">出典を確認できるデータがありません。</p>}</div>
        </section>
        <section className="panel lab-section"><NumberedTitle number={4} title="どんな生活者と関係するか" />
          <div className="lab-evidence-types"><p><span className="badge">A · 調査実測</span> この話題と属性を結ぶ調査実測は自動生成しません。属性別の実測データなし。</p><p><span className="badge">B · 代理指標</span> 収集した投稿の国・年齢・性別は、言語や文章から推測しません。</p><p><span className="badge">C · 関連性の仮説</span> 関連する価値観や対象層は、公開調査と照合して検討してください。</p></div><button className="button" onClick={() => navigate('audience')}>AUDIENCEで調査資料を確認 <ArrowUpRight size={14} /></button>
        </section>
        <section className="panel lab-section"><NumberedTitle number={5} title="流行の背景に関する複数の仮説" hint="観測から作れる検証候補。理由を証明したものではありません。" />
          {refs.length ? <div className="lab-hypothesis-grid"><article><span className="badge">仮説 01 · 一時的な接触</span><h3>出来事や露出の増加が、関心の入口になった可能性。</h3><p>「{topic.title}」が観測された背景に、ニュース・発売・イベント等の一時的な露出がないか、観測日の前後で確認する。</p><small>起点となる観測: {refs[0].id}</small></article><article><span className="badge">仮説 02 · 継続する生活課題</span><h3>既存の欲求や不満に、接点ができた可能性。</h3><p>一時的な話題性と区別するため、関連する検索が継続するか、対象者が具体的な使い方を語るか、調査で確かめる。</p><small>起点となる観測: {refs[0].id}。欲求の実測は未取得。</small></article></div> : <p className="notice">起点になる実測データがないため、定型仮説は生成していません。下のメモに作業仮説を記録できます。</p>}
          <div className="lab-editor"><label>自分の仮説・解釈<textarea className="field" rows={4} placeholder="例：関心は一時的な出来事によるものか。反証できる観測は何か。" value={hypothesis} onChange={event => setHypothesis(event.target.value)} /></label><details><summary>参照する根拠IDを選ぶ（{selectedRefs.length}件）</summary><div className="lab-reference-checks">{refs.length ? refs.map(item => <label key={item.id}><input type="checkbox" checked={selectedRefs.includes(item.id)} onChange={event => setSelectedRefs(current => event.target.checked ? [...current, item.id] : current.filter(value => value !== item.id))} /><span>{item.title}<small>{item.id}</small></span></label>) : <p className="muted">参照できる根拠がありません。保存メモには参照IDなしと表示されます。</p>}</div></details><button className="button button-primary" disabled={!hypothesis.trim()} onClick={saveHypothesis}><Save size={15} />{editingId ? '仮説を更新' : '仮説を保存'}</button></div>
          {savedHypotheses.length > 0 && <div className="lab-saved-list">{savedHypotheses.map(item => <article key={item.id}><span className="badge">仮説・未検証</span><p>{item.text}</p><small>参照ID: {item.evidenceIds.join(', ') || 'なし'} ／ 更新: {formatDate(item.updatedAt)}</small><div><button className="button" onClick={() => { setEditingId(item.id); setHypothesis(item.text); setSelectedRefs(item.evidenceIds); }}>編集</button><button className="button" onClick={() => { updateLocal(current => ({ ...current, hypotheses: current.hypotheses.filter(value => value.id !== item.id) })); notify('仮説を削除しました。'); }}>削除</button></div></article>)}</div>}
        </section>
        <section className="panel lab-section"><NumberedTitle number={6} title="生活者の欲求・不満・共感の候補" />
          <p>「新しい体験への好奇心」「選択の負担を減らしたい」「自分に合うものを見つけたい」などは、インタビューで検証する一般的な候補です。「{topic.title}」に関心を持つ人の実測結果ではありません。</p><p className="muted">検証例：最近この話題を知った場面、実際の行動、代わりに選んだもの、解消しなかった不満を対象者に聞く。</p>
        </section>
        <section className="panel lab-section"><NumberedTitle number={7} title="反対の解釈" />
          <ul className="lab-check-list"><li>注目は肯定・購入意向ではなく、批判や驚きによるものかもしれない。</li><li>報道量の増加は、生活者の関心の増加と一致しないかもしれない。</li><li>取得範囲・時刻・正規化の違いが、地域差に見えているかもしれない。</li><li>既存ファンの活動が目立つだけで、新しい層には届いていないかもしれない。</li></ul><p className="muted">いずれも一般的な反証候補です。原典・調査・観測範囲を確認して判断します。</p>
        </section>
        <section className="panel lab-section"><NumberedTitle number={8} title="広告での応用可能性" />
          {safety?.flagged ? <div className="notice">{safety.reason}</div> : <><p>話題そのものの借用より、生活者が何を解決したいのかを明確にし、ブランドが提供できる価値との一致を検討します。現在の情報だけでは効果・購買意向は判断できません。</p><p className="muted">ブランドの特徴とマーケティング課題を入力すると、根拠付きの検証用ブリーフを作れます。</p><button className="button button-primary" onClick={() => { selectTopic(topic.id); navigate('brief'); }}>BRIEF BUILDERへ <ArrowUpRight size={14} /></button></>}
        </section>
        <section className="panel lab-section"><NumberedTitle number={9} title="追加で検証すべきこと" /><ul className="lab-check-list"><li><Check size={15} /> 原典の対象期間・母集団・地域の意味を確認する。</li><li><Check size={15} /> 対象層と一致する公開調査、または自分で実施する調査を加える。</li><li><Check size={15} /> 同一条件の時系列を蓄積し、一過性と持続的変化を区別する。</li><li><Check size={15} /> 反対仮説も検証し、広告案はコンセプトテストで確かめる。</li><li><Check size={15} /> 広告・投稿・画像の利用権限と、当事者への影響を確認する。</li></ul></section>
      </div><aside className="lab-aside"><div className="panel lab-summary"><p className="eyebrow">RESEARCH NOTE</p><Sparkles size={23} /><h3>断定する前に、<br />問いを深くする。</h3><p>ここで生まれるのは検証の出発点です。収集した事実と自分の解釈を、分けて残しましょう。</p><div className="lab-summary-row"><span>話題</span><strong>{topic.title}</strong></div><div className="lab-summary-row"><span>根拠</span><strong>{refs.length} レコード</strong></div><div className="lab-summary-row"><span>保存した仮説</span><strong>{savedHypotheses.length} 件</strong></div><p className="muted">表示日時は日本標準時。歴史資料は当時の観測であり、今日の流行を示しません。</p></div></aside></div>
    </>}
  </div>;
}
