#!/usr/bin/env python3
"""Repository-scoped OperatorOS development process and runtime-state manager."""

from __future__ import annotations

import argparse
import json
import os
import signal
import shutil
import shlex
import socket
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path


def atomic_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def contained(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def proc_value(pid: int, name: str) -> str | None:
    try:
        return (Path("/proc") / str(pid) / name).read_text(encoding="utf-8", errors="replace")
    except (OSError, ValueError):
        return None


def process_info(pid: int) -> dict | None:
    stat = proc_value(pid, "stat")
    if stat is None:
        return None
    try:
        closing = stat.rfind(")")
        fields = stat[closing + 2 :].split()
        state = fields[0]
        start_ticks = fields[19]
        parent_pid = int(fields[1])
        process_group = int(fields[2])
        cwd = str((Path("/proc") / str(pid) / "cwd").resolve(strict=True))
        argv = (Path("/proc") / str(pid) / "cmdline").read_bytes().decode(errors="replace").rstrip("\0").split("\0")
        command = " ".join(argv)
        user = (Path("/proc") / str(pid)).stat().st_uid
        return {"pid": pid, "parent_pid": parent_pid, "pgid": process_group, "start_ticks": start_ticks, "cwd": cwd, "command": command, "argv": argv, "uid": user, "state": state}
    except (OSError, IndexError, ValueError):
        return None


def git_output(candidate: Path, *arguments: str) -> str | None:
    try:
        result = subprocess.run(["git", "-C", str(candidate), *arguments], capture_output=True, text=True, timeout=2)
        return result.stdout.strip() if result.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired):
        return None


def git_toplevel(candidate: Path) -> Path | None:
    value = git_output(candidate, "rev-parse", "--show-toplevel")
    return Path(value).resolve() if value else None


def git_common_dir(candidate: Path) -> Path | None:
    value = git_output(candidate, "rev-parse", "--path-format=absolute", "--git-common-dir")
    return Path(value).resolve() if value else None


def is_operatoros_checkout(candidate: Path) -> bool:
    try:
        return all(json.loads((candidate / f"apps/{app}/package.json").read_text()).get("name") == f"@operatoros/{app}" for app in ("api", "web"))
    except (OSError, ValueError, AttributeError):
        return False


def checkout_identity(candidate: Path) -> dict | None:
    repo = git_toplevel(candidate)
    if repo is None:
        return None
    common = git_common_dir(repo)
    commit = git_output(repo, "rev-parse", "HEAD") or "unknown"
    upstream = git_output(repo, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
    counts = git_output(repo, "rev-list", "--left-right", "--count", "HEAD...@{u}") if upstream else None
    changes = git_output(repo, "status", "--porcelain", "--untracked-files=normal")
    return {
        "repository": str(repo), "common_dir": str(common) if common else None,
        "branch": git_output(repo, "branch", "--show-current") or "detached",
        "commit": commit[:12], "commit_full": commit, "upstream": upstream,
        "status": "unknown" if changes is None else "dirty" if changes else "clean",
        "ahead": int(counts.split()[0]) if counts else None,
        "behind": int(counts.split()[1]) if counts else None,
    }


def detect_cross_worktree(current_repo: Path, info: dict) -> dict:
    # Discovery is informational. Only durable PID records authorize cleanup.
    cwd, command = info.get("cwd"), info.get("command")
    if not cwd or not command or info.get("uid") != os.getuid():
        return {"decision": "UNKNOWN_OWNER"}
    candidate = git_toplevel(Path(cwd))
    if candidate is None or not is_operatoros_checkout(candidate):
        return {"decision": "NON_OPERATOROS"}
    try:
        words = info.get("argv") or shlex.split(command)
    except ValueError:
        return {"decision": "UNKNOWN_OWNER"}
    service = None
    if contained(Path(cwd).resolve(), candidate / "apps/web") and any(Path(word).name in ("vite", "vite.js") for word in words):
        service = "frontend"
    elif contained(Path(cwd).resolve(), candidate / "apps/api") and any((Path(cwd) / word).resolve() == candidate / "apps/api/src/server.ts" for word in words):
        service = "backend"
    if service is None:
        return {"decision": "NON_OPERATOROS"}
    identity = checkout_identity(candidate)
    current_common = git_common_dir(current_repo)
    candidate_common = git_common_dir(candidate)
    if not identity or not current_common or not candidate_common:
        return {"decision": "UNKNOWN_OWNER"}
    decision = "OPERATOROS_OTHER_CHECKOUT"
    if candidate == current_repo.resolve():
        decision = "OPERATOROS_CURRENT_CHECKOUT"
    elif current_common == candidate_common:
        decision = "OPERATOROS_OTHER_WORKTREE"
    return {
        "decision": decision, "candidate_repository": str(candidate),
        "candidate_common": str(candidate_common), "current_common": str(current_common),
        "candidate_branch": identity["branch"], "candidate_commit": identity["commit"],
        "service": service,
    }


def listener_pids(port: int) -> list[int]:
    commands = (["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-t"], ["fuser", f"{port}/tcp"])
    for command in commands:
        try:
            result = subprocess.run(command, text=True, capture_output=True, check=False)
        except FileNotFoundError:
            continue
        text = f"{result.stdout} {result.stderr}"
        pids = sorted({int(word) for word in text.split() if word.isdigit()})
        if pids:
            return pids
    return []


def is_free(host: str, port: int) -> bool:
    family = socket.AF_INET6 if ":" in host else socket.AF_INET
    try:
        with socket.socket(family, socket.SOCK_STREAM) as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            probe.bind((host, port))
        return True
    except OSError:
        return False


def records(runtime: Path) -> list[tuple[Path, dict]]:
    found = []
    for path in (runtime / "sessions").glob("*/session.json"):
        try:
            found.append((path.parent, json.loads(path.read_text(encoding="utf-8"))))
        except (OSError, json.JSONDecodeError):
            continue
    return found


def valid_record(record: dict, repo: Path, role: str | None = None) -> tuple[bool, dict | None]:
    if role and record.get("role") != role:
        return False, None
    try:
        pid = int(record["pid"])
    except (KeyError, TypeError, ValueError):
        return False, None
    info = process_info(pid)
    if not info or str(record.get("start_ticks")) != info["start_ticks"]:
        return False, info
    if info.get("state", "").startswith("Z"):
        return False, info
    repo_text = str(repo.resolve())
    owned = info["cwd"] == repo_text or info["cwd"].startswith(repo_text + os.sep) or repo_text in info["command"]
    same_user = info["uid"] == os.getuid()
    # PID/start-time validation plus same-user repository ownership is a strong
    # condition. The token remains audit metadata but may disappear after exec.
    return bool(same_user and owned), info


def classify(runtime: Path, repo: Path, port: int, verbose: bool = False) -> list[dict]:
    classifications = []
    pids = listener_pids(port)
    for pid in pids:
        info = process_info(pid) or {"pid": pid}
        decision = "UNKNOWN_OWNER"
        matched_session = None
        matched_role = None
        for session_dir, session in records(runtime):
            for role in ("frontend", "backend"):
                record_path = session_dir / f"{role}.pid"
                try:
                    record = json.loads(record_path.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    continue
                valid, _ = valid_record(record, repo, role)
                if valid and int(record["pid"]) == pid and int(record.get("port", -1)) == port:
                    launcher = session_dir / "launcher.pid"
                    try:
                        launcher_record = json.loads(launcher.read_text(encoding="utf-8"))
                        launcher_valid, _ = valid_record(launcher_record, repo, "launcher")
                    except (OSError, json.JSONDecodeError):
                        launcher_valid = False
                    decision = "OPERATOROS_ACTIVE" if launcher_valid else "OPERATOROS_STALE"
                    matched_session = session.get("session_id")
                    matched_role = role
                    break
            if decision != "UNKNOWN_OWNER":
                break
        # If still unknown, attempt cross-worktree detection
        extra = {}
        if decision == "UNKNOWN_OWNER":
            # Only attempt cross-worktree if we have process info
            if info.get("cwd") or info.get("command"):
                cross = detect_cross_worktree(repo, info)
                if cross.get("decision") != "UNKNOWN_OWNER":
                    decision = cross["decision"]
                    extra = {k: v for k, v in cross.items() if k != "decision"}
                    # infer role from cross if not already
                    if not matched_role and extra.get("service") in ("frontend", "backend"):
                        matched_role = extra["service"]
        info.update({"port": port, "listening_address": f"127.0.0.1:{port}", "ownership_decision": decision, "session_id": matched_session, "role": matched_role})
        if extra:
            info.update(extra)
        info.pop("command", None)
        info.pop("argv", None)
        classifications.append(info)
    if not pids and not is_free("127.0.0.1", port):
        classifications.append({"port": port, "ownership_decision": "UNKNOWN_OWNER", "reason": "listener PID unavailable"})
    return classifications


def wait_dead(pid: int, seconds: float) -> bool:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        info = process_info(pid)
        if info is None or info.get("state", "").startswith("Z"):
            return True
        time.sleep(0.1)
    info = process_info(pid)
    return info is None or info.get("state", "").startswith("Z")


def process_alive(pid: int) -> bool:
    info = process_info(pid)
    return bool(info and not info.get("state", "").startswith("Z"))


def group_alive(pgid: int) -> bool:
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        info = process_info(int(entry.name))
        if info and info.get("pgid") == pgid and not info.get("state", "").startswith("Z"):
            return True
    return False


def stop_pid(pid: int, timeout: float, label: str) -> None:
    for sig, name in ((signal.SIGINT, "SIGINT"), (signal.SIGTERM, "SIGTERM")):
        try:
            os.killpg(pid, sig)
        except ProcessLookupError:
            return
        except PermissionError as error:
            raise RuntimeError(f"cannot signal owned {label} PID {pid}: {error}") from error
        print(f"[cleanup] Sent {name} to {label} PID {pid}")
        if wait_dead(pid, timeout):
            return
    os.killpg(pid, signal.SIGKILL)
    print(f"[cleanup] Sent SIGKILL to positively identified stale {label} PID {pid}")
    wait_dead(pid, timeout)


def stop_owned_session(args: argparse.Namespace) -> int:
    """Stop all verified child groups against one shared monotonic deadline."""
    runtime, repo = Path(args.runtime).resolve(), Path(args.repo).resolve()
    directory = (runtime / "sessions" / args.session).resolve(strict=True)
    if directory.parent != runtime / "sessions" or directory.name != args.session or directory.is_symlink():
        raise RuntimeError("SESSION_PATH_ESCAPE_REJECTED")
    ownership = json.loads((directory / "ownership.json").read_text(encoding="utf-8"))
    if ownership.get("application") != "OperatorOS" or ownership.get("session_id") != args.session:
        raise RuntimeError("SESSION_OWNERSHIP_UNVERIFIED")
    owned: list[tuple[str, int]] = []
    for role in ("frontend", "backend"):
        path = directory / f"{role}.pid"
        try:
            record = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        valid, _ = valid_record(record, repo, role)
        if valid:
            owned.append((role, int(record["pid"])))

    # A signal can arrive after a child is spawned but before its durable PID
    # record is written. Accept only launcher-supplied fallback PIDs whose live
    # identity independently proves ownership, using this same shared deadline.
    session = json.loads((directory / "session.json").read_text(encoding="utf-8"))
    fallback = (("frontend", args.frontend_pid), ("backend", args.backend_pid))
    for role, raw_pid in fallback:
        if raw_pid is None:
            continue
        pid = int(raw_pid)
        if any(existing_pid == pid for _, existing_pid in owned):
            continue
        info = process_info(pid)
        role_root = repo / role
        role_command = "vite"
        if role == "backend":
            role_root = repo / "apps/api"
            role_command = "server.ts"
        if (
            info
            and info["uid"] == os.getuid()
            and (info["cwd"] == str(role_root) or info["cwd"].startswith(str(role_root) + os.sep))
            and role_command in info["command"]
            and str(repo) in info["command"]
        ):
            owned.append((role, pid))

    deadline = time.monotonic() + max(0.1, float(args.timeout))
    phase = max(0.1, float(args.timeout) / 3.0)
    for role, pid in owned:
        try:
            os.killpg(pid, signal.SIGINT)
            print(f"[cleanup] Sent SIGINT to {role} group {pid}")
        except ProcessLookupError:
            pass
    survivors = {pid for _, pid in owned}
    phase_deadline = min(deadline, time.monotonic() + phase)
    while survivors and time.monotonic() < phase_deadline:
        survivors = {pid for pid in survivors if group_alive(pid)}
        if survivors:
            time.sleep(0.1)
    for role, pid in owned:
        if pid in survivors:
            try:
                os.killpg(pid, signal.SIGTERM)
                print(f"[cleanup] Sent SIGTERM to {role} group {pid}")
            except ProcessLookupError:
                survivors.discard(pid)
    phase_deadline = min(deadline, time.monotonic() + phase)
    while survivors and time.monotonic() < phase_deadline:
        survivors = {pid for pid in survivors if group_alive(pid)}
        if survivors:
            time.sleep(0.1)
    for role, pid in owned:
        if pid in survivors:
            try:
                os.killpg(pid, signal.SIGKILL)
                print(f"[cleanup] Sent SIGKILL to verified {role} group {pid}")
            except ProcessLookupError:
                pass
    while survivors and time.monotonic() < deadline:
        survivors = {pid for pid in survivors if group_alive(pid)}
        if survivors:
            time.sleep(0.05)
    final = {pid for _, pid in owned if group_alive(pid)}
    if getattr(args, "human", False):
        print(f"[cleanup] Owned groups: {len(owned)}; remaining: {len(final)}")
    else:
        print(json.dumps({"session": args.session, "owned_groups": len(owned), "remaining_groups": len(final), "deadline_seconds": float(args.timeout)}, sort_keys=True))
    return 0 if not final else 3


def print_port_conflict(item: dict, repo: Path, verbose: bool = False) -> None:
    decision, port = item["ownership_decision"], item["port"]
    if decision in ("OPERATOROS_OTHER_WORKTREE", "OPERATOROS_OTHER_CHECKOUT", "OPERATOROS_CURRENT_CHECKOUT"):
        label = {"OPERATOROS_OTHER_WORKTREE": "Another OperatorOS worktree", "OPERATOROS_OTHER_CHECKOUT": "Another OperatorOS repository", "OPERATOROS_CURRENT_CHECKOUT": "An OperatorOS process from this checkout"}[decision]
        print(f"{label} is already using port {port}.")
        print("\nRunning checkout:")
        for key, title in (("candidate_repository", "Repository"), ("candidate_branch", "Branch"), ("candidate_commit", "Git commit")):
            print(f"  {title:12}{item[key]}")
        requested = checkout_identity(repo) or {"repository": str(repo), "branch": "unknown", "commit": "unknown"}
        print("\nRequested checkout:")
        for key, title in (("repository", "Repository"), ("branch", "Branch"), ("commit", "Git commit")):
            print(f"  {title:12}{requested[key]}")
        print("\nTo use this checkout:\n  ./start-dev.sh --auto-port")
        print(f"\nTo stop the running checkout's managed session:\n  cd {shlex.quote(item['candidate_repository'])}\n  ./stop-dev.sh")
    elif decision == "NON_OPERATOROS":
        print(f"Port {port} is in use by a non-OperatorOS process.")
    elif decision == "OPERATOROS_ACTIVE":
        print(f"OperatorOS is already running from this checkout on port {port}.")
    else:
        print(f"Port {port} has an unverifiable or protected listener ({decision}).")
    if item.get("pid"):
        print(f"PID: {item['pid']}")
    print("No process was terminated.")
    if verbose:
        print(json.dumps(item, sort_keys=True))


def cleanup_port(args: argparse.Namespace) -> int:
    runtime, repo = Path(args.runtime).resolve(), Path(args.repo).resolve()
    decisions = classify(runtime, repo, args.port)
    if not decisions and is_free(args.host, args.port):
        return 0
    blocked = [item for item in decisions if item["ownership_decision"] != "OPERATOROS_STALE" or getattr(args, "no_clean", False)]
    for item in blocked:
        if getattr(args, "human", False):
            print_port_conflict(item, repo, getattr(args, "verbose", False))
        else:
            print(json.dumps(item, sort_keys=True))
    if blocked:
        return 3
    for item in decisions:
        # Revalidate immediately before signaling, including PID reuse and PGID.
        fresh = classify(runtime, repo, args.port)
        if not any(other.get("pid") == item["pid"] and other.get("start_ticks") == item.get("start_ticks") and other.get("pgid") == item["pid"] and other["ownership_decision"] == "OPERATOROS_STALE" for other in fresh):
            print("[blocked] Process ownership changed; no signal sent")
            return 3
        stop_pid(int(item["pid"]), args.timeout, "OperatorOS")
    if not is_free(args.host, args.port):
        print(f"[blocked] Port {args.port} did not release")
        return 3
    print(f"[cleanup] Port {args.port} released")
    return 0


def allocate(args: argparse.Namespace) -> int:
    candidates = range(args.preferred, args.maximum + 1) if args.auto else (args.preferred,)
    for port in candidates:
        if is_free(args.host, port):
            print(port)
            return 0
    print(f"no free port in {args.preferred}-{args.maximum}", file=sys.stderr)
    return 4


def write_record(path: Path, pid: int, role: str, repo: Path, token: str, **extra: object) -> None:
    info = process_info(pid)
    if info is None:
        raise RuntimeError(f"PID {pid} is not running")
    atomic_json(path, {"pid": pid, "role": role, "start_ticks": info["start_ticks"], "recorded_at": now(), "token": token, **extra})


def init_session(args: argparse.Namespace) -> int:
    runtime, repo = Path(args.runtime).resolve(), Path(args.repo).resolve()
    session_dir = runtime / "sessions" / args.session
    session_dir.mkdir(parents=True, exist_ok=False)
    common = {
        "session_id": args.session,
        "backend_runtime": args.backend_runtime,
        "frontend_port": args.frontend_port,
        "backend_port": args.backend_port,
        "frontend_url": f"http://{args.frontend_host}:{args.frontend_port}",
        "backend_url": f"http://{args.backend_host}:{args.backend_port}",
        "started_at": now(),
        "launcher": "wsl",
        "mode": args.mode,
        "javascript_runtime": args.javascript_runtime,
        "javascript_runtime_version": args.javascript_runtime_version,
        "database_path": str(Path(args.database_path).resolve()),
        "status": "starting",
    }
    atomic_json(session_dir / "session.json", common)
    atomic_json(session_dir / "ownership.json", {"application": "OperatorOS", "session_id": args.session, "format_version": 1})
    atomic_json(session_dir / "ports.json", common)
    atomic_json(runtime / "ports.json", common)
    write_record(session_dir / "launcher.pid", args.launcher_pid, "launcher", repo, args.token, session_id=args.session)
    (runtime / "active-session").write_text(args.session + "\n", encoding="utf-8")
    print(session_dir)
    return 0


def finalize_session(args: argparse.Namespace) -> int:
    """Remove one exact, stopped owned session directory; never its database path."""
    runtime, repo = Path(args.runtime).resolve(), Path(args.repo).resolve()
    sessions = runtime / "sessions"
    directory = (sessions / args.session).resolve(strict=False)
    if directory.parent != runtime / "sessions" or directory.name != args.session or directory.is_symlink():
        raise RuntimeError("SESSION_PATH_ESCAPE_REJECTED")
    if not directory.exists():
        return 0
    ownership_path = directory / "ownership.json"
    try:
        ownership = json.loads(ownership_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise RuntimeError("CORRUPT_OWNERSHIP_MARKER") from None
    if ownership.get("application") != "OperatorOS" or ownership.get("session_id") != args.session:
        raise RuntimeError("CORRUPT_OWNERSHIP_MARKER")
    for role in ("backend", "frontend"):
        path = directory / f"{role}.pid"
        if path.exists():
            record = json.loads(path.read_text(encoding="utf-8"))
            valid, info = valid_record(record, repo, role)
            if valid:
                raise RuntimeError(f"ACTIVE_OWNED_SESSION:{role}")
    try:
        session = json.loads((directory / "session.json").read_text(encoding="utf-8"))
    except FileNotFoundError:
        return 0
    database = Path(session.get("database_path", "")).resolve(strict=False)
    if contained(database, directory):
        raise RuntimeError("SESSION_DATABASE_OWNERSHIP_FORBIDDEN")
    shutil.rmtree(directory)
    active = runtime / "active-session"
    if active.exists() and active.read_text(encoding="utf-8").strip() == args.session:
        active.unlink()
    ports = runtime / "ports.json"
    if ports.exists():
        try:
            if json.loads(ports.read_text(encoding="utf-8")).get("session_id") == args.session:
                ports.unlink()
        except json.JSONDecodeError:
            pass
    return 0


def require_no_active_session(args: argparse.Namespace) -> int:
    runtime, repo = Path(args.runtime).resolve(), Path(args.repo).resolve()
    active = runtime / "active-session"
    if not active.exists():
        return 0
    session_id = active.read_text(encoding="utf-8").strip()
    directory = runtime / "sessions" / session_id
    if not session_id or not directory.is_dir():
        raise RuntimeError("STALE_SESSION_UNVERIFIED")
    for role in ("backend", "frontend"):
        path = directory / f"{role}.pid"
        try:
            valid, _ = valid_record(json.loads(path.read_text(encoding="utf-8")), repo, role)
        except (OSError, json.JSONDecodeError):
            valid = False
        if valid:
            print(session_id)
            return 3
    # Only a current-format owned stale session is eligible for automatic cleanup.
    try:
        finalize_session(argparse.Namespace(runtime=str(runtime), repo=str(repo), session=session_id))
    except (OSError, ValueError, json.JSONDecodeError, RuntimeError):
        raise RuntimeError("STALE_SESSION_UNVERIFIED")
    return 0


def status_command(args: argparse.Namespace) -> int:
    """Print a sanitized, read-only active-session classification."""
    runtime, repo = Path(args.runtime).resolve(), Path(args.repo).resolve()
    active = runtime / "active-session"
    if not active.exists():
        print("NO_ACTIVE_SESSION" if getattr(args, "human", False) else json.dumps({"state": "NO_ACTIVE_SESSION"}, sort_keys=True))
        return 0
    try:
        session_id = active.read_text(encoding="utf-8").strip()
        directory = runtime / "sessions" / session_id
        ownership = json.loads((directory / "ownership.json").read_text(encoding="utf-8"))
        if not session_id or not directory.is_dir() or ownership.get("application") != "OperatorOS" or ownership.get("session_id") != session_id:
            raise RuntimeError("unverified")
    except (OSError, json.JSONDecodeError, RuntimeError):
        print("STALE_SESSION_UNVERIFIED" if getattr(args, "human", False) else json.dumps({"state": "STALE_SESSION_UNVERIFIED"}, sort_keys=True))
        return 0
    for role in ("backend", "frontend"):
        try:
            valid, _ = valid_record(json.loads((directory / f"{role}.pid").read_text(encoding="utf-8")), repo, role)
        except (OSError, json.JSONDecodeError):
            valid = False
        if valid:
            if getattr(args, "human", False):
                session = json.loads((directory / "session.json").read_text())
                print("OperatorOS is already running from this checkout.\n")
                for key, title in (("frontend_url", "Frontend"), ("backend_url", "Backend"), ("session_id", "Session"), ("database_path", "Database")):
                    print(f"{title:10}{session.get(key, 'unknown')}")
                print("\nRun ./stop-dev.sh from this checkout to stop it.")
                if getattr(args, "verbose", False):
                    print(json.dumps({"state": "ACTIVE_VERIFIED", "role": role}, sort_keys=True))
            else:
                print(json.dumps({"state": "ACTIVE_VERIFIED"}, sort_keys=True))
            return 0
    print("STALE_VERIFIED" if getattr(args, "human", False) else json.dumps({"state": "STALE_VERIFIED"}, sort_keys=True))
    return 0


def register(args: argparse.Namespace) -> int:
    session_dir = Path(args.runtime).resolve() / "sessions" / args.session
    try:
        write_record(session_dir / f"{args.role}.pid", args.pid, args.role, Path(args.repo).resolve(), args.token, session_id=args.session, port=args.port)
    except RuntimeError:
        # The launcher readiness check owns failure attribution when a child
        # exits in the narrow interval between fork and state registration.
        return 0
    return 0


def mark(args: argparse.Namespace) -> int:
    runtime = Path(args.runtime).resolve()
    path = runtime / "sessions" / args.session / "session.json"
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return 0
    value["status"] = args.status
    value[f"{args.status}_at"] = now()
    atomic_json(path, value)
    current_ports = runtime / "ports.json"
    try:
        ports = json.loads(current_ports.read_text(encoding="utf-8"))
        if ports.get("session_id") == args.session:
            ports["status"] = args.status
            ports[f"{args.status}_at"] = value[f"{args.status}_at"]
            atomic_json(current_ports, ports)
    except (OSError, json.JSONDecodeError):
        pass
    return 0


def stop_session(runtime: Path, repo: Path, session_id: str, timeout: float) -> bool:
    directory = runtime / "sessions" / session_id
    stopped = False
    for role in ("frontend", "backend"):
        path = directory / f"{role}.pid"
        try:
            record = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        valid, _ = valid_record(record, repo, role)
        if not valid:
            print(f"[blocked] Refusing to stop unverified {role} PID record")
            continue
        stop_pid(int(record["pid"]), timeout, role)
        stopped = True
    session_path = directory / "session.json"
    if session_path.exists():
        value = json.loads(session_path.read_text(encoding="utf-8"))
        value.update(status="stopped", stopped_at=now())
        atomic_json(session_path, value)
    return stopped


def stop_command(args: argparse.Namespace) -> int:
    runtime, repo = Path(args.runtime).resolve(), Path(args.repo).resolve()
    if args.all:
        session_ids = [path.parent.name for path in (runtime / "sessions").glob("*/session.json")]
    elif args.session:
        session_ids = [args.session]
    else:
        try:
            session_ids = [(runtime / "active-session").read_text(encoding="utf-8").strip()]
        except OSError:
            print("No active OperatorOS development session")
            return 0
    for session_id in session_ids:
        stop_session(runtime, repo, session_id, args.timeout)
    return 0


def checkout_identity_command(args: argparse.Namespace) -> int:
    repo = Path(args.repo).resolve()
    identity = checkout_identity(repo)
    if not identity:
        print(json.dumps({"error": "CHECKOUT_IDENTITY_UNAVAILABLE", "repository": str(repo)}, sort_keys=True))
        return 2
    # also include status if available
    print(json.dumps(identity, sort_keys=True))
    return 0


def classify_command(args: argparse.Namespace) -> int:
    runtime, repo = Path(args.runtime).resolve(), Path(args.repo).resolve()
    verbose = bool(getattr(args, "verbose", False))
    # single port classify
    result = classify(runtime, repo, args.port, verbose=verbose)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser()
    sub = root.add_subparsers(dest="command", required=True)
    cleanup = sub.add_parser("cleanup-port")
    cleanup.add_argument("--runtime", required=True); cleanup.add_argument("--repo", required=True)
    cleanup.add_argument("--host", default="127.0.0.1"); cleanup.add_argument("--port", type=int, required=True); cleanup.add_argument("--timeout", type=float, default=2)
    cleanup.add_argument("--verbose", action="store_true", help="Include detailed ownership evidence")
    cleanup.add_argument("--human", action="store_true")
    cleanup.add_argument("--no-clean", action="store_true")
    cleanup.set_defaults(func=cleanup_port)
    allocation = sub.add_parser("allocate")
    allocation.add_argument("--host", default="127.0.0.1"); allocation.add_argument("--preferred", type=int, required=True); allocation.add_argument("--maximum", type=int, required=True); allocation.add_argument("--auto", action="store_true")
    allocation.set_defaults(func=allocate)
    init = sub.add_parser("init-session")
    for name in ("runtime", "repo", "session", "mode", "token", "javascript-runtime", "javascript-runtime-version"):
        init.add_argument(f"--{name}", required=True)
    init.add_argument("--launcher-pid", type=int, required=True); init.add_argument("--frontend-host", required=True); init.add_argument("--backend-host", required=True); init.add_argument("--frontend-port", type=int, required=True); init.add_argument("--backend-port", type=int, required=True); init.add_argument("--backend-runtime", choices=("elysia",), default="elysia")
    init.add_argument("--database-path", required=True)
    init.set_defaults(func=init_session)
    registration = sub.add_parser("register")
    for name in ("runtime", "repo", "session", "role", "token"):
        registration.add_argument(f"--{name}", required=True)
    registration.add_argument("--pid", type=int, required=True); registration.add_argument("--port", type=int, required=True)
    registration.set_defaults(func=register)
    marker = sub.add_parser("mark")
    marker.add_argument("--runtime", required=True); marker.add_argument("--session", required=True); marker.add_argument("--status", required=True)
    marker.set_defaults(func=mark)
    finalize = sub.add_parser("finalize-session")
    finalize.add_argument("--runtime", required=True); finalize.add_argument("--repo", required=True); finalize.add_argument("--session", required=True)
    finalize.set_defaults(func=finalize_session)
    active = sub.add_parser("require-no-active-session")
    active.add_argument("--runtime", required=True); active.add_argument("--repo", required=True)
    active.set_defaults(func=require_no_active_session)
    status = sub.add_parser("status")
    status.add_argument("--runtime", required=True); status.add_argument("--repo", required=True)
    status.add_argument("--human", action="store_true")
    status.add_argument("--verbose", action="store_true")
    status.set_defaults(func=status_command)
    stop = sub.add_parser("stop")
    stop.add_argument("--runtime", required=True); stop.add_argument("--repo", required=True); stop.add_argument("--session"); stop.add_argument("--all", action="store_true"); stop.add_argument("--timeout", type=float, default=2)
    stop.set_defaults(func=stop_command)
    owned_stop = sub.add_parser("stop-owned-session")
    owned_stop.add_argument("--runtime", required=True); owned_stop.add_argument("--repo", required=True); owned_stop.add_argument("--session", required=True); owned_stop.add_argument("--timeout", type=float, default=10)
    owned_stop.add_argument("--frontend-pid", type=int)
    owned_stop.add_argument("--backend-pid", type=int)
    owned_stop.add_argument("--human", action="store_true")
    owned_stop.set_defaults(func=stop_owned_session)
    checkout = sub.add_parser("checkout-identity")
    checkout.add_argument("--repo", required=True)
    checkout.set_defaults(func=checkout_identity_command)
    classify_cmd = sub.add_parser("classify-port")
    classify_cmd.add_argument("--runtime", required=True); classify_cmd.add_argument("--repo", required=True); classify_cmd.add_argument("--port", type=int, required=True)
    classify_cmd.add_argument("--verbose", action="store_true")
    classify_cmd.set_defaults(func=classify_command)
    return root


if __name__ == "__main__":
    arguments = parser().parse_args()
    try:
        raise SystemExit(arguments.func(arguments))
    except RuntimeError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2) from error
