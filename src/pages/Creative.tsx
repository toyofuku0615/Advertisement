import { useMemo, useState } from 'react';
import { ArrowUpRight, BookmarkPlus, Copy, Download, Film, FolderOpen, Layers3, Pencil, Search, Trash2, X } from 'lucide-react';
import { useApp } from '../lib/store';
import { downloadCsv, downloadText, formatDate } from '../lib/utils';
import type { CreativeAnalysis } from '../types';
import './Creative.css';

type CreativeField = Exclude<keyof CreativeAnalysis, 'id' | 'createdAt'>;
type Grouping = 'format' | 'hook' | 'emotion' | 'none';
interface Field { key: CreativeField; label: string; placeholder: string; multiline?: boolean }
const narrativeFields: Field[] = [
  { key: 'firstThreeSeconds', label: '最初の3秒', placeholder: '実際に見た動き、音、言葉を記録' },
  { key: 'hook', label: 'フック', placeholder: '問いかけ、違和感、ビフォーアフター…' },
  { key: 'composition', label: '画角・構図', placeholder: '寄り、俯瞰、縦型、手持ち…' },
  { key: 'story', label: 'ストーリー', placeholder: '導入 → 展開 → 結末', multiline: true },
  { key: 'cast', label: '出演者', placeholder: '確認できる役割やキャラクター' },
  { key: 'copy', label: 'コピー', placeholder: '確認できたコピーを引用範囲に配慮して記録', multiline: true },
];
const expressionFields: Field[] = [
  { key: 'appeal', label: '訴求内容', placeholder: '何を伝えているか' },
  { key: 'format', label: 'クリエイティブ形式', placeholder: 'レビュー、実演、インタビュー…' },
  { key: 'emotion', label: '感情表現', placeholder: '驚き、安心、楽しさ…' },
  { key: 'surprise', label: '意外性', placeholder: '予想を裏切る要素' },
  { key: 'empathy', label: '共感', placeholder: 'どんな経験や感情を扱うか' },
  { key: 'benefit', label: 'ベネフィット', placeholder: '生活者にどんな価値を約束するか' },
  { key: 'cta', label: 'CTA', placeholder: '購入、試用、検索、参加…' },
];
const referenceLinks = [
  { name: 'TikTok Creative Center', url: 'https://ads.tiktok.com/business/creativecenter/' },
  { name: 'Meta 広告ライブラリ', url: 'https://www.facebook.com/ads/library/' },
  { name: 'Google Ads Transparency', url: 'https://adstransparency.google.com/' },
  { name: 'TikTok', url: 'https://www.tiktok.com/' },
  { name: 'Instagram', url: 'https://www.instagram.com/' },
  { name: 'X', url: 'https://x.com/' },
];
const exportFields: (keyof CreativeAnalysis)[] = ['id', 'url', 'brand', 'category', 'firstThreeSeconds', 'hook', 'composition', 'story', 'cast', 'copy', 'appeal', 'format', 'emotion', 'surprise', 'empathy', 'benefit', 'cta', 'metrics', 'notes', 'createdAt'];

function blankCreative(): CreativeAnalysis {
  return { id: '', url: '', brand: '', category: '', hook: '', firstThreeSeconds: '', copy: '', appeal: '', format: '', emotion: '', cta: '', composition: '', story: '', cast: '', surprise: '', empathy: '', benefit: '', metrics: '', notes: '', createdAt: '' };
}
function validatedUrl(value: string): string | null {
  try { const url = new URL(value.trim()); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}


export default function Creative() {
  const { local, updateLocal, notify } = useApp();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [grouping, setGrouping] = useState<Grouping>('format');
  const [editing, setEditing] = useState<CreativeAnalysis | null>(null);
  const [formError, setFormError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const creatives = local.creatives;
  const categories = [...new Set([...local.categories, ...creatives.map(item => item.category)])].filter(Boolean);
  const filtered = useMemo(() => creatives.filter(item => (!category || item.category === category) && (!query || Object.values(item).join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase()))).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [creatives, query, category]);
  const groups = useMemo(() => {
    const result = new Map<string, CreativeAnalysis[]>();
    for (const item of filtered) {
      const key = grouping === 'none' ? 'すべての研究' : item[grouping].trim() || '未分類';
      result.set(key, [...(result.get(key) || []), item]);
    }
    return [...result.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'ja'));
  }, [filtered, grouping]);
  const startNew = () => { setEditing(blankCreative()); setFormError(''); };
  const changeField = (key: CreativeField, value: string) => setEditing(current => current ? { ...current, [key]: value } : current);
  const saveCreative = (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    const url = validatedUrl(editing.url);
    if (!url) { setFormError('認証情報を含まない http:// または https:// の原典URLを入力してください。'); return; }
    if (!editing.brand.trim()) { setFormError('ブランド名を入力してください。不明な場合は「不明」と記録できます。'); return; }
    const duplicate = creatives.find(item => item.url === url && item.id !== editing.id);
    if (duplicate) { setFormError('同じ原典URLが保存されています。既存のカードを編集してください。'); return; }
    const now = new Date().toISOString();
    const saved: CreativeAnalysis = { ...editing, id: editing.id || crypto.randomUUID(), url, brand: editing.brand.trim(), category: editing.category.trim(), createdAt: editing.createdAt || now };
    updateLocal(current => ({ ...current, creatives: [saved, ...current.creatives.filter(item => item.id !== saved.id)] }));
    setEditing(null); setFormError(''); setExpandedId(saved.id);
    notify(editing.id ? 'クリエイティブの分析を更新しました' : '原典URLと分析を保存しました');
  };
  const removeCreative = (id: string) => {
    updateLocal(current => ({ ...current, creatives: current.creatives.filter(item => item.id !== id) }));
    if (editing?.id === id) setEditing(null);
    setConfirmDelete(null); notify('クリエイティブの研究記録を削除しました');
  };
  const exportCsv = () => {
    downloadCsv(`culture-radar-creatives-${new Date().toISOString().slice(0, 10)}.csv`, [exportFields, ...filtered.map(item => exportFields.map(key => item[key]))]);
    notify(`${filtered.length}件の研究記録を書き出しました`);
  };
  const fieldInput = (field: Field) => (
    <label className={field.multiline ? 'creative-field creative-span' : 'creative-field'} key={field.key}>
      <span>{field.label}</span>
      {field.multiline
        ? <textarea className="field" rows={3} value={editing?.[field.key] ?? ''} onChange={event => changeField(field.key, event.target.value)} placeholder={field.placeholder} maxLength={10000} />
        : <input className="field" value={editing?.[field.key] ?? ''} onChange={event => changeField(field.key, event.target.value)} placeholder={field.placeholder} maxLength={2000} />}
    </label>
  );

  return <div className="creative-page">
    <header className="page-header">
      <div><p className="eyebrow">CREATIVE / EXPRESSION LIBRARY</p><h1>表現を集め、発想をほどく。</h1><p className="muted">実際の広告や投稿を、あなたの視点で研究するワークスペース。</p></div>
      <button className="button button-primary" onClick={startNew}><BookmarkPlus size={17} /> URLを保存</button>
    </header>

    <div className="creative-intro panel">
      <div className="creative-intro-icon"><Film size={23} /></div>
      <div><h2>気になった表現に、理由を残す。</h2><p className="muted">広告ライブラリや公式画面で見つけた原典URLを登録。動画の転載や無断取得をせず、観察した表現と自分の解釈を整理できます。</p></div>
      <span className="badge">{creatives.length} 保存済み</span>
    </div>
    <nav className="creative-reference-links" aria-label="公式の広告・投稿画面">
      {referenceLinks.map(link => <a key={link.name} href={link.url} target="_blank" rel="noopener noreferrer">{link.name}<ArrowUpRight size={13} /></a>)}
    </nav>
    <p className="creative-caution"><span className="badge">解釈は仮説</span> 掲載の事実や公開反応数だけで、広告効果・CVR・ROASは判断できません。以下の分類はユーザー自身による観察・分析です。</p>

    {editing && <section className="panel creative-editor" aria-label={editing.id ? 'クリエイティブを編集' : 'クリエイティブを新規保存'}>
      <div className="section-heading"><div><p className="eyebrow">RESEARCH NOTE</p><h2>{editing.id ? '分析を編集' : '新しいクリエイティブ'}</h2></div><button className="button" aria-label="入力を閉じる" onClick={() => { setEditing(null); setFormError(''); }}><X size={18} /></button></div>
      <form onSubmit={saveCreative}>
        <div className="creative-form-grid">
          <label className="creative-field creative-span"><span>原典URL <small>必須</small></span><input className="field" type="url" required autoFocus value={editing.url} onChange={event => changeField('url', event.target.value)} placeholder="https://…" maxLength={4000} /><span className="muted creative-field-help">広告・投稿そのものを確認できるURL。取得・再生は原典の画面で行います。</span></label>
          <label className="creative-field"><span>ブランド <small>必須</small></span><input className="field" required value={editing.brand} onChange={event => changeField('brand', event.target.value)} placeholder="ブランド名 / 不明" maxLength={200} /></label>
          <label className="creative-field"><span>商品カテゴリー</span><input className="field" list="creative-category-options" value={editing.category} onChange={event => changeField('category', event.target.value)} placeholder="食品・飲料、美容など" maxLength={100} /><datalist id="creative-category-options">{categories.map(value => <option key={value} value={value} />)}</datalist></label>
        </div>
        <div className="creative-form-divider"><span>01</span><h3>何が、どう映っていたか</h3><p className="muted">観察した事実を記録</p></div>
        <div className="creative-form-grid">{narrativeFields.map(fieldInput)}</div>
        <div className="creative-form-divider"><span>02</span><h3>どんな表現の型があるか</h3><p className="muted">分類・解釈はあなたの仮説</p></div>
        <div className="creative-form-grid">{expressionFields.map(fieldInput)}</div>
        <div className="creative-form-divider"><span>03</span><h3>根拠と分析メモ</h3></div>
        <div className="creative-form-grid">
          {fieldInput({ key: 'metrics', label: '確認できる公開指標・確認日時', placeholder: '数値、単位、対象期間、確認日時、指標の出典URL。未確認なら空欄。広告効果の推定値は記録しないでください。', multiline: true })}
          {fieldInput({ key: 'notes', label: '分析メモ・次に検証すること', placeholder: '気になった理由、別の解釈、参考にできる表現、検証したい仮説…', multiline: true })}
        </div>
        {formError && <p className="notice creative-form-error" role="alert">{formError}</p>}
        <div className="creative-form-actions"><p className="muted">このブラウザに保存します。端末間の同期は行いません。</p><button type="button" className="button" onClick={() => setEditing(null)}>キャンセル</button><button className="button button-primary" type="submit"><BookmarkPlus size={16} />{editing.id ? '変更を保存' : '研究記録を保存'}</button></div>
      </form>
    </section>}

    <section className="creative-library" aria-label="保存したクリエイティブ">
      <div className="creative-toolbar">
        <label className="creative-search"><Search size={17} /><input className="field" aria-label="クリエイティブを検索" placeholder="ブランド、コピー、メモを検索" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <select className="field" aria-label="クリエイティブのカテゴリー" value={category} onChange={event => setCategory(event.target.value)}><option value="">すべてのカテゴリー</option>{categories.map(value => <option key={value} value={value}>{value}</option>)}</select>
        <label className="creative-group-control"><Layers3 size={16} /><select className="field" aria-label="クリエイティブのグループ分類" value={grouping} onChange={event => setGrouping(event.target.value as Grouping)}><option value="format">形式でまとめる</option><option value="hook">フックでまとめる</option><option value="emotion">感情でまとめる</option><option value="none">すべて表示</option></select></label>
        <button className="button" onClick={exportCsv} disabled={filtered.length === 0}><Download size={16} /> CSV</button>
        <button className="button" onClick={() => downloadText('culture-radar-creatives.json', JSON.stringify(filtered, null, 2), 'application/json')} disabled={filtered.length === 0}><Copy size={16} /> JSON</button>
      </div>
      <div className="creative-results-label"><span>{filtered.length}件の研究記録</span><span>グループ数は保存記録の件数です。広告成果や市場全体の傾向ではありません。</span></div>
      {filtered.length === 0 ? <div className="panel creative-empty"><FolderOpen size={32} /><h2>{creatives.length ? '条件に一致する研究記録がありません' : 'まだ集めていない表現がある。'}</h2><p className="muted">{creatives.length ? '検索語やカテゴリーを変更して、保存済みの記録を探してください。' : '公式ライブラリで気になる広告を見つけたら、URLと観察メモをひとつ保存してみましょう。'}</p><button className="button button-primary" onClick={creatives.length ? () => { setQuery(''); setCategory(''); } : startNew}>{creatives.length ? '条件をリセット' : '最初のURLを保存'}</button></div> : groups.map(([name, items]) => <section className="creative-group" key={name}>
        <div className="creative-group-heading"><h2>{name}</h2><span className="badge">{items.length}件</span></div>
        <div className="creative-card-grid">{items.map(item => {
          const expanded = expandedId === item.id;
          const url = validatedUrl(item.url);
          return <article className="panel creative-card" key={item.id}>
            <div className="creative-card-top"><div className="creative-card-brand-icon">{item.brand.trim().slice(0, 1) || 'C'}</div><div><p className="eyebrow">{item.category || 'カテゴリー未分類'}</p><h3>{item.brand}</h3></div>{url && <a className="button" href={url} target="_blank" rel="noopener noreferrer" aria-label={`${item.brand}の原典を開く`}><ArrowUpRight size={18} /></a>}</div>
            <div className="creative-card-copy">{item.copy ? <><span><Copy size={14} /> COPY</span><p>{item.copy}</p></> : <><span><Film size={14} /> FIRST 3 SECONDS</span><p>{item.firstThreeSeconds || '表現の観察メモを追加してください。'}</p></>}</div>
            <div className="creative-card-tags">{[item.format, item.emotion, item.hook].filter(Boolean).map((tag, index) => <span className="badge" key={`${index}-${tag}`}>{tag}</span>)}</div>
            <dl className="creative-card-brief"><div><dt>フック</dt><dd>{item.hook || '未記録'}</dd></div><div><dt>ベネフィット</dt><dd>{item.benefit || '未記録'}</dd></div><div><dt>CTA</dt><dd>{item.cta || '未記録'}</dd></div></dl>
            {expanded && <div className="creative-card-detail"><dl>{[...narrativeFields, ...expressionFields, { key: 'metrics' as const, label: '公開指標・確認日時', placeholder: '' }, { key: 'notes' as const, label: '分析メモ', placeholder: '' }].filter(field => item[field.key]).map(field => <div key={field.key}><dt>{field.label}</dt><dd>{item[field.key]}</dd></div>)}</dl><p className="muted">手動で記録・分類した研究メモです。公開日時・元指標の取得日時は自動取得していません。数値を記録する際は、原典と確認日時を公開指標欄に記載してください。</p>{url && <a className="creative-original-url" href={url} target="_blank" rel="noopener noreferrer">{url}<ArrowUpRight size={13} /></a>}</div>}
            <div className="creative-card-actions"><span className="muted">保存 {formatDate(item.createdAt)}</span><button className="button" onClick={() => setExpandedId(expanded ? null : item.id)} aria-expanded={expanded}>{expanded ? '閉じる' : '分析を読む'}</button><button className="button" onClick={() => { setEditing({ ...item }); setFormError(''); }} aria-label={`${item.brand}の分析を編集`}><Pencil size={15} /></button><button className="button" onClick={() => setConfirmDelete(item.id)} aria-label={`${item.brand}の記録を削除`}><Trash2 size={15} /></button></div>
            {confirmDelete === item.id && <div className="creative-delete-confirm" role="alert"><p>この研究記録を削除しますか？</p><button className="button" onClick={() => setConfirmDelete(null)}>戻る</button><button className="button" onClick={() => removeCreative(item.id)}>削除する</button></div>}
          </article>;
        })}</div>
      </section>)}
    </section>
  </div>;
}
