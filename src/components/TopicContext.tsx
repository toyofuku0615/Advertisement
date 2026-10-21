import { useState } from 'react';
import { ArrowRight, ArrowUpRight, BookOpenText, ChevronDown, Clock3, Lightbulb, MessageCircleMore, Sparkles } from 'lucide-react';
import { useApp } from '../lib/store';
import { formatDate, safeUrl } from '../lib/utils';
import type { Claim, ExplanationEvidence, Observation, Topic, TopicExplanation } from '../types';
import { Dialog } from './ui/dialog';
import './TopicContext.css';

interface TopicContextProps { topic: Topic; observation?: Observation; variant: 'card' | 'full' }
interface Headline { title: string; url: string; fetchedAt: string; observationId: string }

function ClaimText({ claim, evidence }: { claim: Claim; evidence: ExplanationEvidence[] }) {
  const cited = claim.evidenceIds.map(id => ({ row: evidence.find(item => item.id === id), number: evidence.findIndex(item => item.id === id) + 1 })).filter(item => item.row && safeUrl(item.row.url));
  return <div className="context-claim"><p>{claim.text}<span className="context-citations">{cited.map(({ row, number }) => <a key={row!.id} href={safeUrl(row!.url)} target="_blank" rel="noreferrer" aria-label={`出典${number}: ${row!.title}`} title={row!.title}>[{number}]</a>)}</span></p></div>;
}

function ClaimLabel({ claim }: { claim: Claim }) { return <span className={`context-kind ${claim.kind === 'interpretation' ? 'hypothesis' : ''}`}>{claim.kind === 'interpretation' ? 'AIの解釈・仮説' : '原典情報のAI要約'}</span>; }

function ExplanationBody({ explanation, historical = false }: { explanation: TopicExplanation; historical?: boolean }) {
  return <div className={`context-explanation-body ${historical ? 'context-historical' : ''}`}>
    <section className="context-what"><div className="context-section-label"><BookOpenText size={15} /><h3>何の話？</h3><ClaimLabel claim={explanation.overview} /></div><ClaimText claim={explanation.overview} evidence={explanation.evidence} /></section>
    <div className="context-reading-grid"><section className="context-situations"><div className="context-section-label"><MessageCircleMore size={15} /><h3>どんな場面で使われる？</h3></div>{explanation.contexts.length ? explanation.contexts.map((claim, index) => <div className="context-situation" key={`${index}-${claim.text}`}><ClaimLabel claim={claim} /><ClaimText claim={claim} evidence={explanation.evidence} /></div>) : <p className="context-no-context">利用場面まで判断できる根拠はありません。下の見出し・原典から確認してください。</p>}</section>
      {explanation.attention && <section className="context-attention"><div className="context-section-label"><Lightbulb size={15} /><h3>注目の背景をどう読むか</h3></div><ClaimLabel claim={explanation.attention} /><ClaimText claim={explanation.attention} evidence={explanation.evidence} /><p className="context-small-note">検索が増えた理由を証明したものではありません。</p></section>}
    </div>
    {explanation.marketing && <section className="context-marketing"><div className="context-section-label"><Lightbulb size={15} /><h3>マーケターが考えたいこと</h3><ClaimLabel claim={explanation.marketing} /></div><ClaimText claim={explanation.marketing} evidence={explanation.evidence} /></section>}
    {explanation.caveats.length > 0 && <details className="context-caveats"><summary><ChevronDown size={13} />この解説で、まだ分からないこと</summary><ul>{explanation.caveats.map((note, index) => <li key={`${index}-${note}`}>{note}</li>)}</ul></details>}
    <details className="context-evidence"><summary><BookOpenText size={14} />解説に使った出典 <span>{explanation.evidence.length}</span></summary><ol>{explanation.evidence.map((row, index) => <li key={row.id}><a href={safeUrl(row.url) || undefined} aria-disabled={!safeUrl(row.url)} target="_blank" rel="noreferrer"><span className="context-reference-number">[{index + 1}]</span><span>{row.title}<small>{row.source} · 観測 {formatDate(row.observedAt, true)} · 取得 {formatDate(row.fetchedAt)}</small></span><ArrowUpRight size={13} /></a><code>{row.id}</code></li>)}</ol></details>
    <div className="context-generation"><Sparkles size={12} /><span>{historical ? '更新前のAI解説' : 'AI解説'} · {formatDate(explanation.generatedAt)} · {explanation.provider}{explanation.model && explanation.model !== explanation.provider ? ` / ${explanation.model}` : ''}</span></div>
  </div>;
}

export default function TopicContext({ topic, observation, variant }: TopicContextProps) {
  const { dataset, explanations, explanationsLoading, explanationsError } = useApp();
  const [open, setOpen] = useState(false);
  const explanation = explanations?.explanations.find(item => item.topicId === topic.id);
  const ready = explanation?.status === 'ready' ? explanation : null;
  const stale = explanation?.status === 'stale' ? explanation : null;
  const observations = observation ? [observation, ...dataset.observations.filter(item => item.topicId === topic.id && item.id !== observation.id)] : dataset.observations.filter(item => item.topicId === topic.id);
  const seen = new Set<string>();
  const headlines: Headline[] = observations.flatMap(item => (item.relatedLinks || []).map(link => ({ ...link, fetchedAt: item.fetchedAt, observationId: item.id }))).filter(item => { const url = safeUrl(item.url); if (!url || seen.has(url)) return false; seen.add(url); return true; });
  const geoObservations = dataset.geoObservations.filter(item => item.topicId === topic.id);
  const archive = observations.some(item => item.source.includes('archive')) || geoObservations.some(item => item.source.includes('archive'));
  const fallbackSource = observations.find(item => safeUrl(item.sourceUrl)) || geoObservations.find(item => safeUrl(item.sourceUrl));

  function headlineList() {
    return headlines.length > 0 ? <section className="context-headlines"><div className="context-section-label"><BookOpenText size={15} /><h3>関連する実際の見出し</h3><span className="context-kind source">取得した原文</span></div><p className="context-small-note">記事本文は取得していません。見出しを開いて、実際の文脈を確かめられます。</p><ul>{headlines.slice(0, 4).map(item => <li key={item.url}><a href={safeUrl(item.url)} target="_blank" rel="noreferrer"><span>{item.title}<small>取得 {formatDate(item.fetchedAt)}</small></span><ArrowUpRight size={15} /></a></li>)}</ul></section> : fallbackSource ? <section className="context-headlines"><div className="context-section-label"><BookOpenText size={15} /><h3>{archive ? '公開アーカイブの原資料' : '取得した原典を読む'}</h3></div><p className="context-small-note">{archive ? '過去の年次検索指数です。現在の話題や、実際の投稿での用例を示す資料ではありません。' : 'この観測には関連記事の見出しが付いていません。原典から意味・利用場面を確認してください。'}</p><a className="context-original-link" href={safeUrl(fallbackSource.sourceUrl)} target="_blank" rel="noreferrer">原典を確認する <ArrowUpRight size={14} /></a></section> : <p className="context-no-context">文脈を確認できる原典・関連記事がまだありません。AIによる説明は生成していません。</p>;
  }

  function fullBody() {
    return <div className="topic-context-body"><div className="context-intro"><span className="context-ai-mark"><Sparkles size={17} /></span><div><span className="context-eyebrow">CONTEXT EXPLAINER</span><h2>この話題を、ひとことで。</h2></div>{ready && <span className="context-ready-label">AI解説</span>}</div>
      {ready ? <><p className="context-scope">検索語や関連記事の見出しをつなぎ、読むための手がかりを整理しています。原典の要約と、利用場面についての仮説を分けて表示します。</p><ExplanationBody explanation={ready} /></> : <div className="context-unavailable" role="status">{explanationsLoading ? <><span className="context-loading-dot" />保存済みの解説を読み込んでいます。</> : stale ? <><Clock3 size={15} /><span>原典が更新されたため、以前のAI解説は参考表示にしています。最新の文脈は下の原典から確認できます。</span></> : explanationsError ? <><BookOpenText size={15} /><span>AI解説を読み込めませんでした。取得済みの見出し・原典は引き続き確認できます。</span></> : <><BookOpenText size={15} /><span>この話題のAI解説はまだありません。関連記事から文脈を確かめられます。</span></>}</div>}
      {headlineList()}
      {stale && <details className="context-old-explanation"><summary>以前のAI解説を参考として読む <span>更新前</span></summary><p className="context-stale-note">以下は更新前の原典に基づく説明です。現在の話題の説明として断定しないでください。</p><ExplanationBody explanation={stale} historical /></details>}
    </div>;
  }

  if (variant === 'full') return <section className="panel topic-context-full" aria-label={`${topic.title}の文脈解説`}>{fullBody()}</section>;

  return <div className="topic-context-card"><div className={`context-card-summary ${ready ? 'has-explanation' : ''}`}>
    {ready ? <><span className="context-card-label"><Sparkles size={11} />何の話？ <span>AI要約</span></span><p>{ready.overview.text}</p></> : explanationsLoading ? <p className="context-card-loading"><span className="context-loading-dot" />文脈の解説を読み込み中…</p> : <><span className="context-card-label"><BookOpenText size={11} />{stale ? '解説の再生成待ち' : '文脈を知る手がかり'}</span><p className="context-card-headline">{headlines[0]?.title || (archive ? '過去の年次検索データ。元資料と観測期間から意味を確かめられます。' : '原典から、どんな話題・使われ方なのかを確認できます。')}</p></>}
  </div><button className="context-read-button" onClick={() => setOpen(true)} aria-label={`${topic.title}の文脈を読む`}>{ready ? <Sparkles size={13} /> : <BookOpenText size={13} />}文脈を読む <ArrowRight size={13} /></button><Dialog open={open} onOpenChange={setOpen} title={`「${topic.title}」の文脈`}>{fullBody()}</Dialog></div>;
}
