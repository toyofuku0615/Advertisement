import { useState } from 'react';
import { ArrowUpRight, Clock3, Monitor, RefreshCw, Smartphone } from 'lucide-react';
import { Dialog } from './ui/dialog';
import { formatDate } from '../lib/utils';
import './PcUpdateHelp.css';

const SETUP_GUIDE = 'https://github.com/toyofuku0615/Advertisement/blob/main/docs/PC_UPDATES.md';

export function PcUpdateHelp({ dataGeneratedAt }: { dataGeneratedAt: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <button className="pc-update-trigger" aria-label="自動更新の設定ガイド" onClick={() => setOpen(true)}>
      <RefreshCw size={14}/><span>自動更新</span>
    </button>
    <Dialog open={open} onOpenChange={setOpen} title="PCで更新、スマホで読む">
      <div className="pc-update-help">
        <p className="pc-update-intro">自分のPCでデータを集め、OllamaでAI解説を作って公開します。AIのAPI料金はかかりません。初回の設定はPCで行います。</p>
        <div className="pc-update-devices">
          <section>
            <Monitor size={21}/><h3>更新するPC</h3>
            <p>設定すると、ログイン後に更新プログラムが起動します。標準では6時間ごとに、PCが起動し、スリープせず、ネットにつながっているときに更新します。</p>
          </section>
          <section>
            <Smartphone size={21}/><h3>読むスマホ</h3>
            <p>ページを開くと、公開済みのデータと解説を読めます。画面に戻ったときも、公開済みの最新版を確認します。スマホを開いても、電源が切れたPCやスリープ中のPCは起動できません。</p>
          </section>
        </div>
        <p className="pc-update-resume"><Clock3 size={16}/> 更新時刻を過ぎていたら、PCのスリープ復帰後に更新を試みます。生成に失敗しても、前回公開したデータは残ります。</p>
        <h3>最初の設定</h3>
        <ol className="pc-update-steps">
          <li><b>PCに必要なツールを用意する</b><span>Ollamaとローカルモデル、Python、Git、GitHub CLIを導入します。</span></li>
          <li><b>PCで一度更新する</b><span>GitHubへの接続と、収集・AI解説の生成・公開を確認します。</span></li>
          <li><b>ログイン時の自動起動を登録する</b><span>設定後は更新プログラムがPCの起動中に動きます。手動で停止・解除できます。</span></li>
        </ol>
        <a className="button button-primary" href={SETUP_GUIDE} target="_blank" rel="noreferrer">Windows PCでの設定手順を開く <ArrowUpRight size={15}/></a>
        <p className="pc-update-status">配信データ作成日時：{formatDate(dataGeneratedAt)}（日本時間）<br/>この画面からPCの設定状態・稼働状態は確認できません。</p>
      </div>
    </Dialog>
  </>;
}
