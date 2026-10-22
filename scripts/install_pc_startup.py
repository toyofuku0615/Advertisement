#!/usr/bin/env python3
"""Opt-in, current-user login startup for the local CULTURE RADAR updater.

This script never installs Ollama, downloads models, changes execution policy,
registers an administrator service, or wakes a sleeping computer. --dry-run is
side-effect free and can render another supported platform for review.
"""
from __future__ import annotations

import argparse
import getpass
import json
import locale
import os
import plistlib
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
MARKER = 'culture-radar-pc-startup-v1'
LABEL = 'jp.cultureradar.pc-updater'
TASK_NAME = 'CULTURE RADAR PC updater'
UNIT_NAME = 'culture-radar-pc-updater.service'
SUPPORTED = ('darwin', 'win32', 'linux')
TASK_NAMESPACE = 'http://schemas.microsoft.com/windows/2004/02/mit/task'


class StartupError(RuntimeError):
    """Actionable message that does not expose command output or credentials."""


@dataclass(frozen=True)
class StartupPlan:
    platform: str
    target: Path | None
    contents: str
    commands: tuple[tuple[str, ...], ...]
    remove_commands: tuple[tuple[str, ...], ...]


def command_arguments(root: Path, config: Path, python: str) -> list[str]:
    return [python, str(root / 'scripts' / 'pc_updater.py'), '--config', str(config), '--watch']


def render_launchagent(arguments: list[str], root: Path, logs: Path) -> str:
    value = {
        'Label': LABEL,
        'ProgramArguments': arguments,
        'WorkingDirectory': str(root),
        'RunAtLoad': True,
        # Normal shutdown does not cause launchd to start another instance.
        'KeepAlive': {'SuccessfulExit': False},
        'ThrottleInterval': 60,
        'ProcessType': 'Background',
        'StandardOutPath': str(logs / 'startup.stdout.log'),
        'StandardErrorPath': str(logs / 'startup.stderr.log'),
    }
    contents = plistlib.dumps(value, fmt=plistlib.FMT_XML).decode('utf-8')
    return contents.replace('<plist version="1.0">', f'<!-- {MARKER} -->\n<plist version="1.0">', 1)


def systemd_quote(value: str, *, executable_argument: bool = True) -> str:
    if any(character in value for character in ('\n', '\r', '\x00')):
        raise StartupError('改行を含むパスは自動起動に登録できません。')
    value = value.replace('\\', '\\\\').replace('"', '\\"').replace('%', '%%')
    if executable_argument:
        value = value.replace('$', '$$')
    return '"' + value + '"'


def render_systemd(arguments: list[str], root: Path) -> str:
    return '\n'.join([
        f'# {MARKER}',
        '[Unit]',
        'Description=CULTURE RADAR local PC updater',
        '',
        '[Service]',
        'Type=simple',
        'WorkingDirectory=' + systemd_quote(str(root), executable_argument=False),
        'ExecStart=' + ' '.join(systemd_quote(argument) for argument in arguments),
        'Restart=on-failure',
        'RestartSec=60',
        '',
        '[Install]',
        'WantedBy=default.target',
        '',
    ])


def render_task(arguments: list[str], root: Path, username: str) -> str:
    """InteractiveToken uses the signed-in account and stores no password."""
    task = ET.Element('Task', {'version': '1.4', 'xmlns': TASK_NAMESPACE})
    registration = ET.SubElement(task, 'RegistrationInfo')
    ET.SubElement(registration, 'Description').text = f'{MARKER}: CULTURE RADAR local-only updater'
    triggers = ET.SubElement(task, 'Triggers')
    logon = ET.SubElement(triggers, 'LogonTrigger')
    ET.SubElement(logon, 'Enabled').text = 'true'
    ET.SubElement(logon, 'UserId').text = username
    principals = ET.SubElement(task, 'Principals')
    principal = ET.SubElement(principals, 'Principal', {'id': 'CurrentUser'})
    ET.SubElement(principal, 'UserId').text = username
    ET.SubElement(principal, 'LogonType').text = 'InteractiveToken'
    ET.SubElement(principal, 'RunLevel').text = 'LeastPrivilege'
    settings = ET.SubElement(task, 'Settings')
    for key, value in (
        ('MultipleInstancesPolicy', 'IgnoreNew'),
        ('DisallowStartIfOnBatteries', 'false'),
        ('StopIfGoingOnBatteries', 'false'),
        ('AllowHardTerminate', 'true'),
        ('StartWhenAvailable', 'true'),
        ('AllowStartOnDemand', 'true'),
        ('Enabled', 'true'),
        ('Hidden', 'false'),
        ('WakeToRun', 'false'),
        ('ExecutionTimeLimit', 'PT0S'),
    ):
        ET.SubElement(settings, key).text = value
    restart = ET.SubElement(settings, 'RestartOnFailure')
    ET.SubElement(restart, 'Interval').text = 'PT1M'
    ET.SubElement(restart, 'Count').text = '3'
    actions = ET.SubElement(task, 'Actions', {'Context': 'CurrentUser'})
    execute = ET.SubElement(actions, 'Exec')
    ET.SubElement(execute, 'Command').text = arguments[0]
    # Task Scheduler passes this string to CreateProcess, not to a command shell.
    ET.SubElement(execute, 'Arguments').text = subprocess.list2cmdline(arguments[1:])
    ET.SubElement(execute, 'WorkingDirectory').text = str(root)
    return '<?xml version="1.0" encoding="UTF-16"?>\n' + ET.tostring(task, encoding='unicode') + '\n'


def default_username() -> str:
    username = getpass.getuser()
    domain = os.environ.get('USERDOMAIN')
    return f'{domain}\\{username}' if domain else username


def make_plan(platform: str, *, root: Path = ROOT, config: Path | None = None,
              python: str | None = None, home: Path | None = None,
              uid: int | None = None, username: str | None = None) -> StartupPlan:
    if platform not in SUPPORTED:
        raise StartupError('自動起動はWindows、macOS、Linuxに対応しています。')
    root = root.resolve()
    config = (config or root / '.local' / 'pc-updater.json').resolve()
    home = home or Path.home()
    python = python or sys.executable
    if platform == 'win32':
        candidate = Path(python).with_name('pythonw.exe')
        if candidate.is_file():
            python = str(candidate)
    arguments = command_arguments(root, config, python)
    if platform == 'darwin':
        uid = uid if uid is not None else (os.getuid() if hasattr(os, 'getuid') else 501)
        domain = f'gui/{uid}'
        target = home / 'Library' / 'LaunchAgents' / f'{LABEL}.plist'
        return StartupPlan(platform, target, render_launchagent(arguments, root, root / '.local' / 'pc-updater'),
                           (('launchctl', 'bootstrap', domain, str(target)),),
                           (('launchctl', 'bootout', f'{domain}/{LABEL}'),))
    if platform == 'linux':
        target = home / '.config' / 'systemd' / 'user' / UNIT_NAME
        return StartupPlan(platform, target, render_systemd(arguments, root),
                           (('systemctl', '--user', 'daemon-reload'),
                            ('systemctl', '--user', 'enable', '--now', UNIT_NAME)),
                           (('systemctl', '--user', 'disable', '--now', UNIT_NAME),))
    return StartupPlan(platform, None, render_task(arguments, root, username or default_username()),
                       (('schtasks.exe', '/Create', '/TN', TASK_NAME, '/XML', '<一時XMLファイル>'),
                        ('schtasks.exe', '/Run', '/TN', TASK_NAME)),
                       (('schtasks.exe', '/End', '/TN', TASK_NAME),
                        ('schtasks.exe', '/Delete', '/TN', TASK_NAME, '/F')))


def decode_command_output(value: bytes | str | None) -> str:
    """schtasks XML can be UTF-16 even when Windows uses a legacy code page.

    Decode captured bytes ourselves rather than letting subprocess assume the
    current locale. Never include raw command output in an error message.
    """
    if value is None:
        return ''
    if isinstance(value, str):
        return value
    if value.startswith((b'\xff\xfe', b'\xfe\xff')):
        return value.decode('utf-16', errors='replace')
    if value.startswith(b'\xef\xbb\xbf'):
        return value.decode('utf-8-sig', errors='replace')
    # Some Windows versions omit the BOM from a redirected XML response.
    if value.startswith(b'<\x00'):
        return value.decode('utf-16-le', errors='replace')
    if value.startswith(b'\x00<'):
        return value.decode('utf-16-be', errors='replace')
    try:
        return value.decode('utf-8')
    except UnicodeDecodeError:
        return value.decode(locale.getpreferredencoding(False), errors='replace')


def run_command(command: tuple[str, ...] | list[str], *, allow_failure: bool = False):
    try:
        result = subprocess.run(command, capture_output=True, timeout=30, check=False,
                                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0) if os.name == 'nt' else 0)
    except (OSError, subprocess.TimeoutExpired) as error:
        if allow_failure:
            return None
        raise StartupError('自動起動の登録コマンドを実行できません。対応OSとユーザーのログイン状態を確認してください。') from error
    if result.returncode and not allow_failure:
        raise StartupError('自動起動の登録に失敗しました。現在のユーザーでログインし、OSのタスク管理画面を確認してください。')
    result.stdout = decode_command_output(result.stdout)
    result.stderr = decode_command_output(result.stderr)
    return result


def owns_contents(contents: str, platform: str) -> bool:
    if MARKER not in contents:
        return False
    if platform == 'darwin':
        try:
            return plistlib.loads(contents.encode('utf-8')).get('Label') == LABEL
        except (ValueError, plistlib.InvalidFileException):
            return False
    if platform == 'win32':
        try:
            tree = ET.fromstring(contents)
            return MARKER in (tree.findtext(f'{{{TASK_NAMESPACE}}}RegistrationInfo/{{{TASK_NAMESPACE}}}Description') or '')
        except ET.ParseError:
            return False
    return contents.startswith(f'# {MARKER}\n')


def existing_task():
    result = run_command(('schtasks.exe', '/Query', '/TN', TASK_NAME, '/XML'), allow_failure=True)
    if result is None or result.returncode:
        return None
    return result.stdout


def apply_plan(plan: StartupPlan, *, uninstall: bool = False, root: Path = ROOT,
               config: Path | None = None, run=run_command, task_query=existing_task) -> None:
    """Only modify our exact current-user target after checking its ownership."""
    if plan.platform == 'win32':
        existing = task_query()
        if existing is not None and not owns_contents(existing, plan.platform):
            raise StartupError('同名のタスクが別の内容で存在するため変更しません。タスク名を確認してください。')
        if uninstall:
            if existing is not None:
                run(plan.remove_commands[0], allow_failure=True)
                run(plan.remove_commands[1])
            return
        if existing is not None:
            run(plan.remove_commands[0], allow_failure=True)
        with tempfile.TemporaryDirectory(prefix='culture-radar-startup-') as temporary:
            target = Path(temporary) / 'task.xml'
            target.write_text(plan.contents, encoding='utf-16')
            command = ['schtasks.exe', '/Create', '/TN', TASK_NAME, '/XML', str(target)]
            if existing is not None:
                command.append('/F')
            run(command)
        run(plan.commands[1])
        return

    target = plan.target
    if target is None:
        raise StartupError('自動起動ファイルの保存先が不正です。')
    if target.is_symlink():
        raise StartupError('自動起動ファイルがシンボリックリンクのため変更しません。')
    exists = target.exists()
    if exists and not owns_contents(target.read_text(encoding='utf-8'), plan.platform):
        raise StartupError('同名の設定ファイルが別の内容で存在するため変更しません。')
    if uninstall:
        if exists:
            for command in plan.remove_commands:
                run(command, allow_failure=True)
            target.unlink()
            if plan.platform == 'linux':
                run(('systemctl', '--user', 'daemon-reload'))
        return
    if exists:
        for command in plan.remove_commands:
            run(command, allow_failure=True)
    target.parent.mkdir(parents=True, exist_ok=True)
    (root / '.local' / 'pc-updater').mkdir(parents=True, exist_ok=True)
    # Atomic replacement avoids partial plist/unit files during an interrupted install.
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=target.parent, delete=False) as temporary:
        temporary.write(plan.contents)
        temporary_name = temporary.name
    os.chmod(temporary_name, 0o600)
    os.replace(temporary_name, target)
    for command in plan.commands:
        run(command)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='PCログイン時にローカル更新を開始します（管理者権限不要）。')
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument('--install', action='store_true', help='現在のユーザーのログイン時に開始')
    action.add_argument('--uninstall', action='store_true', help='このツールが登録した自動起動だけ解除')
    parser.add_argument('--config', type=Path, default=ROOT / '.local' / 'pc-updater.json')
    parser.add_argument('--dry-run', action='store_true', help='変更せず設定とコマンドを表示')
    parser.add_argument('--platform', choices=SUPPORTED, help='dry-run専用: 他OSの設定を確認')
    args = parser.parse_args(argv)
    if args.platform and not args.dry_run:
        parser.error('--platform は --dry-run と一緒に指定してください。')
    platform = args.platform or sys.platform
    if platform.startswith('linux'):
        platform = 'linux'
    try:
        config = args.config.expanduser().resolve()
        plan = make_plan(platform, config=config)
        if args.dry_run:
            print(f'保存先: {plan.target if plan.target else TASK_NAME}')
            print(plan.contents)
            print('実行予定:')
            for command in (plan.remove_commands if args.uninstall else plan.commands):
                print(json.dumps(command, ensure_ascii=False))
            print('確認のみです。設定・登録・モデルのダウンロードは行っていません。')
            return 0
        if args.install:
            if not config.is_file():
                raise StartupError('PC更新の設定ファイルがありません。先に pc_updater.py --initialize --model MODEL を実行してください。')
            if not (ROOT / 'scripts' / 'pc_updater.py').is_file():
                raise StartupError('PC更新スクリプトがありません。リポジトリを更新してください。')
        apply_plan(plan, uninstall=args.uninstall, config=config)
        if args.uninstall:
            print('PC更新の自動起動を解除しました。保存データ・モデル・PC更新の設定は残しています。')
        else:
            print('PCログイン後の自動更新を登録し、開始しました。スリープ中は更新せず、復帰後に更新時刻を確認します。')
        return 0
    except (StartupError, OSError) as error:
        print(str(error) if isinstance(error, StartupError) else '設定ファイルを読み書きできません。パスとユーザー権限を確認してください。', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
