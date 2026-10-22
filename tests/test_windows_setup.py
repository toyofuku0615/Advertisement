"""Windows registration is mocked; no actual startup entries or models created."""
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from scripts.setup_windows_updates import SetupError, WindowsSetup, validate_model


class FakeRunner:
    def __init__(self, *, authenticated=True, installed=True, once_code=0, doctor_code=0):
        self.calls = []
        self.authenticated = authenticated
        self.installed = installed
        self.once_code = once_code
        self.doctor_code = doctor_code

    def __call__(self, arguments, **options):
        self.calls.append((arguments, options))
        result = 0
        if arguments[:3] == ['gh', 'auth', 'status']:
            result = 0 if self.authenticated else 1
        elif arguments[:2] == ['ollama', 'show']:
            result = 0 if self.installed else 1
        elif '--once' in arguments:
            result = self.once_code
        elif '--doctor' in arguments:
            result = self.doctor_code
        return subprocess.CompletedProcess(arguments, result, 'PRIVATE OUTPUT IS NOT LOGGED', 'PRIVATE ERROR')


class WindowsSetupTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / 'scripts').mkdir()
        for name in ('pc_updater.py', 'install_pc_startup.py'):
            (self.root / 'scripts' / name).touch()
        self.messages = []

    def tearDown(self):
        self.temp.cleanup()

    def setup(self, runner=None, **kwargs):
        return WindowsSetup(root=self.root, platform=kwargs.pop('platform', 'win32'),
                            runner=runner or FakeRunner(), which=kwargs.pop('which', lambda value: value),
                            interactive=kwargs.pop('interactive', False), output=self.messages.append,
                            python='C:/Python/python.exe', **kwargs)

    def existing_config(self, model='qwen3:4b'):
        path = self.root / '.local' / 'pc-updater.json'
        path.parent.mkdir(exist_ok=True)
        path.write_text(json.dumps({'schemaVersion': 1, 'model': model, 'intervalHours': 8}), encoding='utf-8')
        return path

    def test_success_first_updates_then_registers_and_uses_only_loopback(self):
        runner = FakeRunner(installed=False)
        self.setup(runner).run(download_model=True)
        commands = [call[0] for call in runner.calls]
        self.assertIn(['ollama', 'pull', 'qwen3:4b'], commands)
        once = next(index for index, args in enumerate(commands) if '--once' in args)
        startup = next(index for index, args in enumerate(commands) if '--install' in args)
        self.assertLess(once, startup)
        for args, options in runner.calls:
            self.assertNotIn('shell', options)
            if args[0] == 'ollama':
                self.assertEqual(options['env']['OLLAMA_HOST'], 'http://127.0.0.1:11434')
                self.assertEqual(options['env']['OLLAMA_NO_CLOUD'], '1')
        self.assertFalse(any('PRIVATE' in text for text in self.messages))

    def test_read_only_check_never_changes_auth_or_config_or_downloads(self):
        config = self.existing_config()
        before = config.read_bytes()
        runner = FakeRunner()
        self.setup(runner).run(check_only=True, download_model=True)
        self.assertEqual(config.read_bytes(), before)
        commands = [call[0] for call in runner.calls]
        self.assertFalse(any('--initialize' in args or '--once' in args or '--install' in args for args in commands))
        self.assertFalse(any(args[:3] in (['gh', 'auth', 'setup-git'], ['gh', 'auth', 'login']) for args in commands))
        self.assertNotIn(['ollama', 'pull', 'qwen3:4b'], commands)
        self.assertTrue(any('--doctor' in args for args in commands))

    def test_missing_model_requires_explicit_download_option(self):
        runner = FakeRunner(installed=False)
        with self.assertRaisesRegex(SetupError, '--download-model'):
            self.setup(runner).run()
        self.assertFalse(any(args[:2] == ['ollama', 'pull'] for args, _ in runner.calls))

    def test_no_registration_after_failed_initial_update(self):
        runner = FakeRunner(once_code=1)
        with self.assertRaisesRegex(SetupError, '最初の更新'):
            self.setup(runner).run()
        self.assertFalse(any('--install' in args for args, _ in runner.calls))

    def test_no_update_or_registration_after_failed_doctor(self):
        runner = FakeRunner(doctor_code=1)
        with self.assertRaisesRegex(SetupError, '接続確認'):
            self.setup(runner).run()
        self.assertFalse(any('--once' in args or '--install' in args for args, _ in runner.calls))

    def test_existing_model_and_schedule_preserved(self):
        config = self.existing_config('local-reviewed-model:4b')
        before = config.read_bytes()
        runner = FakeRunner()
        self.setup(runner).run(no_startup=True)
        self.assertEqual(config.read_bytes(), before)
        self.assertIn(['ollama', 'show', 'local-reviewed-model:4b'], [args for args, _ in runner.calls])
        self.assertFalse(any('--initialize' in args or '--install' in args for args, _ in runner.calls))

    def test_existing_model_mismatch_does_not_overwrite(self):
        config = self.existing_config('another:4b')
        before = config.read_bytes()
        runner = FakeRunner()
        with self.assertRaisesRegex(SetupError, '異なります'):
            self.setup(runner).run(model='qwen3:4b')
        self.assertEqual(config.read_bytes(), before)
        self.assertEqual(runner.calls, [])

    def test_non_windows_does_nothing(self):
        runner = FakeRunner()
        with self.assertRaisesRegex(SetupError, 'Windows PC'):
            self.setup(runner, platform='linux').run()
        self.assertEqual(runner.calls, [])

    def test_missing_tools_gives_official_links_without_execution(self):
        runner = FakeRunner()
        with self.assertRaisesRegex(SetupError, 'https://ollama.com/download/windows'):
            self.setup(runner, which=lambda value: None).run()
        self.assertEqual(runner.calls, [])

    def test_no_noninteractive_login_and_no_private_output(self):
        runner = FakeRunner(authenticated=False)
        with self.assertRaisesRegex(SetupError, 'gh auth login') as error:
            self.setup(runner).run()
        self.assertEqual(len(runner.calls), 1)
        self.assertNotIn('PRIVATE', str(error.exception))

    def test_interactive_login_is_explicit_browser_flow_without_credentials(self):
        runner = FakeRunner(authenticated=False)
        self.setup(runner, interactive=True).run(no_startup=True)
        login = next(call for call in runner.calls if call[0][:3] == ['gh', 'auth', 'login'])
        self.assertIn('--web', login[0])
        self.assertIn('https', login[0])
        self.assertIsNone(login[1]['stdin'])
        self.assertNotIn('--with-token', login[0])

    def test_rejects_cloud_models_and_option_injection(self):
        for model in ('qwen3:cloud', 'custom-CLOUD', '--help', 'qwen3;whoami', '', 'x y'):
            with self.subTest(model=model), self.assertRaises(SetupError):
                validate_model(model)
        self.assertEqual(validate_model('qwen3:4b'), 'qwen3:4b')

    def test_bad_existing_config_is_preserved(self):
        config = self.existing_config()
        config.write_text('{BROKEN', encoding='utf-8')
        with self.assertRaisesRegex(SetupError, '上書きせず'):
            self.setup().run()
        self.assertEqual(config.read_text(encoding='utf-8'), '{BROKEN')

    def test_timeout_does_not_leak_subprocess_output(self):
        def timeout(arguments, **kwargs):
            raise subprocess.TimeoutExpired(arguments, 120, output='PRIVATE')
        with self.assertRaisesRegex(SetupError, 'タイムアウト') as error:
            self.setup(timeout).run()
        self.assertNotIn('PRIVATE', str(error.exception))


if __name__ == '__main__':
    unittest.main()
