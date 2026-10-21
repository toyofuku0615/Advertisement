import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowUpRight, Download, FileText, Plus, Save, ShieldAlert, Sparkles } from 'lucide-react';
import { useApp } from '../lib/store';
import { brandSafety, describeMetric, topicEvidence } from '../lib/analysis';
import { downloadText, formatDate, id, safeUrl } from '../lib/utils';
import type { Brief } from '../types';
import './research.css';

type Form = Omit<Brief, 'id' | 'updatedAt'>;
const emptyForm: Form = { brand: '', category: '', features: '', target: '', competitors: '', challenge: '', topicIds: [], notes: '' };

export default function BriefBuilder() {
  const { dataset, local, updateLocal, notify, selectedTopicId, navigate } = useApp();
  const [form, setForm] = useState<Form>({ ...emptyForm, topicIds: selectedTopicId ? [selectedTopicId] : [] });
  const [currentId, setCurrentId] = useState('');
  const [draftDate, setDraftDate] = useState('');
  const [edited, setEdited] = useState(false);
  const topics = dataset.topics.filter(topic => form.topicIds.includes(topic.id));
  const topicData = useMemo(() => topics.map(topic => ({ topic, ...topicEvidence(dataset, topic.id) })), [topics, dataset]);
  const references = useMemo(() => topicData.flatMap(item => [
    ...item.observations.filter(row => safeUrl(row.sourceUrl)).map(row => ({ id: row.id, title: row.title, url: row.sourceUrl, topic: item.topic.title, observedAt: row.observedAt, fetchedAt: row.fetchedAt, metric: describeMetric(row), population: row.population, normalization: row.metric.normalization })),
    ...item.geo.filter(row => safeUrl(row.sourceUrl)).map(row => ({ id: row.id, title: `${item.topic.title} / ${row.regionCode}`, url: row.sourceUrl, topic: item.topic.title, observedAt: row.date, fetchedAt: row.fetchedAt, metric: `${row.value} ${row.unit} / ${row.layer}`, population: row.population, normalization: row.normalization })),
  ]), [topicData]);
  const flagged = topicData.filter(item => brandSafety(item.topic, item.observations).flagged).map(item => item.topic);
  const selectedHypotheses = local.hypotheses.filter(item => form.topicIds.includes(item.topicId));

  useEffect(() => {
    if (selectedTopicId && !currentId && !edited) setForm(current => ({ ...current, topicIds: [selectedTopicId] }));
  }, [selectedTopicId, currentId, edited]);

  function patch<K extends keyof Form>(key: K, value: Form[K]) {
    setForm(current => ({ ...current, [key]: value })); setEdited(true);
  }
  function generate(event: FormEvent) {
    event.preventDefault();
    if (!form.brand.trim() || !form.features.trim() || !form.target.trim() || !form.challenge.trim()) { notify('ブランド、特徴、ターゲット、課題を入力してください。'); return; }
    if (!references.length) { notify('根拠データがある話題を選択してください。'); return; }
    const when = new Date().toISOString();
    const sourceLines = references.map(ref => `- [${ref.id}] ${ref.title}\n  ${ref.metric}\n  観測: ${ref.observedAt} / 取得: ${ref.fetchedAt}\n  母集団: ${ref.population}\n  正規化: ${ref.normalization || '不明（横断比較不可）'}\n  原典: ${ref.url}`);
    const relevantSources = [...new Set(references.map(ref => ref.url))];
    const sections = [
      `# ${form.brand.trim()} — コミュニケーション・ブリーフ`,
      `作成: ${when}\nステータス: 検証前の作業案（ルールベース・外部LLM未使用）`,
      '## 入力条件（ユーザー提供・未検証）',
      `- ブランド: ${form.brand}\n- 商品カテゴリー: ${form.category || '未指定'}\n- 商品の特徴: ${form.features}\n- ターゲット: ${form.target}\n- 競合: ${form.competitors || '未指定'}\n- マーケティング課題: ${form.challenge}`,
      '## 1. 市場・生活者の観測',
      `関連性を検討する話題: ${topics.map(topic => topic.title).join(' / ')}。取得範囲内に${references.length}件の根拠レコードがあります。これは人気や人数、記事の総数を示しません。`,
      `指定した「${form.target}」の属性別人気を証明するデータは、この選択だけでは得られません。公開調査または対象者調査で確かめます。歴史資料は当時の観測として扱います。`,
      '## 2. 根拠データ',
      ...sourceLines,
      '## 3. 生活者インサイト仮説（未検証）',
      `対象者が「${form.challenge}」に関係する負担や望みを持つかを確認する。もし関係が確認できれば、「${form.features}」が、その課題に具体的な価値を提供するか検証する。トレンドを見たことだけでは欲求や購買意向を断定しない。`,
      ...selectedHypotheses.map(hypothesis => `- リサーチメモ由来の仮説: ${hypothesis.text}\n  参照ID: ${hypothesis.evidenceIds.join(', ') || 'なし（根拠未設定）'}`),
      '## 4. コミュニケーション課題',
      `「${form.target}」が理解・比較・判断するときの障壁を調べ、「${form.features}」がどの場面で役立つかを具体的に伝える。解決すべき課題は「${form.challenge}」。`,
      '## 5. 企画の切り口（仮説）',
      ...(flagged.length ? [
        `【自動提案停止】選択した話題「${flagged.map(topic => topic.title).join('、')}」には事故・災害・暴力・差別等を含む可能性があります。商用機会として扱わず、当事者への影響と原典を人が確認してください。`,
      ] : [
        `A. 利用場面から考える: 「${form.features}」が役立つ生活の場面を対象者の言葉で特定し、話題「${topics.map(topic => topic.title).join(' / ')}」との関連があるか調べる。関連がなければトレンドを採用しない。`,
        `B. 選ぶ理由から考える: 「${form.target}」が代替手段と比べるポイントを調査し、ブランドの特徴との一致を確かめる。競合との優劣は実測なしに主張しない。`,
      ]),
      '## 6. クリエイティブアイデア（検証用）',
      ...(flagged.length ? ['センシティブな文脈の確認が終わるまで、自動生成しません。'] : [
        `案1: 生活の中の具体的な困りごと → 「${form.features}」による利用場面 → 対象者による理解確認。最初の3秒は観察した困りごとの描写を仮案にし、当事者調査で確かめる。`,
        `案2: 対象者自身が、選ぶ際の不安・疑問を語る短い形式。実証できる特徴だけを答えとして示す。トレンドの画像・投稿・音源は、権利確認なしに再利用しない。`,
      ]),
      '## 7. 検証方法',
      '- 原典の地域の意味、母集団、観測時期、指標と正規化を確認。異なる指標や国別指数を合算しない。',
      `- 「${form.target}」に該当する対象者へ探索インタビューを行い、話題の認知・行動・ブランドとの関連を別々に聞く。`,
      '- 観測を説明できる反対仮説（一時的ニュース、批判、取得範囲の偏り）を検討する。',
      '- トレンドあり／なしのコンセプトを同条件で比較し、理解・関連性・不快感を測る。必要サンプル数と判断基準は実施前に設計する。',
      '- 媒体・予算・目的に応じた実験計画を立てる。未検証のCVR・ROAS・成功確率を生成しない。',
      '## 8. 原典URL一覧',
      ...relevantSources.map(url => `- ${url}`),
      '', '## 限界',
      '本資料は出典とユーザー入力に基づく企画の作業案です。市場規模、指定属性の人気、将来の伝播、広告効果を証明するものではありません。仮説は追加調査で検証してください。',
    ];
    patch('notes', sections.join('\n\n')); setDraftDate(when); notify('根拠付きの検証用ドラフトを作成しました。内容を編集して保存できます。');
  }
  function save() {
    if (!form.brand.trim()) { notify('保存するにはブランド名を入力してください。'); return; }
    const entry: Brief = { ...form, id: currentId || id('brief'), updatedAt: new Date().toISOString() };
    updateLocal(current => ({ ...current, briefs: [entry, ...current.briefs.filter(item => item.id !== entry.id)] }));
    setCurrentId(entry.id); setEdited(false); notify('ブリーフをブラウザに保存しました。');
  }
  function reset() { setForm({ ...emptyForm, topicIds: selectedTopicId ? [selectedTopicId] : [] }); setCurrentId(''); setEdited(false); setDraftDate(''); }
  function load(brief: Brief) { const { id: briefId, updatedAt, ...rest } = brief; setForm(rest); setCurrentId(briefId); setDraftDate(updatedAt); setEdited(false); }

  return <div className="research-page">
    <header className="page-header"><div><p className="eyebrow">CONNECT CULTURE WITH BRAND VALUE</p><h1>BRIEF BUILDER<span className="lab-title-dot">.</span></h1><p className="muted">流行を借りる前に、ブランドの価値と生活者の課題をつなぐ。</p></div><button className="button" onClick={reset}><Plus size={16} />新しいブリーフ</button></header>
    <div className="notice lab-brief-intro"><Sparkles size={18} /><span>有料APIなしの定型ドラフト。観測された事実・ユーザー入力・未検証の仮説を分けて出力します。</span></div>
    <div className="brief-layout"><div><form className="panel brief-form" onSubmit={generate}>
      <div className="section-heading"><div><p className="eyebrow">01 / BRAND CONTEXT</p><h2>ブランドと、向き合う課題</h2></div><span className="badge">* 必須</span></div>
      <div className="grid-two"><label>ブランド名 *<input className="field" required maxLength={160} value={form.brand} placeholder="ブランド・商品名" onChange={event => patch('brand', event.target.value)} /></label><label>商品カテゴリー<select className="field" value={form.category} onChange={event => patch('category', event.target.value)}><option value="">選択してください</option>{local.categories.map(category => <option key={category}>{category}</option>)}</select></label></div>
      <label>商品の特徴・ブランドが提供できる価値 *<textarea className="field" required rows={3} value={form.features} placeholder="実際に提供できる特徴や便益を記入。根拠のない優位性は入れない。" onChange={event => patch('features', event.target.value)} /></label>
      <div className="grid-two"><label>ターゲット *<input className="field" required value={form.target} placeholder="地域・生活場面・対象層" onChange={event => patch('target', event.target.value)} /></label><label>競合・代替手段<input className="field" value={form.competitors} placeholder="ブランド名や、同じ課題の解決手段" onChange={event => patch('competitors', event.target.value)} /></label></div>
      <label>マーケティング課題 *<textarea className="field" required rows={3} value={form.challenge} placeholder="誰の、どのような理解や行動を変えたいか。現状の根拠も記入。" onChange={event => patch('challenge', event.target.value)} /></label>
      <div className="brief-divider" /><div className="section-heading"><div><p className="eyebrow">02 / CULTURAL EVIDENCE</p><h2>関連性を検討する話題</h2></div><span className="badge">{topics.length} 件選択</span></div>
      <p className="muted">人気の借用ではなく、ブランドの課題と結びつく根拠があるかを考えます。</p>
      <div className="brief-topic-list">{dataset.topics.length ? dataset.topics.map(topic => {
        const data = topicEvidence(dataset, topic.id);
        return <label key={topic.id}><input type="checkbox" checked={form.topicIds.includes(topic.id)} onChange={event => patch('topicIds', event.target.checked ? [...form.topicIds, topic.id] : form.topicIds.filter(value => value !== topic.id))} /><span><strong>{topic.title}</strong><small>{topic.category} · {data.observations.length + data.geo.length} 観測レコード</small></span></label>;
      }) : <p className="notice">取得済みの話題がありません。収集処理、またはSPREAD MAPのCSV取り込みで実データを追加してください。</p>}</div>
      {flagged.length > 0 && <div className="notice lab-sensitive"><ShieldAlert size={18} /><span>センシティブな話題の可能性を検出しました。広告活用案の自動提案を止め、根拠確認と検証計画のみ出力します。</span></div>}
      <div className="brief-evidence-summary"><strong>選択した話題の根拠: {references.length} レコード</strong><p className="muted">話題の選択だけでは指定ターゲットとの関連性は証明されません。属性別の実測は追加調査で確認します。</p></div>
      <div className="brief-actions"><button className="button button-primary" type="submit" disabled={!references.length}><Sparkles size={16} />検証用ドラフトを作る</button><button className="button" type="button" onClick={save} disabled={!form.brand.trim()}><Save size={15} />入力を保存</button></div>
      {!references.length && <p className="muted">ドラフト生成には、原典URLを持つ観測がある話題を1件以上選択してください。入力のみの保存はできます。</p>}
    </form>
    <section className="panel brief-output"><div className="section-heading"><div><p className="eyebrow">03 / WORKING DRAFT</p><h2>編集して、検証につなげる</h2></div><span className="badge">{edited ? '編集中' : currentId ? 'ブラウザ保存済み' : '未保存'}</span></div>
      {form.notes ? <><p className="muted">作成・読込: {formatDate(draftDate)}。観測時点は本文の各根拠を参照。仮説は検証前の作業案です。</p><label>ブリーフ本文（Markdown）<textarea className="field brief-draft" rows={24} value={form.notes} onChange={event => patch('notes', event.target.value)} /></label><div className="brief-actions"><button className="button button-primary" onClick={save}><Save size={15} />ブリーフを保存</button><button className="button" onClick={() => downloadText(`culture-radar-brief-${form.brand.replace(/[^\p{L}\p{N}_-]/gu, '_') || 'draft'}.md`, form.notes, 'text/markdown;charset=utf-8')}><Download size={15} />Markdown出力</button></div></> : <div className="lab-empty"><FileText size={30} /><h3>根拠を選び、ドラフトを作成。</h3><p className="muted">観測 → インサイト仮説 → 課題 → 企画の切り口 → クリエイティブ → 検証方法の順で構成します。根拠のない数字や成果予測は生成しません。</p></div>}
    </section></div><aside className="brief-aside"><section className="panel lab-summary"><p className="eyebrow">YOUR RESEARCH DESK</p><h2>保存したブリーフ</h2>{local.briefs.length ? <div className="brief-saved-list">{local.briefs.map(brief => <article key={brief.id} className={brief.id === currentId ? 'is-active' : ''}><button className="brief-load" onClick={() => load(brief)}><FileText size={17} /><span><strong>{brief.brand}</strong><small>{brief.target || 'ターゲット未指定'}</small><small>{formatDate(brief.updatedAt, true)}</small></span></button><button className="brief-delete" onClick={() => { updateLocal(current => ({ ...current, briefs: current.briefs.filter(item => item.id !== brief.id) })); if (currentId === brief.id) reset(); notify('ブリーフを削除しました。'); }}>削除</button></article>)}</div> : <p className="muted">ブリーフはこのブラウザに保存されます。書き出してバックアップできます。</p>}</section>
      <section className="panel lab-summary"><p className="eyebrow">EVIDENCE CHECK</p><h3>つながりは、まだ仮説。</h3><p>原典の観測と、選んだターゲットの生活課題を混同しない。ブランドが役立つ場面が見えなければ、そのトレンドを使わない判断も残しましょう。</p><button className="button" onClick={() => navigate('insight')}>INSIGHT LABで考える <ArrowUpRight size={14} /></button></section>
      {references.length > 0 && <section className="panel lab-summary"><p className="eyebrow">SOURCE LINKS</p><h3>選択中の根拠</h3><div className="brief-source-links">{[...new Map(references.map(ref => [ref.url, ref])).values()].map(ref => <a key={ref.url} href={safeUrl(ref.url)} target="_blank" rel="noreferrer"><span>{ref.topic}<small>{formatDate(ref.observedAt, true)} · 原典</small></span><ArrowUpRight size={14} /></a>)}</div></section>}
    </aside></div>
  </div>;
}
