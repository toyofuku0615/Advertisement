# 検証記録

確認日: 2026-10-21（日本時間）。このクラウド環境の現物を対象とする。外部公開や新しいタスクへのスナップショット復元を確認した記録ではない。

## インストール・ビルド

- Node.js 24.19.0 / npm 11.9.0 / Python 3.12.14
- `npm ci --no-audit --no-fund --cache /workspace/.npm-cache`: 成功。package-lock.json から再インストール
- `npm test`: **46件成功、失敗・skipなし**（6ファイル）。CSV・調査・地域比較・分析指標・安全なURL/CSV出力・配信JSONスキーマと参照を検証
- `npm run test:collect`: **19件成功、失敗・skipなし**。実行はPython標準unittest
- `npm run build`: TypeScriptとVite本番ビルド成功
- MapLibre本体約1.1MBとworker約518KBの大きなchunk警告あり。地図画面を遅延ロードし、MapLibreの単一ライブラリを無理に分割していない。致命的ビルドエラーではない

## 実APIと実データ

取得済み本番JSONは生成時刻 `2026-10-21T09:37:19Z`、43トピック、100観測、501地域・日時別観測。テスト用DEMOデータは含めていない。

| 対象 | 実際の結果 |
| --- | --- |
| Google Trends RSS | 日本・米国・韓国・英国で各10件、合計40件成功。検索市場であり任意語の日次地域指数ではない |
| Bluesky公開フィード | 公式 `bsky.app` の12投稿成功。限定アカウントの観測であり世界のトレンド標本ではない |
| Google公式アーカイブ | 固定コミットの環境関連3トピック、2012–2023年、16か国。48要約観測、501地域時点。原CSVとの値一致・ハッシュ・来歴を確認 |
| Blueskyキーワード検索 | HTTP403、取得失敗。実行成功と主張しない |
| GDELT DOC | HTTP503と上流タイムアウト、取得失敗。APIパーサーと地域意味のテストは成功、ニュース地図の実API成功は未検証 |
| YouTube | キー未設定で無効。無料枠・仕様・ポリシーを公式資料で確認したが、認証付きAPI実行は未検証 |
| 公開調査 | 公式利用条件と参照先を確認。調査の実測値は初期同梱していない。許諾ある利用者CSVの取り込みを検証 |

最終ライブスモークは以下で終了コード0。Google RSS4地域とBluesky公開アカウントの **5処理すべて非ゼロ件で成功**。本番と分離した `/tmp` に出力し、失敗している別のAPIを成功扱いしていない。

```bash
python3 scripts/collect.py --output /tmp/culture-radar-live-smoke.json --sources google-trends bluesky-author --strict
```

## 画面操作

`npm run test:e2e -- --reporter=line`: **20件すべて成功（1.9分、skipなし）**。Chromiumを実際に起動し、1440pxのPCと390pxのスマートフォン相当の2条件で以下を実施。

1. 全7画面の遷移、描画例外なし、横方向のレイアウト崩れなし
2. 実アーカイブの検索・国・カテゴリー条件、原典を新規タブで開くリンク、欠損状態
3. 話題とメモの保存、再読込後のIndexedDB復元
4. ダークモードの切替・復元、情報源の失敗とキー未設定状態
5. 実際のMapLibre地図、地域詳細、12年次観測のスライダー・再生/停止、レイヤー、PNG出力
6. CSVの検証・確認後取り込み、期間切替、再読込後の復元、元データCSV出力
7. 広告記録の作成・編集・検索・分類・出力・削除
8. 調査CSVの原典・標本数、別年代に実測を流用しないこと
9. INSIGHT LABの9段階・根拠ID付き仮説の保存/編集/復元/出力
10. ブランド入力と実測根拠からのブリーフ生成・編集・保存・復元・Markdown出力

CSVや調査の固定テストデータはテストファイルにDEMOと明記し、各テスト専用ブラウザにだけ取り込む。本番の公開JSONには混ぜない。

## Pages相当の静的配信

以下を実行し、`/Advertisement/` 配下で本番ビルドの操作を検証。最初にpreviewだけ既定ベースパスで起動した確認ではアセット404を検出し、ビルドとpreviewのBASE_PATHを一致させて解消。READMEにも同じ条件を記載。

```bash
BASE_PATH=/Advertisement/ npm run build
BASE_PATH=/Advertisement/ npm run preview -- --port 4173 --strictPort
```

実ブラウザでRADARの実データカード、MapLibreの12観測時点、PNGダウンロード成功。`data/dataset.json`、`data/world.geojson`、`THIRD_PARTY_NOTICES.txt` がすべてHTTP200、画面例外・console errorなし。

- [実データのRADAR画面](screenshots/radar-desktop.png)
- [公式履歴を使った地図画面](screenshots/spread-map-desktop.png)

## 保存した設定と未検証事項

クラウド環境設定のドラフトに `install_script`、`start_skill`、必要な通信先を保存。保存成功をツールで確認した。ドラフト保存は適用・Publishを意味しない。新しいクラウドタスクでの復元、GitHub Actionsの定期運転、GitHub Pagesへの公開は未実施。外部公開は利用者の明示許可後に行う。

制約と今後の作業は [LIMITATIONS.md](LIMITATIONS.md)、データ条件は [SOURCES.md](SOURCES.md) を参照。
