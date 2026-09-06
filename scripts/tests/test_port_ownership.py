from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
from contextlib import contextmanager

import pytest

ROOT = Path(__file__).resolve().parents[2]
HELPER = ROOT / 'scripts/operatoros-dev-runtime.py'


def load_helper():
    spec = importlib.util.spec_from_file_location('op_helper', HELPER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def git(repo, *args):
    return subprocess.run(['git', '-C', str(repo), *args], check=True, capture_output=True, text=True).stdout.strip()


def create_operatoros_checkout(base, name):
    repo = base / name
    repo.mkdir()
    git(repo, 'init', '-b', 'main')
    git(repo, 'config', 'user.email', 'test@example.invalid')
    git(repo, 'config', 'user.name', 'Test')
    git(repo, 'config', 'commit.gpgsign', 'false')
    for app in ('api', 'web'):
        directory = repo / 'apps' / app
        directory.mkdir(parents=True)
        (directory / 'package.json').write_text(json.dumps({'name': f'@operatoros/{app}'}))
    shutil.copyfile(ROOT / 'start-dev.sh', repo / 'start-dev.sh')
    git(repo, 'add', 'apps/api/package.json', 'apps/web/package.json', 'start-dev.sh')
    git(repo, 'commit', '-m', 'fixture')
    return repo


@pytest.fixture
def repo(tmp_path):
    return create_operatoros_checkout(tmp_path, 'repo with spaces')


def info(repo, role='frontend'):
    app = 'web' if role == 'frontend' else 'api'
    command = 'bun run --bun vite' if role == 'frontend' else 'bun run src/server.ts'
    return dict(pid=12345, pgid=12345, start_ticks='123', uid=os.getuid(), state='S', cwd=str(repo / 'apps' / app), command=command)


@pytest.mark.parametrize('role', ['frontend', 'backend'])
@pytest.mark.parametrize('kind', ['current', 'worktree', 'repository'])
def test_checkout_port_classification(repo, tmp_path, monkeypatch, role, kind):
    h = load_helper()
    candidate = repo
    if kind == 'worktree':
        candidate = tmp_path / 'linked checkout'
        git(repo, 'worktree', 'add', '--detach', str(candidate), 'HEAD')
        assert (candidate / '.git').is_file()
        assert h.git_common_dir(candidate / 'apps/web') == h.git_common_dir(repo)
    elif kind == 'repository':
        candidate = create_operatoros_checkout(tmp_path, 'other')
    monkeypatch.setattr(h, 'listener_pids', lambda port: [12345])
    monkeypatch.setattr(h, 'process_info', lambda pid: info(candidate, role))
    result = h.classify(tmp_path / 'runtime', repo, 5173)[0]
    expected = {'current': 'OPERATOROS_CURRENT_CHECKOUT', 'worktree': 'OPERATOROS_OTHER_WORKTREE', 'repository': 'OPERATOROS_OTHER_CHECKOUT'}
    assert result['ownership_decision'] == expected[kind]
    assert result['candidate_repository'] == str(candidate)
    assert result['role'] == role
    assert 'command' not in result


@pytest.mark.parametrize('change,expected', [({'command': 'python -m http.server'}, 'NON_OPERATOROS'), ({'cwd': None}, 'UNKNOWN_OWNER'), ({'command': ''}, 'UNKNOWN_OWNER'), ({'uid': -1}, 'UNKNOWN_OWNER')])
def test_unrelated_and_unverifiable(repo, change, expected):
    h = load_helper()
    process = info(repo) | change
    assert h.detect_cross_worktree(repo, process)['decision'] == expected


def test_inaccessible_process_remains_unknown(repo, tmp_path, monkeypatch):
    h = load_helper()
    monkeypatch.setattr(h, 'listener_pids', lambda port: [12345])
    monkeypatch.setattr(h, 'process_info', lambda pid: None)
    assert h.classify(tmp_path, repo, 5173)[0]['ownership_decision'] == 'UNKNOWN_OWNER'


def test_missing_proc_cwd_is_not_a_fake_path(monkeypatch):
    h = load_helper()
    resolve = Path.resolve
    def unavailable(path, *args, **kwargs):
        if path == Path(f'/proc/{os.getpid()}/cwd'):
            raise FileNotFoundError()
        return resolve(path, *args, **kwargs)
    monkeypatch.setattr(Path, 'resolve', unavailable)
    assert h.process_info(os.getpid()) is None


@pytest.mark.parametrize('role', ['frontend', 'backend'])
def test_managed_current_checkout_and_pid_reuse(repo, tmp_path, monkeypatch, role):
    h = load_helper()
    runtime = tmp_path / 'runtime'
    directory = runtime / 'sessions/test'
    directory.mkdir(parents=True)
    (directory / 'session.json').write_text('{"session_id":"test"}')
    record = dict(pid=12345, role=role, start_ticks='123', port=5173)
    (directory / f'{role}.pid').write_text(json.dumps(record))
    (directory / 'launcher.pid').write_text(json.dumps(record | {'role': 'launcher'}))
    monkeypatch.setattr(h, 'listener_pids', lambda port: [12345])
    monkeypatch.setattr(h, 'process_info', lambda pid: info(repo, role))
    assert h.classify(runtime, repo, 5173)[0]['ownership_decision'] == 'OPERATOROS_ACTIVE'
    record['start_ticks'] = 'old-pid'
    (directory / f'{role}.pid').write_text(json.dumps(record))
    assert not h.valid_record(record, repo, role)[0]
    assert h.classify(runtime, repo, 5173)[0]['ownership_decision'] == 'OPERATOROS_CURRENT_CHECKOUT'
    monkeypatch.setattr(h, 'stop_pid', lambda *args: pytest.fail('must not signal reused PID'))
    assert h.cleanup_port(argparse.Namespace(runtime=runtime, repo=repo, port=5173, host='127.0.0.1', timeout=0.1)) == 3


@pytest.mark.parametrize('decision', ['UNKNOWN_OWNER', 'NON_OPERATOROS', 'OPERATOROS_OTHER_WORKTREE', 'OPERATOROS_OTHER_CHECKOUT', 'OPERATOROS_CURRENT_CHECKOUT', 'OPERATOROS_ACTIVE'])
def test_discovery_never_authorizes_signaling(repo, tmp_path, monkeypatch, decision):
    h = load_helper()
    monkeypatch.setattr(h, 'classify', lambda *args: [dict(port=5173, pid=12345, ownership_decision=decision)])
    monkeypatch.setattr(h, 'stop_pid', lambda *args: pytest.fail('must not signal'))
    assert h.cleanup_port(argparse.Namespace(runtime=tmp_path, repo=repo, port=5173, host='127.0.0.1', timeout=0.1)) == 3


def test_stale_pid_revalidated_before_signal(repo, tmp_path, monkeypatch):
    h = load_helper()
    stale = dict(port=5173, pid=12345, pgid=12345, start_ticks='123', ownership_decision='OPERATOROS_STALE')
    responses = iter([[stale], [stale | {'start_ticks': '456'}]])
    monkeypatch.setattr(h, 'classify', lambda *args: next(responses))
    monkeypatch.setattr(h, 'stop_pid', lambda *args: pytest.fail('PID was reused'))
    assert h.cleanup_port(argparse.Namespace(runtime=tmp_path, repo=repo, port=5173, host='127.0.0.1', timeout=0.1)) == 3


def banner(repo):
    result = subprocess.run(['bash', str(repo / 'start-dev.sh'), '--check'], capture_output=True, text=True)
    assert result.returncode == 2  # fixture deliberately lacks dependencies
    assert result.stdout.index('Repository') < result.stdout.index('Checking environment')
    return result.stdout


def test_banner_clean_dirty_detached_and_protected_data(repo):
    assert 'Status      clean' in banner(repo)
    (repo / 'backend').mkdir()
    protected = repo / 'backend/attendance.db'
    protected.write_bytes(b'protected fixture must not be opened')
    before = protected.stat()
    assert 'Status      dirty' in banner(repo)
    git(repo, 'checkout', '--detach', 'HEAD')
    assert 'Branch      detached' in banner(repo)
    after = protected.stat()
    assert (before.st_mtime_ns, before.st_atime_ns, before.st_size) == (after.st_mtime_ns, after.st_atime_ns, after.st_size)
    assert load_helper().checkout_identity(repo)['branch'] == 'detached'


def test_upstream_ahead_behind_and_primary_warning(repo):
    git(repo, 'branch', 'upstream')
    git(repo, 'branch', '--set-upstream-to=upstream')
    assert 'behind 0, ahead 0' in banner(repo)
    git(repo, 'commit', '--allow-empty', '-m', 'ahead')
    assert 'behind 0, ahead 1' in banner(repo)
    git(repo, 'checkout', 'upstream')
    git(repo, 'commit', '--allow-empty', '-m', 'upstream ahead')
    git(repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
    git(repo, 'checkout', 'main')
    output = banner(repo)
    assert 'behind 1, ahead 1' in output
    assert 'WARNING: PRIMARY MAIN IS BEHIND origin/main' in output
    identity = load_helper().checkout_identity(repo)
    assert identity['ahead'] == identity['behind'] == 1


@contextmanager
def listener(repo, preferred=0):
    # Parent holds the socket; the child serves only as a known, recorded process.
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', preferred))
        sock.listen()
        yield sock.getsockname()[1]


def launcher_env(tmp_path, frontend, backend):
    return os.environ | {'OPERATOROS_RUNTIME_DIR': str(tmp_path / "runtime's path"), 'OPERATOROS_DATA_DIR': str(tmp_path / 'data'), 'FRONTEND_PORT': str(frontend), 'BACKEND_PORT': str(backend)}


def run_launcher(env, *args):
    return subprocess.run([str(ROOT / 'start-dev.sh'), '--check', *args], cwd=ROOT, env=env, capture_output=True, text=True, timeout=45)


def test_launcher_normal_verbose_and_secrets(tmp_path):
    with listener(ROOT) as port, listener(ROOT) as backend:
        env = launcher_env(tmp_path, port, backend)
        env['DATABASE_URL'] = 'postgres://user:never-print-this@invalid/db'
        for options in ((), ('--verbose',), ('--no-clean-stale',)):
            result = run_launcher(env, *options)
            output = result.stdout + result.stderr
            assert result.returncode == 2, output
            assert 'non-OperatorOS process' in output, output
            assert f'PID: {os.getpid()}' in output
            assert 'never-print-this' not in output
            assert ('"ownership_decision"' in output) == ('--verbose' in options)


def test_launcher_second_invocation_preserves_owned_process(tmp_path):
    h = load_helper()
    with listener(ROOT) as frontend, listener(ROOT) as backend:
        env = launcher_env(tmp_path, frontend, backend)
        runtime = Path(env['OPERATOROS_RUNTIME_DIR'])
        directory = runtime / 'sessions/test'
        directory.mkdir(parents=True)
        (runtime / 'active-session').write_text('test')
        (directory / 'ownership.json').write_text('{"application":"OperatorOS","session_id":"test"}')
        (directory / 'session.json').write_text(json.dumps(dict(session_id='test', frontend_url=f'http://127.0.0.1:{frontend}', backend_url=f'http://127.0.0.1:{backend}', database_path=str(tmp_path / 'data/operatoros.sqlite'))))
        h.write_record(directory / 'frontend.pid', os.getpid(), 'frontend', ROOT, 'never-print-token', port=frontend)
        result = run_launcher(env)
        output = result.stdout + result.stderr
        assert result.returncode == 2, output
        assert 'OperatorOS is already running from this checkout.' in output
        assert f'Frontend  http://127.0.0.1:{frontend}' in output
        assert f'Backend   http://127.0.0.1:{backend}' in output
        assert '"state"' not in output and 'never-print-token' not in output
        assert (directory / 'frontend.pid').exists()


def test_auto_port_reports_selection_and_check_uses_disposable_data(tmp_path):
    h = load_helper()
    frontend = next(p for p in range(5173, 5199) if h.is_free('127.0.0.1', p))
    backend = next(p for p in range(8000, 8099) if h.is_free('127.0.0.1', p))
    with listener(ROOT, frontend), listener(ROOT, backend):
        result = run_launcher(launcher_env(tmp_path, frontend, backend), '--auto-port')
        output = result.stdout + result.stderr
        assert result.returncode == 0, output
        assert 'Requested ports are occupied.' in output
        assert 'Selected:' in output
        assert 'another OperatorOS worktree' not in output
        assert '"ownership_decision"' not in output
        assert f'Data root   {tmp_path / "data"}' in output
        assert (tmp_path / 'data/operatoros.sqlite').exists()


def test_verbose_conflict_omits_command_secrets(repo, tmp_path, monkeypatch, capsys):
    h = load_helper()
    monkeypatch.setattr(h, 'listener_pids', lambda port: [12345])
    monkeypatch.setattr(h, 'process_info', lambda pid: info(repo) | {'command': 'bun vite --password hidden-password positional-secret'})
    item = h.classify(tmp_path, repo, 5173, verbose=True)[0]
    h.print_port_conflict(item, repo, True)
    output = capsys.readouterr().out
    assert '"ownership_decision"' in output
    assert 'hidden-password' not in output and 'positional-secret' not in output


def test_unverified_session_normal_output_is_plain(tmp_path):
    env = launcher_env(tmp_path, 5173, 8000)
    runtime = Path(env['OPERATOROS_RUNTIME_DIR'])
    runtime.mkdir()
    (runtime / 'active-session').write_text('missing')
    result = run_launcher(env)
    assert result.returncode == 2
    assert 'STALE_SESSION_UNVERIFIED' in result.stdout
    assert '"state"' not in result.stdout
    assert (runtime / 'active-session').exists()


def test_absolute_backend_argument_preserves_spaces(repo):
    process = info(repo, 'backend')
    process['argv'] = ['bun', 'run', str(repo / 'apps/api/src/server.ts')]
    process['command'] = ' '.join(process['argv'])
    assert load_helper().detect_cross_worktree(repo, process)['decision'] == 'OPERATOROS_CURRENT_CHECKOUT'


@pytest.mark.parametrize('kind', ['worktree', 'repository'])
def test_other_checkout_message_gives_exact_stop_directory(repo, tmp_path, kind, capsys):
    other = tmp_path / 'other checkout'
    if kind == 'worktree':
        git(repo, 'worktree', 'add', '--detach', str(other), 'HEAD')
    else:
        other = create_operatoros_checkout(tmp_path, 'other checkout')
    h = load_helper()
    detected = h.detect_cross_worktree(repo, info(other))
    item = detected | {'ownership_decision': detected['decision'], 'port': 5173, 'pid': 12345}
    h.print_port_conflict(item, repo)
    output = capsys.readouterr().out
    assert f'Another OperatorOS {kind}' in output
    assert str(repo) in output and str(other) in output
    assert 'Git commit' in output and 'Branch' in output
    assert f"cd '{other}'" in output
    assert './stop-dev.sh' in output and './start-dev.sh --auto-port' in output
    assert '"ownership_decision"' not in output
