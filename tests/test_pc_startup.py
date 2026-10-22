"""PC startup rendering/lifecycle tests never register a real OS login service."""
import contextlib
import io
import plistlib
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from xml.etree import ElementTree as ET

from scripts.install_pc_startup import (
    LABEL, MARKER, TASK_NAME, TASK_NAMESPACE, UNIT_NAME,
    StartupError, StartupPlan, apply_plan, command_arguments, main,
    make_plan, owns_contents, render_launchagent, render_systemd,
    render_task, systemd_quote, decode_command_output, run_command,
)


class StartupRenderingTest(unittest.TestCase):
    def test_task_output_decodes_utf16_utf8_and_japanese_windows_codepage(self):
        xml = render_task(['C:/Python/python.exe', 'C:/研究/pc_updater.py'], Path('/研究'), 'DEMO\\山田')
        for encoding in ('utf-16', 'utf-16-le', 'utf-16-be', 'utf-8-sig', 'utf-8'):
            decoded = decode_command_output(xml.encode(encoding))
            self.assertEqual(decoded, xml)
            self.assertTrue(owns_contents(decoded, 'win32'))
        with patch('scripts.install_pc_startup.locale.getpreferredencoding', return_value='cp932'):
            self.assertEqual(decode_command_output(xml.encode('cp932')), xml)
        self.assertEqual(decode_command_output(None), '')

    def test_task_command_captures_bytes_before_decoding(self):
        xml = render_task(['python.exe', 'C:/研究/pc_updater.py'], Path('/研究'), 'DEMO\\山田')
        result = subprocess.CompletedProcess(['schtasks.exe'], 0, xml.encode('utf-16'), b'')
        with patch('scripts.install_pc_startup.subprocess.run', return_value=result) as run:
            decoded = run_command(['schtasks.exe', '/Query', '/XML'])
        self.assertNotIn('text', run.call_args.kwargs)
        self.assertEqual(decoded.stdout, xml)
        self.assertTrue(owns_contents(decoded.stdout, 'win32'))

    def test_windows_interactive_current_user_no_admin_no_wakeup(self):
        arguments = [r'C:\Program Files\Python\pythonw.exe', r'C:\Culture Radar\scripts\pc_updater.py', '--config', r'C:\Culture Radar\my "config".json', '--watch']
        text = render_task(arguments, Path('/DEMO root'), r'DEMO\researcher')
        task = ET.fromstring(text)
        ns = {'t': TASK_NAMESPACE}
        self.assertEqual(task.findtext('t:Principals/t:Principal/t:UserId', namespaces=ns), r'DEMO\researcher')
        self.assertEqual(task.findtext('t:Principals/t:Principal/t:LogonType', namespaces=ns), 'InteractiveToken')
        self.assertEqual(task.findtext('t:Principals/t:Principal/t:RunLevel', namespaces=ns), 'LeastPrivilege')
        self.assertEqual(task.findtext('t:Triggers/t:LogonTrigger/t:UserId', namespaces=ns), r'DEMO\researcher')
        self.assertEqual(task.findtext('t:Settings/t:WakeToRun', namespaces=ns), 'false')
        self.assertEqual(task.findtext('t:Settings/t:ExecutionTimeLimit', namespaces=ns), 'PT0S')
        self.assertEqual(task.findtext('t:Settings/t:MultipleInstancesPolicy', namespaces=ns), 'IgnoreNew')
        self.assertEqual(task.findtext('t:Settings/t:StartWhenAvailable', namespaces=ns), 'true')
        self.assertEqual(task.findtext('t:Actions/t:Exec/t:Command', namespaces=ns), arguments[0])
        self.assertEqual(task.findtext('t:Actions/t:Exec/t:Arguments', namespaces=ns), subprocess.list2cmdline(arguments[1:]))
        self.assertNotIn('Password', text)
        self.assertNotIn('PowerShell', text)
        self.assertNotIn('cmd.exe', text)
        self.assertTrue(owns_contents(text, 'win32'))

    def test_macos_plist_escapes_paths_and_restarts_only_failures(self):
        root = Path('/Users/DEMO/A & B "研究"')
        arguments = command_arguments(root, root / '.local' / 'pc updater.json', '/usr/bin/python3')
        text = render_launchagent(arguments, root, root / '.local')
        value = plistlib.loads(text.encode())
        self.assertEqual(value['Label'], LABEL)
        self.assertEqual(value['ProgramArguments'], arguments)
        self.assertTrue(value['RunAtLoad'])
        self.assertEqual(value['KeepAlive'], {'SuccessfulExit': False})
        self.assertTrue(owns_contents(text, 'darwin'))
        self.assertNotIn('UserName', value)

    def test_linux_quotes_shell_syntax_and_systemd_substitution(self):
        root = Path('/DEMO/$(touch secret) 100% "path"')
        text = render_systemd(['/usr/bin/python3', str(root / 'scripts/pc_updater.py'), '--config', str(root / 'config.json'), '--watch'], root)
        self.assertIn('Restart=on-failure', text)
        self.assertIn('WantedBy=default.target', text)
        self.assertIn('$$(', text)
        self.assertIn('100%%', text)
        self.assertNotIn('bash -c', text)
        self.assertNotIn('sudo', text)
        self.assertTrue(owns_contents(text, 'linux'))
        self.assertEqual(systemd_quote('a"b\\c'), '"a\\"b\\\\c"')
        with self.assertRaises(StartupError):
            systemd_quote('a\nb')

    def test_plans_only_target_current_user(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'DEMO project'
            home = Path(temporary) / 'DEMO home'
            mac = make_plan('darwin', root=root, home=home, uid=1234)
            self.assertEqual(mac.target, home / 'Library/LaunchAgents' / f'{LABEL}.plist')
            self.assertIn('gui/1234', mac.commands[0])
            linux = make_plan('linux', root=root, home=home)
            self.assertEqual(linux.target, home / '.config/systemd/user' / UNIT_NAME)
            self.assertTrue(all('--user' in command for command in linux.commands))
            windows = make_plan('win32', root=root, home=home, username=r'DEMO\user')
            self.assertIsNone(windows.target)
            self.assertNotIn('/RU', windows.commands[0])
            self.assertNotIn('/RP', windows.commands[0])
            self.assertNotIn('/F', windows.commands[0])

    def test_only_recognizes_own_marker_and_identity(self):
        self.assertFalse(owns_contents('some file', 'linux'))
        self.assertFalse(owns_contents(f'# {MARKER} fake prefix\n', 'linux'))
        self.assertFalse(owns_contents(f'<!-- {MARKER} --><plist version="1.0"><dict/></plist>', 'darwin'))
        self.assertFalse(owns_contents(f'<Task>{MARKER}</Task>', 'win32'))


class StartupLifecycleTest(unittest.TestCase):
    def test_linux_install_uninstall_preserves_configuration(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'DEMO project'
            home = Path(temporary) / 'DEMO home'
            config = root / '.local/config.json'
            config.parent.mkdir(parents=True)
            config.write_text('{"DEMO":"keep"}')
            plan = make_plan('linux', root=root, config=config, home=home)
            commands = []
            run = lambda command, **kwargs: commands.append(tuple(command))
            apply_plan(plan, root=root, run=run)
            self.assertEqual(plan.target.read_text(), plan.contents)
            self.assertEqual(commands, list(plan.commands))
            commands.clear()
            apply_plan(plan, root=root, uninstall=True, run=run)
            self.assertFalse(plan.target.exists())
            self.assertTrue(config.is_file())
            self.assertEqual(commands[0], ('systemctl', '--user', 'disable', '--now', UNIT_NAME))
            self.assertEqual(commands[-1], ('systemctl', '--user', 'daemon-reload'))

    def test_refuses_unknown_files_and_symlinks(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            plan = make_plan('linux', root=root, home=root)
            plan.target.parent.mkdir(parents=True)
            plan.target.write_text('DEMO unrelated file')
            for uninstall in (True, False):
                with self.assertRaises(StartupError):
                    apply_plan(plan, root=root, uninstall=uninstall, run=lambda *a, **k: self.fail('must not run'))
            self.assertEqual(plan.target.read_text(), 'DEMO unrelated file')
            plan.target.unlink()
            other = root / 'other'
            other.write_text(plan.contents)
            plan.target.symlink_to(other)
            with self.assertRaises(StartupError):
                apply_plan(plan, root=root, run=lambda *a, **k: self.fail('must not run'))
            self.assertTrue(other.exists())

    def test_windows_unknown_task_is_not_replaced_or_deleted(self):
        plan = make_plan('win32', username='DEMO')
        for uninstall in (False, True):
            with self.assertRaises(StartupError):
                apply_plan(plan, uninstall=uninstall, task_query=lambda: '<Task>DEMO unrelated</Task>', run=lambda *a, **k: self.fail('must not run'))

    def test_windows_installs_utf16_xml_and_starts_immediately(self):
        plan = make_plan('win32', username='DEMO')
        calls = []
        def run(command, **kwargs):
            calls.append(tuple(command))
            if '/XML' in command:
                xml = Path(command[command.index('/XML') + 1])
                self.assertTrue(xml.read_bytes().startswith(b'\xff\xfe'))
                self.assertTrue(owns_contents(xml.read_text(encoding='utf-16'), 'win32'))
        apply_plan(plan, task_query=lambda: None, run=run)
        self.assertEqual(calls[-1], ('schtasks.exe', '/Run', '/TN', TASK_NAME))
        self.assertNotIn('/F', calls[0])
        self.assertFalse(Path(calls[0][calls[0].index('/XML') + 1]).exists())

    def test_windows_duplicate_only_overwrites_owned_task(self):
        plan = make_plan('win32', username='DEMO')
        calls = []
        apply_plan(plan, task_query=lambda: plan.contents, run=lambda command, **kwargs: calls.append(tuple(command)))
        self.assertEqual(calls[0], ('schtasks.exe', '/End', '/TN', TASK_NAME))
        self.assertIn('/F', calls[1])
        calls.clear()
        apply_plan(plan, uninstall=True, task_query=lambda: plan.contents, run=lambda command, **kwargs: calls.append(tuple(command)))
        self.assertEqual(calls, list(plan.remove_commands))

    def test_uninstall_absent_target_has_no_effect(self):
        with tempfile.TemporaryDirectory() as temporary:
            plan = make_plan('linux', root=Path(temporary), home=Path(temporary))
            apply_plan(plan, uninstall=True, run=lambda *a, **k: self.fail('must not run'))
            self.assertEqual(list(Path(temporary).iterdir()), [])
        plan = make_plan('win32', username='DEMO')
        apply_plan(plan, uninstall=True, task_query=lambda: None, run=lambda *a, **k: self.fail('must not run'))

    def test_dry_run_has_no_writes_or_registration(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config = root / 'does-not-exist/config.json'
            with patch('scripts.install_pc_startup.ROOT', root), patch('scripts.install_pc_startup.apply_plan', side_effect=AssertionError('must not register')), contextlib.redirect_stdout(io.StringIO()) as output:
                self.assertEqual(main(['--install', '--dry-run', '--platform', 'win32', '--config', str(config)]), 0)
            self.assertIn(MARKER, output.getvalue())
            self.assertEqual(list(root.iterdir()), [])

    def test_platform_override_requires_dry_run(self):
        with contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as error:
                main(['--install', '--platform', 'win32'])
        self.assertEqual(error.exception.code, 2)


if __name__ == '__main__':
    unittest.main()
