# CULTURE RADAR 2.0：観測窓の基盤と開発計画

更新日：2026-11-10。今回の範囲はPR 1のデータ基盤です。新しいコミュニティを取得したことや、生活者心理を解明したことを示すリリースではありません。

## 既存構成と維持する境界

React / TypeScript / Viteの7画面（RADAR、AUDIENCE、SPREAD MAP、COMPARE、CREATIVE、INSIGHT LAB、BRIEF BUILDER）を、Python標準ライブラリの収集器が出力する静的JSONから表示します。Google Trends RSS、GDELT、任意設定のYouTubeが既存の収集対象です。Blueskyの公開配信は運用連絡先・削除窓口の整備前のため無効です。

GitHub Actionsは1日2回の収集と、main更新・収集成功後のGitHub Pages公開を担当します。Windows PCのOllama更新は別の既存経路です。個人の保存、メモ、広告分類、取り込みCSV、仮説、ブリーフはブラウザのIndexedDBに保存し、今回の変更でキーや構造を移行しません。

本PRはfeatureブランチで作業し、mainへ直接push・公開デプロイを行いません。既存の定期収集・公開設定は維持し、レビュー後にマージされたコードで追加処理が動く構成です。

## PR 1：今回追加する基盤

### データモデルと互換性

`schemaVersion: 1`と既存の`Topic` / `Observation` / `GeoObservation`を維持し、Datasetに次の任意配列を追加します。

| 配列 | 役割 |
| --- | --- |
| `cultureWindows` | 観測窓の定義、情報源の確認記録、公開・AI利用方針 |
| `windowObservations` | 原観測をどの窓から見るかを表す関連レコード。元の観測を作り直さない |
| `windowCollectionRuns` | 情報源ごとの関連付け処理、欠損、保持、停止・部分失敗の記録 |

公開禁止・AI入力禁止が再取得で消えないよう、必要な場合だけ`publicationRestrictions`も保持します。各行はSHA-256キーと公開/AI許可フラグのみで、原文、元ID、URL、氏名、認証情報を含みません。キーは観測では`source + NUL + sourceId`、地域集計では別名前空間の`geo + NUL + source + NUL + id`から生成します。再取得した行には`publicationRestriction`を適用し、通常の情報源更新で個別の制限を自動解除しません。これは制限照合用の識別子で、匿名性を保証するものではありません。解除は権利を再確認した運用者による台帳・適用済み制限の見直しが必要です。

追加配列のない既存JSONも読み込めます。観測窓を追加する場合は窓に関する3配列を揃え、PythonとTypeScriptで検証します。公開制限台帳だけの追加も可能です。原観測ID・トピックID・出典URL・観測値を維持するため、保存済み話題や仮説の根拠IDを変更しません。

`CultureWindow`は`id`、`name`、`description`、`countryCodes`、`languages`、`categories`、`sources`、`enabled`、`scopeNote`を持ちます。`sources`は元のSource IDに加え、adapter名、endpoint、対象国、取得確認記録、利用条件、停止理由を持ちます。

`WindowObservation`は`windowId`、`observationId`、`sourceBindingId`、`source`、`sourceItemId`、`sourceUrl`、`publishedAt`、`observedAt`、`fetchedAt`、`language`、`regionScope`、`evidenceType`、`publication`、`status`を保持します。公開日時と言語が分からなければ`null`とし、国から言語や投稿者属性を補いません。

重複の単位は`windowId + source + sourceItemId + observedAt`です。同じ元記事を再取得しても同じ窓へ二重登録せず、取得日時の新しいレコードを使います。別の窓との関連は別レコードですが、元の記事・投稿を独立した複数の反応として数えません。

### 初期の6つの観測窓

設定は[`config/culture_windows.json`](../config/culture_windows.json)を正とします。

| 観測窓 | 今回関連付ける既存データ | 解釈の限界 |
| --- | --- | --- |
| US Campus & Youth | 米国のGoogle Trends RSS | 米国検索市場の基準線。大学生・若者の人気を実測したものではない |
| K-Beauty & Lifestyle | 韓国のGoogle Trends RSS | 美容・暮らしを調べる窓であり、美容コミュニティの標本ではない |
| UK Music & Subculture | 英国のGoogle Trends RSS | 音楽・サブカルチャーを調べる窓。特定ファン層を代表しない |
| European Creative | 既存GDELT標本のFR / DE / IT / ES / NLの報道機関 | 欧州の出来事、読者、クリエイターの居住地を示さない。未観測国は補完しない |
| Southeast Asian Culture | 既存GDELT標本のSG / TH / MY / VN / PH / IDの報道機関 | 東南アジア全体の文化・人気を代表しない。古い取得と現在の取得を区別する |
| Japan Baseline | 日本のGoogle Trends RSS | 日本の検索市場の基準線。特定年代・性別・属性の実測ではない |

名前、カテゴリー、言語は編集上の調査目的です。PR 1では、投稿文から属性・関心・言語を推測して対象を選別しません。実際の関連付け条件は元の情報源、国コード、地域の意味です。コミュニティ固有のRSS、Blueskyのアカウント・フィード、YouTubeチャンネルは未検証のため新たに有効化していません。

### 取得確認と規約確認を分ける

初期設定の`verification.method`は`recorded-collection`です。[mainの固定コミットにある実取得JSON](https://github.com/toyofuku0615/Advertisement/blob/182bfdde66ed56e30b95c00ce5d68c4fb39ae3c2/public/data/dataset.json)の出典・取得日時・収集履歴から確認したことを表し、2026-11-10に各サービスへ直接接続できたという意味ではありません。

- Google RSSは2026-11-09のJP / US / KR / GBの収集成功を確認しています。
- GDELTは既存の報道機関所在国レコードを確認しています。対象地域の最新取得日時は設定の確認メモに保持し、古い東南アジアのレコードを最新の文化の証拠として扱いません。
- この開発環境からの2026-11-10のGoogle RSS・公式ヘルプ・GDELT公式Aboutへの直接接続は、クラウドプロキシのCONNECT 403で遮断されました。原典の障害・HTTP応答・件数は未確認です。制限回避や非公式APIへの切替は行っていません。
- 利用条件は2026-10-21に確認した既存方針を継承し、今回の再読が未確認であることを設定に記録しています。[Googleの引用・再利用案内](https://support.google.com/trends/answer/4365538?hl=ja)、[Google規約](https://policies.google.com/terms)、[GDELT About](https://www.gdeltproject.org/about.html)を参照します。記事本文・画像の転載許諾を主張しません。
- Google公式の固定履歴の[CC BY 4.0ライセンス](https://github.com/googletrends/data/blob/44ce5e8cdb786b6bd5257dd5e9ea6af58fcffe16/LICENSE)は再読できましたが、ライブRSSや第三者記事にこのライセンスを適用しません。

### adapterと継続観測

`scripts/culture_windows.py`の`SourceAdapter` / `AdapterRegistry`を拡張境界とし、今回登録するのは`legacy-google-trends`と`legacy-gdelt`です。既存収集器が取得・重複排除した観測を再利用するため、観測窓の数だけ同じHTTPリクエストを増やしません。既存のGoogle Trends / GDELTの取得処理や指標定義を置き換えません。

通常の収集では既存データの統合後に窓を関連付けます。設定の読込・検証は収集前に行い、不正な設定で既存JSONを上書きしません。`--culture-windows-config PATH`で設定ファイルを指定でき、`--no-culture-windows`で従来の収集だけを実行できます。

未登録adapterは停止として記録し、実装済み・取得成功と表示しません。RSS / Bluesky / YouTubeを追加するときは、実装だけでなく実取得確認と利用条件の確認が必要です。

`windowCollectionRuns.method`は`existing-observation-projection`です。`count`と`retainedCount`は窓へ関連付けたfresh / staleの件数であり、その処理が新しくネットワーク取得した件数ではありません。元の取得成否は既存の`collectionRuns`で確認します。情報源の一部失敗や不正な行は他の窓を止めず、`partial` / `error` / `empty` / `disabled`を区別します。

原観測の保持期限・削除に従って関連を再構築します。窓の追加によって保持期限を延ばしたり、削除済みの原観測を別の履歴として復活させたりしません。

### 公開とAI入力の境界

`publication`は公開範囲（`public` / `private` / `unknown`）、AI利用可否、規約URL、権利の記述、許可する項目、確認日時・留意事項を持ちます。公開可能であることとAIに入力可能であることは別に扱います。

新しい窓・情報源・関連レコードには明示的な方針が必要です。方針のない従来の観測は既存の情報源方針を継承して互換性を維持し、無制限な利用許可へ読み替えません。明示された`unknown`、非公開、不正な方針は拒否します。

窓・bindingの停止や利用制限はその関連レコードを除外します。同じ原観測が別の許可済み用途で使われている場合に、窓の停止だけで原観測を一律削除しません。一方、**原観測自体**に非公開・利用不可の方針がある場合は、公開JSON、窓の関連、AI入力から除外します。公開・AI利用できない根拠が過去の解説キャッシュに残る場合も、該当キャッシュをそのまま公開しません。旧キャッシュを安全のため破棄する場合があるのは意図した挙動です。

ブラウザ内のメモ・ブリーフ・個人CSVはこのパイプラインの入力ではありません。APIキー、資格情報付きURL、ローカル・非公開URLは公開設定へ登録しません。

### 検証と今回の未対応範囲

Python / TypeScriptの検証で、窓・原観測の参照、重複、タイムゾーン、日時順序、公開URL、欠損、地域の意味、部分失敗、公開不可データと旧JSONの互換性を扱います。既存7画面・保存・定期更新の回帰確認として、依頼された`npm test`、`npm run test:collect`、`npm run build`、`npm run test:e2e`を実行します。**最終結果・未実行項目はREADMEと完了報告を参照してください。ここでは未実行テストを成功扱いしません。**

窓の選択UI、実コミュニティの新規収集、投稿への反応の網羅的取得、属性別人気、文化の伝播判定、自動心理推定は今回未対応です。既存のAI解説があることを、これらが実装済みである根拠にはしません。

## 今回の検証結果

2026-11-10、Node.js 24.19.0 / Python 3.12.14 / 既存のChromiumで実行しました。追加の依存関係・有料サービスは不要でした。

| コマンド | 実行結果 |
| --- | --- |
| `npm test` | 84件成功、失敗・skipなし |
| `npm run test:collect` | 138件成功、失敗・skipなし |
| `npm run build` | 成功。既存MapLibreの大きなチャンク警告は残る |
| `npm run test:e2e` | PC・スマートフォン計42件成功、失敗・skipなし |

既存実データ2,599観測から6窓・1,690所属を生成し、公開整理→モデルを呼ばないAIキャッシュ整理→既存PC更新処理の公開前検証まで一時フォルダーで成功しました。元の観測値・ID・追跡対象JSONは変更していません。公開整理→再収集→公開整理での非公開・AI禁止・地域集計の制限継承もテストしています。

長期収集によって既存の未生成キャッシュが500件を超える根拠を持ち、PC公開検証が失敗する問題も確認したため、Python/TypeScriptの文脈参照と署名を最新側の最大500件に揃えました。正規の観測は削らず、モデルへの入力は従来どおり別途最大8件に制限します。大量根拠の境界と、未生成を古い生成済み解説へ誤分類しないことをテストしています。

これらはライブAPI・実Ollama生成・公開デプロイの成功を示しません。新規の原典接続と規約再読は上記のプロキシ制限があり、実取得履歴からの関連付けだけを検証しています。機能をmainへ直接pushしたり、本PRを公開デプロイしたりしていません。

## PR 2〜6の計画

| PR | 実装すること | 完了条件 |
| --- | --- | --- |
| **PR 2：実コミュニティの情報源** | 窓ごとに少数の実在RSS・Blueskyフィード等を選定し、source adapterを追加。公式の取得方法、公開範囲、原典削除・非公開化、通報・削除窓口を整備。YouTubeは既存の任意キー・無料枠を使える場合のみ検討 | 実取得と最新規約を原典付きで確認。未確認は無効。API失敗・レート制限・削除追従・取得日時・ライセンスをテストし、公開/AI利用不可データが混ざらない |
| **PR 3：発見の画面** | 既存RADARへ観測窓の選択、観測目的と実際の対象範囲、欠損・更新状態、保存条件を追加。普段見ない窓からのDiscoverを用意 | 原典へ1操作で移動でき、設定・スクロール・保存が維持される。窓のラベルを属性別人気と誤認させず、情報源の異なる指標を合算しない |
| **PR 4：文脈と反応の理解** | 実投稿・記事・利用可能な公開反応を並べ、観測事実、複数の仮説、反対解釈、追加検証を整理。既存の任意ローカルOllamaを拡張 | 主張ごとに根拠IDを追跡できる。実際の反応とAIの仮説を分離し、AI利用不可の根拠は入力しない。人物の年代・性別・所属・心理を投稿文から断定しない |
| **PR 5：国境を越えた変化** | ユーザー確認可能な多言語alias、同一トピックの文脈・意味の違い、比較可能な系列の先行・遅行を探索 | 検索市場・報道機関・言及場所を区別。母集団・単位・取得範囲が違う系列を無理に比較せず、欠損は0にしない。時間差だけで伝播や因果を断定しない |
| **PR 6：インサイトと企画、長期品質** | 仮説の根拠・反証・検証計画をINSIGHT LAB / BRIEF BUILDERへ接続。長期の欠損、古さ、削除対応、容量・処理量を監査 | ブランドの価値と生活課題を結び、CVR・ROAS・確率・属性データを捏造しない。事故等のセンシティブな話題を安易に商用提案しない。原典・利用条件・保存/出力を人が確認できる |

各PRはデータ・表示・分析の境界を保ち、小さい差分で既存テストを維持します。PR 2の情報源確認が終わるまで、コミュニティ固有データを揃えたようなランキングや心理分析画面を先行させません。

## 無料運用と上限

GitHub Pages、GitHub Actions、React、TypeScript、Python、静的JSONを継続し、有料LLM・有料DB・新規サーバー・必須の有料APIは追加しません。PR 1は追加HTTP取得や依存パッケージを必要としません。既存の無料枠・利用規約・更新頻度の制約は残ります。

窓の関連を増やすほどJSON・Git履歴・ビルド負荷は増えるため、原観測の保持方針を継承し、公開リポジトリの容量とActions実行時間を監視します。GitHubの無料枠やPagesの用途条件は将来も無制限・不変とは保証しません。個別サービスの規約改定や原典の削除時には、設定の停止・公開データとキャッシュの除外が必要です。
