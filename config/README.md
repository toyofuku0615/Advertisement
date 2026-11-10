# 観測窓の設定

`culture_windows.json`はCULTURE RADAR 2.0の観測目的と情報源の対応表です。PR 1では既存のGoogle Trends / GDELTの実取得観測へ関連を付けます。新しいRSSやSNSへ追加通信する設定ではありません。

## 今回の6窓

| ID | 名前 | 実際の基準線 |
| --- | --- | --- |
| `us-campus-youth` | US Campus & Youth | US検索市場 |
| `k-beauty-lifestyle` | K-Beauty & Lifestyle | KR検索市場 |
| `uk-music-subculture` | UK Music & Subculture | GB検索市場 |
| `european-creative` | European Creative | FR / DE / IT / ES / NLの報道機関所在国 |
| `southeast-asian-culture` | Southeast Asian Culture | SG / TH / MY / VN / PH / IDの報道機関所在国 |
| `japan-baseline` | Japan Baseline | JP検索市場 |

窓名は編集上の観測目的です。大学生、美容の愛好者、音楽ファン等の属性やコミュニティ所属を確認したデータではありません。`languages`と`categories`も観測目的を記録するもので、PR 1の自動分類・属性推定・フィルター条件ではありません。国が設定されていても、その国の観測が必ず存在するわけではありません。

## 主な項目

| 項目 | 意味 |
| --- | --- |
| `schemaVersion` | 設定形式。現在は`1` |
| `windows[].id` | 永続的な窓ID。重複させず、保存済み参照があるIDを不用意に変更しない |
| `name` / `description` / `scopeNote` | 観測目的と、実際に観測していないものの説明 |
| `countryCodes` | ISO形式の2文字国コード。検索市場と報道機関所在国は別の意味 |
| `languages` / `categories` | 調査したい言語・カテゴリー。原観測へ値を補完しない |
| `enabled` | 窓全体の関連付けを有効にするか |
| `sources[]` | 元Source ID、adapter、対象範囲、取得確認、利用方針のbinding |
| `sources[].verification` | 取得確認の方法・日時・原典。確認していないソースは有効化しない |
| `sources[].publication` | 公開範囲、AI利用可否、規約URL、ライセンス記述、許可項目、確認日時・留意事項 |
| `sources[].disabledReason` | 無効にした理由。停止した情報源には必須 |

今回の`verification.method: recorded-collection`は、設定の`evidenceUrl`にある固定コミットの実取得JSONを確認した記録です。2026-11-10に原典から新規取得した記録ではありません。この環境での直接接続はプロキシのCONNECT 403でした。取得確認の日時と原観測の`fetchedAt`を混同しないでください。

利用条件は既存情報源の2026-10-21確認方針を継承し、今回の公式文書再読ができていない点を`publication.note`に記録しています。公開メタデータ・原典参照の範囲を超え、記事本文・画像の転載やAI利用全般の許諾を意味するものではありません。固定履歴のCC BY 4.0をライブRSSへ適用しません。

## 情報源を追加・停止するとき

1. 実在する公式endpointとadapterを確認し、取得方法・対象範囲・更新頻度を決める。
2. 実取得と規約を別々に確認し、原典URL・日時・方法・利用制限を記録する。未確認なら`enabled: false`、`verification.status: unverified`として停止理由を付ける。
3. 公開可否とAI利用可否を個別に設定する。`private` / `unknown`や不正な方針を有効化しない。認証情報や個人情報をJSONへ保存しない。
4. adapterを実装し、重複・日時・URL・欠損・部分失敗・公開除外・後方互換性のテストを追加する。未登録adapterを取得済みとして扱わない。
5. 追加後に指定の4種類のテストを実行し、確認できない処理を完了済みと記録しない。

窓・bindingを停止すると、その関連レコードを公開対象から外します。元の観測自体の公開方針と、1つの窓での利用停止は別です。原観測自体が非公開・利用不可なら、公開JSON・関連レコード・AI入力・該当する旧解説キャッシュも除外する必要があります。

## 収集コマンド

```bash
# 標準設定を使い、既存の収集後に窓を関連付ける
python3 scripts/collect.py --sources google-trends gdelt youtube

# 別の設定を指定
python3 scripts/collect.py --culture-windows-config /path/to/culture_windows.json --sources google-trends gdelt

# 従来の収集だけを使う
python3 scripts/collect.py --no-culture-windows --sources google-trends gdelt
```

不正な設定では既存JSONを上書きしません。追加の関連付け記録は`existing-observation-projection`であり、新規ネットワーク取得の証拠ではありません。`windowCollectionRuns`と、元情報源の`collectionRuns`を併せて確認します。

設定は許可された項目だけを受け入れ、認証ヘッダー等の未定義項目や、資格情報を含むURLは拒否します。正規観測に明示的な公開条件を付ける場合は、実際に保存する見出し・指標等の全項目が許可されていなければ、その行全体を公開から除外します。窓の関連レコードはメタデータだけのため、元の見出し転載・AI利用を追加許可するものではありません。

非公開・AI入力禁止の判断は、内容を含まないハッシュとフラグの`publicationRestrictions`へ保持し、再取得時にも適用します。`--no-culture-windows`でも公開制限は無効になりません。台帳は自動失効しないため、権利の再確認・解除手順と件数の監視を運用で管理してください。

設計・未対応事項・次のPRは[`docs/CULTURE_RADAR_2_ROADMAP.md`](../docs/CULTURE_RADAR_2_ROADMAP.md)を参照してください。
