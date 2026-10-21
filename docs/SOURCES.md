# 情報源・API・無料利用条件

確認日: **2026-10-21（日本時間）**。本書の「確認済み」は、記載した公式文書または公式 GitHub リポジトリを実際に読み取れた範囲を指す。公開 URL があること、HTTP 200 が返ること、OSS のライセンスがあることだけで、投稿・記事・調査結果の無制限な商用転載が許可されるわけではない。

## この環境での確認範囲

当初の環境は `package_managers` プリセットのネットワーク制限下にあり、直接リクエストがプロキシの `CONNECT 403` になった。後続の実通信では Google RSS と Bluesky 公開アカウントフィードに成功した。初期失敗を現在の全情報源の障害と解釈しない。TLS 検証、プロキシ、制限を迂回していない。

2026-10-21 の実収集では Google RSS が日本・米国・韓国・英国で各10観測、Bluesky `bsky.app` のフィードが12投稿。Bluesky キーワード検索は403、GDELT は再試行後503、YouTube はキー未設定で無効。Google 公式履歴は3トピック・16か国・48要約観測と501地域時点を取得した。これらはそれぞれ異なる観測範囲である。最新状態はアプリの収集履歴と `public/data/` の日時で確認すること。

後続の公式文書取得では、Google Trends RSS/CSV ヘルプと API alpha、YouTube quota/policies、Bluesky Terms、GDELT仕様/About、生活定点規約、e-Stat規約、総務省規約、Pew規約、Ofcom規約が HTTP 200。Bluesky Docs の直接ホストは引き続きプロキシ403のため、公式 GitHub の同一文書を読んだ。文書読取成功と認証を要する API の実行検証は別である。

## 観測データ

| 情報源 | 使用する公開手段・意味 | 費用・認証 | 条件と実装判断 |
| --- | --- | --- | --- |
| Google Trends | [急上昇 RSS](https://trends.google.com/trending/rss?geo=JP)、[Trending Now ヘルプ](https://support.google.com/trends/answer/3076011?hl=ja)、[CSVと引用](https://support.google.com/trends/answer/4365538?hl=ja)、[正規化FAQ](https://support.google.com/trends/answer/4365533?hl=ja) | 公開 RSS / ユーザー取得 CSV。非公開 API を使わない | 公式ヘルプはRSSとCSVのエクスポートを案内。Trends情報の再利用はGoogle規約に従いGoogleへの引用を付ける。急上昇 RSS は任意語の各国・各日検索指数ではない。公開文字列は下限・丸めを含み得る。地域・期間の全検索で正規化した0〜100は絶対検索数ではなく、低量も0になり得る。任意語比較は同じ条件の公式 CSV の範囲でのみ表示。 |
| Google Trends 公式履歴 | [Google 公式データ](https://github.com/googletrends/data/blob/44ce5e8cdb786b6bd5257dd5e9ea6af58fcffe16/20220404_environmental_issues_country_timeline.csv)、[固定版 LICENSE](https://github.com/googletrends/data/blob/44ce5e8cdb786b6bd5257dd5e9ea6af58fcffe16/LICENSE) | API キー不要。CC BY 4.0 を公式リポジトリで実読確認 | 環境に関する3トピック、16か国、2012–2023年の年次履歴を選択・再整形。18か国を要求したうち米国・ベトナムは原資料になく補完しない。原数値を保持。正規化範囲未詳のため国間値比較・国別順位は作らない。0は低量・欠損を区別できず地図では省略。原典・ライセンス・改変内容・固定コミット・取得日時・SHA-256 を保存し、固定原資料のチェックサムが不一致なら拒否。 |
| Google Trends API | [公式案内](https://developers.google.com/search/apis/trends) | 公式ページを実読。限定した開発者向け alpha tester 申請であり一般公開ではない | 必須依存にしない。アクセス資格のない API や非公開エンドポイントを呼ばない。alpha の consistently scaled data を、通常 UI の0〜100と混同しない。 |
| Bluesky | [API ホストと認証](https://docs.bsky.app/docs/advanced-guides/api-directory)、[検索仕様](https://github.com/bluesky-social/bsky/blob/main/lexicons/app/bsky/feed/searchPosts.json)、[実験的トレンド](https://github.com/bluesky-social/bsky/blob/main/lexicons/app/bsky/unspecced/getTrends.json) | `public.api.bsky.app` の公開 AppView を優先。多くの公開読み取りは認証不要。すべてのエンドポイントで認証不要という保証ではない | 公式 GitHub 文書を確認済み。`searchPosts` の `q` は必須、`limit` は 1–100、`sort` は `latest` / `top`。`hitsTotal` は省略・丸め・切り捨てがあり得る。標本投稿と反応数を表示し、検索ヒット数を人口の人気率としない。投稿言語から国・年代・性別を推定しない。 |
| YouTube Data API v3 | [公式概要](https://developers.google.com/youtube/v3)、[videos.list](https://developers.google.com/youtube/v3/docs/videos/list)、[クォータ](https://developers.google.com/youtube/v3/determine_quota_cost)、[開発者ポリシー](https://developers.google.com/youtube/terms/developer-policies) | 任意キー、無料割当内のみ。2026-10-15更新の公式文書では通常エンドポイント共通10,000units/日、`videos.list` 1unit。正本はプロジェクトConsole | キー未設定で無効。他機能は独立。キーは収集環境 / Actions Secretsのみ。`mostPopular` は Shorts専用・属性別・地域内再生数ではない。非認証データは30日以内に更新/削除。独自の派生指標作成や異なる所有者のAPIデータ集計は規約の制限対象で、本アプリの独自スコアに使用しない。出典ブランド表示を保持。公式条件は確認したがキーを使う実APIは未検証。 |
| GDELT DOC API | [公式サイト](https://www.gdeltproject.org/)、[DOC 2.0 仕様](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/)、[利用条件](https://www.gdeltproject.org/about.html)、[公開エンドポイント](https://api.gdeltproject.org/api/v2/doc/doc) | 公式Aboutは学術/商用/政府で無償利用・再配布可、GDELTへの引用とリンクが必要と明示。可用性保証なし | 公式仕様で `sourcecountry` は **報道機関所在国**、`language` は記事言語と確認。出来事の場所・住民検索関心ではない。最大50件の返却標本を全報道量・生活者人気にしない。GDELTデータの許可は記事本文・画像の権利を与えず、全文配信しない。実収集は503で失敗しており、ニュース地図の実APIデータは未取得。 |
| Wikimedia Analytics | [公式仕様](https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/)、[Wikimedia API 利用規則](https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_API_Usage_Guidelines) | 公開 API。適切な識別 User-Agent、レート制限への配慮が必要 | 補助情報源候補。言語版別閲覧数は国別関心ではない。本実装の必須情報源とはせず、接続・利用条件の検証前に有効化しない。 |

### Bluesky の運用上の制約

公式の [レート制限文書](https://github.com/bluesky-social/bsky-docs/blob/main/docs/advanced-guides/rate-limits.md) は、公開 AppView について具体的な固定リクエスト数を保証せず「generous rate-limits」としている。PDS の 3,000 requests / 5 min を公開 AppView の契約値として転用しない。429 と再試行指示を尊重し、少数の検索語・投稿だけを収集する。今回 `searchPosts` は403で、`getAuthorFeed` は200。後者は明示的に選んだ `bsky.app` の投稿標本であり、キーワード検索や世界の人気として表示しない。

公式 [Developer Guidelines](https://github.com/bluesky-social/bsky-docs/blob/main/docs/support/developer-guidelines.md) には、削除リクエストへの対応方法、違反報告への対応、公開された最新の連絡先等の要件がある。一般公開する運用者は連絡先・削除手続きを整える。現状は抜粋を最大120文字、取得から24時間の短期キャッシュで、正常な再取得時に標本を置換する。原投稿削除への完全な自動追従は未実装。API ソフトウェアのライセンスは投稿者の著作権を置き換えない。[Bluesky Terms](https://bsky.social/about/support/tos) を実読し、所有権は投稿者に残ると確認。[Privacy](https://bsky.social/about/support/privacy-policy) / [Community Guidelines](https://bsky.social/about/support/community-guidelines) も運用用途に合わせて確認する。

なお、`searchPosts` の `since` / `until` は検索側の `sortAt` に基づき、投稿レコードの `createdAt` と一致しないことがある。原投稿日時と取得日時を別項目に保持する。`unspecced` 名前空間は実験的であり、仕様変更時は失敗を表示する。

## 生活者調査: 参照リンクとユーザー CSV

以下は公式資料への導線を提供する。**自動取得・一括再配布の許諾を確認できていない資料をコピーしない。** CSV を取り込む利用者が権利を持つことを前提とし、インポートした調査値はブラウザ内保存とする。公式サイトの各データセット個別条件が優先される。

| 情報源 | 公式参照先 | 注意点 |
| --- | --- | --- |
| 博報堂生活総研「生活定点」 | [生活定点](https://seikatsusoken.jp/teiten/)、[利用規約](https://seikatsusoken.jp/teiten/about.html#overview) | **公式規約を実読: 私的利用の範囲のみ。事前承諾のない商用利用、改変、AI学習、AIへのプロンプト入力による再生成/要約、スクレイピングを禁止。** 本アプリは参照リンクのみで、同サイトを原典にした調査CSVも取り込まない。将来の許諾を得る場合は別途対応。許諾なく分析用データやAI入力に転載しない。 |
| 総務省 通信利用動向調査 | [調査案内](https://www.soumu.go.jp/johotsusintokei/statistics/statistics05.html)、[総務省サイトポリシー](https://www.soumu.go.jp/menu_kyotsuu/policy/tyosaku.html) | 公式規約は特記なければ「公共データ利用規約1.0」準拠。出典・URL・利用日・加工した旨を記載し、国の作成物と誤認させない。第三者権利・個別制約は別。世帯・個人・企業の対象を混同しない。 |
| e-Stat | [ポータル](https://www.e-stat.go.jp/)、[API](https://www.e-stat.go.jp/api/)、[利用規約](https://www.e-stat.go.jp/terms-of-use) | 公式規約は商用を含む利用可、出典・加工の表示が必要。第三者権利や別条件のコンテンツは除外し、CC BY4.0との互換性も明示。APIは個別ルール/アプリケーションIDを確認。本 MVP は許諾のある CSV / 原典リンクで利用し、API IDは必須でない。 |
| Pew Research Center | [公式調査](https://www.pewresearch.org/)、[利用条件](https://www.pewresearch.org/about/terms-and-conditions/)、[データ利用](https://www.pewresearch.org/datasets/) | 公式規約を実読。適切な引用と通知を保持し、推奨/支持を示唆しない。主たる部分/全体の再掲載・ミラーは事前承諾が必要。無許可のスクレイピング禁止。データセットは抜粋限定、分析責任の免責文が必要、American Trends Panel は別規約。翻訳には未承認翻訳の免責文を付ける。 |
| Ofcom | [公式](https://www.ofcom.org.uk/)、[著作権と情報再利用](https://www.ofcom.org.uk/about-ofcom/our-website/copyright)、[利用規約](https://www.ofcom.org.uk/about-ofcom/our-website/terms-of-use) | 公式規約を実読。特記なければ正確かつ誤解を招かない文脈で無償再現でき、Ofcom copyright と資料名を表示。Crown資料や第三者権利は別条件、ロゴ利用は許可が必要。リンクは可だがOfcomサイトのフレーム表示は不可。英国調査を他国人口の実測値にしない。 |

これらの規約は後続の直接アクセスで本文を読んだ。特定の調査表の自動取得・実測値の取り込み検証を全件実施したという意味ではない。インポートでは原典URL、取得日時、調査時期、地域、属性、母集団、標本数、設問、単位、調査方法、比較キーを保存。属性を選んだだけで、その属性向けの観測値を生成しない。

Pew の調査データを利用する場合の指定免責文は、`Pew Research Center bears no responsibility for the analyses or interpretations of the data presented here. The opinions expressed herein, including any implications for policy, are those of the author and not of Pew Research Center.`。英語原文の翻訳には `Pew Research Center has published the original content in English but has not reviewed or approved this translation.` が必要。本アプリはこれらの素材を自動転載せず、利用者は対象資料の個別条件を確認する。

## 広告ライブラリ: 公式リンクと手動分類

| サービス | 公式リンク | 方針 |
| --- | --- | --- |
| TikTok Creative Center | [公式](https://ads.tiktok.com/business/creativecenter/) | 自動スクレイピングしない。利用者が原典 URL と自分の分類・メモを保存する。 |
| Meta 広告ライブラリ | [公式](https://www.facebook.com/ads/library/) | 公開されていることから成果を推定しない。API へのアクセス資格・対象範囲・利用条件を検証するまで自動収集しない。 |
| Google Ads Transparency Center | [公式](https://adstransparency.google.com/) | 原典を閲覧する導線を用意し、手動保存する。CVR / ROAS など非公開の値を生成しない。 |
| Instagram / X | [Instagram](https://www.instagram.com/)、[X](https://x.com/) | 無料・許可済みの自動取得手段を確認していないため URL の保存のみ。認証や技術的制限を回避しない。 |

## 地図・無料公開

- **Natural Earth:** [公式リポジトリの LICENSE](https://github.com/nvkelso/natural-earth-vector/blob/master/LICENSE.md) を実際に確認。Natural Earth の raster / vector map data は public domain と明示されている。利用・改変・商用利用に許可申請を要求しない旨がある。配布に原典とバージョンを残し、地図に Natural Earth と表示する。[公式利用条件](https://www.naturalearthdata.com/about/terms-of-use/) の直接アクセスは初期環境では失敗した。国境・国名の表示は特定の政治的見解を意味しない。
- **MapLibre GL JS:** [公式 README](https://github.com/maplibre/maplibre-gl-js)、[ライセンス全文](https://github.com/maplibre/maplibre-gl-js/blob/main/LICENSE.txt) を確認。BSD-3-Clause を基本とし、同梱部分の追加 notice も保持する。商用利用可能な OSS だが、任意の地図タイルサービスを無料で使える許諾ではない。本アプリは同梱した地理データを使用し、有料地図タイル API に依存しない。WebGL が利用できない環境ではデータ表を使う。
- **GitHub Pages:** [公式制限](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) の [公式 GitHub ソース](https://github.com/github/docs/blob/main/content/pages/getting-started-with-github-pages/github-pages-limits.md) を確認。[無料プランの範囲](https://github.com/github/docs/blob/main/data/reusables/gated-features/pages.md) では public repository で Pages を利用できる。公開サイト上限 1 GB、帯域の soft limit 100 GB/月などがあり、将来の保証ではない。**オンライン事業、e-commerce、商用 SaaS を主目的にした無料ホスティングとしての利用は許可されない。** 静的なオープンソース調査ツールを公開する場合も用途・最新規約を運用者が確認する。企業向け商用 SaaS の恒久無料公開を保証する構成ではない。
- **GitHub Actions:** 無料範囲はリポジトリ公開状態・runner・アカウントの割当に依存する。[料金と利用](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions) を確認し、通常の Linux runner と少数の定期ジョブで運用する。スケジュールは遅延・停止され得るため SLA を約束しない。外部公開・課金利用は自動実行しない。

## フロントエンドの仕様・ライセンス確認

2026-10-21 に公式 npm registry の `/パッケージ名/latest` を実際に取得した。下表のバージョンは **調査時の latest メタデータ** であり、インストール版は `package-lock.json` が正本。安定性のため latest より前の互換バージョンを選ぶことがある。

| パッケージ | 確認した latest | ライセンス | 公式資料 |
| --- | --- | --- | --- |
| React / React DOM | 19.3.1 | MIT | [React](https://react.dev/)、[公式ソース](https://github.com/facebook/react)、[registry](https://registry.npmjs.org/react/latest) |
| TypeScript | 7.0.2 | Apache-2.0 | [公式ソース](https://github.com/microsoft/TypeScript)、[registry](https://registry.npmjs.org/typescript/latest) |
| Vite | 8.3.5 | MIT | [公式ソース](https://github.com/vitejs/vite)、[registry](https://registry.npmjs.org/vite/latest) |
| Tailwind CSS / Vite plugin | 4.3.3 | MIT | [公式ソース](https://github.com/tailwindlabs/tailwindcss)、[registry](https://registry.npmjs.org/tailwindcss/latest) |
| shadcn CLI / UI | 4.22.1 | MIT | [公式ソース](https://github.com/shadcn-ui/ui)、[registry](https://registry.npmjs.org/shadcn/latest) |
| Recharts | 3.10.1 | MIT | [公式ソース](https://github.com/recharts/recharts)、[registry](https://registry.npmjs.org/recharts/latest) |
| MapLibre GL JS | 6.15.0 | BSD-3-Clause | [公式ソース](https://github.com/maplibre/maplibre-gl-js)、[registry](https://registry.npmjs.org/maplibre-gl/latest) |
| Lucide React | 1.61.0 | ISC | [公式ソース](https://github.com/lucide-icons/lucide)、[registry](https://registry.npmjs.org/lucide-react/latest) |
| Radix UI | Dialog 1.3.1 / Slot 1.5.0 | MIT | [公式ソース](https://github.com/radix-ui/primitives) |
| class-variance-authority | 0.7.1 | Apache-2.0 | [registry](https://registry.npmjs.org/class-variance-authority/latest) |
| idb-keyval | 6.3.0 | Apache-2.0 | [公式ソース](https://github.com/jakearchibald/idb-keyval) |
| PapaParse | 5.7.0 | MIT | [公式ソース](https://github.com/mholt/PapaParse) |
| tailwind-merge | 3.7.0 | MIT | [公式ソース](https://github.com/dcastil/tailwind-merge) |
| Playwright Test | 1.64.1 | Apache-2.0 | [公式ソース](https://github.com/microsoft/playwright) |
| Vitest | 5.0.5 | MIT | [公式ソース](https://github.com/vitest-dev/vitest) |

Vite 8 / React plugin 6 の registry `engines.node` は `^20.19.0 || >=22.12.0`。この環境の Node 24 は範囲内。[Vite 公式ガイドのソース](https://github.com/vitejs/vite/blob/main/docs/guide/index.md)、[React 公式 API 参照](https://github.com/reactjs/react.dev/blob/main/src/content/reference/react/index.md)、[shadcn の Vite 導入手順](https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/installation/vite.mdx)、[Recharts 公式 README](https://github.com/recharts/recharts/blob/main/README.md) を読んだ。Tailwind 4 は `@tailwindcss/vite` を Vite plugin として使用する。React は関数コンポーネント、MapLibre は API key 不要の GeoJSON ソース、Recharts は UI 表示用で計測値の生成器にしない。

[MapLibre 現行 MapOptions の公式ソース](https://github.com/maplibre/maplibre-gl-js/blob/main/src/ui/map.ts) では PNG 用の描画保持は `canvasContextAttributes: { preserveDrawingBuffer: true }`、コンテキストは WebGL 2。古い Mapbox 向けオプションをそのまま渡さない。GPU / WebGL が使用できない場合は地域別データ表を残す。

各 OSS の商用利用が可能でも、著作権表示・ライセンス本文・NOTICE 等の配布要件は残る。配布物で依存パッケージの license notices を削除しない。上表はデータの利用権を付与するものではない。

配布用の全文通知を [`public/THIRD_PARTY_NOTICES.txt`](../public/THIRD_PARTY_NOTICES.txt) に保存し、Vite の public asset として配信する。実際にインストールした100の本番依存と、victory-vendor同梱のD3等のライセンスを含む。murmurhash-js は同梱READMEのMIT全文を使用。victory-vendor本体は公式リポジトリの同版タグのLICENSEを追加。react-remove-scroll-barは独立したLICENSEファイルを配布しておらず、公開パッケージのMIT宣言・作者・標準許諾文を保持した。

**依存を更新する際:** `npm ci` 後に `package-lock.json` の本番パッケージ一覧と通知の版を照合し、各インストールディレクトリの LICENSE / LICENCE / COPYING / NOTICE と同梱vendorの全文を更新する。README内のライセンスや固定版の公式原典も確認し、省略せず通知ファイルに反映してからビルドする。ビルド時に外部から可変の最新版ライセンスを取得する処理は入れていない。

## 無料運用に含めるもの・含めないもの

無料の基本動作は、静的 JSON の閲覧、ローカルでの収集、ブラウザ内保存、手動 CSV 取込、地理データ表示、ルールに基づく分析・企画書素材の出力。外部有料 LLM、課金 API、認証サーバー、DB サービス、地図タイル契約を要求しない。YouTube は任意設定で、無料割当を超える利用や課金契約を自動設定しない。ローカル LLM、Notion 連携、ログイン・クラウド同期は基本動作の前提ではない。

API の利用条件・無料枠は変更される。アプリの存在だけで各サービスへの永続アクセスや提供終了時の互換性を保証しない。取得できない場合は失敗・無効化・未更新を示し、テストデータや生成値を実データに置き換えない。
