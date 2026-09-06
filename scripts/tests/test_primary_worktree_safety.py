from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[2]
RUNTIME_PATH = ROOT / "scripts/operatoros-dev-runtime.py"
SAFETY_PATH = ROOT / "scripts/operatoros-worktree-safety.py"


def load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


runtime = load(RUNTIME_PATH, "operatoros_runtime")


def git(repo: Path, *args: str, check: bool = True) -> str:
    result = subprocess.run(["git", "-C", str(repo), *args], text=True, capture_output=True, check=check)
    return result.stdout.strip()


def create_repo(tmp_path: Path, name: str = "primary") -> Path:
    repo = tmp_path / name
    repo.mkdir()
    git(repo, "init", "-b", "main")
    git(repo, "config", "user.name", "Test")
    git(repo, "config", "user.email", "test@example.invalid")
    for app in ("api", "web"):
        directory = repo / "apps" / app
        directory.mkdir(parents=True)
        (directory / "package.json").write_text(json.dumps({"name": f"@operatoros/{app}"}))
    (repo / "package.json").write_text("{}")
    (repo / "bun.lock").write_text("lockfile")
    (repo / "mise.toml").write_text("[tools]\n")
    (repo / "scripts").mkdir()
    shutil.copy(ROOT / "start-dev.sh", repo / "start-dev.sh")
    shutil.copy(ROOT / "scripts/operatoros_dev_config.py", repo / "scripts/operatoros_dev_config.py")
    git(repo, "add", "apps/api/package.json", "apps/web/package.json", "package.json", "bun.lock", "mise.toml", "scripts/operatoros_dev_config.py", "start-dev.sh")
    git(repo, "commit", "-m", "initial")
    origin = tmp_path / f"{name}-origin.git"
    git(tmp_path, "init", "--bare", str(origin))
    git(repo, "remote", "add", "origin", str(origin))
    git(repo, "push", "-u", "origin", "main")
    return repo


def push_remote_commit(repo: Path, tmp_path: Path, message: str) -> None:
    peer = tmp_path / f"peer-{message.replace(' ', '-') }"
    origin = Path(git(repo, "remote", "get-url", "origin"))
    git(tmp_path, "clone", str(origin), str(peer))
    git(peer, "config", "user.name", "Peer")
    git(peer, "config", "user.email", "peer@example.invalid")
    (peer / message.replace(" ", "-")).write_text(message)
    git(peer, "add", message.replace(" ", "-"))
    git(peer, "commit", "-m", message)
    git(peer, "push", "origin", "main")


def run_launcher(repo: Path, primary: Path) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["OPERATOROS_PRIMARY_CHECKOUT_PATH"] = str(primary)
    env["OPERATOROS_RUNTIME_DIR"] = str(repo / ".runtime-test")
    env["OPERATOROS_DATA_DIR"] = str(repo / "data-test")
    return subprocess.run([str(repo / "start-dev.sh"), "--check"], cwd=repo, env=env, text=True, capture_output=True, timeout=30)


def test_primary_up_to_date_proceeds_to_environment_check(tmp_path: Path):
    repo = create_repo(tmp_path)
    result = run_launcher(repo, repo)
    assert result.returncode == 2
    assert "Checking environment..." in result.stdout
    assert "PRIMARY_CHECKOUT_" not in result.stdout
    assert "Worktree role PRIMARY" in result.stdout


def test_primary_clean_behind_fast_forwards(tmp_path: Path):
    repo = create_repo(tmp_path)
    push_remote_commit(repo, tmp_path, "remote update")
    before = git(repo, "rev-parse", "HEAD")
    result = run_launcher(repo, repo)
    after = git(repo, "rev-parse", "HEAD")
    assert result.returncode == 2
    assert before != after
    assert after == git(repo, "rev-parse", "origin/main")
    assert "PRIMARY_CHECKOUT_BEHIND" not in result.stdout
    assert "Freshness   FAST_FORWARDED" in result.stdout


def test_primary_behind_dirty_refuses_and_lists_paths(tmp_path: Path):
    repo = create_repo(tmp_path)
    push_remote_commit(repo, tmp_path, "remote update")
    (repo / "local-change.txt").write_text("keep")
    before = git(repo, "rev-parse", "HEAD")
    result = run_launcher(repo, repo)
    assert result.returncode == 2
    assert "PRIMARY_CHECKOUT_BEHIND_AND_DIRTY" in result.stdout
    assert "local-change.txt" in result.stdout
    assert git(repo, "rev-parse", "HEAD") == before


def test_primary_diverged_lists_local_only_commits_without_reset_guidance(tmp_path: Path):
    repo = create_repo(tmp_path)
    (repo / "local-only").write_text("local")
    git(repo, "add", "local-only")
    git(repo, "commit", "-m", "local only")
    push_remote_commit(repo, tmp_path, "remote update")
    result = run_launcher(repo, repo)
    output = result.stdout + result.stderr
    assert result.returncode == 2
    assert "PRIMARY_CHECKOUT_DIVERGED" in output
    assert "local only" in output
    assert "force-push" not in output.lower()
    assert "git reset" not in output.lower()


def test_secondary_is_exempt_and_reports_na(tmp_path: Path):
    primary = create_repo(tmp_path)
    secondary = tmp_path / "secondary"
    git(primary, "worktree", "add", str(secondary), "-b", "task")
    shutil.copy(ROOT / "start-dev.sh", secondary / "start-dev.sh")
    shutil.copy(ROOT / "scripts/operatoros_dev_config.py", secondary / "scripts/operatoros_dev_config.py")
    result = run_launcher(secondary, primary)
    assert result.returncode == 2
    assert "Worktree role SECONDARY" in result.stdout
    assert "Freshness   N/A (secondary)" in result.stdout


def test_primary_detached_refuses_to_start(tmp_path: Path):
    repo = create_repo(tmp_path)
    git(repo, "checkout", "--detach", "HEAD")
    result = run_launcher(repo, repo)
    assert result.returncode == 2
    assert "PRIMARY_CHECKOUT_UNEXPECTED_BRANCH" in result.stdout
    assert "No branch switch was attempted" in result.stdout


def session_record(repo: Path, session_id: str, worktree: Path, pid: int, start_ticks: str = "1", port: int = 5173) -> Path:
    entry = runtime.shared_registry_dir(repo) / session_id
    entry.mkdir(parents=True, exist_ok=True)
    common = runtime.git_common_dir(repo)
    session = {
        "session_id": session_id,
        "repoCommonDir": str(common),
        "worktreePath": str(worktree),
        "worktreeRole": "PRIMARY" if worktree == repo else "SECONDARY",
        "branch": "main",
        "commit": "abc123",
        "pid": pid,
        "ports": {"frontend": port, "backend": 8000},
        "startedAt": "2026-09-06T00:00:00+00:00",
        "status": "ready",
    }
    (entry / "session.json").write_text(json.dumps(session))
    (entry / "ownership.json").write_text(json.dumps({"application": "OperatorOS", "session_id": session_id}))
    (entry / "frontend.pid").write_text(json.dumps({"pid": pid, "role": "frontend", "port": port, "start_ticks": start_ticks}))
    return entry


def test_shared_registry_identifies_other_worktree_active_session(tmp_path: Path, monkeypatch, capsys):
    repo = create_repo(tmp_path)
    other = tmp_path / "other"
    git(repo, "worktree", "add", str(other), "-b", "task")
    entry = session_record(repo, "other-session", other, 4321)
    monkeypatch.setattr(runtime, "listener_pids", lambda port: [4321])
    monkeypatch.setattr(runtime, "process_info", lambda pid: {"pid": pid, "pgid": pid, "start_ticks": "1", "state": "S", "uid": os.getuid(), "cwd": str(other / "apps/web"), "argv": ["vite"], "command": "vite"})
    result = runtime.classify(tmp_path / "runtime", repo, 5173)[0]
    assert result["ownership_decision"] == "OTHER_WORKTREE_ACTIVE_SESSION"
    assert result["candidate_repository"] == str(other.resolve())
    assert result["candidate_branch"] == "task"
    runtime.print_port_conflict(result, repo)
    assert str(other.resolve()) in capsys.readouterr().out
    assert entry.exists()


def test_same_worktree_second_invocation_reports_existing_session(tmp_path: Path, monkeypatch, capsys):
    repo = create_repo(tmp_path)
    entry = session_record(repo, "same-session", repo, 4321)
    (entry / "backend.pid").write_text(json.dumps({"pid": 4321, "role": "backend", "port": 8000, "start_ticks": "1"}))
    monkeypatch.setattr(runtime, "process_info", lambda pid: {"pid": pid, "pgid": pid, "start_ticks": "1", "state": "S", "uid": os.getuid(), "cwd": str(repo / "apps/web"), "argv": ["vite"], "command": "vite"})
    args = argparse.Namespace(runtime=str(tmp_path / "runtime"), repo=str(repo))
    assert runtime.require_no_active_session(args) == 3
    assert capsys.readouterr().out.strip() == "same-session"
    status_args = argparse.Namespace(runtime=str(tmp_path / "runtime"), repo=str(repo), human=True, verbose=False)
    assert runtime.status_command(status_args) == 0
    output = capsys.readouterr().out
    assert "OperatorOS is already running from this checkout." in output
    assert "Session   same-session" in output


def test_init_session_mirrors_worktree_identity_to_shared_registry(tmp_path: Path):
    repo = create_repo(tmp_path)
    runtime_dir = tmp_path / "runtime"
    arguments = argparse.Namespace(
        runtime=str(runtime_dir), repo=str(repo), session="metadata-session", mode="browser", token="session-token",
        javascript_runtime="bun", javascript_runtime_version="1.4.0", backend_runtime="elysia", launcher_pid=os.getpid(),
        frontend_host="127.0.0.1", frontend_port=5173, backend_host="127.0.0.1", backend_port=8000,
        database_path=str(tmp_path / "data" / "operatoros.sqlite"),
    )
    assert runtime.init_session(arguments) == 0
    shared = runtime.shared_registry_dir(repo) / "metadata-session" / "session.json"
    value = json.loads(shared.read_text())
    assert value["repoCommonDir"] == str(runtime.git_common_dir(repo))
    assert value["worktreePath"] == str(repo.resolve())
    assert value["worktreeRole"] == "SECONDARY"
    assert value["branch"] == "main"
    assert value["commit"] == git(repo, "rev-parse", "HEAD")
    assert value["pids"]["launcher"] == os.getpid()
    assert value["ports"] == {"frontend": 5173, "backend": 8000}


def test_same_worktree_dead_session_is_cleaned_without_signal(tmp_path: Path, monkeypatch):
    repo = create_repo(tmp_path)
    entry = session_record(repo, "stale-session", repo, 4321, port=5197)
    monkeypatch.setattr(runtime, "listener_pids", lambda port: [4321])
    monkeypatch.setattr(runtime, "process_info", lambda pid: None)
    monkeypatch.setattr(runtime, "stop_pid", lambda *args: (_ for _ in ()).throw(AssertionError("unverified process was signaled")))
    result = runtime.classify(tmp_path / "runtime", repo, 5197)[0]
    assert result["ownership_decision"] == "SAME_WORKTREE_STALE_SESSION"
    cleanup = runtime.cleanup_port(argparse.Namespace(runtime=tmp_path / "runtime", repo=repo, port=5197, host="127.0.0.1", timeout=0.1))
    assert cleanup == 0
    assert not (entry / "frontend.pid").exists()


def test_removed_worktree_registry_entry_is_pruned_without_signal(tmp_path: Path, monkeypatch):
    repo = create_repo(tmp_path)
    other = tmp_path / "removed"
    git(repo, "worktree", "add", str(other), "-b", "task")
    entry = session_record(repo, "removed-session", other, 4321)
    git(repo, "worktree", "remove", str(other))
    monkeypatch.setattr(runtime, "stop_pid", lambda *args: (_ for _ in ()).throw(AssertionError("stale registry was signaled")))
    assert runtime.prune_stale_registry(repo) == 1
    assert not entry.exists()


def test_finalize_cannot_remove_sibling_registry_entry(tmp_path: Path):
    repo = create_repo(tmp_path)
    other = tmp_path / "other"
    git(repo, "worktree", "add", str(other), "-b", "task")
    entry = session_record(repo, "sibling-session", other, 4321)
    args = argparse.Namespace(runtime=str(tmp_path / "runtime"), repo=str(repo), session="sibling-session")
    assert runtime.finalize_session(args) == 0
    assert entry.exists()


def test_stop_session_mirrors_stopped_state_to_shared_registry(tmp_path: Path, monkeypatch):
    repo = create_repo(tmp_path)
    runtime_dir = tmp_path / "runtime"
    local = runtime_dir / "sessions" / "stop-session"
    local.mkdir(parents=True)
    entry = session_record(repo, "stop-session", repo, 4321)
    session = json.loads((entry / "session.json").read_text())
    (local / "session.json").write_text(json.dumps(session))
    (local / "ownership.json").write_text(json.dumps({"application": "OperatorOS", "session_id": "stop-session"}))
    record = {"pid": 4321, "role": "frontend", "port": 5173, "start_ticks": "1"}
    (local / "frontend.pid").write_text(json.dumps(record))
    (entry / "frontend.pid").write_text(json.dumps(record))
    process = {"pid": 4321, "pgid": 4321, "start_ticks": "1", "state": "S", "uid": os.getuid(), "cwd": str(repo / "apps/web"), "command": "vite"}
    monkeypatch.setattr(runtime, "process_info", lambda pid: process)
    monkeypatch.setattr(runtime, "stop_pid", lambda *args: None)
    monkeypatch.setattr(runtime, "group_alive", lambda pid: False)
    assert runtime.stop_session(runtime_dir, repo, "stop-session", 0.1)
    assert json.loads((entry / "session.json").read_text())["status"] == "stopped"
    assert not (entry / "frontend.pid").exists()


def test_branch_and_worktree_cleanup_guards(tmp_path: Path):
    repo = create_repo(tmp_path)
    other = tmp_path / "other"
    git(repo, "worktree", "add", str(other), "-b", "task")
    (other / "dirty.txt").write_text("dirty")
    git(other, "config", "user.name", "Test")
    git(other, "config", "user.email", "test@example.invalid")
    dirty = subprocess.run([sys.executable, str(SAFETY_PATH), "remove-worktree", "--repo", str(repo), "--path", str(other)], text=True, capture_output=True)
    assert dirty.returncode == 2
    assert "WORKTREE_REMOVE_DIRTY" in dirty.stdout
    git(other, "add", "dirty.txt")
    git(other, "commit", "-m", "unmerged task")
    unmerged = subprocess.run([sys.executable, str(SAFETY_PATH), "delete-branch", "--repo", str(repo), "--branch", "task"], text=True, capture_output=True)
    assert unmerged.returncode == 2
    assert "BRANCH_DELETE_WITHOUT_MERGE_BASE_CHECK" in unmerged.stdout
    assert subprocess.run([sys.executable, str(SAFETY_PATH), "remove-worktree", "--repo", str(repo), "--path", str(other)], check=False).returncode == 0
