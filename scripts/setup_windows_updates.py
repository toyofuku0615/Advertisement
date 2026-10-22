#!/usr/bin/env python3
"""One-time, current-user Windows setup for the local CULTURE RADAR updater.

Run on the owner's PC, never on a cloud runner. No administrator rights, paid
API, manual credential-file access, execution-policy changes or remote Ollama are needed.
Model downloads require the explicit --download-model option.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MODEL = 'qwen3:4b'
DOWNLOADS = {
    'git': 'https://git-scm.com/downloads/win',
    'gh': 'https://cli.github.com/',
    'ollama': 'https://ollama.com/download/windows',
}


class SetupError(RuntimeError):
    """A user-safe diagnostic without a subprocess's potentially private output."""


def validate_model(model: object) -> str:
    if not isinstance(model, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}', model):
        raise SetupError('ローカルモデル名が不正です。例: qwen3:4b')
    if ':cloud' in model.lower() or model.lower().endswith('-cloud'):
        raise SetupError('クラウドモデルは使用できません。PC内のローカルモデルを指定してください。')
    return model


class WindowsSetup:
    def __init__(self, *, root: Path = ROOT, platform: str = sys.platform,
                 runner: Callable = subprocess.run, which: Callable = shutil.which,
                 interactive: bool | None = None, output: Callable[[str], None] = print,
                 python: str = sys.executable):
        self.root = root.resolve()
        self.config = self.root / '.local' / 'pc-updater.json'
        self.platform = platform
        self.runner = runner
        self.which = which
        self.interactive = sys.stdin.isatty() if interactive is None else interactive
        self.output = output
        self.python = python

    def invoke(self, arguments: list[str], *, visible: bool = False,
               interactive: bool = False, timeout: int = 120,
               ollama: bool = False) -> int:
        environment = os.environ.copy()
        if ollama:
            # A user's OLLAMA_HOST may point at another machine. This setup only
            # talks to the daemon on this PC. No inherited environment is logged.
            environment['OLLAMA_HOST'] = 'http://127.0.0.1:11434'
            environment['OLLAMA_NO_CLOUD'] = '1'
        try:
            result = self.runner(arguments, cwd=self.root, env=environment,
                                 stdin=None if interactive else subprocess.DEVNULL,
                                 stdout=None if visible else subprocess.PIPE,
                                 stderr=None if visible else subprocess.PIPE,
                                 text=True, encoding='utf-8', errors='replace',
                                 timeout=timeout, check=False)
        except subprocess.TimeoutExpired:
            raise SetupError('処理がタイムアウトしました。設定を消さずに、通信・PCの状態を確認して再実行してください。') from None
        except OSError:
            raise SetupError('必要なプログラムを実行できません。インストール後にターミナルを開き直してください。') from None
        return result.returncode

    def prerequisites(self) -> None:
        if self.platform != 'win32':
            raise SetupError('このセットアップはご自身のWindows PCで実行してください。クラウド環境からPCへは設定しません。')
        if sys.version_info < (3, 10):
            raise SetupError('Python 3.10以降が必要です。https://www.python.org/downloads/windows/')
        missing = [name for name in DOWNLOADS if self.which(name) is None]
        if missing:
            links = '\n'.join(f'  {name}: {DOWNLOADS[name]}' for name in missing)
            raise SetupError('次のソフトを公式サイトからインストールし、ターミナルを開き直してください。\n' + links)
        for helper in ('pc_updater.py', 'install_pc_startup.py'):
            if not (self.root / 'scripts' / helper).is_file():
                raise SetupError('更新用ファイルが見つかりません。リポジトリを最新にしてから再実行してください。')

    def selected_model(self, requested: str | None) -> tuple[str, bool]:
        if self.config.exists():
            try:
                value = json.loads(self.config.read_text(encoding='utf-8'))
                if not isinstance(value, dict) or value.get('schemaVersion') != 1:
                    raise ValueError
                model = validate_model(value.get('model'))
            except (OSError, ValueError, TypeError):
                raise SetupError('既存のPC更新設定を読めません。上書きせず停止しました。.local/pc-updater.jsonを確認してください。') from None
            if requested is not None and validate_model(requested) != model:
                raise SetupError('既存設定と指定モデルが異なります。既存設定を保護するため変更せず停止しました。')
            return model, True
        return validate_model(requested or DEFAULT_MODEL), False

    def github_auth(self, *, check_only: bool) -> None:
        if self.invoke(['gh', 'auth', 'status', '--hostname', 'github.com']) != 0:
            if check_only or not self.interactive:
                raise SetupError('GitHubへのログインが必要です。Windowsのターミナルで gh auth login --hostname github.com --git-protocol https --web を実行してください。')
            self.output('GitHubのブラウザ認証を開始します。公開リポジトリに書き込めるご自身のアカウントでログインしてください。')
            if self.invoke(['gh', 'auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web'],
                           visible=True, interactive=True, timeout=600) != 0:
                raise SetupError('GitHub認証が完了しませんでした。GitHub CLIの認証状態を確認して再実行してください。')
        if not check_only:
            self.output('GitHubへのGit書き込みに、GitHub CLIの認証を使う設定を行います。')
            if self.invoke(['gh', 'auth', 'setup-git', '--hostname', 'github.com']) != 0:
                raise SetupError('GitHubのGit認証設定に失敗しました。gh auth setup-git --hostname github.com を実行して確認してください。')

    def ollama_model(self, model: str, *, download: bool) -> None:
        if self.invoke(['ollama', 'list'], ollama=True, timeout=30) != 0:
            raise SetupError('PC内のOllamaに接続できません。スタートメニューからOllamaを開いて、もう一度実行してください。')
        if self.invoke(['ollama', 'show', model], ollama=True, timeout=30) == 0:
            return
        if not download:
            raise SetupError(f'モデル {model} がPCにありません。ダウンロードには数GBの空き容量と通信が必要です。--download-model を付けて再実行してください。')
        self.output(f'ローカルモデル {model} をダウンロードします。数GBの空き容量と通信が必要です。API料金は発生しません。')
        if self.invoke(['ollama', 'pull', model], ollama=True, visible=True, timeout=7200) != 0:
            raise SetupError('モデルをダウンロードできませんでした。空き容量・通信状態を確認してください。設定は消していません。')

    def updater(self, *arguments: str, timeout: int = 120) -> int:
        return self.invoke([self.python, str(self.root / 'scripts' / 'pc_updater.py'),
                            '--config', str(self.config), *arguments], visible=True,
                           timeout=timeout)

    def run(self, *, model: str | None = None, download_model: bool = False,
            check_only: bool = False, no_startup: bool = False) -> None:
        self.prerequisites()
        selected, existing = self.selected_model(model)
        self.github_auth(check_only=check_only)
        self.ollama_model(selected, download=download_model and not check_only)
        if check_only:
            if not existing:
                raise SetupError('必要なソフトは確認できました。PC更新設定はまだありません。--checkを外してセットアップしてください。')
            if self.updater('--doctor') != 0:
                raise SetupError('PC更新の接続確認に失敗しました。上に表示した確認結果をご覧ください。')
            self.output('確認が完了しました。--checkでは設定・ダウンロード・更新・自動起動登録を変更していません。')
            return
        if existing:
            self.output('既存のPC更新設定をそのまま使います。設定ファイルは上書きしません。')
        elif self.updater('--initialize', '--model', selected, '--interval-hours', '6', '--max-topics', '12') != 0:
            raise SetupError('PC更新設定を作成できませんでした。')
        if self.updater('--doctor', timeout=180) != 0:
            raise SetupError('接続確認が完了しなかったため、自動更新は登録していません。上の確認結果を直して再実行してください。')
        self.output('最初の更新を実行します。最大12話題をPC内で生成し、検証して公開します。PCの性能・通信により時間がかかります。')
        if self.updater('--once', timeout=7200) != 0:
            raise SetupError('最初の更新が完了しなかったため、自動更新は登録していません。既存の公開データを残しています。表示したエラーを確認して再実行してください。')
        if not no_startup:
            if self.invoke([self.python, str(self.root / 'scripts' / 'install_pc_startup.py'),
                            '--install', '--config', str(self.config)], visible=True) != 0:
                raise SetupError('初回更新は完了しましたが、自動起動の登録に失敗しました。scripts/install_pc_startup.py --install を再実行してください。')
            self.output('Windowsログイン後の自動起動を登録しました。PCが起きていてネットにつながっている間、標準6時間ごとに更新します。')
        else:
            self.output('初回更新が完了しました。--no-startupのため自動起動は登録していません。')
        self.output('スマホでは公開サイトの最新版を読めます。スマホの起動で、電源OFF・スリープ中のPCを起こすことはしません。')


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', help='初回のローカルモデル名（既定: qwen3:4b）。既存設定は上書きしない')
    parser.add_argument('--download-model', action='store_true', help='モデルがなければ明示的にダウンロードする')
    parser.add_argument('--check', action='store_true', help='読み取りだけで確認。ログイン・取得・設定変更・更新は行わない')
    parser.add_argument('--no-startup', action='store_true', help='初回更新まで行い、自動起動は登録しない')
    args = parser.parse_args(argv)
    try:
        WindowsSetup().run(model=args.model, download_model=args.download_model,
                           check_only=args.check, no_startup=args.no_startup)
        return 0
    except SetupError as error:
        print(f'セットアップを停止しました: {error}', file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print('セットアップを中断しました。既存設定は消していません。', file=sys.stderr)
        return 130


if __name__ == '__main__':
    raise SystemExit(main())
