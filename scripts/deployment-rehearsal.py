#!/usr/bin/env python3
"""Run one explicit, disposable GitHub-hosted deployment rehearsal."""

from __future__ import annotations

import base64
from http.cookiejar import CookieJar
import json
import os
from pathlib import Path
import pwd
import re
import secrets
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
SOURCE_SHA = "278faae7a027cf1c96326d32a9b796618d75620e"
RELEASE_RUN_ID = "41987515713"
RELEASE_ATTEMPT = "1"
ARTIFACT_ID = "13396749662"
ARTIFACT_NAME = f"operatoros-release-{SOURCE_SHA}-{RELEASE_RUN_ID}-{RELEASE_ATTEMPT}"
INNER_BUNDLE_SHA256 = "a8a1555d2184ca1daeeb2d4d4d48dceffd08961215c125721d8ed7b108a18435"
ENVELOPE_SHA256 = "sha256:22829ed9a872500fae1d793fda85059384321ccf827fcd770cc2401ae6458cf7"
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
        check: bool = True, log_output: bool = True,
        input_data: str | None = None) -> subprocess.CompletedProcess[str]:
    try:
        result = subprocess.run(args, env=env if env is not None else system_environment(), capture_output=True, text=True,
                                input=input_data, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise RehearsalError(f"command could not complete: {Path(args[0]).name}: {type(error).__name__}") from error
    if log_output:
        log(f"command={Path(args[0]).name} exit={result.returncode}")
        output = (result.stdout + result.stderr).strip()
        if output:
            for line in output[-4_000:].splitlines():
                log("output=" + line[:1_000])
    if check and result.returncode != 0:
        raise RehearsalError(f"command failed: {Path(args[0]).name} exited {result.returncode}")
    return result


DIAGNOSTICS: Path | None = None
REPORT: dict[str, Any] = {"schema_version": 1, "checks": {}, "failures": []}


def system_environment() -> dict[str, str]:
    names = ("PATH", "HOME", "LANG", "LC_ALL", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS")
    return {name: os.environ[name] for name in names if name in os.environ}


def log(message: str) -> None:
    print(message, flush=True)
    if DIAGNOSTICS is not None:
        with (DIAGNOSTICS / "rehearsal.log").open("a", encoding="utf-8") as output:
            output.write(message.replace(str(DIAGNOSTICS.parent), "<runner-temp>")[:2_000] + "\n")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RehearsalError(message)


def command_text(args: list[str], *, env: dict[str, str] | None = None, timeout: int = 30) -> str:
    result = run(args, env=env, timeout=timeout, log_output=False)
    return result.stdout.strip()


def create_podman_secret(name: str, value: str, env: dict[str, str]) -> None:
    run(["podman", "secret", "create", name, "-"], env=env,
        input_data=value, log_output=False)


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


def private_env(workspace: Path, *, include_runtime: bool = True) -> dict[str, str]:
    result = system_environment()
    result["REGISTRY_AUTH_FILE"] = str(workspace / "deploy/registry-auth.json")
    if include_runtime:
        result["CONTAINERS_STORAGE_CONF"] = str(workspace / "deploy/storage.conf")
    for key in ("CONTAINER_HOST", "CONTAINER_CONNECTION", "DOCKER_HOST", "CONTAINERS_CONF"):
        require(not os.environ.get(key), f"refusing an alternate or remote Podman context: {key}")
    return result


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
                   created: set[Path]) -> tuple[Path, Path, Path]:
    root = workspace
    deploy_dir = root / "deploy"
    data_dir = root / "data"
    api_unit = unit_dir / (api_service.removesuffix(".service") + ".container")
    caddy_unit = unit_dir / (caddy_service.removesuffix(".service") + ".container")
    api_copy = deploy_dir / "operatoros-lite-api.container"
    storage_conf = deploy_dir / "storage.conf"
    atomic_text(storage_conf, f'[storage]\ndriver="vfs"\ngraphroot="{root / "podman-rootless/graphroot"}"\nrunroot="{root / "podman-rootless/runroot"}"\n')
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
Environment=CONTAINERS_STORAGE_CONF={storage_conf}
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
Environment=CONTAINERS_STORAGE_CONF={storage_conf}
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
                api_service: str, caddy_service: str, api_port: int, web_port: int) -> Path:
    values: dict[str, str | int] = {
        "root": str(workspace),
        "expected_uid": os.getuid(),
        "storage_conf": str(workspace / "deploy/storage.conf"),
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


def image_identity_for_release(deploy: Any, release: Any, workspace: Path) -> str:
    archive = workspace / "deploy/operatoros-api.oci.tar"
    archive.write_bytes(release.files["operatoros-api.oci.tar"])
    archive.chmod(0o600)
    env = private_env(workspace)
    deploy.command(["podman", "load", "--input", str(archive)], env, timeout=300)
    image = release.manifest["image"]
    image_id = "sha256:" + image["image_id"].removeprefix("sha256:")
    deploy.validate_image_after_load(image_id, SOURCE_SHA, image["source_tree_sha256"], image["manifest_digest"],
                                     {"storage_conf": workspace / "deploy/storage.conf",
                                      "graphroot": workspace / "podman-rootless/graphroot",
                                      "runroot": workspace / "podman-rootless/runroot"})
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


def setup_synthetic_database(workspace: Path, source_sha: str) -> tuple[str, str, str, str, str, str]:
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
    podman_env = private_env(workspace)
    create_podman_secret(auth_secret_name, cookie_secret, podman_env)
    create_podman_secret(backup_secret_name, backup_key, podman_env)
    api_env = workspace / "deploy/api.env"
    env_values = api_environment(source_sha, os.environ["OPERATOROS_REHEARSAL_ORIGIN"])
    atomic_text(api_env, "".join(f"{key}={value}\n" for key, value in env_values.items()))
    base_env = private_env(workspace, include_runtime=False)
    db_env = base_env | {"OPERATOROS_DATA_DIR": str(data_dir)}
    run(["bun", "packages/db/src/db-cli.ts", "bootstrap", "--data-dir", str(data_dir)],
        env=db_env, timeout=120)
    seed_env = db_env | {"OPERATOROS_E2E_ADMIN_USERNAME": admin_username,
                         "OPERATOROS_E2E_ADMIN_PASSWORD": admin_password}
    run(["bun", "e2e/helpers/seed-test-database.ts", "--database", str(data_dir / "operatoros.sqlite"),
         "--runtime-root", str(workspace)], env=seed_env, timeout=120, log_output=False)

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
    log(f"deployment_cli={args[1] if len(args) > 1 else 'unknown'} exit={result.returncode}")
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
    env = private_env(workspace)
    env.update({"TMPDIR": str(runner_temp)})
    result = subprocess.run([
        sys.executable, str(path), str(workspace), str(runner_temp),
        "--diagnostics-dir", str(diagnostics),
    ], env=env, capture_output=True, text=True, timeout=300, check=False)
    for line in (result.stdout + result.stderr).strip().splitlines():
        log("cleanup=" + line[:1_000])
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

    uid = os.getuid()
    api_service, caddy_service = services
    unit_dir = Path.home() / ".config/containers/systemd"
    workspace.mkdir(mode=0o700)
    os.chmod(workspace, 0o700)
    for name in ("deploy", "data", "data/backups", "web", "web/releases", "podman-rootless",
                 "podman-rootless/graphroot", "podman-rootless/runroot"):
        (workspace / name).mkdir(mode=0o700, parents=True, exist_ok=True)
    atomic_text(workspace / "deploy/registry-auth.json", "{}\n")
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

    graphroot = workspace / "podman-rootless/graphroot"
    runroot = workspace / "podman-rootless/runroot"
    storage_conf = workspace / "deploy/storage.conf"
    atomic_text(storage_conf, f'[storage]\ndriver="vfs"\ngraphroot="{graphroot}"\nrunroot="{runroot}"\n')
    env = private_env(workspace)
    info = json.loads(deploy.command(["podman", "info", "--format", "json"], env))
    require(info["host"]["security"]["rootless"] is True, "Podman is not running rootless")
    require(Path(info["store"]["graphRoot"]).resolve() == graphroot.resolve() and
            Path(info["store"]["runRoot"]).resolve() == runroot.resolve() and
            info["store"].get("graphDriverName") == "vfs",
            "Podman did not select the disposable VFS storage context")
    require(str(info["host"].get("cgroupsVersion", "")) == "v2", "rootless Podman is not using cgroup v2")
    require(info["host"].get("cgroupManager") == "systemd",
            "rootless Podman is not using the user systemd cgroup manager")
    uid_map = deploy.command(["podman", "unshare", "cat", "/proc/self/uid_map"], env)
    gid_map = deploy.command(["podman", "unshare", "cat", "/proc/self/gid_map"], env)
    for mapping in (uid_map, gid_map):
        require(sum(int(line.split()[2]) for line in mapping.splitlines() if len(line.split()) == 3) >= 65_536,
                "Podman user namespace does not expose the required subordinate ID range")
    REPORT["checks"]["podman_context"] = "rootless dedicated VFS store, systemd cgroup v2, subordinate ID maps verified"

    request = deploy.ReleaseRequest(SOURCE_SHA, RELEASE_RUN_ID, RELEASE_ATTEMPT,
                                    ARTIFACT_ID, ARTIFACT_NAME, ENVELOPE_SHA256)
    with tempfile.TemporaryDirectory(prefix="verified-artifact.", dir=workspace / "deploy") as temporary:
        verified = deploy.verified_artifact(request, Path(temporary))
        require(verified.bundle_sha256 == INNER_BUNDLE_SHA256,
                "verified inner bundle checksum differs from the approved rehearsal artifact")
        release = verified
        image_ref = image_identity_for_release(deploy, release, workspace)
        deploy.command(["podman", "pull", deploy.CADDY_IMAGE], env, timeout=300)

        (admin_username, admin_password, cookie_secret, backup_key,
         auth_secret_name, backup_secret_name) = setup_synthetic_database(workspace, SOURCE_SHA)
        # Seed a deliberately distinct previous SPA target so rollback visibly restores application files.
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

        # Create the encrypted backup after schema rejection and before starting services.
        backup_env = env | api_environment(SOURCE_SHA, origin) | {
            "OPERATOROS_DATA_DIR": str(workspace / "data"),
            "AUTH_COOKIE_SECRET": cookie_secret,
            "BACKUP_ENCRYPTION_KEY": backup_key,
        }
        run(["bun", "apps/api/src/backup-cli.ts", "backup"], env=backup_env,
            timeout=120, log_output=False)
        backups = list((workspace / "data/backups").glob("backup_*.sqlite3"))
        require(len(backups) == 1, "expected exactly one synthetic encrypted backup")

        (workspace / "deploy/Caddyfile").write_text(make_caddyfile(web_port, api_port), encoding="utf-8")
        (workspace / "deploy/Caddyfile").chmod(0o600)
        create_unit_directory(unit_dir, unit_dirs_created)
        api_unit, caddy_unit, api_copy = write_quadlets(
            workspace, unit_dir, api_service, caddy_service, api_port, web_port,
            image_ref, auth_secret_name, backup_secret_name, units_created,
        )
        config = toml_config(workspace, api_unit, caddy_unit, api_copy, api_service, caddy_service,
                             api_port, web_port)
        cfg = deploy.load_config(config)
        require(cfg["profile"] == "rehearsal" and cfg["expected_uid"] == uid,
                "deployment CLI did not accept the exact isolated rehearsal profile")
        deploy.switch_pointer(cfg, previous_spa)

        deploy.command(["systemctl", "--user", "daemon-reload"], timeout=60)
        deploy.verify_quadlet_service(api_service, api_unit, require_active=False)
        deploy.verify_quadlet_service(caddy_service, caddy_unit, require_active=False)
        for service in services:
            unit_env = deploy.command(["systemctl", "--user", "show", "--property=Environment", "--value", service], timeout=20)
            require("CONTAINERS_STORAGE_CONF=" + str(storage_conf) in unit_env,
                    "Quadlet service does not inherit the run-scoped Podman storage configuration")
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

        deploy_result = run_cli(deployment_command(config, "deploy", backup_name=backups[0].name), needs_token=True)
        if deploy_result.stdout:
            (diagnostics / "deploy-result.json").write_text(deploy_result.stdout, encoding="utf-8")
            (diagnostics / "deploy-result.json").chmod(0o600)
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

        login_synthetic_admin(cfg["web_url"], admin_username, admin_password)
        wait_url(cfg["web_url"] + "/attendance/calendar", 200)
        wait_url(cfg["web_url"] + "/.env", 404)
        # The release verifier already checked the SPA archive. Ask Caddy for one real file by its retained tree.
        client = Path(previous_spa / "client")
        static_files = [path for path in client.rglob("*") if path.is_file() and path.suffix in (".js", ".css")]
        require(bool(static_files), "verified SPA contains no JS/CSS asset for Caddy validation")
        rel = static_files[0].relative_to(client).as_posix()
        wait_url(cfg["web_url"] + "/" + rel, 200)
        REPORT["checks"]["authenticated_api_spa_dotfiles"] = "synthetic login, auth/me, deep route, static asset, dotfile 404 passed"

        # A held deployment lock must reject rollback without reaching Podman or systemd state changes.
        lock_path = workspace / "deploy/.operatoros-deploy.lock"
        lock_holder = subprocess.Popen([
            sys.executable, "-c",
            "import fcntl,sys,time; f=open(sys.argv[1],'r+b'); fcntl.flock(f,fcntl.LOCK_EX); print('locked',flush=True); time.sleep(20)",
            str(lock_path),
        ], env=system_environment(), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            require(lock_holder.stdout is not None and lock_holder.stdout.readline().strip() == "locked",
                    "could not establish the synthetic deployment lock")
            locked = run_cli([str(ROOT / "scripts/operatoros-deploy.sh"), "rollback", "legacy-" + SOURCE_SHA,
                              "--config", str(config), "--yes"], expect_success=False)
            require("another OperatorOS deployment or rollback holds the lock" in locked.stderr,
                    "deployment lock did not reject a concurrent rollback")
        finally:
            lock_holder.terminate()
            lock_holder.wait(timeout=5)
        REPORT["checks"]["concurrent_lock_rejected"] = True

        marker = deploy.active_transaction(cfg)
        deploy.update_transaction(marker, {"schema_version": 1, "transaction_id": "synthetic-interruption"}, "api_restarted")
        interrupted = json.loads(run_cli([str(ROOT / "scripts/operatoros-deploy.sh"), "status",
                                          "--config", str(config)]).stdout)
        require(interrupted.get("state") == "incomplete_transaction",
                "incomplete deployment transaction was not reported")
        marker.unlink()
        REPORT["checks"]["interrupted_transaction_reported"] = True

        before_rollback = deploy.sha_db_snapshot(cfg["data_dir"])
        rollback = run_cli([str(ROOT / "scripts/operatoros-deploy.sh"), "rollback", "legacy-" + SOURCE_SHA,
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
        final_status = json.loads(run_cli([str(ROOT / "scripts/operatoros-deploy.sh"), "status",
                                           "--config", str(config)]).stdout)
        require(final_status.get("state") == "healthy", "rollback did not restore a healthy application state")
        REPORT["checks"]["application_rollback_sqlite_preserved"] = True
        REPORT["result"] = "synthetic deployment and application rollback passed"

    write_json(diagnostics / "rehearsal-evidence.json", REPORT)


def main() -> int:
    global DIAGNOSTICS
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
        REPORT["result"] = "failed"
        REPORT["failures"].append(str(error)[:1_000])
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
            except Exception as error:
                cleanup_failure = error
                REPORT["failures"].append(str(error)[:1_000])
                REPORT["result"] = "failed_cleanup"
            try:
                write_json(diagnostics / "rehearsal-evidence.json", REPORT)
            except OSError:
                cleanup_failure = cleanup_failure or RehearsalError("could not write final diagnostics")
    if failure is not None and cleanup_failure is not None:
        print(f"Rehearsal failed: {failure}; cleanup also failed: {cleanup_failure}", file=sys.stderr)
        return 1
    if failure is not None:
        print(f"Rehearsal failed: {failure}", file=sys.stderr)
        return 1
    if cleanup_failure is not None:
        print(f"Rehearsal cleanup failed: {cleanup_failure}", file=sys.stderr)
        return 1
    print("PHASE_3B_SYNTHETIC_REHEARSAL_PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
