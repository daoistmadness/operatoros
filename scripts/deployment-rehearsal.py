#!/usr/bin/env python3
"""Run one explicit, disposable GitHub-hosted deployment rehearsal."""

from __future__ import annotations

import base64
import hashlib
from http.cookiejar import CookieJar
import json
import os
from pathlib import Path
import pwd
import re
import secrets
import shlex
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import time
from typing import Any
from urllib.request import HTTPCookieProcessor, ProxyHandler, Request, build_opener


ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = "daoistmadness/operatoros"
SOURCE_SHA = "b9718ab1a6f8b1d855c8a5c62e973bfad2f8ea84"
RELEASE_RUN_ID = "42181508155"
RELEASE_ATTEMPT = "1"
ARTIFACT_ID = "13485579515"
ARTIFACT_NAME = f"operatoros-release-{SOURCE_SHA}-{RELEASE_RUN_ID}-{RELEASE_ATTEMPT}"
INNER_BUNDLE_SHA256 = "0d66097da4bff85b4bb0915c39c819b9d069cf34f16688b0b9e29f5c7594bd39"
ENVELOPE_SHA256 = "0ff8033c51900e0e3154f06e428ea8120f12b906a906938f1458ff058498bbf4"
OCI_MANIFEST_DIGEST = "sha256:acf22409b2a2f957830533c778198cdde5c342664d886526c38f8a4336c5a0ed"
OCI_IMAGE_ID = "sha256:8c8dfce496c1f304a2b157603d0b6b239fadf540e9824cc1414d0addf31621c6"
SPA_SHA256 = "8c23256063f803a52590ba5fe432f51e519cc6d475af058ae5240f896eeb2ecc"
ARTIFACT_EXPIRES_AT = "2027-02-04T07:32:13Z"
SQLITE_WAL_SETUP = (
    "import { Database } from 'bun:sqlite'; "
    "const db = new Database(process.argv[1]); "
    "const journalMode = db.query('PRAGMA journal_mode=WAL').get().journal_mode; "
    "if (journalMode !== 'wal') throw new Error('synthetic database did not enter WAL mode'); "
    "console.log(JSON.stringify({journal_mode: journalMode})); db.close();"
)
SQLITE_ASSERTION = (
    "import { Database } from 'bun:sqlite'; "
    "const db = new Database(process.argv[1], {readonly: true}); "
    "const integrity = db.query('PRAGMA integrity_check').get()?.integrity_check; "
    "const foreignKeys = db.query('PRAGMA foreign_key_check').all(); "
    "const journalMode = db.query('PRAGMA journal_mode').get()?.journal_mode; "
    "const admin = db.query('SELECT username, role, is_active FROM users WHERE username=?').get(process.argv[2]); "
    "if (integrity !== 'ok' || foreignKeys.length !== 0 || journalMode !== 'wal' || "
    "admin?.role !== 'admin' || admin?.is_active !== 1) throw new Error('synthetic SQLite validation failed'); "
    "console.log(JSON.stringify({integrity_check: integrity, foreign_key_violations: foreignKeys.length, "
    "journal_mode: journalMode, synthetic_admin_preserved: true})); db.close();"
)
WORKSPACE_PREFIX = "operatoros-deployment-rehearsal."
MIN_FREE_BYTES = 5 * 1024**3
MIN_FREE_INODES = 20_000


class RehearsalError(RuntimeError):
    pass


def write_json(path: Path, value: dict[str, Any]) -> None:
    temporary = path.with_name("." + path.name + ".tmp")
    temporary.write_text(json.dumps(value, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    temporary.chmod(0o600)
    os.replace(temporary, path)


def run(args: list[str], *, env: dict[str, str] | None = None, timeout: int = 60,
        check: bool = True, input_data: str | None = None) -> subprocess.CompletedProcess[str]:
    try:
        result = subprocess.run(args, env=env if env is not None else system_environment(), capture_output=True, text=True,
                                input=input_data, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise RehearsalError(f"subprocess could not complete ({type(error).__name__})") from error
    log("subprocess", exit_code=result.returncode)
    if check and result.returncode != 0:
        raise RehearsalError(f"subprocess failed with exit code {result.returncode}")
    return result


DIAGNOSTICS: Path | None = None
REPORT: dict[str, Any] = {"schema_version": 2, "checks": {}, "failures": []}
PODMAN_CONTEXT_VERIFIED = False


def system_environment() -> dict[str, str]:
    names = ("PATH", "HOME", "LANG", "LC_ALL", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS")
    return {name: os.environ[name] for name in names if name in os.environ}


def log(event: str, *, exit_code: int | None = None) -> None:
    if event not in {"subprocess", "deployment_cli", "cleanup"}:
        raise RehearsalError("diagnostic event is not allowlisted")
    if exit_code is not None and not isinstance(exit_code, int):
        raise RehearsalError("diagnostic exit code must be an integer")
    message = event if exit_code is None else f"{event} exit={exit_code}"
    print(message, flush=True)
    if DIAGNOSTICS is not None:
        with (DIAGNOSTICS / "rehearsal.log").open("a", encoding="utf-8") as output:
            output.write(message.replace(str(DIAGNOSTICS.parent), "<runner-temp>")[:2_000] + "\n")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RehearsalError(message)


def failure_kind(error: BaseException) -> str:
    return type(error).__name__


def context_progress(stage: str, last_completed_guard: str | None = None) -> None:
    record = REPORT.get("podman_context")
    if not isinstance(record, dict):
        return
    record["stage"] = stage
    if last_completed_guard is not None:
        record["last_completed_guard"] = last_completed_guard


def retain_context_failure(error: BaseException) -> None:
    record = REPORT.get("podman_context")
    if not isinstance(record, dict) or record.get("status") != "qualifying":
        return
    error_module = sys.modules.get(type(error).__module__)
    error_type = getattr(error_module, "PodmanContextError", None)
    if isinstance(error_type, type) and isinstance(error, error_type):
        diagnostic_record = error.diagnostic_record
        failure = diagnostic_record()
    else:
        failure = {
            "code": "CTX_UNCLASSIFIED_FAILURE",
            "stage": record["stage"],
            "last_completed_guard": record["last_completed_guard"],
            "exit_code": None,
            "explanation": "Private Podman context qualification failed unexpectedly.",
            "expected": None,
            "observed": None,
        }
    record["status"] = "failed"
    record["failure"] = failure
    record["stage"] = failure["stage"]
    record["last_completed_guard"] = failure["last_completed_guard"]


def command_text(args: list[str], *, env: dict[str, str] | None = None, timeout: int = 30) -> str:
    result = run(args, env=env, timeout=timeout)
    return result.stdout.strip()


def create_podman_secret(name: str, value: str, env: dict[str, str]) -> None:
    run(["podman", "secret", "create", name, "-"], env=env,
        input_data=value)


def require_subid_file(path: Path, username: str, uid: int) -> None:
    try:
        lines = path.read_text(encoding="ascii").splitlines()
    except OSError as error:
        raise RehearsalError(f"rootless subordinate ID mapping file is unavailable: {path.name}") from error
    for line in lines:
        fields = line.split(":")
        if len(fields) != 3 or fields[0] not in (username, str(uid)):
            continue
        if fields[1].isdigit() and fields[2].isdigit() and int(fields[2]) >= 65_536:
            return
    raise RehearsalError(f"{path.name} does not grant this runner user a 65,536-ID subordinate range")


def service_names() -> tuple[str, str]:
    run_id = os.environ.get("GITHUB_RUN_ID", "")
    attempt = os.environ.get("GITHUB_RUN_ATTEMPT", "")
    if not re.fullmatch(r"[1-9][0-9]{5,19}", run_id) or not re.fullmatch(r"[1-9][0-9]{0,8}", attempt):
        raise RehearsalError("GitHub run identity is missing or malformed")
    prefix = f"operatoros-rehearsal-{run_id}-{attempt}"
    return prefix + "-api.service", prefix + "-caddy.service"


def workspace_path(runner_temp: Path) -> Path:
    run_id = os.environ.get("GITHUB_RUN_ID", "")
    attempt = os.environ.get("GITHUB_RUN_ATTEMPT", "")
    require(re.fullmatch(r"[1-9][0-9]{5,19}", run_id) is not None, "invalid workflow run ID")
    require(re.fullmatch(r"[1-9][0-9]{0,8}", attempt) is not None, "invalid workflow attempt")
    return runner_temp / (WORKSPACE_PREFIX + run_id + "a" + attempt)


def require_private_workspace_boundary(runner_temp: Path, workspace: Path) -> None:
    """Reject a rehearsal root that could overlap shared stores or application data."""
    suffix = workspace.name.removeprefix(WORKSPACE_PREFIX)
    require(workspace.parent == runner_temp and workspace.name.startswith(WORKSPACE_PREFIX) and
            len(suffix) >= 8 and suffix.isalnum() and
            workspace.resolve(strict=False) == workspace,
            "rehearsal workspace is not a canonical run-scoped child of RUNNER_TEMP")
    protected = [
        Path(pwd.getpwuid(os.getuid()).pw_dir) / ".local/share/containers/storage",
        Path("/var/lib/containers/storage"),
        Path("/run/containers/storage"),
        Path("/mnt/podman-data"),
        ROOT,
    ]
    for name, suffix in (("XDG_DATA_HOME", "containers/storage"),
                         ("XDG_RUNTIME_DIR", "containers"),
                         ("OPERATOROS_DATA_DIR", "")):
        value = os.environ.get(name)
        if not value:
            continue
        path = Path(value)
        require(path.is_absolute() and ".." not in path.parts,
                f"refusing an ambiguous protected path in {name}")
        protected.append(path / suffix if suffix else path)
    workspace_root = workspace.resolve(strict=False)
    for value in protected:
        protected_root = value.resolve(strict=False)
        require(workspace_root != protected_root and protected_root not in workspace_root.parents and
                workspace_root not in protected_root.parents,
                "rehearsal workspace overlaps shared Podman storage or protected application data")


def validate_workflow_context() -> tuple[Path, Path, Path, tuple[str, str]]:
    required = {
        "GITHUB_ACTIONS": "true",
        "GITHUB_REPOSITORY": REPOSITORY,
        "GITHUB_REF": "refs/heads/main",
        "GITHUB_EVENT_NAME": "workflow_dispatch",
        "RUNNER_OS": "Linux",
    }
    for name, expected in required.items():
        require(os.environ.get(name) == expected, f"rehearsal requires {name}={expected}")
    require(os.environ.get("OPERATOROS_REHEARSAL_CONFIRMED", "").lower() == "true",
            "the explicit rehearsal confirmation input is required")
    token = os.environ.get("OPERATOROS_RELEASE_TOKEN", "")
    require(bool(token) and "\n" not in token and "\r" not in token,
            "a short-lived Actions artifact/attestation read credential is required")

    runner_temp = Path(os.environ.get("RUNNER_TEMP", ""))
    try:
        info = runner_temp.lstat()
        canonical_temp = runner_temp.resolve(strict=True)
    except OSError as error:
        raise RehearsalError("RUNNER_TEMP is unavailable") from error
    require(runner_temp.is_absolute() and canonical_temp == runner_temp and
            stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode) and info.st_uid == os.getuid(),
            "RUNNER_TEMP must be a canonical runner-owned directory")
    workspace = workspace_path(runner_temp)
    require_private_workspace_boundary(runner_temp, workspace)
    require(not workspace.exists() and not workspace.is_symlink(),
            "run-specific rehearsal workspace already exists; refusing reuse")
    diagnostics = runner_temp / ("operatoros-deployment-rehearsal-diagnostics." + workspace.name.removeprefix(WORKSPACE_PREFIX))
    require(not diagnostics.exists() and not diagnostics.is_symlink(),
            "run-specific diagnostics directory already exists; refusing reuse")
    diagnostics.mkdir(mode=0o700)
    info = diagnostics.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) == 0o700,
            "diagnostics directory must be private and owned by the runner")
    return runner_temp, workspace, diagnostics, service_names()


def preflight_runner(runner_temp: Path, services: tuple[str, str]) -> dict[str, Any]:
    release = {}
    for line in Path("/etc/os-release").read_text(encoding="utf-8").splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            release[key] = value.strip('"')
    require(release.get("ID") == "ubuntu" and release.get("VERSION_ID") == "24.04",
            "the rehearsal requires the Ubuntu 24.04 hosted runner")
    require(os.getuid() != 0, "the rehearsal requires rootless execution as the hosted runner user")
    username = pwd.getpwuid(os.getuid()).pw_name
    require_subid_file(Path("/etc/subuid"), username, os.getuid())
    require_subid_file(Path("/etc/subgid"), username, os.getuid())
    for name in ("newuidmap", "newgidmap", "podman", "systemctl", "findmnt", "curl", "bun", "gh"):
        require(shutil.which(name) is not None, f"required runner tool is unavailable: {name}")
    require(Path("/sys/fs/cgroup/cgroup.controllers").is_file(), "cgroup v2 is required for Quadlet")
    runtime_dir = Path(os.environ.get("XDG_RUNTIME_DIR", ""))
    expected_runtime = Path(f"/run/user/{os.getuid()}")
    try:
        runtime_info = runtime_dir.lstat()
    except OSError as error:
        raise RehearsalError("systemd user runtime directory is unavailable") from error
    require(runtime_dir == expected_runtime and stat.S_ISDIR(runtime_info.st_mode) and
            not stat.S_ISLNK(runtime_info.st_mode) and runtime_info.st_uid == os.getuid() and
            stat.S_IMODE(runtime_info.st_mode) == 0o700,
            "XDG_RUNTIME_DIR must be the private runtime directory for the current user")
    manager_state = command_text(["systemctl", "--user", "is-system-running"], timeout=20)
    require(manager_state == "running", f"user systemd manager is not running: {manager_state}")
    manager_environment = command_text(["systemctl", "--user", "show-environment"], timeout=20)
    manager_variables = {line.split("=", 1)[0] for line in manager_environment.splitlines() if "=" in line}
    forbidden_manager_variables = {
        "CONTAINER_HOST", "CONTAINER_CONNECTION", "DOCKER_HOST", "CONTAINERS_CONF",
        "CONTAINERS_STORAGE_CONF", "GH_TOKEN", "GITHUB_TOKEN", "OPERATOROS_RELEASE_TOKEN",
    }
    require(not manager_variables.intersection(forbidden_manager_variables),
            "user systemd manager contains an alternate Podman context or release credential")

    fs_type = command_text(["findmnt", "-n", "-o", "FSTYPE", "--target", str(runner_temp)])
    require(fs_type in ("ext4", "xfs", "btrfs"), f"unsupported runner temporary filesystem: {fs_type}")
    usage = shutil.disk_usage(runner_temp)
    fs = os.statvfs(runner_temp)
    require(usage.free >= MIN_FREE_BYTES and fs.f_favail >= MIN_FREE_INODES,
            "runner temporary filesystem lacks the required 5 GiB and 20,000 free inodes")

    home = Path.home()
    home_info = home.lstat()
    require(home.resolve(strict=True) == home and stat.S_ISDIR(home_info.st_mode) and
            not stat.S_ISLNK(home_info.st_mode) and home_info.st_uid == os.getuid(),
            "runner home must be a canonical directory owned by the runner")
    unit_dir = home / ".config/containers/systemd"
    for path in (home / ".config", home / ".config/containers", unit_dir):
        if path.exists() or path.is_symlink():
            info = path.lstat()
            require(stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode) and info.st_uid == os.getuid(),
                    "user Quadlet configuration path has unsafe ownership or type")
    unit_paths = tuple(unit_dir / (name.removesuffix(".service") + ".container") for name in services)
    require(not any(path.exists() or path.is_symlink() for path in unit_paths),
            "run-specific Quadlet file already exists")
    listed = command_text(["systemctl", "--user", "list-units", "--all", "--plain", "--no-legend"], timeout=20)
    loaded = command_text(["systemctl", "--user", "list-unit-files", "--no-legend"], timeout=20)
    require(all(name not in listed and name not in loaded for name in services),
            "run-specific systemd service identity already exists")

    version = command_text(["podman", "version", "--format", "{{.Client.Version}}"])
    return {
        "ubuntu": release.get("VERSION_ID"),
        "kernel": os.uname().release,
        "uid": os.getuid(),
        "podman": version,
        "filesystem": fs_type,
        "free_bytes": usage.free,
        "free_inodes": fs.f_favail,
        "cgroups": "v2",
        "user_systemd": manager_state,
        "subuid_range": "verified",
        "subgid_range": "verified",
        "services_absent": True,
    }


def reserve_loopback_port(excluded: set[int]) -> int:
    for _ in range(20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
            listener.bind(("127.0.0.1", 0))
            port = int(listener.getsockname()[1])
        if port not in excluded:
            return port
    raise RehearsalError("could not allocate a unique loopback-only rehearsal port")


def private_env(workspace: Path, context: Any) -> dict[str, str]:
    result = system_environment()
    for key in ("CONTAINER_HOST", "CONTAINER_CONNECTION", "DOCKER_HOST", "CONTAINERS_CONF_OVERRIDE",
                "STORAGE_DRIVER", "STORAGE_OPTS"):
        require(not os.environ.get(key), f"refusing an alternate or remote Podman context: {key}")
    require(context.root == workspace.resolve(strict=True),
            "Podman context does not belong to the unique rehearsal workspace")
    result.update(context.environment())
    return result


def verify_quadlet_podman_environment(value: str, context: Any) -> None:
    """Require systemd's effective service environment to match direct Podman calls."""
    try:
        entries = shlex.split(value)
    except ValueError as error:
        raise RehearsalError("Quadlet service returned an unparseable environment") from error
    expected = context.environment()
    observed: dict[str, str] = {}
    for entry in entries:
        name, separator, setting = entry.partition("=")
        if not separator:
            raise RehearsalError("Quadlet service returned a malformed environment entry")
        if name == "CONTAINERS_STORAGE_CONF":
            raise RehearsalError("Quadlet service must use the private XDG storage config without an override")
        if name in expected:
            if name in observed:
                raise RehearsalError("Quadlet service has duplicate Podman context settings")
            observed[name] = setting
    if observed != expected:
        raise RehearsalError("Quadlet service storage environment differs from the direct private Podman context")


def atomic_text(path: Path, value: str, mode: int = 0o600) -> None:
    temporary = path.with_name("." + path.name + ".tmp")
    temporary.write_text(value, encoding="utf-8")
    temporary.chmod(mode)
    os.replace(temporary, path)


def create_unit_directory(unit_dir: Path, created: list[Path]) -> None:
    missing: list[Path] = []
    current = unit_dir
    while not current.exists():
        missing.append(current)
        current = current.parent
    info = current.lstat()
    require(stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode) and
            info.st_uid == os.getuid(), "user Quadlet parent has unsafe ownership or type")
    for path in reversed(missing):
        path.mkdir(mode=0o700)
        created.append(path)


def make_caddyfile(web_port: int, api_port: int) -> str:
    return f'''http://127.0.0.1:{web_port} {{
    bind 127.0.0.1
    encode zstd gzip
    @dotfiles path_regexp dotfiles (^|/)\\.[^/]+(/|$)
    handle @dotfiles {{
        respond 404
    }}
    @api path /api /api/* /health /ready /openapi /openapi/*
    handle @api {{
        reverse_proxy 127.0.0.1:{api_port}
    }}
    @root path /
    handle @root {{
        root * /srv/operatoros/current/client
        rewrite * /_shell.html
        file_server
    }}
    @static_file path_regexp static_file \\.[^/]+$
    handle @static_file {{
        root * /srv/operatoros/current/client
        file_server
    }}
    handle {{
        root * /srv/operatoros/current/client
        try_files {{path}} /_shell.html
        file_server
    }}
}}
'''


def write_quadlets(workspace: Path, unit_dir: Path, api_service: str, caddy_service: str,
                   api_port: int, web_port: int, image_ref: str,
                   auth_secret_name: str, backup_secret_name: str,
                   created: set[Path], context: Any) -> tuple[Path, Path, Path]:
    root = workspace
    deploy_dir = root / "deploy"
    data_dir = root / "data"
    api_unit = unit_dir / (api_service.removesuffix(".service") + ".container")
    caddy_unit = unit_dir / (caddy_service.removesuffix(".service") + ".container")
    api_copy = deploy_dir / "operatoros-lite-api.container"
    storage_conf = context.storage_conf
    environment = "\n".join(context.quadlet_environment())
    api_text = f'''[Unit]
Description=OperatorOS disposable rehearsal API

[Container]
Image={image_ref}
Pull=never
ContainerName=operatoros-lite-api
PublishPort=127.0.0.1:{api_port}:8090
User=10000:10000
UserNS=keep-id:uid=10000,gid=10000
ReadOnly=true
ReadOnlyTmpfs=true
NoNewPrivileges=true
DropCapability=all
EnvironmentFile={deploy_dir / "api.env"}
Secret={auth_secret_name},type=env,target=AUTH_COOKIE_SECRET
Secret={backup_secret_name},type=env,target=BACKUP_ENCRYPTION_KEY
Volume={data_dir}:/var/lib/operatoros/data:rw

[Service]
{environment}
Restart=on-failure
RestartSec=5s
TimeoutStartSec=600
TimeoutStopSec=45
'''
    caddy_text = f'''[Unit]
Description=OperatorOS disposable rehearsal Caddy

[Container]
Image=docker.io/library/caddy@sha256:e70b164da81ef698b3ad19af799ea6086ce6d9e48ed4079eb9fe26f6fbf14ee5
Pull=never
ContainerName=operatoros-lite-caddy
Network=host
User=1000:1000
UserNS=keep-id:uid=1000,gid=1000
ReadOnly=true
NoNewPrivileges=true
DropCapability=all
AddCapability=net_bind_service
Volume={deploy_dir / "Caddyfile"}:/etc/caddy/Caddyfile:ro
Volume={root / "web/current/client"}:/srv/operatoros/current/client:ro

[Service]
{environment}
Restart=on-failure
RestartSec=5s
TimeoutStartSec=600
TimeoutStopSec=45
'''
    for path, value in ((api_unit, api_text), (caddy_unit, caddy_text), (api_copy, api_text)):
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(path, flags, 0o600 if path == api_copy else 0o644)
        created.add(path)
        try:
            info = os.fstat(descriptor)
            require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and info.st_nlink == 1,
                    "new rehearsal Quadlet file has unsafe identity")
            content = memoryview(value.encode("utf-8"))
            while content:
                content = content[os.write(descriptor, content):]
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    return api_unit, caddy_unit, api_copy


def toml_config(workspace: Path, api_unit: Path, caddy_unit: Path, api_copy: Path,
                api_service: str, caddy_service: str, api_port: int, web_port: int,
                storage_conf: Path) -> Path:
    values: dict[str, str | int] = {
        "root": str(workspace),
        "expected_uid": os.getuid(),
        "storage_conf": str(storage_conf),
        "graphroot": str(workspace / "podman-rootless/graphroot"),
        "runroot": str(workspace / "podman-rootless/runroot"),
        "data_dir": str(workspace / "data"),
        "backup_dir": str(workspace / "data/backups"),
        "api_unit": str(api_unit),
        "api_unit_copy": str(api_copy),
        "caddy_unit": str(caddy_unit),
        "api_service": api_service,
        "caddy_service": caddy_service,
        "api_url": f"http://127.0.0.1:{api_port}",
        "web_url": f"http://127.0.0.1:{web_port}",
        "min_free_bytes": MIN_FREE_BYTES,
        "min_free_inodes": MIN_FREE_INODES,
        "backup_max_age_seconds": 3_600,
    }
    path = workspace / "deploy/deployment.toml"
    lines = []
    for key, value in values.items():
        rendered = json.dumps(value) if isinstance(value, str) else str(value)
        lines.append(f"{key} = {rendered}")
    atomic_text(path, "\n".join(lines) + "\n")
    return path


def image_identity_for_release(deploy: Any, release: Any, workspace: Path, context: Any) -> str:
    archive = workspace / "deploy/operatoros-api.oci.tar"
    archive.write_bytes(release.files["operatoros-api.oci.tar"])
    archive.chmod(0o600)
    env = private_env(workspace, context)
    deploy.command(["podman", "load", "--input", str(archive)], env, timeout=300)
    image = release.manifest["image"]
    image_id = "sha256:" + image["image_id"].removeprefix("sha256:")
    podman_cfg = {"root": workspace, "profile": "rehearsal", "storage_conf": context.storage_conf,
                  "graphroot": context.graphroot, "runroot": context.runroot,
                  "_private_podman_context": context}
    deploy.validate_image_after_load(image_id, SOURCE_SHA, image["source_tree_sha256"],
                                     image["manifest_digest"], podman_cfg)
    image_ref = "localhost/operatoros-api:" + SOURCE_SHA
    deploy.command(["podman", "tag", image_id, image_ref], env)
    return image_ref


def api_environment(source_sha: str, origin: str) -> dict[str, str]:
    return {
        "NODE_ENV": "production",
        "HOST": "0.0.0.0",
        "PORT": "8090",
        "OPERATOROS_DATA_DIR": "/var/lib/operatoros/data",
        "BACKUP_ENCRYPTION_KEY_ID": "deployment-rehearsal-" + source_sha[:12],
        "ALLOWED_ORIGINS": origin,
        "COOKIE_SECURE": "false",
        "ENABLE_DESTRUCTIVE_OPERATIONS": "false",
    }


def setup_synthetic_database(workspace: Path, source_sha: str, context: Any) -> tuple[str, str, str, str, str, str]:
    data_dir = workspace / "data"
    backup_dir = data_dir / "backups"
    data_dir.mkdir(mode=0o700)
    backup_dir.mkdir(mode=0o700)
    cookie_secret = secrets.token_hex(64)
    backup_key = base64.b64encode(secrets.token_bytes(32)).decode("ascii")
    admin_username = "operatoros_rehearsal_" + os.environ["GITHUB_RUN_ID"]
    admin_password = "Synthetic-" + secrets.token_urlsafe(30)
    secret_prefix = "operatoros-rehearsal-" + os.environ["GITHUB_RUN_ID"] + "-" + os.environ["GITHUB_RUN_ATTEMPT"]
    auth_secret_name = secret_prefix + "-auth-cookie"
    backup_secret_name = secret_prefix + "-backup-key"
    podman_environment = private_env(workspace, context)
    create_podman_secret(auth_secret_name, cookie_secret, podman_environment)
    create_podman_secret(backup_secret_name, backup_key, podman_environment)
    api_env = workspace / "deploy/api.env"
    env_values = api_environment(source_sha, os.environ["OPERATOROS_REHEARSAL_ORIGIN"])
    atomic_text(api_env, "".join(f"{key}={value}\n" for key, value in env_values.items()))
    base_env = system_environment()
    db_env = base_env | {"OPERATOROS_DATA_DIR": str(data_dir)}
    run(["bun", "packages/db/src/db-cli.ts", "bootstrap", "--data-dir", str(data_dir)],
        env=db_env, timeout=120)
    seed_env = db_env | {"OPERATOROS_E2E_ADMIN_USERNAME": admin_username,
                         "OPERATOROS_E2E_ADMIN_PASSWORD": admin_password}
    run(["bun", "e2e/helpers/seed-test-database.ts", "--database", str(data_dir / "operatoros.sqlite"),
         "--runtime-root", str(workspace)], env=seed_env, timeout=120)

    incompatible = workspace / "schema-negative/data"
    incompatible.mkdir(mode=0o700, parents=True)
    shutil.copy2(data_dir / "operatoros.sqlite", incompatible / "operatoros.sqlite")
    if (data_dir / "operatoros.sqlite-wal").exists():
        shutil.copy2(data_dir / "operatoros.sqlite-wal", incompatible / "operatoros.sqlite-wal")
    if (data_dir / "operatoros.sqlite-shm").exists():
        shutil.copy2(data_dir / "operatoros.sqlite-shm", incompatible / "operatoros.sqlite-shm")
    run(["bun", "-e", "import { Database } from 'bun:sqlite'; const db = new Database(process.argv[1]); db.query(\"UPDATE operatoros_schema_migrations SET version = 'invalid-rehearsal-schema'\").run(); db.close();",
         str(incompatible / "operatoros.sqlite")], env=base_env, timeout=30)
    return admin_username, admin_password, cookie_secret, backup_key, auth_secret_name, backup_secret_name


def login_synthetic_admin(web_url: str, username: str, password: str) -> None:
    opener = build_opener(ProxyHandler({}), HTTPCookieProcessor(CookieJar()))
    body = json.dumps({"username": username, "password": password}).encode("utf-8")
    login_request = Request(web_url + "/api/auth/login", data=body,
                            headers={"Content-Type": "application/json", "Origin": web_url}, method="POST")
    with opener.open(login_request, timeout=10) as response:
        require(response.status == 200, "synthetic login through Caddy failed")
        login_value = json.load(response)
    require(login_value.get("username") == username and login_value.get("role") == "admin",
            "synthetic login returned an unexpected identity")
    current_request = Request(web_url + "/api/auth/me")
    with opener.open(current_request, timeout=10) as response:
        require(response.status == 200, "authenticated synthetic API request failed")


def wait_url(url: str, expected: int = 200, timeout: int = 60) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = subprocess.run(["curl", "--silent", "--show-error", "--output", "/dev/null",
                                 "--write-out", "%{http_code}", "--max-time", "3", url],
                                env=system_environment(), capture_output=True, text=True, check=False)
        if result.returncode == 0 and result.stdout == str(expected):
            return
        time.sleep(1)
    raise RehearsalError(f"HTTP readiness check failed for loopback path (expected {expected})")


def deployment_command(config: Path, action: str, *, backup_name: str | None = None,
                       release_id: str | None = None, wrong_source: bool = False) -> list[str]:
    source_sha = "f" * 40 if wrong_source else SOURCE_SHA
    args = [str(ROOT / "scripts/operatoros-deploy.sh"), action,
            "--source-sha", source_sha,
            "--run-id", RELEASE_RUN_ID,
            "--run-attempt", RELEASE_ATTEMPT,
            "--artifact-id", ARTIFACT_ID,
            "--artifact-name", ARTIFACT_NAME,
            "--envelope-sha256", ENVELOPE_SHA256]
    if action != "verify":
        args.extend(["--config", str(config)])
    if action == "deploy":
        require(backup_name is not None, "backup name is required for deploy")
        args.extend(["--backup-name", backup_name, "--yes"])
    elif action == "rollback":
        require(release_id is not None, "rollback release ID is required")
        args.extend([release_id, "--yes"])
    return args


def run_cli(args: list[str], *, expect_success: bool = True,
            needs_token: bool = False) -> subprocess.CompletedProcess[str]:
    env = system_environment()
    for name in ("GITHUB_ACTIONS", "GITHUB_REPOSITORY", "GITHUB_REF", "GITHUB_EVENT_NAME",
                 "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "RUNNER_TEMP"):
        if name in os.environ:
            env[name] = os.environ[name]
    env["OPERATOROS_REHEARSAL_CONFIRMED"] = "true"
    if needs_token:
        env["OPERATOROS_RELEASE_TOKEN"] = os.environ["OPERATOROS_RELEASE_TOKEN"]
    result = subprocess.run(args, env=env, capture_output=True, text=True, timeout=300, check=False)
    log("deployment_cli", exit_code=result.returncode)
    if expect_success and result.returncode != 0:
        raise RehearsalError("deployment CLI failed; inspect the non-secret rehearsal log")
    if not expect_success and result.returncode == 0:
        raise RehearsalError("deployment CLI accepted an invalid test input")
    return result


def remove_run_units(unit_dir: Path, services: tuple[str, str], created: set[Path]) -> None:
    failures = []
    expected_paths = {unit_dir / (service.removesuffix(".service") + ".container") for service in services}
    owned_units = {path for path in expected_paths if path in created}
    owned_services = {name.removesuffix(".container") + ".service"
                      for name in (path.name for path in owned_units)}
    for service in services:
        if service not in owned_services:
            continue
        result = subprocess.run(["systemctl", "--user", "stop", service], env=system_environment(),
                                capture_output=True, text=True,
                                timeout=30, check=False)
        if result.returncode != 0:
            # A missing, never-started service is already stopped; verify its state below.
            active = subprocess.run(["systemctl", "--user", "is-active", "--quiet", service],
                                    env=system_environment(), capture_output=True, check=False)
            if active.returncode == 0:
                failures.append("could not stop " + service)
    for path in owned_units:
        try:
            info = path.lstat()
            require(stat.S_ISREG(info.st_mode) and not stat.S_ISLNK(info.st_mode) and info.st_uid == os.getuid(),
                    "refusing to remove a non-owned rehearsal Quadlet file")
            path.unlink()
        except FileNotFoundError:
            pass
        except (OSError, RehearsalError) as error:
            failures.append(type(error).__name__ + " while removing a rehearsal unit")
    if owned_units:
        reload_result = subprocess.run(["systemctl", "--user", "daemon-reload"], env=system_environment(),
                                       capture_output=True, text=True,
                                       timeout=30, check=False)
        if reload_result.returncode != 0:
            failures.append("user systemd daemon-reload failed during cleanup")
    for service in services:
        if service not in owned_services:
            continue
        active = subprocess.run(["systemctl", "--user", "is-active", "--quiet", service],
                                env=system_environment(), capture_output=True, check=False)
        if active.returncode == 0:
            failures.append("service remained active after cleanup: " + service)
    if failures:
        raise RehearsalError("rehearsal service cleanup failed: " + "; ".join(failures))


def remove_created_unit_directories(created: list[Path]) -> None:
    failures = []
    for path in reversed(created):
        try:
            info = path.lstat()
            require(stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode) and
                    info.st_uid == os.getuid(), "refusing to remove a non-owned Quadlet directory")
            path.rmdir()
        except FileNotFoundError:
            continue
        except (OSError, RehearsalError) as error:
            failures.append(type(error).__name__ + " while removing an empty Quadlet directory")
    if failures:
        raise RehearsalError("rehearsal Quadlet directory cleanup failed: " + "; ".join(failures))


def cleanup_workspace(workspace: Path, runner_temp: Path, diagnostics: Path) -> None:
    if not workspace.exists():
        return
    from importlib.util import module_from_spec, spec_from_file_location

    path = ROOT / "scripts/release-consumer-cleanup.py"
    spec = spec_from_file_location("operatoros_rehearsal_cleanup", path)
    require(spec is not None and spec.loader is not None, "scoped Podman cleanup is unavailable")
    module = module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    if not PODMAN_CONTEXT_VERIFIED:
        info = workspace.lstat()
        require(workspace.parent == runner_temp and workspace.name.startswith(WORKSPACE_PREFIX) and
                len(workspace.name.removeprefix(WORKSPACE_PREFIX)) >= 8 and
                workspace.resolve(strict=True) == workspace and stat.S_ISDIR(info.st_mode) and
                not stat.S_ISLNK(info.st_mode) and info.st_uid == os.getuid() and
                stat.S_IMODE(info.st_mode) == 0o700 and not os.path.ismount(workspace),
                "refusing cleanup outside the unique owned rehearsal workspace")
        module.assert_no_mounts_below(workspace)
        if not shutil.rmtree.avoids_symlink_attacks:
            raise RehearsalError("safe workspace cleanup is unavailable")
        shutil.rmtree(workspace)
        require(not workspace.exists(), "private rehearsal workspace cleanup failed")
        return
    try:
        helper = ROOT / "scripts/operatoros_deploy.py"
        helper_spec = spec_from_file_location("operatoros_deploy_cleanup", helper)
        require(helper_spec is not None and helper_spec.loader is not None,
                "deployment verifier is unavailable for cleanup")
        deploy_module = module_from_spec(helper_spec)
        sys.modules[helper_spec.name] = deploy_module
        helper_spec.loader.exec_module(deploy_module)
        context = deploy_module.podman_context_from_workspace(workspace)
    except Exception as error:
        raise RehearsalError("verified Podman cleanup context could not be reconstructed") from error
    env = private_env(workspace, context)
    env.update({"TMPDIR": str(runner_temp)})
    if os.environ.get("XDG_DATA_HOME"):
        env["OPERATOROS_REHEARSAL_HOST_XDG_DATA_HOME"] = os.environ["XDG_DATA_HOME"]
    result = subprocess.run([
        sys.executable, str(path), str(workspace), str(runner_temp),
        "--diagnostics-dir", str(diagnostics),
    ], env=env, capture_output=True, text=True, timeout=300, check=False)
    log("cleanup", exit_code=result.returncode)
    require(result.returncode == 0 and not workspace.exists(),
            "isolated Podman cleanup failed; workspace was retained for investigation")


def rehearse(workspace: Path, diagnostics: Path,
             services: tuple[str, str],
             units_created: set[Path], unit_dirs_created: list[Path]) -> None:
    import importlib.util

    spec = importlib.util.spec_from_file_location("operatoros_deploy", ROOT / "scripts/operatoros_deploy.py")
    require(spec is not None and spec.loader is not None, "deployment verifier is unavailable")
    deploy = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = deploy
    spec.loader.exec_module(deploy)

    global PODMAN_CONTEXT_VERIFIED
    uid = os.getuid()
    api_service, caddy_service = services
    unit_dir = Path.home() / ".config/containers/systemd"
    REPORT["podman_context"] = {
        "status": "not_started",
        "stage": "workspace_creation",
        "last_completed_guard": "none",
        "failure": None,
        "cleanup_status": "not_started",
    }
    try:
        require_private_workspace_boundary(workspace.parent, workspace)
        workspace.mkdir(mode=0o700)
        os.chmod(workspace, 0o700)
        for name in ("deploy", "data", "data/backups", "web", "web/releases"):
            (workspace / name).mkdir(mode=0o700, parents=True, exist_ok=True)
    except (OSError, RehearsalError) as error:
        REPORT["podman_context"]["status"] = "qualifying"
        raise deploy.PodmanContextError(
            "CTX_WORKSPACE_FAILURE", "workspace_creation", "none",
            expected="private_workspace", observed="unsafe" if isinstance(error, RehearsalError) else "unavailable",
        ) from error
    context_progress("workspace_creation", "workspace_created")
    api_port = reserve_loopback_port(set())
    web_port = reserve_loopback_port({api_port})
    origin = f"http://127.0.0.1:{web_port}"
    os.environ["OPERATOROS_REHEARSAL_ORIGIN"] = origin

    report_path = diagnostics / "rehearsal-evidence.json"
    REPORT.update({"source_sha": SOURCE_SHA, "release_run_id": RELEASE_RUN_ID,
                   "release_attempt": RELEASE_ATTEMPT, "artifact_id": ARTIFACT_ID,
                   "artifact_name": ARTIFACT_NAME, "envelope_sha256": ENVELOPE_SHA256,
                   "inner_bundle_sha256": INNER_BUNDLE_SHA256,
                   "runner_run_id": os.environ["GITHUB_RUN_ID"],
                   "runner_attempt": os.environ["GITHUB_RUN_ATTEMPT"],
                   "services": list(services), "loopback_ports": {"api": api_port, "web": web_port}})
    write_json(report_path, REPORT)

    request = deploy.ReleaseRequest(SOURCE_SHA, RELEASE_RUN_ID, RELEASE_ATTEMPT,
                                    ARTIFACT_ID, ARTIFACT_NAME, ENVELOPE_SHA256)
    with tempfile.TemporaryDirectory(prefix="verified-artifact.", dir=workspace / "deploy") as temporary:
        verified = deploy.verified_artifact(request, Path(temporary))
        manifest = verified.manifest
        image = manifest.get("image", {})
        artifacts = manifest.get("artifacts", {})
        require(verified.envelope_sha256 == ENVELOPE_SHA256 and
                verified.bundle_sha256 == INNER_BUNDLE_SHA256 and
                verified.artifact_id == ARTIFACT_ID and verified.artifact_name == ARTIFACT_NAME and
                verified.artifact_expires_at == ARTIFACT_EXPIRES_AT,
                "verified release envelope, bundle, or artifact identity differs from Gate B")
        require(manifest.get("source_commit") == SOURCE_SHA and
                str(manifest.get("run_id")) == RELEASE_RUN_ID and
                str(manifest.get("run_attempt")) == RELEASE_ATTEMPT and
                manifest.get("repository") == REPOSITORY and
                manifest.get("workflow") == REPOSITORY + "/.github/workflows/ci.yml" and
                image.get("manifest_digest") == OCI_MANIFEST_DIGEST and
                image.get("image_id") == OCI_IMAGE_ID and
                artifacts.get("operatoros-web-client.tar.gz") == SPA_SHA256,
                "verified release manifest or component identities differ from Gate B")
        release = verified
        REPORT["artifact_verification"] = {
            "result": "verified",
            "attestation": "verified",
            "repository": manifest["repository"],
            "consumer": "scripts.operatoros_deploy.verified_artifact",
            "source_sha": SOURCE_SHA,
            "source_ref": manifest["source_ref"],
            "workflow": REPOSITORY + "/.github/workflows/ci.yml",
            "run_id": RELEASE_RUN_ID,
            "run_attempt": RELEASE_ATTEMPT,
            "artifact_id": ARTIFACT_ID,
            "artifact_name": ARTIFACT_NAME,
            "expires_at": verified.artifact_expires_at,
            "envelope_sha256": verified.envelope_sha256,
            "bundle_sha256": verified.bundle_sha256,
            "manifest_sha256": hashlib.sha256(verified.files["manifest.json"]).hexdigest(),
            "artifact_checksums": manifest["artifacts"],
            "scanner": manifest["scanner"],
            "security_scope": manifest["security_scope"],
            "oci_manifest_digest": image["manifest_digest"],
            "oci_image_id": image["image_id"],
            "spa_sha256": artifacts["operatoros-web-client.tar.gz"],
        }
        REPORT["checks"]["artifact_verification"] = "GitHub repository, run, workflow, attestation, envelope, bundle, manifest, OCI, and SPA identities verified before Podman initialization"
        REPORT["podman_context"]["status"] = "qualifying"
        context_progress("private_context_creation", "artifact_verified")
        write_json(report_path, REPORT)
        print("ARTIFACT_VERIFICATION_PASS " + json.dumps(REPORT["artifact_verification"], sort_keys=True), flush=True)

        try:
            context = deploy.create_private_podman_context(workspace)
        except deploy.PodmanContextError:
            raise
        except Exception as error:
            raise deploy.PodmanContextError(
                "CTX_CONFIG_FAILURE", "private_context_creation", "artifact_verified",
                expected="private_storage_config", observed="unavailable",
            ) from error
        context_progress("podman_environment", "private_context_created")
        storage_conf = context.storage_conf
        graphroot = context.graphroot
        runroot = context.runroot
        try:
            env = private_env(workspace, context)
        except RehearsalError as error:
            raise deploy.PodmanContextError(
                "CTX_CONFIG_FAILURE", "podman_environment", "private_context_created",
                expected="private_workspace", observed="environment_mismatch",
            ) from error
        context_progress("podman_info", "private_environment_verified")
        info = deploy.command_json(["podman", "info", "--format", "json"], env,
                                   context_diagnostics=True)
        context_progress("podman_store_validation", "podman_info_parsed")
        deploy.validate_podman_store(info, context, require_empty=True)
        PODMAN_CONTEXT_VERIFIED = True
        context_progress("store_inventory", "podman_store_identity_verified")
        deploy.require_empty_podman_store(context, env)
        context_progress("uid_gid_map_validation", "store_inventory_empty")
        try:
            uid_map = deploy.command(["podman", "unshare", "cat", "/proc/self/uid_map"], env)
        except deploy.DeployError as error:
            raise deploy.PodmanContextError(
                "CTX_IDMAP_INVALID", "uid_gid_map_validation", "store_inventory_empty",
                exit_code=error.exit_code, expected="at_least_65536_numeric_mapping_ids", observed="command_failed",
            ) from error
        deploy.validate_user_namespace_map(uid_map, name="uid", last_completed_guard="store_inventory_empty")
        context_progress("uid_gid_map_validation", "uid_map_verified")
        try:
            gid_map = deploy.command(["podman", "unshare", "cat", "/proc/self/gid_map"], env)
        except deploy.DeployError as error:
            raise deploy.PodmanContextError(
                "CTX_IDMAP_INVALID", "uid_gid_map_validation", "uid_map_verified",
                exit_code=error.exit_code, expected="at_least_65536_numeric_mapping_ids", observed="command_failed",
            ) from error
        deploy.validate_user_namespace_map(gid_map, name="gid", last_completed_guard="uid_map_verified")
        context_progress("uid_gid_map_validation", "gid_map_verified")
        REPORT["podman_context"]["status"] = "passed"
        REPORT["checks"]["podman_context"] = "private config, graphroot/runroot, metadata paths, VFS driver, empty inventory, rootless systemd cgroup v2, subordinate ID maps verified"

        image_ref = image_identity_for_release(deploy, release, workspace, context)
        deploy.command(["podman", "pull", deploy.CADDY_IMAGE], env, timeout=300)

        (admin_username, admin_password, cookie_secret, backup_key,
         auth_secret_name, backup_secret_name) = setup_synthetic_database(workspace, SOURCE_SHA, context)
        wal_setup = run(["bun", "-e", SQLITE_WAL_SETUP, str(workspace / "data/operatoros.sqlite")],
                        env=system_environment(), timeout=30)
        require(json.loads(wal_setup.stdout).get("journal_mode") == "wal",
                "synthetic SQLite database did not enable WAL mode")
        sqlite_before_transition = run(
            ["bun", "-e", SQLITE_ASSERTION, str(workspace / "data/operatoros.sqlite"), admin_username],
            env=system_environment(), timeout=30,
        )
        REPORT["checks"]["sqlite_wal_mode"] = "synthetic database set to WAL before deployment"
        REPORT["checks"]["sqlite_before_transition"] = json.loads(sqlite_before_transition.stdout)
        REPORT["checks"]["sqlite_schema"] = "synthetic S5.4 database passed integrity, foreign-key, and seeded-user checks"
        previous_spa = deploy.materialize_spa({"root": workspace}, release, "legacy-" + SOURCE_SHA)
        shell = previous_spa / "client/_shell.html"
        shell.chmod(0o600)
        shell.write_text(shell.read_text(encoding="utf-8") + "\n<!-- synthetic previous application shell -->\n", encoding="utf-8")
        shell.chmod(0o444)

        bad_data = workspace / "schema-negative/data"
        bad_cfg = {"data_dir": bad_data, "storage_conf": storage_conf, "graphroot": graphroot, "runroot": runroot}
        before_bad = deploy.sha_db_snapshot(bad_data)
        try:
            deploy.schema_validate(release.manifest["image"]["image_id"], bad_cfg)
        except deploy.DeployError as error:
            require("DATABASE_MIGRATION_REQUIRED" in str(error) or
                    "DATABASE_SCHEMA_INVALID" in str(error),
                    "incompatible database was rejected for an unexpected reason")
            REPORT["checks"]["incompatible_schema_rejected_read_only"] = True
        else:
            raise RehearsalError("candidate API image accepted the incompatible synthetic schema")
        require(deploy.sha_db_snapshot(bad_data) == before_bad,
                "schema compatibility rejection modified its synthetic SQLite fixture")

        backup_env = env | api_environment(SOURCE_SHA, origin) | {
            "OPERATOROS_DATA_DIR": str(workspace / "data"),
            "AUTH_COOKIE_SECRET": cookie_secret,
            "BACKUP_ENCRYPTION_KEY": backup_key,
        }
        run(["bun", "apps/api/src/backup-cli.ts", "backup"], env=backup_env, timeout=120)
        backups = list((workspace / "data/backups").glob("backup_*.sqlite3"))
        require(len(backups) == 1, "expected exactly one synthetic encrypted backup")

        (workspace / "deploy/Caddyfile").write_text(make_caddyfile(web_port, api_port), encoding="utf-8")
        (workspace / "deploy/Caddyfile").chmod(0o600)
        create_unit_directory(unit_dir, unit_dirs_created)
        api_unit, caddy_unit, api_copy = write_quadlets(
            workspace, unit_dir, api_service, caddy_service, api_port, web_port,
            image_ref, auth_secret_name, backup_secret_name, units_created, context,
        )
        config = toml_config(workspace, api_unit, caddy_unit, api_copy, api_service, caddy_service,
                             api_port, web_port, context.storage_conf)
        cfg = deploy.load_config(config)
        require(cfg["profile"] == "rehearsal" and cfg["expected_uid"] == uid,
                "deployment CLI did not accept the exact isolated rehearsal profile")
        deploy.switch_pointer(cfg, previous_spa)

        deploy.command(["systemctl", "--user", "daemon-reload"], timeout=60)
        deploy.verify_quadlet_service(api_service, api_unit, require_active=False)
        deploy.verify_quadlet_service(caddy_service, caddy_unit, require_active=False)
        for service in services:
            unit_env = deploy.command(["systemctl", "--user", "show", "--property=Environment", "--value", service], timeout=20)
            verify_quadlet_podman_environment(unit_env, context)
        deploy.service_call(cfg, "start", api_service)
        wait_url(cfg["api_url"] + "/health")
        wait_url(cfg["api_url"] + "/ready")
        deploy.service_call(cfg, "start", caddy_service)
        wait_url(cfg["web_url"] + "/ready")
        containers = deploy.command(
            ["podman", "ps", "--all", "--format", "{{.Names}} {{.State}}"], env
        ).splitlines()
        require(set(containers) == {"operatoros-lite-api running", "operatoros-lite-caddy running"},
                "disposable Podman store does not contain exactly the two expected running containers")
        REPORT["checks"]["quadlet_startup"] = "API then Caddy started under unique user-systemd units"

        before_deploy = deploy.sha_db_snapshot(cfg["data_dir"])
        wrong = run_cli(deployment_command(config, "verify", wrong_source=True),
                        expect_success=False, needs_token=True)
        require("artifact name does not identify" in wrong.stderr,
                "wrong-source artifact rejection did not fail at request validation")
        REPORT["checks"]["wrong_source_rejected"] = True

        run_cli(deployment_command(config, "deploy", backup_name=backups[0].name), needs_token=True)
        require(deploy.sha_db_snapshot(cfg["data_dir"]) == before_deploy,
                "SQLite main/WAL/SHM changed during the real deployment")
        report = json.loads(run_cli([str(ROOT / "scripts/operatoros-deploy.sh"), "status",
                                     "--config", str(config)]).stdout)
        require(report.get("state") == "healthy", "deployed release status is not healthy")
        REPORT["checks"]["deployment"] = "verified artifact imported without rebuild; API/Caddy healthy"
        REPORT["api_image_id"] = release.manifest["image"]["image_id"]
        REPORT["oci_manifest_digest"] = release.manifest["image"]["manifest_digest"]
        REPORT["bundle_sha256"] = verified.bundle_sha256
        REPORT["spa_sha256"] = release.manifest["artifacts"]["operatoros-web-client.tar.gz"]

        unauthenticated = run(["curl", "--silent", "--show-error", "--output", os.devnull,
                               "--write-out", "%{http_code}", cfg["web_url"] + "/api/auth/me"])
        require(unauthenticated.stdout == "401", "unauthenticated API request was not rejected")
        REPORT["checks"]["unauthenticated_auth_me"] = 401
        login_synthetic_admin(cfg["web_url"], admin_username, admin_password)
        sqlite_after_deploy = run(
            ["bun", "-e", SQLITE_ASSERTION, str(cfg["data_dir"] / "operatoros.sqlite"), admin_username],
            env=system_environment(), timeout=30,
        )
        REPORT["checks"]["sqlite_after_deploy"] = json.loads(sqlite_after_deploy.stdout)
        wait_url(cfg["web_url"] + "/attendance/calendar", 200)
        wait_url(cfg["web_url"] + "/.env", 404)
        wait_url(cfg["web_url"] + "/.git/config", 404)
        client = Path(previous_spa / "client")
        static_files = sorted(path for path in client.rglob("*") if path.is_file() and path.suffix in (".js", ".css"))
        require(bool(static_files), "verified SPA contains no JS/CSS asset for Caddy validation")
        rel = static_files[0].relative_to(client).as_posix()
        asset_url = cfg["web_url"] + "/" + rel
        wait_url(asset_url, 200)
        asset_headers = run(["curl", "--silent", "--show-error", "--dump-header", "-", "--output", os.devnull,
                             "--max-time", "10", asset_url])
        status_lines = [line for line in asset_headers.stdout.splitlines() if line.startswith("HTTP/")]
        headers = {key.lower(): value.strip() for line in asset_headers.stdout.splitlines()
                   if ":" in line for key, _, value in (line.partition(":"),)}
        require(status_lines and status_lines[-1].split()[1] == "200",
                "static asset response did not return HTTP 200")
        expected_content_types = {".js": {"text/javascript", "application/javascript"}, ".css": {"text/css"}}
        content_type = headers.get("content-type", "").split(";", 1)[0].strip().lower()
        require(content_type in expected_content_types[static_files[0].suffix],
                "static asset returned an unexpected MIME type")
        etag = headers.get("etag")
        require(bool(etag), "static asset response did not include an ETag cache validator")
        conditional = run(["curl", "--silent", "--show-error", "--output", os.devnull,
                           "--write-out", "%{http_code}", "--header", f"If-None-Match: {etag}", asset_url])
        require(conditional.stdout == "304", "conditional static asset request did not return HTTP 304")
        REPORT["checks"]["authenticated_api_spa_dotfiles"] = (
            "synthetic login, auth/me, deep route, and dotfile protection passed"
        )
        REPORT["checks"]["static_asset"] = {"status": 200, "content_type": content_type,
                                            "etag": "present", "conditional_status": 304}

        deploy.service_call(cfg, "restart", api_service)
        wait_url(cfg["api_url"] + "/health")
        wait_url(cfg["api_url"] + "/ready")
        login_synthetic_admin(cfg["web_url"], admin_username, admin_password)
        sqlite_after_api_restart = run(
            ["bun", "-e", SQLITE_ASSERTION, str(cfg["data_dir"] / "operatoros.sqlite"), admin_username],
            env=system_environment(), timeout=30,
        )
        REPORT["checks"]["sqlite_after_api_restart"] = json.loads(sqlite_after_api_restart.stdout)
        deploy.service_call(cfg, "restart", caddy_service)
        wait_url(cfg["web_url"] + "/ready")
        login_synthetic_admin(cfg["web_url"], admin_username, admin_password)
        REPORT["checks"]["quadlet_restart"] = (
            "API and Caddy Quadlet user services restarted and passed readiness and authentication"
        )

        legacy_release_id = "legacy-" + SOURCE_SHA
        lock_path = workspace / "deploy/.operatoros-deploy.lock"

        def locked_application_state() -> dict[str, Any]:
            return {
                "database": deploy.sha_db_snapshot(cfg["data_dir"]),
                "spa_current": os.readlink(cfg["root"] / "web/current"),
                "api_unit_sha256": hashlib.sha256(api_unit.read_bytes()).hexdigest(),
                "caddy_unit_sha256": hashlib.sha256(caddy_unit.read_bytes()).hexdigest(),
                "systemd_active": {
                    service: deploy.command(["systemctl", "--user", "is-active", service]).strip()
                    for service in services
                },
                "containers": sorted(deploy.command(
                    ["podman", "ps", "--all", "--format", "{{.ID}} {{.Image}} {{.Names}} {{.State}}"], env
                ).splitlines()),
            }

        lock_holder = subprocess.Popen([
            sys.executable, "-c",
            "import fcntl,sys,time; f=open(sys.argv[1],'r+b'); fcntl.flock(f,fcntl.LOCK_EX); print('locked',flush=True); time.sleep(20)",
            str(lock_path),
        ], env=system_environment(), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            require(lock_holder.stdout is not None and lock_holder.stdout.readline().strip() == "locked",
                    "could not establish the synthetic deployment lock")
            locked_state_before = locked_application_state()
            locked = run_cli([str(ROOT / "scripts/operatoros-deploy.sh"), "rollback", legacy_release_id,
                              "--config", str(config), "--yes"], expect_success=False)
            require("another OperatorOS deployment or rollback holds the lock" in locked.stderr,
                    "deployment lock did not reject a concurrent rollback")
            require(locked_application_state() == locked_state_before,
                    "lock-rejected rollback changed the synthetic database, SPA, units, services, or containers")
        finally:
            lock_holder.terminate()
            lock_holder.wait(timeout=5)
        REPORT["checks"]["concurrent_lock_rejected"] = True
        REPORT["checks"]["locked_application_state_unchanged"] = True

        before_rollback = deploy.sha_db_snapshot(cfg["data_dir"])
        rollback = run_cli([str(ROOT / "scripts/operatoros-deploy.sh"), "rollback", legacy_release_id,
                            "--config", str(config), "--yes"])
        require(rollback.returncode == 0 and "rolled_back" in rollback.stdout,
                "application-only rollback failed")
        require(deploy.sha_db_snapshot(cfg["data_dir"]) == before_rollback,
                "SQLite main/WAL/SHM changed during application-only rollback")
        wait_url(cfg["web_url"] + "/", 200)
        shell_response = subprocess.run(["curl", "--silent", "--show-error", "--max-time", "10", cfg["web_url"] + "/"],
                                        env=system_environment(), capture_output=True, text=True, check=False)
        require(shell_response.returncode == 0 and "synthetic previous application shell" in shell_response.stdout,
                "rollback did not restore the previous synthetic SPA")
        login_synthetic_admin(cfg["web_url"], admin_username, admin_password)
        sqlite_after_rollback = run(
            ["bun", "-e", SQLITE_ASSERTION, str(cfg["data_dir"] / "operatoros.sqlite"), admin_username],
            env=system_environment(), timeout=30,
        )
        REPORT["checks"]["sqlite_after_rollback"] = json.loads(sqlite_after_rollback.stdout)
        rolled_back_status = json.loads(run_cli([str(ROOT / "scripts/operatoros-deploy.sh"), "status",
                                                 "--config", str(config)]).stdout)
        require(rolled_back_status.get("state") == "healthy", "rollback did not restore a healthy application state")
        REPORT["checks"]["application_rollback_sqlite_preserved"] = True

        interrupted_db_before = deploy.sha_db_snapshot(cfg["data_dir"])
        interrupted_previous = {
            "old_release_path": str(previous_spa.resolve(strict=True)),
            "old_release_id": previous_spa.name,
            "old_image_ref": image_ref,
            "old_image_id": release.manifest["image"]["image_id"],
            "old_commit": SOURCE_SHA,
            "release_id": legacy_release_id,
            "db_snapshot": interrupted_db_before,
        }
        interrupted_tx = deploy.snapshot_state(
            cfg, interrupted_previous, "interrupted-" + str(time.time_ns())
        )
        deployed_spa = cfg["root"] / "web/releases" / request.release_id
        deploy.switch_pointer(cfg, deployed_spa)
        deploy.service_call(cfg, "restart", caddy_service)
        deploy.update_transaction(deploy.active_transaction(cfg), interrupted_tx, "caddy_restarted")
        interrupted = json.loads(run_cli([str(ROOT / "scripts/operatoros-deploy.sh"), "status",
                                          "--config", str(config)]).stdout)
        require(interrupted.get("state") == "incomplete_transaction",
                "interrupted deployment transaction was not reported")
        REPORT["checks"]["interrupted_transaction_reported"] = True

        recovered = run_cli([str(ROOT / "scripts/operatoros-deploy.sh"), "rollback", legacy_release_id,
                             "--config", str(config), "--yes"])
        require(recovered.returncode == 0 and "rolled_back" in recovered.stdout,
                "interrupted deployment could not restore its recorded previous release")
        require(deploy.sha_db_snapshot(cfg["data_dir"]) == interrupted_db_before,
                "SQLite main/WAL/SHM changed during interrupted transaction recovery")
        final_status = json.loads(run_cli([str(ROOT / "scripts/operatoros-deploy.sh"), "status",
                                           "--config", str(config)]).stdout)
        require(final_status.get("state") == "healthy" and
                final_status.get("current_release", {}).get("release_id") == legacy_release_id,
                "interrupted transaction recovery did not restore a healthy previous application")
        sqlite_after_recovery = run(
            ["bun", "-e", SQLITE_ASSERTION, str(cfg["data_dir"] / "operatoros.sqlite"), admin_username],
            env=system_environment(), timeout=30,
        )
        REPORT["checks"]["sqlite_after_interrupted_recovery"] = json.loads(sqlite_after_recovery.stdout)
        REPORT["checks"]["interrupted_transaction_recovered"] = True
        REPORT["rollback_scope"] = (
            "same API image; rollback restored a distinct synthetic SPA target, not a second release artifact"
        )
        REPORT["result"] = "synthetic deployment, application rollback, and interrupted recovery passed"

    write_json(diagnostics / "rehearsal-evidence.json", REPORT)


def main() -> int:
    global DIAGNOSTICS, PODMAN_CONTEXT_VERIFIED
    PODMAN_CONTEXT_VERIFIED = False
    REPORT.pop("podman_context", None)
    runner_temp: Path | None = None
    workspace: Path | None = None
    diagnostics: Path | None = None
    services: tuple[str, str] | None = None
    units_created: set[Path] = set()
    unit_dirs_created: list[Path] = []
    failure: Exception | None = None
    cleanup_failure: Exception | None = None
    try:
        runner_temp, workspace, diagnostics, services = validate_workflow_context()
        DIAGNOSTICS = diagnostics
        REPORT["runner"] = preflight_runner(runner_temp, services)
        REPORT["checks"]["runner_capabilities"] = "qualified for rootless Podman/Quadlet preflight"
        unit_dir = Path.home() / ".config/containers/systemd"
        rehearse(workspace, diagnostics, services, units_created, unit_dirs_created)
    except Exception as error:
        failure = error
        retain_context_failure(error)
        REPORT["result"] = "failed"
        REPORT["failures"].append(failure_kind(error))
        if diagnostics is not None:
            try:
                write_json(diagnostics / "rehearsal-evidence.json", REPORT)
            except OSError:
                pass
    finally:
        if workspace is not None and runner_temp is not None and diagnostics is not None:
            try:
                if services is not None and units_created:
                    remove_run_units(Path.home() / ".config/containers/systemd", services, units_created)
                remove_created_unit_directories(unit_dirs_created)
                cleanup_workspace(workspace, runner_temp, diagnostics)
                REPORT["checks"]["cleanup"] = "run-scoped units stopped and disposable VFS workspace removed"
                if isinstance(REPORT.get("podman_context"), dict):
                    REPORT["podman_context"]["cleanup_status"] = "passed"
            except Exception as error:
                cleanup_failure = error
                REPORT["failures"].append(failure_kind(error))
                REPORT["result"] = "failed_cleanup"
                if isinstance(REPORT.get("podman_context"), dict):
                    REPORT["podman_context"]["cleanup_status"] = "failed"
            try:
                write_json(diagnostics / "rehearsal-evidence.json", REPORT)
            except OSError:
                cleanup_failure = cleanup_failure or RehearsalError("could not write final diagnostics")
    REPORT["rehearsal_exit_code"] = 1 if failure is not None or cleanup_failure is not None else 0
    if diagnostics is not None:
        try:
            write_json(diagnostics / "rehearsal-evidence.json", REPORT)
        except OSError:
            cleanup_failure = cleanup_failure or RehearsalError("could not write rehearsal exit status")
    if failure is not None and cleanup_failure is not None:
        print(f"Rehearsal failed ({failure_kind(failure)}); cleanup also failed ({failure_kind(cleanup_failure)})",
              file=sys.stderr)
        return 1
    if failure is not None:
        print(f"Rehearsal failed ({failure_kind(failure)})", file=sys.stderr)
        return 1
    if cleanup_failure is not None:
        print(f"Rehearsal cleanup failed ({failure_kind(cleanup_failure)})", file=sys.stderr)
        return 1
    print("PHASE_3B_SYNTHETIC_REHEARSAL_PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
