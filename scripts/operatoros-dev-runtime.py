#!/usr/bin/env python3
"""Repository-scoped OperatorOS development process and runtime-state manager."""

from __future__ import annotations

import argparse
import json
import os
import signal
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
        start_ticks = fields[19]
        parent_pid = int(fields[1])
        cwd = str((Path("/proc") / str(pid) / "cwd").resolve())
        command = (Path("/proc") / str(pid) / "cmdline").read_bytes().replace(b"\0", b" ").decode(errors="replace").strip()
        user = (Path("/proc") / str(pid)).stat().st_uid
        return {"pid": pid, "parent_pid": parent_pid, "start_ticks": start_ticks, "cwd": cwd, "command": command, "uid": user}
    except (OSError, IndexError, ValueError):
        return None


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
    repo_text = str(repo.resolve())
    owned = info["cwd"] == repo_text or info["cwd"].startswith(repo_text + os.sep) or repo_text in info["command"]
    same_user = info["uid"] == os.getuid()
    # PID/start-time validation plus same-user repository ownership is a strong
    # condition. The token remains audit metadata but may disappear after exec.
    return bool(same_user and owned), info


def classify(runtime: Path, repo: Path, port: int) -> list[dict]:
    classifications = []
    pids = listener_pids(port)
    for pid in pids:
        info = process_info(pid) or {"pid": pid}
        decision = "UNKNOWN_OWNER"
        matched_session = None
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
                    break
        info.update({"port": port, "listening_address": f"127.0.0.1:{port}", "ownership_decision": decision, "session_id": matched_session})
        classifications.append(info)
    if not pids and not is_free("127.0.0.1", port):
        classifications.append({"port": port, "ownership_decision": "UNKNOWN_OWNER", "reason": "listener PID unavailable"})
    return classifications


def wait_dead(pid: int, seconds: float) -> bool:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if process_info(pid) is None:
            return True
        time.sleep(0.1)
    return process_info(pid) is None


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


def cleanup_port(args: argparse.Namespace) -> int:
    runtime, repo = Path(args.runtime).resolve(), Path(args.repo).resolve()
    decisions = classify(runtime, repo, args.port)
    if not decisions and is_free(args.host, args.port):
        return 0
    for item in decisions:
        decision = item["ownership_decision"]
        if decision == "OPERATOROS_STALE":
            print(f"[cleanup] Found stale OperatorOS PID {item['pid']} on port {args.port}")
            stop_pid(int(item["pid"]), args.timeout, "OperatorOS")
        else:
            print(f"[blocked] Port {args.port} ownership: {decision}")
            print("[blocked] No process was terminated")
            print(json.dumps(item, sort_keys=True))
            return 3
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
    atomic_json(session_dir / "ports.json", common)
    atomic_json(runtime / "ports.json", common)
    write_record(session_dir / "launcher.pid", args.launcher_pid, "launcher", repo, args.token, session_id=args.session)
    (runtime / "active-session").write_text(args.session + "\n", encoding="utf-8")
    print(session_dir)
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
    value = json.loads(path.read_text(encoding="utf-8"))
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


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser()
    sub = root.add_subparsers(dest="command", required=True)
    cleanup = sub.add_parser("cleanup-port")
    cleanup.add_argument("--runtime", required=True); cleanup.add_argument("--repo", required=True)
    cleanup.add_argument("--host", default="127.0.0.1"); cleanup.add_argument("--port", type=int, required=True); cleanup.add_argument("--timeout", type=float, default=2)
    cleanup.set_defaults(func=cleanup_port)
    allocation = sub.add_parser("allocate")
    allocation.add_argument("--host", default="127.0.0.1"); allocation.add_argument("--preferred", type=int, required=True); allocation.add_argument("--maximum", type=int, required=True); allocation.add_argument("--auto", action="store_true")
    allocation.set_defaults(func=allocate)
    init = sub.add_parser("init-session")
    for name in ("runtime", "repo", "session", "mode", "token", "javascript-runtime", "javascript-runtime-version"):
        init.add_argument(f"--{name}", required=True)
    init.add_argument("--launcher-pid", type=int, required=True); init.add_argument("--frontend-host", required=True); init.add_argument("--backend-host", required=True); init.add_argument("--frontend-port", type=int, required=True); init.add_argument("--backend-port", type=int, required=True)
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
    stop = sub.add_parser("stop")
    stop.add_argument("--runtime", required=True); stop.add_argument("--repo", required=True); stop.add_argument("--session"); stop.add_argument("--all", action="store_true"); stop.add_argument("--timeout", type=float, default=2)
    stop.set_defaults(func=stop_command)
    return root


if __name__ == "__main__":
    arguments = parser().parse_args()
    raise SystemExit(arguments.func(arguments))
