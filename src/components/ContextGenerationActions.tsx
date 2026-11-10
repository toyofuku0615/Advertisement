import { useMemo, useState } from 'react';
import { ArrowUpRight, Check, Copy, Monitor } from 'lucide-react';
import type { Dataset, Topic } from '../types';
import { buildContextInput, buildTopicGenerationCommand } from '../lib/context-input';
import './ContextGenerationActions.css';

export default function ContextGenerationActions({ topic, dataset }: { topic: Topic; dataset: Dataset }) {
  const input = useMemo(() => buildContextInput(topic, dataset), [topic, dataset]);
  const command = buildTopicGenerationCommand(topic.id);
  const [copied, setCopied] = useState<'input' | 'command' | null>(null);
  const [fallback, setFallback] = useState<{ kind: 'input' | 'command'; value: string } | null>(null);
  const [copying, setCopying] = useState(false);
  async function copy(kind: 'input' | 'command', value: string) {
    setCopying(true); setCopied(null); setFallback(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(value);
      setCopied(kind);
    } catch {
      setFallback({ kind, value });
    } finally { setCopying(false); }
  }
  return <section className="context-generation-actions" aria-label="この話題のAI要約を作る">
    <h3>取得した原文から、内容と文脈をまとめる</h3>
    <p>ChatGPTなどに貼り付けて要約できます。記事本文は含みません。見出し・原典URL・取得日時だけをまとめ、保存したメモは含めません。</p>
    <button className="button" onClick={() => void copy('input', input.prompt)} disabled={!input.evidence.length || copying}><Copy size={14}/> AIに渡す原文をコピー</button>
    <small>{input.evidence.length ? `${input.evidence.length}件の見出しと出典をコピーします。この操作だけではAI生成は実行しません。` : 'AIに渡せる関連記事の見出しがありません。原典を確認してください。'}</small>
    {copied && <p className="context-copy-status" role="status"><Check size={14}/>{copied === 'input' ? '原文と要約の指示をコピーしました。使うAIへ貼り付けてください。' : 'この話題だけを生成するコマンドをコピーしました。'}</p>}
    {fallback && <div className="context-copy-fallback"><p role="status">自動コピーを使えませんでした。下の文章を選択してコピーしてください。</p><textarea className="field" readOnly rows={8} aria-label={fallback.kind === 'input' ? 'AI要約用の原文と指示' : 'PCでの生成コマンド'} value={fallback.value} onFocus={event => event.currentTarget.select()}/></div>}
    <details className="context-pc-generation"><summary><Monitor size={14}/> この話題をPCで生成する</summary>
      <p>Windows PCの初回設定とOllamaの起動が必要です。最新のプログラムを使い、CultureRadarフォルダーのPowerShellで次を実行します。</p>
      {command && input.evidence.length ? <><code>{command}</code><button className="text-link" disabled={copying} onClick={() => void copy('command', command)}><Copy size={13}/> 生成コマンドをコピー</button></> : <p>この話題は生成用の原文または有効なIDを確認できません。</p>}
      <p>この話題を優先して、PC内でAI解説を生成・検証し、GitHubへ保存します。公開への反映には数分かかる場合があります。反映後に配信データを再読み込みしてください。スマホからPCを起動したり、生成したりする操作ではありません。</p>
      <a className="text-link" href="https://github.com/toyofuku0615/Advertisement/blob/main/docs/PC_UPDATES.md" target="_blank" rel="noreferrer">Windowsでの初回設定 <ArrowUpRight size={13}/></a>
    </details>
  </section>;
}
