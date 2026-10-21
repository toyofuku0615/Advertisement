# CULTURE RADAR

**公開アプリ:** https://toyofuku0615.github.io/Advertisement/ （2026-10-21に公開・HTTP200と実データ配信を確認）

**自分とは違う人が見ている世界を知る。**

検索・公開投稿・ニュース・生活者調査の根拠を確かめながら、文化の変化を広告の仮説につなげる静的 Web アプリです。React + TypeScript + Vite と Python 標準ライブラリで動き、サーバー・認証基盤・有料 LLM・有料地図 API は必要ありません。

**確認した実データ:** 2026-10-21 に日本・米国・韓国・英国の Google Trends RSS 40観測と、Bluesky 公式アカウントの公開投稿12件を取得しました。Bluesky のキーワード検索は403、GDELT は503で失敗し、YouTube はキー未設定で無効です。別に Google 公式の2012–2023年の年次履歴を同梱しています。履歴は実データですが最新トレンドではありません。各情報源の取得日時と失敗は収集履歴で確認できます。

## 必要な環境

- Node.js 24 推奨（Vite の要件は Node 20.19+ / 22.12+）と npm
- Python 3.12 以降。収集器は標準ライブラリのみで、pip install は不要
- Chromium などの現代的なブラウザ。地図は WebGL 2 を使用
- 収集時のインターネット接続。閲覧時は同梱 JSON と地理データを配信

## インストール・起動

リポジトリのルートで実行します。

```bash
npm ci
python3 scripts/collect.py --archive
npm run dev
```

開発サーバーの既定ポートは5173です。同梱の `public/data/dataset.json` があれば、収集が失敗した状態でも履歴データの閲覧・CSV 取込・研究メモを利用できます。アプリ右上の情報源の状態で、個別の成功・失敗・無効化・取得時刻を確認してください。開発サーバーを起動しただけで最新データの取得成功とはなりません。

```bash
# 型チェックと本番ビルド
npm run build

# ビルドした静的ファイルを確認（既定ポート4173）
npm run preview
```

## 7つの画面

| 画面 | できること | 解釈上の境界 |
| --- | --- | --- |
| RADAR | 現在の観測と公式アーカイブを分けて探索、検索、国・カテゴリー・期間・情報源で絞込、保存、CSV 出力、Discover | 異なる情報源の値を合算した人気順位を作らない。履歴不足の急上昇度・新規性は算出不可 |
| AUDIENCE | 地域・年代・性別・生活者セグメント等で公開調査を探索、調査 CSV を取込、関連し得る話題と公式資料への導線 | 実測 A / 代理指標 B / 関連性仮説 C を区別。選んだ属性の実測資料がなければ欠損を表示 |
| SPREAD MAP | 世界地図、地域の出典詳細、観測日時を使う時間軸・再生、2〜3か国の推移、検索/報道レイヤー、CSV 取込・出力、PNG 出力 | 検索市場と報道機関所在国を分離。日次データがなければ日次値を作らない。履歴の国間ランキングや伝播の因果推定をしない |
| COMPARE | 国・年代・セグメント比較、共通/固有の観測、調査方法の比較可否、時系列上の先行・遅行の確認 | 設問・方法・時期・母集団の異なる調査を単純比較しない。確率としての海外流行予測はしない |
| CREATIVE | 実際の広告・投稿 URL と表現分析の登録・編集・削除、形式/フック/感情によるグループ化、検索、CSV/JSON 出力 | 手動記録。広告動画の自動ダウンロード・無断転載をしない。CVR/ROASを生成しない |
| INSIGHT LAB | 根拠 ID 付きの事実・数値・原典、複数の解釈・反証候補・検証課題、仮説の編集と保存 | 有料 AI を使わない定型・ルール分析。観測していない因果や属性を断定しない |
| BRIEF BUILDER | ブランド・特徴・ターゲット・競合・課題と保存した話題を関連づけ、根拠と仮説を分けた企画書素材を編集・保存・出力 | 企画アイデアは検証前の仮説。ブランドセーフティ簡易検査に該当すると広告案の自動提案を停止 |

保存した話題・検索条件・メモ・発見・企画書はこのブラウザの IndexedDB に保存します。日次/週次レポートやバックアップ等の出力は保存した研究の画面から行います。端末間の同期・ログインはありません。ブラウザのサイトデータ削除で失われるため、重要な研究は出力して保管してください。

## データを更新する

```bash
# 既定の検索語と4か国の公開データを収集
python3 scripts/collect.py

# Google 公式の固定版履歴データも取得
python3 scripts/collect.py --archive

# 履歴データだけを明示的に取得。最新データには置き換えない
python3 scripts/collect.py --archive --only-archive

# 検索標本の観測対象を指定（最大8語）
python3 scripts/collect.py --keywords matcha skincare "artificial intelligence"

# 実 API スモークテスト。情報源エラーがあれば終了コード1
python3 scripts/collect.py --strict
```

標準の収集先は以下です。

- Google Trends 急上昇 RSS: 日本・米国・韓国・英国
- Bluesky 公開検索: `matcha` / `skincare` / `artificial intelligence`、各最大15投稿
- Bluesky 公開アカウントフィード: 既定は `bsky.app` の最大12件。明示したアカウントの投稿であり、検索結果や世界の人気ランキングではない
- GDELT DOC: 同じ3語、直近24時間の各最大50記事の標本。記事の所在国は報道機関所在国
- YouTube: API キーを任意設定した場合のみ、4地域の `mostPopular` を各最大10動画
- Google Trends 公式履歴: `--archive` 指定時のみ。環境関連3トピック、実在する16か国、2012–2023年（18か国を要求したうち米国・ベトナムは原資料になく補完しない）

任意語の毎日の検索関心を RSS から取得できるとは扱いません。Bluesky・GDELT の既定検索語は観測範囲であり、全世界の人気トピックの網羅的発見ではありません。アプリの検索は取得済みデータの検索です。新しい任意語を自動収集するには上記 `--keywords` で収集し直すか、公式 CSV を取り込みます。

出力先は `public/data/dataset.json`。固定版履歴の選択行と来歴は `archive-environment-selected.csv` / `archive-provenance.json` に保存します。Google/GDELT の観測は30日、YouTube は取得から30日、Bluesky は取得から24時間の短期キャッシュです。Bluesky は同じ検索/アカウントの正常な再取得で標本を更新し、原投稿の削除を標本からの不在だけで判定しません。部分失敗時は期限内の過去取得分を stale として残します。固定版の履歴は別扱いで保持します。`--output PATH` で別の JSON に出力可能です。通常実行は部分失敗でも JSON を保存して終了するため、終了コード0だけで全収集成功と判断しないでください。厳密な検証には `--strict` と収集履歴を使います。

失敗した操作だけの再試行や、キュレーション対象アカウントの変更にも対応します。

```bash
python3 scripts/collect.py --sources google-trends bluesky-author --strict
python3 scripts/collect.py --sources bluesky-author --bluesky-actors bsky.app
```

### ネットワーク・認証

必要な収集先は `trends.google.com`、`public.api.bsky.app`、`api.gdeltproject.org`、`raw.githubusercontent.com`。任意の YouTube には `www.googleapis.com` が必要です。制限された環境ではこれらの宛先を許可してから再実行してください。TLS 検証は無効化しません。プロキシの403は、外部 API の障害や「話題がゼロ」という意味ではありません。

YouTube を有効にする場合は、[Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成し、YouTube Data API v3 を有効化、API キーを作成して API の制限と割当を設定します。**キーをソースコード、CSV、JSON、ブラウザ用 `VITE_*` 環境変数に入れないでください。** ローカルではシェルの安全な秘密情報入力等で収集プロセスの `YOUTUBE_API_KEY` に設定します。GitHub Actions では Settings → Secrets and variables → Actions に同名の Repository Secret を登録してください。キー未設定時は YouTube だけが無効化されます。割当はプロジェクトごとに公式 Console で確認し、無料枠を超える契約はこのアプリから行いません。

## CSV インポート

SPREAD MAP の取り込み画面で、トピック名、原典 URL、取得日、正規化・比較条件を指定してプレビューします。欠損や `<1` の抑制値は0に変えません。5 MB以下の UTF-8 CSV を使用します。

- Google Trends 地域別 CSV: 地域名と1系列の2列。集計期間の終了日を指定し、期間全体のスナップショットとして扱う
- Google Trends 時系列 CSV: 日/週/月と1系列の2列。対象国を明示し、列名から国を推定しない
- 共通形式: `date,region,value`。任意列に `topic,sourceUrl,normalization` を利用可能
- 国名は日本語・英語等と ISO 2文字コード、都道府県は `JP-01`〜`JP-47` や対応名を利用可能。都道府県は一覧・推移表示で、境界ヒートマップは未対応

Google Trends の0〜100は絶対検索数や人口比ではありません。別々のリクエストで正規化された値は国同士でそのまま順位にしないでください。複数系列を含む時系列CSVは一括解釈せず、系列ごとに国と比較条件を指定します。多言語の別名は編集できますが、原典観測IDを含めた複数トピックの完全な統合・分離は未実装です。

AUDIENCE の調査 CSV は画面からヘッダーを出力できます。以下の項目を使用します。

```text
title,sourceUrl,fetchedAt,surveyDate,regionCode,age,gender,segment,population,sampleSize,question,value,unit,methodology,comparabilityKey
```

必須列・URL・日付・数値を検証します。`comparabilityKey` は利用者が同じ比較設計を確認した調査に付ける識別子で、同じ値を付けるだけで比較妥当性が保証されるものではありません。調査の母集団と属性を確認し、転載・利用の権利があるデータだけを取り込んでください。

**生活定点は原典リンクのみです。** 2026-10-21 に確認した公式規約は、私的利用の範囲外、事前承諾のない商用利用、改変、AI学習/プロンプト入力による再生成・要約、スクレイピングを禁止しています。同サイトを原典にした調査CSVの取り込みを拒否します。代理店の業務利用やAI入力に許諾なく転載しないでください。Pew・Ofcom・政府統計も各資料の引用・加工表示・第三者権利の条件を確認してください。[確認した条件](docs/SOURCES.md)

## 自動テスト

```bash
# 指標、CSV、比較条件等のユニットテスト
npm test

# 収集器: 重複、日時、地域、欠損、429、タイムアウト、形式変更、保持期限等
npm run test:collect

# 初回のみテスト用ブラウザをインストール
npx playwright install chromium

# PC / モバイルの画面操作テスト
npm run test:e2e
```

テスト用の固定 fixture は `tests/` またはテストファイル内に分離し、本番 JSON に入れません。ユニットテストの成功と実 API の接続成功は別です。ブラウザのダウンロードや外部 API が制限された環境では未実行のチェックを成功扱いしないでください。

## 定期収集と無料公開

`.github/workflows/collect.yml` は1日2回（01:17 / 13:17 UTC、日本時間10:17 / 22:17）と手動で収集し、データファイルを更新する設定です。GitHub の scheduler は定刻実行を保証しません。リポジトリ設定で Actions の書込権限が必要で、ブランチ保護等により更新できない場合があります。ジョブの実行成功と各情報源の取得成功は別なので、`CollectionRun` を確認します。

このリポジトリのGitHub Pagesへの初回公開は完了しました。別のリポジトリで公開する場合は、権利・データ・連絡先・利用条件を確認したうえで、次を運用者が実施します。

1. 無料の GitHub Pages を使うなら公開リポジトリを用意し、コードとレビュー済みデータを push
2. リポジトリ Settings → Pages → Build and deployment の Source を GitHub Actions に設定
3. Actions → **Publish CULTURE RADAR to GitHub Pages** → Run workflow を手動実行

`.github/workflows/pages.yml` は main への更新、手動実行、定期収集の成功後に動きます。収集をデプロイの副作用にせず、コミット済み JSON をビルドします。既定のプロジェクトサイト向けに `BASE_PATH=/<リポジトリ名>/` を設定します。ユーザー/組織サイトやカスタムドメインでは `BASE_PATH=/` に変更してください。 ローカルでプロジェクトサイトの配信を確認する場合は、`BASE_PATH=/Advertisement/ npm run build` と `BASE_PATH=/Advertisement/ npm run preview` の両方で同じベースパスを指定します。preview側だけ既定の `/` にするとアセットの検証先が異なります。ハッシュベースの画面遷移のためサーバーの SPA rewrite は不要です。

Pages の無料範囲は public repository 等の条件付きです。**商用 SaaS・オンライン事業の無料ホスティングを主目的とする用途は Pages の規約で制限されています。** 非公開リポジトリでの Pages、Actions の割当超過、商用提供、外部 API の有料利用を一律0円とは保証しません。[情報源・利用条件](docs/SOURCES.md) を確認してください。

## 設計・制約

- [設計書・データモデル](docs/ARCHITECTURE.md)
- [情報源・API・ライセンス](docs/SOURCES.md)
- [データ品質・指標定義](docs/METRICS.md)
- [未対応事項・改善ロードマップ](docs/LIMITATIONS.md)
- [実行した検証と残る失敗](docs/VALIDATION.md)
- [配布する第三者ライセンス通知](public/THIRD_PARTY_NOTICES.txt)

有料 LLM は不要です。外部 LLM / ローカル LLM / Notion 連携、ログインと同期は未実装です。現時点のデータ範囲だけで最新の世界的流行や属性別の人気を網羅したとは主張しません。

## 公開版のデータ範囲

初回の公開用データは Google RSS 4地域40観測と公式アーカイブ48観測・501地域時点です。Bluesky は公開運用に必要な監視済み連絡先メール・削除受付が未設定のため公開JSONから除き、無効状態として表示します。ローカル収集コードとURL手動保存は維持しています。`python3 scripts/prepare_public.py` が原典・日時を保ったまま公開用に限定します。定期収集後にも適用し、Blueskyを無断で再公開しません。

公開ワークフローはユーザーの公開依頼に基づき main への push と手動実行で起動し、定期収集の成功後にも最新コミットを配信します。初回にはリポジトリのPages設定をGitHub Actionsに有効化する必要があります。設定未有効時に発行予定URLだけを公開済みとは表示しません。
