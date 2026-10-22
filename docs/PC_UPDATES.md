# Windows PCで自動更新する

**最初の1回だけ、この手順を自分のWindows PCで実行してください。** 公開サイトを開くだけではPCへのインストールは行われません。この開発用クラウドから、利用者のPCを直接設定することもできません。

設定後は、Windowsへのログイン後に更新プログラムが起動します。PCが起きていてネットにつながっている間、標準6時間ごとに公開データを収集し、変更・未生成の話題をローカルOllamaで解説してGitHubへ保存します。GitHub Pagesへの反映には、その後数分かかる場合があります。

- 電源OFF・ログアウト中・スリープ中は更新しません。スリープを解除する設定はしません。
- スリープ復帰後は1分以内を目安に更新時刻を確認し、期限を過ぎていれば処理を試みます。通信・生成等の失敗時は標準15分以上あけて再試行します。
- スマホでは [公開アプリ](https://toyofuku0615.github.io/Advertisement/) を読めます。アプリを開いたとき・画面に戻ったときに公開済みJSONを確認します（再確認は最短1分間隔）。スマホからPCを起こしたり、スマホ単体で今回のOllama処理を実行したりはしません。
- AIのAPI料金は不要です。PCの電力、通信、モデルを保存するディスク領域は必要です。GitHub側も無料利用条件と実行制限の範囲で運用します。

## 1. 必要なソフトをインストール

Windows 10 22H2以降またはWindows 11で、以下を公式サイトから導入してください。

| ソフト | 入手先・用途 |
| --- | --- |
| Python 3.12以降推奨（スクリプトは3.10以降） | [Windows版Python](https://www.python.org/downloads/windows/)。「py」コマンドを使います |
| Git | [Git for Windows](https://git-scm.com/downloads/win)。データをGitHubへ送ります |
| GitHub CLI | [公式ダウンロード](https://cli.github.com/)。ブラウザでGitHub認証します |
| Ollama | [Windows版Ollama](https://ollama.com/download/windows)。PC内でAIを動かします |

インストール後、スタートメニューからOllamaを開き、**PowerShellを新しく開いて**ください。更新だけならNode.jsやnpmは不要です。

初期モデルは `qwen3:4b` です。Qwen3の公開重みは[公式ライセンス案内](https://github.com/QwenLM/Qwen3#license-agreement)でApache 2.0とされています。モデルの取得には数GBの通信・空き容量が必要です。速度・メモリ消費はPCに依存し、特定のメモリ容量での快適な動作は保証しません。モデル名、利用条件は導入時にも確認してください。

## 2. 最初のセットアップ

PowerShellで次を実行します。すでに同じ場所へダウンロードしている場合は、`git clone`を繰り返さず、そのフォルダーへ移動してください。

```powershell
git clone https://github.com/toyofuku0615/Advertisement.git "$env:USERPROFILE\CultureRadar"
Set-Location "$env:USERPROFILE\CultureRadar"
git pull --ff-only
py scripts/setup_windows_updates.py --download-model
```

このセットアップは次を順に行います。

1. 必要なソフトとOllamaの起動状態を確認。
2. GitHubに未ログインなら、ブラウザで認証。**`toyofuku0615/Advertisement`に書き込めるアカウント**を使用。
3. `gh auth setup-git --hostname github.com`で、GitHub CLIの認証をGitで使用するよう設定。GitHub CLI自身が認証を管理し、このアプリはトークンをコピーしません。
4. 指定したローカルモデルがなければ取得。`--download-model`を付けない場合は勝手に取得しません。
5. 初回更新を実行。最大12話題を生成し、出典・形式を検証して、公開用JSONだけをGitHubへ保存。
6. 初回更新が成功したら、現在のユーザーのタスクスケジューラに `CULTURE RADAR PC updater` を登録し、起動。

認証画面以外でパスワードやトークンを入力する必要はありません。チャットや設定JSONへトークンを書かないでください。初回処理には数分以上かかる場合があります。モデル生成がタイムアウトした場合は、下記の対処を確認してください。

**この手順をPCで実行するまでは、自動更新は有効になっていません。** アプリ内の「自動更新」は手順の案内であり、PCの稼働を遠隔確認する画面ではありません。

## 3. 更新・停止・状態の確認

以下のコマンドは、PowerShellで `CultureRadar` フォルダーに移動して実行します。

```powershell
# 読み取りだけの接続確認。モデル生成・公開はしない
py scripts/setup_windows_updates.py --check

# 今すぐ1回更新。自動更新と重なった場合は二重実行しない
py scripts/pc_updater.py --once

# 最終状態とログ（自分のPC内にだけ保存）
Get-Content .local\pc-updater\status.json -Encoding UTF8
Get-Content .local\pc-updater\updater.log -Encoding UTF8 -Tail 20

# 自動更新を停止し、次回ログイン時の起動も解除
py scripts/install_pc_startup.py --uninstall

# 再び自動起動を登録して開始
py scripts/install_pc_startup.py --install
```

タスクスケジューラから同名のタスクを確認することもできます。管理者権限、パスワード保存、PowerShellの実行ポリシー変更は必要ありません。Ollama自身もWindowsへのログイン後に起動する必要があるため、Windowsのスタートアップ設定でOllamaを無効にしないでください。起動順序で接続できなかった場合も、更新処理は間隔をあけて再試行します。

## 設定を変える

`.local/pc-updater.json` は自分のPC内の設定です。Gitへは入りません。初期値は次の通りです。

```json
{
  "schemaVersion": 1,
  "model": "qwen3:4b",
  "intervalHours": 6,
  "maxTopics": 12,
  "timeoutSeconds": 120,
  "repositoryUrl": "https://github.com/toyofuku0615/Advertisement.git",
  "branch": "main"
}
```

`intervalHours`が更新間隔、`maxTopics`が1回の最大生成件数です。変更は次の確認時に読み込まれます。モデルを変える場合は、先にそのローカルモデルをOllamaへ導入し、利用条件と日本語の出力を確認してください。`:cloud`等のクラウドモデルや、クラウドへ転送する別名モデルは使用しません。

公開対象は `public/data/dataset.json` と `public/data/explanations.json` だけです。手元で保存したメモ、広告研究、ブリーフ、CSVはブラウザ内に残り、モデルへの入力やGitHubへの送信に含めません。

## うまく動かない場合

| 表示・症状 | 確認すること |
| --- | --- |
| `py`、`git`、`gh`、`ollama`が見つからない | 公式インストーラーで導入し、PowerShellを開き直す。`py`がない場合はPythonのインストール設定を確認 |
| Ollamaへ接続できない | スタートメニューからOllamaを起動。`ollama list`でモデルを確認。標準の `127.0.0.1:11434` を使う |
| モデル生成が遅い・タイムアウト | 他の重い処理を閉じ、PCの空きメモリを確認。1話題120秒の上限があるため、PCに適した小さいローカルモデルを検討。生成できなかった説明は捏造せず未生成・更新待ちとする |
| GitHubへ保存できない | `gh auth status`で使用アカウントを確認。リポジトリへの書き込み権限が必要。公開状態は [Actions](https://github.com/toyofuku0615/Advertisement/actions) で確認 |
| 同時更新・未公開データの保持 | 他のPCや定期収集との衝突で強制上書きしない。未公開データを `.local/pc-updater/retained-*` に残し、次回は最新ブランチから再試行 |
| 専用作業フォルダーの想定外の変更 | `.local/pc-updater/repository` は自動更新専用。自分でコード編集しない。保護のため止まっているので、ログを確認し、必要なファイルを別途保存して対処 |
| PCを再起動しても更新されない | Windowsにログインし、Ollamaと同名のタスクが有効か確認。設定後に元の `CultureRadar` フォルダーを移動・削除するとタスクのパスが無効になる |
| スマホで前の情報が出る | PCの最後の更新・Pages公開が完了しているか確認。公開サイトを開き直すか「配信データを再読込」を使用。PCが停止中なら新しいAI解説は生成されない |

## 運用上の範囲

- 収集は公式RSS・公開APIの範囲に限定し、情報源ごとの失敗や欠損を表示します。Google Trendsの任意キーワードの日別地図を勝手に生成しません。
- GitHub Actionsによる1日2回のデータ収集も設定されています。定期実行の成功はActionsの履歴で確認してください。その処理だけでは新しいAI解説を生成しません。PCの処理が取得したデータは、既存の保存済みデータと重複排除して扱います。
- GitHubへのpush後にPagesのビルド・公開が別途行われます。PC側の「保存完了」は公開完了を保証しません。
- 公開JSONは専用のローカルcloneで処理します。通常のコード編集フォルダーや未コミットの変更を強制リセット・強制pushしません。未公開の退避フォルダーは自動削除しないため、ディスク使用量を時々確認してください。
- Ollamaを外部へ公開するポート設定、`0.0.0.0`への待受変更、ブラウザ用CORS設定は不要です。追加でOllamaのクラウド機能も無効にしたい場合は、[公式FAQ](https://github.com/ollama/ollama/blob/main/docs/faq.mdx)に従って既存のサーバー設定を保ちながら `disable_ollama_cloud` を設定し、Ollamaを再起動します。更新プロセスに環境変数を設定するだけでは、起動済みサーバーの設定は変わりません。

## 検証範囲

この開発環境では、日付・再試行・二重実行防止、通信/生成失敗、JSONと出典検証、一時Gitリポジトリへの公開処理、Windows起動設定の生成、セットアップのコマンド順、PC/スマホの画面復帰時の再確認を自動テストします。

**利用者のWindows実機でのタスク登録、モデルの実推論、PC固有の速度・メモリ使用量は、このクラウドからは未検証です。** 最初のセットアップでそのPC上の更新を実行して確認します。モデルの応答を模したDEMOはテスト内だけに置き、公開データや本物のAI生成結果には混ぜません。

公式資料（2026-10-22確認）：[Ollama Windows](https://github.com/ollama/ollama/blob/main/docs/windows.mdx)、[Thinking制御](https://github.com/ollama/ollama/blob/main/docs/capabilities/thinking.mdx)、[Qwen3](https://github.com/QwenLM/Qwen3)。
