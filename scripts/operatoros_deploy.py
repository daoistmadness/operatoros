#!/usr/bin/env python3
"""Verify and install an attested OperatorOS release on one rootless host."""

from __future__ import annotations

import argparse
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import tarfile
import time
import tomllib
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener
import zipfile


REPOSITORY = "daoistmadness/operatoros"
WORKFLOW = ".github/workflows/ci.yml"
ARTIFACT_PREFIX = "operatoros-release-"
API_IMAGE_LABELS = {
    "revision": "org.opencontainers.image.revision",
    "source_dirty": "org.operatoros.source.dirty",
    "source_tree_sha256": "org.operatoros.source.tree-sha256",
}
MAX_ENVELOPE_BYTES = 1_000_000_000
MAX_BUNDLE_BYTES = 256 * 1024 * 1024
MAX_OUTER_MEMBERS = 4
MAX_TAR_MEMBERS = 16
MAX_SPA_MEMBERS = 10_000
MAX_SPA_BYTES = 256 * 1024 * 1024
API_NAME = "operatoros-lite-api"
CADDY_NAME = "operatoros-lite-caddy"
CADDY_IMAGE = "docker.io/library/caddy@sha256:e70b164da81ef698b3ad19af799ea6086ce6d9e48ed4079eb9fe26f6fbf14ee5"
REHEARSAL_WORKSPACE_PREFIX = "operatoros-deployment-rehearsal."


class DeployError(RuntimeError):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, new_url):
        return None


@dataclass(frozen=True)
class ReleaseRequest:
    source_sha: str
    run_id: str
    run_attempt: str
    artifact_id: str
    artifact_name: str
    envelope_sha256: str

    @property
    def release_id(self) -> str:
        return f"{self.source_sha}-{self.run_id}-{self.run_attempt}"


@dataclass(frozen=True)
class VerifiedRelease:
    bundle_path: Path
    files: dict[str, bytes]
    manifest: dict[str, Any]
    envelope_sha256: str
    bundle_sha256: str
    artifact_id: str
    artifact_name: str


@dataclass(frozen=True)
class PrivatePodmanContext:
    root: Path
    storage_conf: Path
    containers_conf: Path
    graphroot: Path
    runroot: Path
    static_dir: Path
    volume_path: Path
    image_copy_tmp_dir: Path
    xdg_config_home: Path
    xdg_data_home: Path
    home: Path
    registry_auth_file: Path

    def environment(self) -> dict[str, str]:
        return {
            "HOME": str(self.home),
            "CONTAINERS_STORAGE_CONF": str(self.storage_conf),
            "CONTAINERS_CONF": str(self.containers_conf),
            "XDG_CONFIG_HOME": str(self.xdg_config_home),
            "XDG_DATA_HOME": str(self.xdg_data_home),
            "REGISTRY_AUTH_FILE": str(self.registry_auth_file),
            "TMPDIR": str(self.image_copy_tmp_dir),
        }

    def quadlet_environment(self) -> list[str]:
        lines = []
        for name, value in self.environment().items():
            # These values are generated absolute paths. Refuse systemd quoting or
            # specifier syntax instead of trying to reinterpret an unexpected path.
            if not re.fullmatch(r"[A-Z_]+", name) or not re.fullmatch(r"/[A-Za-z0-9_./-]+", value):
                raise DeployError("private Podman environment cannot be represented safely in Quadlet")
            lines.append(f"Environment={name}={value}")
        return lines


def create_private_podman_context(root: Path) -> PrivatePodmanContext:
    """Create a fresh Podman context whose persistent paths live under root."""
    supplied_root = root.absolute()
    root = root.resolve(strict=True)
    if supplied_root != root:
        raise DeployError("private Podman context root must not use symlinks or non-canonical components")
    root_info = root.lstat()
    if (not stat.S_ISDIR(root_info.st_mode) or stat.S_ISLNK(root_info.st_mode) or
        root_info.st_uid != os.getuid() or stat.S_IMODE(root_info.st_mode) != 0o700):
        raise DeployError("private Podman context root must be a canonical runner-owned mode-0700 directory")

    podman_root = root / "podman-rootless"
    paths = {
        "home": podman_root / "home",
        "graphroot": podman_root / "graphroot",
        "runroot": podman_root / "runroot",
        "static_dir": podman_root / "metadata",
        "volume_path": podman_root / "volumes",
        "image_copy_tmp_dir": podman_root / "image-tmp",
        "xdg_config_home": podman_root / "xdg-config",
        "xdg_data_home": podman_root / "xdg-data",
    }
    for path in (podman_root, *paths.values(), paths["xdg_config_home"] / "containers"):
        try:
            path.mkdir(mode=0o700, parents=True, exist_ok=True)
            info = path.lstat()
        except OSError as error:
            raise DeployError("could not create the private Podman context") from error
        if (not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode) or
            info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077 or
            path.resolve(strict=True) != path):
            raise DeployError("private Podman context contains an unsafe path")

    deploy_dir = root / "deploy"
    deploy_dir.mkdir(mode=0o700, exist_ok=True)
    deploy_info = deploy_dir.lstat()
    if (not stat.S_ISDIR(deploy_info.st_mode) or stat.S_ISLNK(deploy_info.st_mode) or
        deploy_info.st_uid != os.getuid() or stat.S_IMODE(deploy_info.st_mode) & 0o077 or
        deploy_dir.resolve(strict=True) != deploy_dir):
        raise DeployError("private Podman configuration directory is unsafe")

    storage_conf = deploy_dir / "storage.conf"
    containers_conf = deploy_dir / "containers.conf"
    registry_auth_file = deploy_dir / "registry-auth.json"
    storage_text = (
        "[storage]\n"
        'driver = "vfs"\n'
        f'graphroot = "{paths["graphroot"]}"\n'
        f'runroot = "{paths["runroot"]}"\n'
    )
    containers_text = (
        "[engine]\n"
        'cgroup_manager = "systemd"\n'
        f'static_dir = "{paths["static_dir"]}"\n'
        f'volume_path = "{paths["volume_path"]}"\n'
        f'image_copy_tmp_dir = "{paths["image_copy_tmp_dir"]}"\n'
    )
    for path, content in ((storage_conf, storage_text), (containers_conf, containers_text)):
        try:
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
            with os.fdopen(descriptor, "w", encoding="utf-8") as output:
                output.write(content)
        except OSError as error:
            raise DeployError("private Podman configuration already exists or cannot be created") from error

    try:
        descriptor = os.open(registry_auth_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL |
                             getattr(os, "O_NOFOLLOW", 0), 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            output.write("{}\n")
    except OSError as error:
        raise DeployError("private Podman registry-auth file cannot be created") from error

    for path in (storage_conf, containers_conf, registry_auth_file):
        info = path.lstat()
        if (not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode) or info.st_nlink != 1 or
            info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600):
            raise DeployError("private Podman configuration has unsafe ownership or permissions")

    return PrivatePodmanContext(
        root=root,
        storage_conf=storage_conf,
        containers_conf=containers_conf,
        graphroot=paths["graphroot"],
        runroot=paths["runroot"],
        static_dir=paths["static_dir"],
        volume_path=paths["volume_path"],
        image_copy_tmp_dir=paths["image_copy_tmp_dir"],
        xdg_config_home=paths["xdg_config_home"],
        xdg_data_home=paths["xdg_data_home"],
        home=paths["home"],
        registry_auth_file=registry_auth_file,
    )


def podman_context_from_workspace(root: Path) -> PrivatePodmanContext:
    root = root.resolve(strict=True)
    podman_root = root / "podman-rootless"
    deploy_dir = root / "deploy"
    return PrivatePodmanContext(
        root=root,
        storage_conf=deploy_dir / "storage.conf",
        containers_conf=deploy_dir / "containers.conf",
        graphroot=podman_root / "graphroot",
        runroot=podman_root / "runroot",
        static_dir=podman_root / "metadata",
        volume_path=podman_root / "volumes",
        image_copy_tmp_dir=podman_root / "image-tmp",
        xdg_config_home=podman_root / "xdg-config",
        xdg_data_home=podman_root / "xdg-data",
        home=podman_root / "home",
        registry_auth_file=deploy_dir / "registry-auth.json",
    )


def validate_private_podman_config(context: PrivatePodmanContext) -> None:
    """Validate private config files before starting Podman or creating units."""
    for path in (context.storage_conf, context.containers_conf, context.registry_auth_file):
        require_regular_owned(path, os.getuid(), "private Podman configuration", 0o077)
        if path.resolve(strict=True) != path:
            raise DeployError("private Podman configuration path is not canonical")
    if context.registry_auth_file.read_bytes() != b"{}\n":
        raise DeployError("private Podman registry-auth file must not contain credentials")
    try:
        storage_config = tomllib.loads(context.storage_conf.read_text(encoding="utf-8"))
        containers_config = tomllib.loads(context.containers_conf.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError) as error:
        raise DeployError("private Podman configuration is malformed") from error
    storage = storage_config.get("storage")
    containers = containers_config.get("engine")
    if (set(storage_config) != {"storage"} or not isinstance(storage, dict) or
        set(storage) != {"driver", "graphroot", "runroot"} or storage.get("driver") != "vfs" or
        storage.get("graphroot") != str(context.graphroot) or storage.get("runroot") != str(context.runroot)):
        raise DeployError("private storage.conf selects an unexpected image or container store")
    expected_engine = {
        "cgroup_manager": "systemd",
        "static_dir": str(context.static_dir),
        "volume_path": str(context.volume_path),
        "image_copy_tmp_dir": str(context.image_copy_tmp_dir),
    }
    if (set(containers_config) != {"engine"} or not isinstance(containers, dict) or
        set(containers) != set(expected_engine) or
        any(containers.get(key) != value for key, value in expected_engine.items())):
        raise DeployError("private containers.conf metadata paths differ from the rehearsal workspace")
    for path in (context.root, context.root / "podman-rootless", context.home, context.graphroot,
                 context.runroot, context.static_dir, context.volume_path, context.image_copy_tmp_dir,
                 context.xdg_config_home, context.xdg_data_home, context.xdg_config_home / "containers"):
        info = path.lstat()
        if (not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode) or info.st_uid != os.getuid() or
            stat.S_IMODE(info.st_mode) & 0o077 or path.resolve(strict=True) != path or
            not path.is_relative_to(context.root)):
            raise DeployError("private Podman storage path is unsafe or outside the rehearsal workspace")


def validate_podman_store(info: Any, context: PrivatePodmanContext, *, require_empty: bool = False) -> None:
    validate_private_podman_config(context)
    try:
        host = info["host"]
        store = info["store"]
        expected_paths = {
            "configFile": context.storage_conf,
            "graphRoot": context.graphroot,
            "runRoot": context.runroot,
            "volumePath": context.volume_path,
            "imageCopyTmpDir": context.image_copy_tmp_dir,
        }
        cgroup_version = host.get("cgroupVersion", host.get("cgroupsVersion"))
        if (host["security"]["rootless"] is not True or host.get("serviceIsRemote") is not False or
            cgroup_version != "v2" or host.get("cgroupManager") != "systemd" or
            store.get("graphDriverName") != "vfs"):
            raise DeployError("Podman is not running in the required local rootless VFS/systemd context")
        for key, expected in expected_paths.items():
            actual = Path(store[key])
            if (not actual.is_absolute() or actual.resolve(strict=True) != actual or
                actual != expected or actual != expected.resolve(strict=True)):
                raise DeployError(f"Podman {key} is outside the approved private storage context")
        if "staticDir" in store:
            static_dir = Path(store["staticDir"])
            if (not static_dir.is_absolute() or static_dir.resolve(strict=True) != static_dir or
                static_dir != context.static_dir):
                raise DeployError("Podman staticDir is outside the approved private metadata context")
        additional_stores = store.get("additionalImageStores", [])
        if additional_stores not in ([], None):
            raise DeployError("Podman reported an additional image store outside the private configuration")
        for key in ("imageStore", "containerStore"):
            if not isinstance(store.get(key), dict) or type(store[key].get("number")) is not int:
                raise DeployError(f"Podman did not report a verifiable {key} inventory")
        if require_empty:
            for field in ("containerStore", "imageStore"):
                value = store.get(field)
                if not isinstance(value, dict) or value.get("number") != 0:
                    raise DeployError("private Podman context already contains containers or images")
        if context.static_dir.resolve(strict=True) != context.static_dir:
            raise DeployError("Podman metadata directory is not canonical")
    except (KeyError, TypeError, ValueError, OSError) as error:
        raise DeployError("Podman returned incomplete private storage identity") from error


def stderr_classification(stderr: str) -> str:
    value = stderr.casefold()
    if not value.strip():
        return "empty"
    if ("graph driver" in value and ("overwritten" in value or "overridden" in value) and
        ("database" in value or "store" in value)):
        return "storage-driver-database-override"
    if "additionalimagestore" in value or "additional image store" in value:
        return "additional-image-store-warning"
    if (("graphroot" in value or "runroot" in value or "volumepath" in value) and
        any(word in value for word in ("default", "outside", "fallback", "overridden", "overwritten"))):
        return "storage-path-warning"
    storage_terms = ("storage", "graphroot", "runroot", "imagestore", "volume_path", "volumepath")
    if ("warning" in value or "warn[" in value) and any(word in value for word in storage_terms):
        return "storage-configuration-warning"
    return "present"


def _assert_podman_command(result: subprocess.CompletedProcess[str], args: list[str]) -> None:
    diagnostic = stderr_classification(result.stderr)
    if result.returncode != 0:
        raise DeployError(f"command failed ({result.returncode}): {args[0]} (stderr={diagnostic})")
    if args and Path(args[0]).name == "podman" and diagnostic in {
        "storage-driver-database-override", "additional-image-store-warning", "storage-path-warning",
        "storage-configuration-warning",
    }:
        raise DeployError(f"Podman reported an isolation warning (stderr={diagnostic})")


def command_json(args: list[str], env: dict[str, str] | None = None, *, timeout: int = 60) -> Any:
    result = run_command(args, env=env, timeout=timeout)
    _assert_podman_command(result, args)
    if not result.stdout.strip():
        raise DeployError(f"{args[0]} returned empty JSON (exit={result.returncode}, stderr={stderr_classification(result.stderr)})")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise DeployError(f"{args[0]} returned malformed JSON (stderr={stderr_classification(result.stderr)})") from error


def run_command(args: list[str], env: dict[str, str] | None = None, *, timeout: int = 60) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(args, env=env if env is not None else system_environment(), text=True,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise DeployError(f"command failed to execute: {args[0]} ({type(error).__name__})") from error


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_release_module():
    path = Path(__file__).with_name("release-bundle.py")
    spec = importlib.util.spec_from_file_location("operatoros_release_bundle", path)
    if spec is None or spec.loader is None:
        raise DeployError("repository release-bundle verifier is unavailable")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def load_consumer_cleanup_module():
    path = Path(__file__).with_name("release-consumer-cleanup.py")
    spec = importlib.util.spec_from_file_location("operatoros_consumer_cleanup", path)
    if spec is None or spec.loader is None:
        raise DeployError("rootless Podman cleanup verifier is unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def require_token() -> str:
    token = os.environ.get("OPERATOROS_RELEASE_TOKEN", "")
    if not token:
        raise DeployError("OPERATOROS_RELEASE_TOKEN is required; supply a short-lived, repository-scoped read-only credential")
    if "\n" in token or "\r" in token:
        raise DeployError("OPERATOROS_RELEASE_TOKEN contains invalid characters")
    return token


def api_json(path: str, token: str) -> dict[str, Any]:
    request = Request(
        "https://api.github.com" + path,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": "Bearer " + token,
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "operatoros-deploy",
        },
    )
    try:
        with build_opener(NoRedirect).open(request, timeout=30) as response:
            value = json.load(response)
    except (HTTPError, URLError, TimeoutError, OSError, json.JSONDecodeError) as error:
        raise DeployError(f"GitHub API request failed for {path}: {error}") from error
    if not isinstance(value, dict):
        raise DeployError(f"GitHub API returned an invalid object for {path}")
    return value


def download_artifact(url: str, token: str, destination: Path, expected_size: int) -> None:
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != "api.github.com" or parsed.username or parsed.password:
        raise DeployError("artifact download URL is not the GitHub API endpoint")

    request = Request(url, headers={"Accept": "application/vnd.github+json", "Authorization": "Bearer " + token,
                                    "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "operatoros-deploy"})
    opener = build_opener(NoRedirect)
    try:
        response = opener.open(request, timeout=60)
    except HTTPError as error:
        if error.code not in (301, 302, 303, 307, 308):
            raise DeployError(f"artifact download request failed: HTTP {error.code}") from error
        location = error.headers.get("Location", "")
        parsed_location = urlparse(location)
        host = (parsed_location.hostname or "").lower()
        allowed = ("github.com", "githubusercontent.com", "amazonaws.com", "blob.core.windows.net",
                   "actions.githubusercontent.com")
        if parsed_location.scheme != "https" or not any(host == suffix or host.endswith("." + suffix) for suffix in allowed):
            raise DeployError("GitHub returned an untrusted artifact download host") from error
        # The signed redirect URL is fetched without forwarding the operator credential.
        try:
            response = build_opener().open(Request(location, headers={"User-Agent": "operatoros-deploy"}), timeout=60)
        except (HTTPError, URLError, TimeoutError, OSError) as download_error:
            raise DeployError(f"artifact payload download failed: {download_error}") from download_error
    except (URLError, TimeoutError, OSError) as error:
        raise DeployError(f"artifact download request failed: {error}") from error

    size = 0
    with response, destination.open("xb") as output:
        while chunk := response.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_ENVELOPE_BYTES or size > expected_size:
                raise DeployError("artifact envelope exceeds its declared or allowed size")
            output.write(chunk)
    if size != expected_size:
        raise DeployError("downloaded artifact size differs from GitHub metadata")


def validate_request(request: ReleaseRequest) -> None:
    if not re.fullmatch(r"[0-9a-f]{40}", request.source_sha):
        raise DeployError("source SHA must be 40 lowercase hexadecimal characters")
    for value, label, maximum in ((request.run_id, "run ID", 20), (request.run_attempt, "run attempt", 9),
                                  (request.artifact_id, "artifact ID", 20)):
        if not re.fullmatch(r"[1-9][0-9]{0," + str(maximum - 1) + r"}", value):
            raise DeployError(f"{label} must be a positive decimal integer")
    expected_name = f"{ARTIFACT_PREFIX}{request.source_sha}-{request.run_id}-{request.run_attempt}"
    if request.artifact_name != expected_name:
        raise DeployError("artifact name does not identify the requested source/run/attempt")
    if not re.fullmatch(r"(?:sha256:)?[0-9a-f]{64}", request.envelope_sha256):
        raise DeployError("expected GitHub envelope digest must be a SHA-256 value")


def verify_run_and_artifact(request: ReleaseRequest, token: str, work: Path) -> dict[str, Any]:
    run = api_json(f"/repos/{REPOSITORY}/actions/runs/{request.run_id}", token)
    if run.get("id") != int(request.run_id) or run.get("run_attempt") != int(request.run_attempt):
        raise DeployError("GitHub run ID or attempt mismatch")
    if run.get("repository", {}).get("full_name", "").lower() != REPOSITORY:
        raise DeployError("workflow run repository mismatch")
    if (run.get("event"), run.get("status"), run.get("conclusion"), run.get("head_branch"), run.get("head_sha")) != (
        "workflow_dispatch", "completed", "success", "main", request.source_sha
    ):
        raise DeployError("workflow run was not a successful manual run on the requested main commit")
    run_path, separator, run_ref = str(run.get("path") or "").partition("@")
    if run_path != WORKFLOW or (separator and run_ref not in ("main", "refs/heads/main")):
        raise DeployError("workflow run path/ref does not match the trusted main release workflow")

    artifact = api_json(f"/repos/{REPOSITORY}/actions/artifacts/{request.artifact_id}", token)
    run_ref = artifact.get("workflow_run") or {}
    if (artifact.get("id") != int(request.artifact_id) or artifact.get("name") != request.artifact_name or
        artifact.get("expired") is not False or run_ref.get("id") != int(request.run_id) or
        run_ref.get("head_sha") != request.source_sha or run_ref.get("head_branch") != "main"):
        raise DeployError("GitHub artifact identity, retention, or workflow association mismatch")
    api_digest = artifact.get("digest", "")
    expected_digest = request.envelope_sha256 if request.envelope_sha256.startswith("sha256:") else "sha256:" + request.envelope_sha256
    if api_digest != expected_digest:
        raise DeployError("expected envelope digest differs from GitHub artifact metadata")
    size = artifact.get("size_in_bytes")
    if not isinstance(size, int) or size < 1 or size > MAX_ENVELOPE_BYTES:
        raise DeployError("GitHub artifact has an invalid or excessive size")
    download_url = urlparse(artifact.get("archive_download_url", ""))
    expected_download_path = f"/repos/{REPOSITORY}/actions/artifacts/{request.artifact_id}/zip"
    if (download_url.scheme != "https" or download_url.hostname != "api.github.com" or
        download_url.path != expected_download_path or download_url.username or download_url.password):
        raise DeployError("GitHub artifact URL does not identify the selected artifact")
    required_bytes = size * 2 + 64 * 1024 * 1024
    if shutil.disk_usage(work).free < required_bytes:
        raise DeployError("temporary filesystem lacks capacity for the GitHub artifact and verified bundle")
    return artifact


def check_zip_entry(info: zipfile.ZipInfo) -> None:
    name = info.filename
    path = PurePosixPath(name)
    mode = info.external_attr >> 16
    if (name.startswith("/") or "\\" in name or ".." in path.parts or path.is_absolute() or
        path.as_posix() != name or name not in ("operatoros-release.tar", "operatoros-release.tar.sha256") or
        (stat.S_IFMT(mode) not in (0, stat.S_IFREG)) or info.file_size < 0):
        raise DeployError(f"unsafe or unexpected artifact envelope member: {name}")


def safe_extract_envelope(envelope: Path, work: Path) -> tuple[Path, str]:
    try:
        with zipfile.ZipFile(envelope) as archive:
            infos = archive.infolist()
            if len(infos) != 2 or len(infos) > MAX_OUTER_MEMBERS:
                raise DeployError("artifact envelope must contain exactly the release and checksum files")
            for info in infos:
                check_zip_entry(info)
                if info.file_size > MAX_BUNDLE_BYTES:
                    raise DeployError("artifact member exceeds the allowed size")
                if info.filename.endswith(".sha256") and info.file_size > 256:
                    raise DeployError("release checksum sidecar is too large")
            names = [item.filename for item in infos]
            if len(set(names)) != len(names) or set(names) != {"operatoros-release.tar", "operatoros-release.tar.sha256"}:
                raise DeployError("artifact envelope has duplicate or missing release members")
            bundle = work / "operatoros-release.tar"
            with archive.open("operatoros-release.tar") as source, bundle.open("xb") as output:
                shutil.copyfileobj(source, output, 1024 * 1024)
            checksum = archive.read("operatoros-release.tar.sha256")
    except (OSError, zipfile.BadZipFile, RuntimeError, KeyError) as error:
        if isinstance(error, DeployError):
            raise
        raise DeployError(f"invalid artifact envelope: {error}") from error
    if len(checksum) > 256:
        raise DeployError("release checksum sidecar is too large")
    text = checksum.decode("ascii", errors="strict")
    expected = sha256_file(bundle)
    if text != f"{expected}  operatoros-release.tar\n":
        raise DeployError("inner release checksum sidecar mismatch")
    return bundle, expected


def check_tar_archive(path: Path, expected_names: set[str] | None, max_members: int, max_total: int) -> None:
    try:
        with tarfile_open(path) as archive:
            entries = archive.getmembers()
            if not entries or len(entries) > max_members:
                raise DeployError("release archive has an invalid member count")
            names: set[str] = set()
            total = 0
            for member in entries:
                posix = PurePosixPath(member.name)
                if (member.name.startswith("/") or "\\" in member.name or posix.is_absolute() or ".." in posix.parts or
                    posix.as_posix() != member.name or "" in posix.parts or "." in posix.parts or
                    member.name in names or not member.isfile() or member.size < 0):
                    raise DeployError(f"unsafe or unsupported release archive entry: {member.name}")
                names.add(member.name)
                total += member.size
                if total > max_total:
                    raise DeployError("release archive expands beyond the allowed size")
            if expected_names is not None and names != expected_names:
                raise DeployError("release archive member inventory mismatch")
    except (OSError, tarfile.TarError) as error:
        if isinstance(error, DeployError):
            raise
        raise DeployError(f"invalid release tar archive: {error}") from error


def tarfile_open(path: Path):
    return tarfile.open(path, "r:*")


def invoke_bundle_verifier(bundle: Path, source_sha: str, token: str) -> dict[str, Any]:
    module = load_release_module()
    check_tar_archive(bundle, module.FILES, MAX_TAR_MEMBERS, MAX_BUNDLE_BYTES)
    try:
        with tarfile_open(bundle) as archive:
            files = module.members(archive)
        manifest = module.validate(files, source_sha)
    except (ValueError, KeyError, OSError, json.JSONDecodeError) as error:
        raise DeployError(f"release bundle rejected: {error}") from error
    if manifest.get("run_id") is None:
        raise DeployError("release manifest omits workflow run identity")
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": os.environ.get("HOME", ""),
           "GH_TOKEN": token, "GH_PROMPT_DISABLED": "true"}
    command = [sys.executable, str(Path(__file__).with_name("release-bundle.py")), "verify", str(bundle), source_sha]
    try:
        result = subprocess.run(command, env=env, text=True, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, check=False, timeout=180)
    except subprocess.TimeoutExpired as error:
        output = error.stdout or ""
        if isinstance(output, bytes):
            output = output.decode(errors="replace")
        raise DeployError("GitHub attestation verification timed out: " + output[-4000:]) from error
    if result.returncode != 0:
        raise DeployError("GitHub attestation verification failed: " + result.stdout[-4000:])
    return {"files": files, "manifest": manifest}


def verified_artifact(request: ReleaseRequest, work: Path) -> VerifiedRelease:
    validate_request(request)
    token = require_token()
    artifact = verify_run_and_artifact(request, token, work)
    envelope = work / "artifact.zip"
    download_artifact(artifact["archive_download_url"], token, envelope, artifact["size_in_bytes"])
    actual_envelope_sha = sha256_file(envelope)
    expected = request.envelope_sha256.removeprefix("sha256:")
    if actual_envelope_sha != expected:
        raise DeployError("downloaded GitHub artifact envelope digest mismatch")
    bundle, bundle_sha = safe_extract_envelope(envelope, work)
    verified = invoke_bundle_verifier(bundle, request.source_sha, token)
    manifest = verified["manifest"]
    if (str(manifest.get("run_id")) != request.run_id or str(manifest.get("run_attempt")) != request.run_attempt or
        manifest.get("source_commit") != request.source_sha or manifest.get("source_ref") != "refs/heads/main" or
        manifest.get("repository") != REPOSITORY or manifest.get("workflow") != REPOSITORY + "/" + WORKFLOW):
        raise DeployError("signed release manifest does not match the selected GitHub run")
    (work / "operatoros-api.oci.tar").write_bytes(verified["files"]["operatoros-api.oci.tar"])
    (work / "operatoros-web-client.tar.gz").write_bytes(verified["files"]["operatoros-web-client.tar.gz"])
    return VerifiedRelease(bundle, verified["files"], manifest, actual_envelope_sha, bundle_sha,
                           request.artifact_id, request.artifact_name)


def path_from_config(value: str, label: str, must_exist: bool = True) -> Path:
    if not isinstance(value, str) or not value.startswith("/") or ".." in Path(value).parts:
        raise DeployError(f"{label} must be an absolute path")
    path = Path(value)
    if must_exist and (not path.exists() or path.is_symlink()):
        raise DeployError(f"{label} is missing or is a symlink: {value}")
    if must_exist and path.resolve(strict=True) != path:
        raise DeployError(f"{label} contains a symlinked or non-canonical path component: {value}")
    return path


def deployment_profile(cfg: dict[str, Any], root: Path) -> str:
    production_services = ("operatoros-lite-api.service", "operatoros-lite-caddy.service")
    services = (cfg["api_service"], cfg["caddy_service"])
    if services == production_services:
        return "host"

    run_id = os.environ.get("GITHUB_RUN_ID", "")
    attempt = os.environ.get("GITHUB_RUN_ATTEMPT", "")
    runner_temp_value = os.environ.get("RUNNER_TEMP", "")
    if (os.environ.get("GITHUB_ACTIONS") != "true" or
        os.environ.get("GITHUB_REPOSITORY", "").lower() != REPOSITORY or
        os.environ.get("GITHUB_REF") != "refs/heads/main" or
        os.environ.get("GITHUB_EVENT_NAME") != "workflow_dispatch" or
        not re.fullmatch(r"[1-9][0-9]{5,19}", run_id) or
        not re.fullmatch(r"[1-9][0-9]{0,8}", attempt) or
        not runner_temp_value):
        raise DeployError("non-host service identities are allowed only in the approved GitHub rehearsal context")
    runner_temp = Path(runner_temp_value)
    try:
        runner_info = runner_temp.lstat()
        canonical_temp = runner_temp.resolve(strict=True)
    except OSError as error:
        raise DeployError("GitHub runner temporary directory is unavailable") from error
    if (not stat.S_ISDIR(runner_info.st_mode) or stat.S_ISLNK(runner_info.st_mode) or
        runner_info.st_uid != os.getuid() or canonical_temp != runner_temp):
        raise DeployError("GitHub runner temporary directory has unsafe ownership or path identity")
    suffix = run_id + "a" + attempt
    expected_root = canonical_temp / (REHEARSAL_WORKSPACE_PREFIX + suffix)
    expected_services = (f"operatoros-rehearsal-{run_id}-{attempt}-api.service",
                         f"operatoros-rehearsal-{run_id}-{attempt}-caddy.service")
    if services != expected_services or root != expected_root:
        raise DeployError("rehearsal service names and root must be unique to this GitHub Actions run")
    protected_roots = [
        Path.home() / ".local/share/containers/storage",
        Path("/var/lib/containers/storage"),
        Path("/run/containers/storage"),
        Path("/mnt/podman-data"),
        Path.home() / "code/repos/operatoros",
        Path.home() / "code/worktrees/operatoros",
    ]
    for name, suffix in (("XDG_DATA_HOME", "containers/storage"),
                         ("XDG_RUNTIME_DIR", "containers"),
                         ("OPERATOROS_DATA_DIR", "")):
        value = os.environ.get(name)
        if value:
            candidate = Path(value)
            if not candidate.is_absolute() or ".." in candidate.parts:
                raise DeployError(f"refusing rehearsal with an ambiguous {name} path")
            protected_roots.append(candidate / suffix if suffix else candidate)
    for protected in protected_roots:
        protected = Path(os.path.realpath(protected))
        if root == protected or root in protected.parents or protected in root.parents:
            raise DeployError("rehearsal workspace overlaps a protected or shared storage path")
    workspace_info = root.lstat()
    if (not stat.S_ISDIR(workspace_info.st_mode) or stat.S_ISLNK(workspace_info.st_mode) or
        workspace_info.st_uid != os.getuid() or stat.S_IMODE(workspace_info.st_mode) != 0o700):
        raise DeployError("rehearsal workspace must be a private runner-owned directory")
    return "rehearsal"


def load_config(path: Path) -> dict[str, Any]:
    try:
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise DeployError("deployment config must be a current-user-owned regular file with mode 0600 or stricter")
        with path.open("rb") as source:
            cfg = tomllib.load(source)
    except (OSError, tomllib.TOMLDecodeError) as error:
        raise DeployError(f"cannot read deployment config: {error}") from error
    required = {"root", "expected_uid", "storage_conf", "graphroot", "runroot", "data_dir", "backup_dir",
                "api_unit", "api_unit_copy", "caddy_unit", "api_service", "caddy_service", "api_url", "web_url",
                "min_free_bytes", "min_free_inodes", "backup_max_age_seconds"}
    if set(cfg) != required:
        raise DeployError("deployment config keys differ from the documented schema")
    if any(type(cfg[key]) is not int for key in ("expected_uid", "min_free_bytes", "min_free_inodes", "backup_max_age_seconds")):
        raise DeployError("numeric deployment settings have invalid types")
    if (cfg["min_free_bytes"] < 0 or cfg["min_free_inodes"] < 0 or
        not isinstance(cfg["backup_max_age_seconds"], int) or cfg["backup_max_age_seconds"] < 1):
        raise DeployError("capacity and backup age limits must be positive values")
    for key in ("api_service", "caddy_service"):
        if not isinstance(cfg[key], str):
            raise DeployError(f"invalid systemd service name: {key}")
        if not re.fullmatch(r"[A-Za-z0-9_.@-]+\.service", cfg[key]):
            raise DeployError(f"invalid systemd service name: {key}")
    for key in ("api_url", "web_url"):
        if not isinstance(cfg[key], str):
            raise DeployError(f"{key} must be an explicit loopback HTTP URL with a port")
        parsed = urlparse(cfg[key])
        if (parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "::1", "localhost") or
            not parsed.port or parsed.username is not None or parsed.password is not None or
            parsed.path not in ("", "/") or parsed.query or parsed.fragment):
            raise DeployError(f"{key} must be an explicit loopback HTTP URL with a port")
    paths = ("root", "storage_conf", "graphroot", "runroot", "data_dir", "backup_dir", "api_unit", "api_unit_copy", "caddy_unit")
    for key in paths:
        cfg[key] = path_from_config(cfg[key], key)
    root = cfg["root"].resolve(strict=True)
    cfg["profile"] = deployment_profile(cfg, root)
    for key in ("storage_conf", "graphroot"):
        if not cfg[key].resolve(strict=True).is_relative_to(root):
            raise DeployError(f"{key} must remain inside the configured rootless OperatorOS storage root")
    for key in ("data_dir", "backup_dir"):
        if not cfg[key].resolve(strict=True).is_relative_to(root):
            raise DeployError(f"{key} must be inside the configured OperatorOS root")
    runtime_runroot = Path(f"/run/user/{cfg['expected_uid']}") / "operatoros-podman-runroot"
    if (not cfg["storage_conf"].resolve(strict=True).is_relative_to(root / "deploy") or
        not cfg["graphroot"].resolve(strict=True).is_relative_to(root / "podman-rootless") or
        not (cfg["runroot"].resolve(strict=True).is_relative_to(root / "podman-rootless") or
             cfg["runroot"].resolve(strict=True) == runtime_runroot)):
        raise DeployError("Podman storage configuration must use the dedicated deployment-owned rootless store")
    unit_dir = cfg["api_unit"].parent.resolve(strict=True)
    expected_api_unit = cfg["api_service"].removesuffix(".service") + ".container"
    expected_caddy_unit = cfg["caddy_service"].removesuffix(".service") + ".container"
    if (cfg["api_unit"].name != expected_api_unit or cfg["caddy_unit"].name != expected_caddy_unit or
        cfg["caddy_unit"].parent.resolve(strict=True) != unit_dir or
        unit_dir.parts[-3:] != (".config", "containers", "systemd") or
        cfg["api_unit_copy"].resolve(strict=True) != (root / "deploy/operatoros-lite-api.container").resolve(strict=True)):
        raise DeployError("Quadlet inputs must use the current user's standard Quadlet directory and managed API copy")
    if cfg["backup_dir"].resolve(strict=True) != (cfg["data_dir"] / "backups").resolve(strict=True):
        raise DeployError("backup directory must be the data root's backups directory")
    if cfg["data_dir"].name in ("", ".") or (cfg["data_dir"] / "operatoros.sqlite").name != "operatoros.sqlite":
        raise DeployError("configured SQLite path is invalid")
    if cfg["expected_uid"] != os.getuid() or os.getuid() == 0:
        raise DeployError("deployment must run as the configured non-root Podman user")
    return cfg


def private_environment(storage_conf: Path, context: PrivatePodmanContext | None = None) -> dict[str, str]:
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": os.environ.get("HOME", ""),
           "XDG_RUNTIME_DIR": os.environ.get("XDG_RUNTIME_DIR", ""),
           "CONTAINERS_STORAGE_CONF": str(storage_conf), "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8"}
    if context is not None:
        env.update(context.environment())
    return env


def system_environment() -> dict[str, str]:
    names = ("PATH", "HOME", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS", "LANG", "LC_ALL")
    return {name: os.environ[name] for name in names if name in os.environ}


def command(args: list[str], env: dict[str, str] | None = None, *, timeout: int = 60) -> str:
    result = run_command(args, env=env, timeout=timeout)
    _assert_podman_command(result, args)
    return result.stdout.strip()


def require_regular_owned(path: Path, uid: int, label: str, mode_mask: int = 0o022) -> os.stat_result:
    try:
        info = path.lstat()
    except OSError as error:
        raise DeployError(f"{label} is unavailable: {path}") from error
    if not stat.S_ISREG(info.st_mode) or info.st_uid != uid or info.st_mode & mode_mask:
        raise DeployError(f"{label} must be an owned regular file without group/other write access: {path}")
    return info


def require_directory(path: Path, uid: int, label: str, mode_mask: int = 0o022) -> os.stat_result:
    try:
        info = path.lstat()
    except OSError as error:
        raise DeployError(f"{label} is unavailable: {path}") from error
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != uid or info.st_mode & mode_mask:
        raise DeployError(f"{label} must be an owned directory without group/other write access: {path}")
    return info


def read_owned_json(path: Path, uid: int, label: str) -> dict[str, Any]:
    require_regular_owned(path, uid, label, 0o077)
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise DeployError(f"{label} is unreadable or malformed") from error
    if not isinstance(value, dict):
        raise DeployError(f"{label} must contain a JSON object")
    return value


def podman_env(cfg: dict[str, Any]) -> dict[str, str]:
    context = cfg.get("_private_podman_context")
    if context is None and cfg.get("profile") == "rehearsal":
        context = podman_context_from_workspace(cfg["root"])
        validate_private_podman_config(context)
    env = private_environment(cfg["storage_conf"], context)
    for forbidden in ("CONTAINER_HOST", "CONTAINER_CONNECTION", "DOCKER_HOST", "CONTAINERS_CONF_OVERRIDE",
                      "STORAGE_DRIVER", "STORAGE_OPTS"):
        if os.environ.get(forbidden):
            raise DeployError(f"unexpected remote/alternate Podman context variable is set: {forbidden}")
    if context is not None:
        validate_private_podman_config(context)
        configured_paths = (("storage_conf", context.storage_conf), ("graphroot", context.graphroot),
                            ("runroot", context.runroot))
        for key, expected in configured_paths:
            if Path(cfg[key]).resolve(strict=True) != expected.resolve(strict=True):
                raise DeployError(f"Podman {key} does not identify the current private workspace")
    elif any(os.environ.get(name) for name in ("CONTAINERS_CONF", "CONTAINERS_STORAGE_CONF")):
        raise DeployError("unexpected alternate Podman configuration is set")
    return env


def validate_host_podman_store(info: Any, cfg: dict[str, Any]) -> dict[str, str]:
    """Prove Podman is reading the configured rootless store, not a default one."""
    try:
        store = info["store"]
        rootless = info["host"]["security"]["rootless"]
        graphroot = Path(store["graphRoot"])
        runroot = Path(store["runRoot"])
    except (KeyError, TypeError) as error:
        raise DeployError("Podman returned incomplete storage identity") from error
    if not rootless or not graphroot.is_absolute() or not runroot.is_absolute():
        raise DeployError("Podman is not using the configured rootless graphroot/runroot")
    if graphroot.resolve() != cfg["graphroot"].resolve() or runroot.resolve() != cfg["runroot"].resolve():
        raise DeployError("Podman is not using the configured rootless graphroot/runroot")
    config_file = store.get("configFile")
    if config_file and Path(config_file).resolve() != cfg["storage_conf"].resolve():
        raise DeployError("Podman is reading a different storage configuration file")
    return {
        "storage_conf": str(cfg["storage_conf"]),
        "graphroot": str(graphroot),
        "runroot": str(runroot),
        "graph_driver": str(store.get("graphDriverName") or "unknown"),
    }


def inspect_podman_context(cfg: dict[str, Any]) -> dict[str, str]:
    runtime_dir = Path(os.environ.get("XDG_RUNTIME_DIR", ""))
    if not runtime_dir.is_absolute() or runtime_dir != Path(f"/run/user/{os.getuid()}"):
        raise DeployError("XDG_RUNTIME_DIR does not identify this user's systemd runtime directory")
    try:
        runtime_info = runtime_dir.stat()
    except OSError as error:
        raise DeployError("systemd user runtime directory is unavailable") from error
    if not stat.S_ISDIR(runtime_info.st_mode) or runtime_info.st_uid != os.getuid() or stat.S_IMODE(runtime_info.st_mode) & 0o077:
        raise DeployError("systemd user runtime directory has unsafe ownership or permissions")
    env = podman_env(cfg)
    info = command_json(["podman", "info", "--format", "json"], env)
    if cfg.get("profile") == "rehearsal":
        context = cfg.get("_private_podman_context") or podman_context_from_workspace(cfg["root"])
        validate_podman_store(info, context)
        return {
            "storage_conf": str(context.storage_conf),
            "graphroot": str(context.graphroot),
            "runroot": str(context.runroot),
            "graph_driver": str(info["store"].get("graphDriverName") or "unknown"),
        }
    return validate_host_podman_store(info, cfg)


def require_empty_podman_store(context: PrivatePodmanContext, env: dict[str, str]) -> None:
    """Prove the private store cannot see pre-existing containers, images, or volumes."""
    if any(env.get(name) != value for name, value in context.environment().items()):
        raise DeployError("Podman inventory command environment differs from the verified private context")
    commands = (
        ["podman", "ps", "--all", "--quiet"],
        ["podman", "image", "ls", "--quiet"],
        ["podman", "volume", "ls", "--quiet"],
    )
    for args in commands:
        if command(args, env).strip():
            raise DeployError("private Podman context exposes pre-existing containers, images, or volumes")


def service_active(name: str) -> None:
    command(["systemctl", "--user", "is-active", "--quiet", name], timeout=20)


def verify_quadlet_service(name: str, unit: Path, *, require_active: bool = True) -> None:
    if require_active:
        service_active(name)
    fragment = command(["systemctl", "--user", "show", "--property=FragmentPath", "--value", name], timeout=20)
    source = command(["systemctl", "--user", "show", "--property=SourcePath", "--value", name], timeout=20)
    if (Path(fragment).name != name or "generator" not in fragment or
        Path(source).resolve(strict=True) != unit.resolve(strict=True)):
        raise DeployError(f"service is not generated from its expected Quadlet file: {name}")


def curl_ok(url: str) -> None:
    command(["curl", "--fail", "--silent", "--show-error", "--max-time", "5", url], timeout=10)


def sha_db_snapshot(data_dir: Path) -> dict[str, tuple[int, int, int, int, int]]:
    snapshot: dict[str, tuple[int, int, int, int, int]] = {}
    for name in ("operatoros.sqlite", "operatoros.sqlite-wal", "operatoros.sqlite-shm"):
        path = data_dir / name
        if path.exists():
            info = path.lstat()
            if not stat.S_ISREG(info.st_mode):
                raise DeployError(f"SQLite path is not a regular file: {name}")
            if info.st_uid != os.getuid() or info.st_mode & 0o077:
                raise DeployError(f"SQLite file ownership or permissions are unsafe: {name}")
            snapshot[name] = (info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns, info.st_mode)
    if "operatoros.sqlite" not in snapshot:
        raise DeployError("application SQLite database is missing")
    return snapshot


def validate_backup(cfg: dict[str, Any], backup_name: str) -> Path:
    if not re.fullmatch(r"backup_[A-Za-z0-9T._-]+\.sqlite3", backup_name):
        raise DeployError("backup must be selected by filename, not path")
    backup = cfg["backup_dir"] / backup_name
    metadata = backup.with_name(backup.name + ".meta.json")
    require_regular_owned(backup, os.getuid(), "encrypted backup", 0o077)
    require_regular_owned(metadata, os.getuid(), "backup metadata", 0o077)
    try:
        value = json.loads(metadata.read_text(encoding="utf-8"))
        created_at = datetime.fromisoformat(value["created_at"].replace("Z", "+00:00"))
        if created_at.tzinfo is None:
            raise ValueError("backup timestamp has no timezone")
        created = created_at.astimezone(timezone.utc).timestamp()
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
        raise DeployError("backup metadata is malformed") from error
    now = time.time()
    if (value.get("filename") != backup.name or value.get("encrypted") is not True or value.get("algorithm") != "aes-256-gcm" or
        not re.fullmatch(r"[0-9a-f]{64}", str(value.get("sha256", ""))) or value["sha256"] != sha256_file(backup) or
        created > now or now - created > cfg["backup_max_age_seconds"]):
        raise DeployError("backup is not a recent, integrity-verified AES-256-GCM artifact")
    return backup


def load_unit_image(unit: Path, expected_container: str) -> str:
    text = unit.read_text(encoding="utf-8")
    if len(re.findall(r"(?m)^ContainerName=" + re.escape(expected_container) + r"$", text)) != 1:
        raise DeployError(f"Quadlet does not identify the expected container: {unit}")
    images = re.findall(r"(?m)^Image=(.+)$", text)
    if len(images) != 1 or not images[0].strip():
        raise DeployError(f"Quadlet must have exactly one Image setting: {unit}")
    return images[0].strip()


def unit_values(text: str, key: str) -> list[str]:
    return re.findall(r"(?m)^" + re.escape(key) + r"=(.*)$", text)


def verify_runtime_units(cfg: dict[str, Any]) -> None:
    api_text = cfg["api_unit"].read_text(encoding="utf-8")
    api_port = urlparse(cfg["api_url"]).port
    expected_api = {
        "ContainerName": API_NAME,
        "Pull": "never",
        "PublishPort": f"127.0.0.1:{api_port}:8090",
        "User": "10000:10000",
        "UserNS": "keep-id:uid=10000,gid=10000",
        "ReadOnly": "true",
        "ReadOnlyTmpfs": "true",
        "NoNewPrivileges": "true",
        "DropCapability": "all",
        "EnvironmentFile": str(cfg["root"] / "deploy/api.env"),
        "Volume": f"{cfg['data_dir']}:/var/lib/operatoros/data:rw",
    }
    for key, expected in expected_api.items():
        if unit_values(api_text, key) != [expected]:
            raise DeployError(f"API Quadlet {key} does not match the approved loopback and persistent-data contract")
    require_regular_owned(cfg["root"] / "deploy/api.env", os.getuid(), "API environment file", 0o077)

    caddy_text = cfg["caddy_unit"].read_text(encoding="utf-8")
    expected_caddy = {
        "Image": CADDY_IMAGE,
        "ContainerName": CADDY_NAME,
        "Pull": "never",
        "Network": "host",
        "User": "1000:1000",
        "UserNS": "keep-id:uid=1000,gid=1000",
        "ReadOnly": "true",
        "NoNewPrivileges": "true",
        "DropCapability": "all",
        "AddCapability": "net_bind_service",
    }
    for key, expected in expected_caddy.items():
        if unit_values(caddy_text, key) != [expected]:
            raise DeployError(f"Caddy Quadlet {key} does not match the approved loopback proxy contract")
    required_mounts = {
        f"{cfg['root']}/deploy/Caddyfile:/etc/caddy/Caddyfile:ro",
        f"{cfg['root']}/web/current/client:/srv/operatoros/current/client:ro",
    }
    if not required_mounts.issubset(set(unit_values(caddy_text, "Volume"))):
        raise DeployError("Caddy Quadlet must mount the managed Caddyfile and static SPA read-only")
    caddyfile = cfg["root"] / "deploy/Caddyfile"
    require_regular_owned(caddyfile, os.getuid(), "Caddy configuration", 0o022)
    caddy_config = caddyfile.read_text(encoding="utf-8")
    web_port = urlparse(cfg["web_url"]).port
    required_config = (f"http://127.0.0.1:{web_port} {{", "bind 127.0.0.1",
                       f"reverse_proxy 127.0.0.1:{api_port}", "@dotfiles path_regexp dotfiles",
                       "handle @dotfiles", "respond 404", "@static_file path_regexp static_file",
                       "handle @static_file", "@root path /", "handle @root", "file_server",
                       "rewrite * /_shell.html", "try_files {path} /_shell.html")
    sites = re.findall(r"(?m)^([^\s{}]+)\s*\{\s*$", caddy_config)
    if (sites != [f"http://127.0.0.1:{web_port}"] or any(required not in caddy_config for required in required_config) or
        unit_values(caddy_text, "PublishPort")):
        raise DeployError("Caddy does not match the loopback API/SPA routing contract")


def inspect_image(image: str, cfg: dict[str, Any]) -> dict[str, Any]:
    values = command_json(["podman", "image", "inspect", "--format", "json", image], podman_env(cfg))
    try:
        value = values[0] if isinstance(values, list) else values
    except (IndexError, TypeError) as error:
        raise DeployError(f"cannot inspect local image {image}") from error
    return value


def local_image_identity(image: str, cfg: dict[str, Any]) -> tuple[str, dict[str, str]]:
    info = inspect_image(image, cfg)
    image_id = info.get("Id") or info.get("ID")
    if isinstance(image_id, str) and re.fullmatch(r"[0-9a-f]{64}", image_id):
        image_id = "sha256:" + image_id
    if not isinstance(image_id, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", image_id):
        raise DeployError("local API image has no valid config ID")
    config = info.get("Config") or {}
    labels = config.get("Labels") or {}
    if not isinstance(labels, dict):
        raise DeployError("local API image labels are invalid")
    return image_id, labels


def check_loopback_services(cfg: dict[str, Any]) -> None:
    state = command(["systemctl", "--user", "is-system-running"], timeout=20)
    if state != "running":
        raise DeployError(f"systemd user manager is not fully running: {state}")
    for name in (cfg["api_service"], cfg["caddy_service"]):
        unit = cfg["api_unit"] if name == cfg["api_service"] else cfg["caddy_unit"]
        verify_quadlet_service(name, unit)
    curl_ok(cfg["api_url"] + "/health")
    curl_ok(cfg["api_url"] + "/ready")
    curl_ok(cfg["web_url"] + "/ready")


def check_capacity(cfg: dict[str, Any], release: VerifiedRelease) -> None:
    roots = (cfg["root"], cfg["graphroot"])
    required = max(cfg["min_free_bytes"], len(release.files["operatoros-api.oci.tar"]) * 2)
    for root in roots:
        usage = shutil.disk_usage(root)
        statvfs = os.statvfs(root)
        if usage.free < required or statvfs.f_favail < cfg["min_free_inodes"]:
            raise DeployError(f"insufficient disk bytes or inodes at {root}")


def current_spa(cfg: dict[str, Any]) -> tuple[Path, str]:
    pointer = cfg["root"] / "web/current"
    try:
        info = pointer.lstat()
    except OSError as error:
        raise DeployError("current SPA pointer is missing") from error
    if not stat.S_ISLNK(info.st_mode):
        raise DeployError("current SPA pointer must be a symlink")
    target = Path(os.readlink(pointer))
    if not target.is_absolute():
        target = pointer.parent / target
    target = target.resolve(strict=True)
    release_root = (cfg["root"] / "web/releases").resolve(strict=True)
    if not target.is_relative_to(release_root) or not (target / "client").is_dir():
        raise DeployError("current SPA pointer escapes retained application releases")
    spa_tree_hashes(target / "client")
    return target, target.name


def spa_tree_hashes(client: Path) -> dict[str, str]:
    if client.is_symlink() or not client.is_dir():
        raise DeployError("SPA client root is missing or is a symlink")
    hashes: dict[str, str] = {}
    for directory, directories, files in os.walk(client, followlinks=False):
        base = Path(directory)
        for name in directories:
            path = base / name
            if path.is_symlink() or not path.is_dir():
                raise DeployError("retained SPA contains a symlink or unsupported directory entry")
        for name in files:
            path = base / name
            info = path.lstat()
            if not stat.S_ISREG(info.st_mode):
                raise DeployError("retained SPA contains a symlink or unsupported file entry")
            hashes[path.relative_to(client.parent).as_posix()] = sha256_file(path)
    return dict(sorted(hashes.items()))


def preflight(cfg: dict[str, Any], release: VerifiedRelease, backup_name: str) -> dict[str, Any]:
    uid = os.getuid()
    require_directory(cfg["root"], uid, "OperatorOS root")
    require_directory(cfg["root"] / "deploy", uid, "deployment directory")
    require_directory(cfg["root"] / "web", uid, "web directory")
    require_directory(cfg["root"] / "web/releases", uid, "web release directory")
    require_directory(cfg["data_dir"], uid, "SQLite data directory", 0o077)
    require_directory(cfg["backup_dir"], uid, "backup directory", 0o077)
    for key in ("storage_conf", "api_unit", "api_unit_copy", "caddy_unit"):
        require_regular_owned(cfg[key], uid, key)
    if (cfg["api_unit"].name != cfg["api_service"].removesuffix(".service") + ".container" or
        cfg["caddy_unit"].name != cfg["caddy_service"].removesuffix(".service") + ".container"):
        raise DeployError("Quadlet filenames must match their configured API/Caddy service identities")
    load_unit_image(cfg["api_unit"], API_NAME)
    verify_runtime_units(cfg)
    if cfg["api_unit"].read_bytes() != cfg["api_unit_copy"].read_bytes():
        raise DeployError("active API Quadlet differs from the reviewed deployment copy")
    inspect_podman_context(cfg)
    manager_state = command(["systemctl", "--user", "is-system-running"], timeout=20)
    if manager_state != "running":
        raise DeployError(f"systemd user manager is not fully running: {manager_state}")
    for service in (cfg["api_service"], cfg["caddy_service"]):
        unit = cfg["api_unit"] if service == cfg["api_service"] else cfg["caddy_unit"]
        verify_quadlet_service(service, unit)
    old_release, old_release_id = current_spa(cfg)
    old_image_ref = load_unit_image(cfg["api_unit"], API_NAME)
    old_image_id, old_labels = local_image_identity(old_image_ref, cfg)
    old_commit = old_labels.get(API_IMAGE_LABELS["revision"], "")
    if not re.fullmatch(r"[0-9a-f]{40}", old_commit):
        raise DeployError("current API image lacks a full source revision for rollback")
    if not (old_release / "client").is_dir():
        raise DeployError("current SPA release is not available for rollback")
    backup = validate_backup(cfg, backup_name)
    check_capacity(cfg, release)
    db_before = sha_db_snapshot(cfg["data_dir"])
    check_loopback_services(cfg)
    isolated_schema_preflight(release, cfg)
    if sha_db_snapshot(cfg["data_dir"]) != db_before:
        raise DeployError("SQLite main/WAL/SHM changed during preflight; no application change was made")
    return {"old_release_path": str(old_release), "old_release_id": old_release_id, "old_image_ref": old_image_ref,
            "old_image_id": old_image_id, "old_commit": old_commit, "backup": backup.name,
            "db_snapshot": db_before}


def atomic_write(path: Path, data: bytes, mode: int = 0o600) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, "wb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temp_name, path)
        directory_fd = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass


def update_unit_image(unit: Path, image_ref: str) -> None:
    original = unit.read_text(encoding="utf-8")
    updated, count = re.subn(r"(?m)^Image=.*$", "Image=" + image_ref, original)
    if count != 1:
        raise DeployError("API Quadlet must contain exactly one Image setting")
    atomic_write(unit, updated.encode(), stat.S_IMODE(unit.stat().st_mode))


def switch_pointer(cfg: dict[str, Any], target: Path) -> None:
    root = (cfg["root"] / "web/releases").resolve(strict=True)
    target = target.resolve(strict=True)
    if not target.is_relative_to(root) or not (target / "client").is_dir():
        raise DeployError("refusing SPA release outside retained web releases")
    link = cfg["root"] / "web/current"
    temp = link.with_name(".current." + str(os.getpid()) + "." + str(time.time_ns()))
    os.symlink(target, temp)
    os.replace(temp, link)


def materialize_spa(cfg: dict[str, Any], release: VerifiedRelease, release_id: str) -> Path:
    module = load_release_module()
    spa_bytes = release.files["operatoros-web-client.tar.gz"]
    spa_sha = hashlib.sha256(spa_bytes).hexdigest()
    releases = cfg["root"] / "web/releases"
    destination = releases / release_id
    with tempfile.NamedTemporaryFile(dir=release.bundle_path.parent, prefix="spa-check-", suffix=".tar.gz") as check_archive:
        check_archive.write(spa_bytes)
        check_archive.flush()
        check_tar_archive(Path(check_archive.name), None, MAX_SPA_MEMBERS, MAX_SPA_BYTES)
        with tarfile_open(Path(check_archive.name)) as archive:
            files = module.members(archive)
    if any(not name.startswith("client/") or any(part.startswith(".") for part in PurePosixPath(name).parts) for name in files):
        raise DeployError("SPA archive contains an unexpected client path")
    expected_hashes = {name: hashlib.sha256(data).hexdigest() for name, data in sorted(files.items())}
    if destination.exists():
        marker = destination / ".source-archive-sha256"
        if not marker.is_file() or marker.read_text().strip() != spa_sha:
            raise DeployError("an existing SPA release ID has different bytes")
        if spa_tree_hashes(destination / "client") != expected_hashes:
            raise DeployError("an existing SPA release has modified files")
        return destination
    staging = Path(tempfile.mkdtemp(prefix=".staging-" + release_id + ".", dir=releases))
    try:
        root = staging / "client"
        root.mkdir(mode=0o700)
        for name, data in files.items():
            relative = PurePosixPath(name).relative_to("client")
            target = root.joinpath(*relative.parts)
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            target.write_bytes(data)
            target.chmod(0o444)
        for directory in sorted((p for p in root.rglob("*") if p.is_dir()), key=lambda p: len(p.parts), reverse=True):
            directory.chmod(0o555)
        root.chmod(0o555)
        (staging / ".source-archive-sha256").write_text(spa_sha + "\n", encoding="ascii")
        (staging / ".source-archive-sha256").chmod(0o444)
        staging.chmod(0o555)
        os.rename(staging, destination)
    except Exception:
        if staging.exists():
            for path in sorted(staging.rglob("*"), key=lambda p: len(p.parts), reverse=True):
                if path.is_dir() and not path.is_symlink():
                    path.chmod(0o700)
                else:
                    path.chmod(0o600)
            staging.chmod(0o700)
            shutil.rmtree(staging)
        raise
    return destination


def write_release_record(cfg: dict[str, Any], release_id: str, data: dict[str, Any]) -> Path:
    records = cfg["root"] / "deploy/releases"
    records.mkdir(mode=0o700, parents=True, exist_ok=True)
    record = records / (release_id + ".json")
    payload = (json.dumps(data, sort_keys=True, indent=2) + "\n").encode()
    if record.exists():
        existing = read_owned_json(record, os.getuid(), "retained release record")
        comparable_existing = {key: value for key, value in existing.items() if key != "recorded_at"}
        comparable_candidate = {key: value for key, value in data.items() if key != "recorded_at"}
        if comparable_existing != comparable_candidate:
            raise DeployError("release record already exists with different identity")
    else:
        atomic_write(record, payload)
    return record


def make_legacy_record(cfg: dict[str, Any], state: dict[str, Any]) -> str:
    release_id = "legacy-" + state["old_commit"]
    path = cfg["root"] / "deploy/releases" / (release_id + ".json")
    if not path.exists():
        spa = Path(state["old_release_path"])
        if spa.name != state["old_release_id"]:
            raise DeployError("legacy rollback SPA identity is inconsistent")
        write_release_record(cfg, release_id, {"schema_version": 1, "release_id": release_id,
            "source_commit": state["old_commit"], "api_image_id": state["old_image_id"],
            "api_image_ref": state["old_image_ref"], "spa_path": str(spa), "legacy": True,
            "recorded_at": datetime.now(timezone.utc).isoformat()})
    return release_id


def validate_image_after_load(image_id: str, source_sha: str, source_tree_hash: str,
                              manifest_digest: str, cfg: dict[str, Any]) -> None:
    actual_id, labels = local_image_identity("sha256:" + image_id.removeprefix("sha256:"), cfg)
    if actual_id != image_id or labels.get(API_IMAGE_LABELS["revision"]) != source_sha or labels.get(API_IMAGE_LABELS["source_dirty"]) != "false" or labels.get(API_IMAGE_LABELS["source_tree_sha256"]) != source_tree_hash:
        raise DeployError("imported API image identity or source labels differ from the attested bundle")
    info = inspect_image(actual_id, cfg)
    if info.get("Digest") != manifest_digest:
        raise DeployError("imported API OCI manifest digest differs from the attested release")
    if (info.get("Architecture"), info.get("Os")) != ("amd64", "linux"):
        raise DeployError("imported API image platform mismatch")


def schema_validate(image: str, cfg: dict[str, Any]) -> None:
    before = sha_db_snapshot(cfg["data_dir"])
    args = ["podman", "run", "--rm", "--network=none", "--read-only", "--read-only-tmpfs",
            "--cap-drop=all", "--security-opt=no-new-privileges", "--userns=keep-id:uid=10000,gid=10000",
            "--user=10000:10000", "--mount", f"type=bind,src={cfg['data_dir']},dst=/var/lib/operatoros/data,ro",
            "--env", "OPERATOROS_DATA_DIR=/var/lib/operatoros/data", "--entrypoint", "bun", image,
            "run", "packages/db/src/db-cli.ts", "validate", "--data-dir", "/var/lib/operatoros/data"]
    command(args, podman_env(cfg), timeout=60)
    after = sha_db_snapshot(cfg["data_dir"])
    if after != before:
        raise DeployError("read-only schema validation observed a SQLite main/WAL/SHM change; aborting for database activity review")


def isolated_schema_preflight(release: VerifiedRelease, cfg: dict[str, Any]) -> None:
    """Run the attested image's read-only DB validator in a disposable VFS store."""
    parent = cfg["root"] / "deploy/preflight"
    if parent.exists():
        require_directory(parent, os.getuid(), "isolated preflight directory", 0o077)
    else:
        parent.mkdir(mode=0o700)
    workspace = Path(tempfile.mkdtemp(prefix="operatoros-deploy-preflight.", dir=parent))
    workspace.chmod(0o700)
    if workspace.parent.resolve() != parent.resolve() or not workspace.name.startswith("operatoros-deploy-preflight."):
        raise DeployError("refusing an ambiguous schema preflight workspace")
    context = create_private_podman_context(workspace)
    graphroot, runroot = context.graphroot, context.runroot
    temp_cfg = dict(cfg, storage_conf=context.storage_conf, graphroot=graphroot, runroot=runroot,
                    _private_podman_context=context)
    env = podman_env(temp_cfg)
    before = sha_db_snapshot(cfg["data_dir"])
    cleanup_error: Exception | None = None
    failure: Exception | None = None
    context_verified = False
    try:
        info = command_json(["podman", "info", "--format", "json"], env)
        validate_podman_store(info, context, require_empty=True)
        context_verified = True
        require_empty_podman_store(context, env)
        image_archive = workspace / "candidate.oci.tar"
        image_archive.write_bytes(release.files["operatoros-api.oci.tar"])
        command(["podman", "load", "--input", str(image_archive)], env, timeout=300)
        image = release.manifest["image"]["image_id"]
        validate_image_after_load(image, release.manifest["source_commit"],
                                  release.manifest["image"]["source_tree_sha256"],
                                  release.manifest["image"]["manifest_digest"], temp_cfg)
        schema_validate(image, temp_cfg)
        if sha_db_snapshot(cfg["data_dir"]) != before:
            raise DeployError("read-only schema preflight observed SQLite file changes")
    except Exception as error:
        failure = error
    finally:
        try:
            load_consumer_cleanup_module().assert_no_mounts_below(workspace)
            if context_verified:
                if (command(["podman", "ps", "--all", "--quiet"], env) or
                    command(["podman", "unshare", "podman", "mount"], env)):
                    raise DeployError("temporary schema preflight Podman store still has containers or mounts")
                cleanup_program = """
import os, shutil, stat, sys
from pathlib import Path
w = Path(sys.argv[1])
p = Path(sys.argv[2]).resolve()
assert w.parent.resolve() == p and w.name.startswith("operatoros-deploy-preflight.")
assert w.is_dir() and not w.is_symlink() and not os.path.ismount(w)
assert w.stat().st_uid == os.getuid() and stat.S_IMODE(w.stat().st_mode) == 0o700
store = w / "podman-rootless"
if store.exists():
    info = store.lstat()
    assert stat.S_ISDIR(info.st_mode) and not store.is_symlink() and not os.path.ismount(store)
    shutil.rmtree(store)
"""
                command(["podman", "unshare", sys.executable, "-c", cleanup_program, str(workspace), str(parent)], env, timeout=120)
            shutil.rmtree(workspace)
        except Exception as error:
            cleanup_error = error
        if cleanup_error is not None:
            detail = f"isolated schema preflight cleanup failed; retained workspace {workspace}: {cleanup_error}"
            if failure is not None:
                detail = f"schema preflight also failed: {failure}; {detail}"
            raise DeployError(detail) from failure
    if failure is not None:
        raise failure


def check_candidate_capacity(cfg: dict[str, Any], release: VerifiedRelease) -> None:
    check_capacity(cfg, release)
    web_free = shutil.disk_usage(cfg["root"] / "web").free
    spa_size = len(release.files["operatoros-web-client.tar.gz"])
    if (web_free < max(cfg["min_free_bytes"], spa_size * 2) or
        os.statvfs(cfg["root"] / "web").f_favail < cfg["min_free_inodes"]):
        raise DeployError("insufficient storage for staged SPA release")


def active_transaction(cfg: dict[str, Any]) -> Path:
    return cfg["root"] / "deploy/active-transaction.json"


@contextmanager
def deployment_lock(cfg: dict[str, Any]):
    deploy_dir = cfg["root"] / "deploy"
    require_directory(deploy_dir, os.getuid(), "deployment directory")
    lock_path = deploy_dir / ".operatoros-deploy.lock"
    fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    lock = os.fdopen(fd, "r+b")
    info = os.fstat(lock.fileno())
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1 or info.st_mode & 0o077:
        lock.close()
        raise DeployError("deployment lock must be a private, single-link file owned by the deployment user")
    try:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError as error:
        lock.close()
        raise DeployError("another OperatorOS deployment or rollback holds the lock") from error
    try:
        yield
    finally:
        lock.close()


def update_transaction(path: Path, value: dict[str, Any], phase: str, failure: str | None = None) -> None:
    value["phase"] = phase
    value["updated_at"] = datetime.now(timezone.utc).isoformat()
    if failure is not None:
        value["failure"] = failure[-4000:]
    atomic_write(path, (json.dumps(value, indent=2, sort_keys=True) + "\n").encode())


def service_call(cfg: dict[str, Any], action: str, service: str) -> None:
    command(["systemctl", "--user", action, service], timeout=120)


def wait_release_health(cfg: dict[str, Any]) -> None:
    for url in (cfg["api_url"] + "/health", cfg["api_url"] + "/ready", cfg["web_url"] + "/ready"):
        wait_for_url(url, "release health check")
    response = command(["curl", "--silent", "--show-error", "--max-time", "5", "--output", "/dev/null", "--write-out", "%{http_code}", cfg["web_url"] + "/attendance/calendar"])
    if response != "200":
        raise DeployError("Caddy SPA deep-route check did not return HTTP 200")
    unauthorized = command(["curl", "--silent", "--show-error", "--max-time", "5", "--output", "/dev/null", "--write-out", "%{http_code}", cfg["web_url"] + "/api/auth/me"])
    if unauthorized != "401":
        raise DeployError("Caddy API proxy did not preserve the unauthenticated 401 contract")


def wait_for_url(url: str, label: str) -> None:
    last: DeployError | None = None
    for _ in range(40):
        try:
            curl_ok(url)
            return
        except DeployError as error:
            last = error
            time.sleep(1)
    raise DeployError(f"{label} failed for {url}: {last}")


def snapshot_state(cfg: dict[str, Any], previous: dict[str, Any], transaction_id: str) -> dict[str, Any]:
    old_unit = cfg["api_unit"].read_bytes()
    old_copy = cfg["api_unit_copy"].read_bytes()
    state_dir = cfg["root"] / "deploy/transactions"
    state_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    snapshot_dir = state_dir / transaction_id
    snapshot_dir.mkdir(mode=0o700)
    atomic_write(snapshot_dir / "previous-api.container", old_unit)
    atomic_write(snapshot_dir / "previous-deploy-api.container", old_copy)
    current_record = cfg["root"] / "deploy/current-release.json"
    current_record_exists = current_record.exists() or current_record.is_symlink()
    if current_record_exists:
        require_regular_owned(current_record, os.getuid(), "current release record", 0o077)
        atomic_write(snapshot_dir / "previous-current-release.json", current_record.read_bytes())
    value = {"schema_version": 1, "transaction_id": transaction_id, "operation": "deploy",
             "started_at": datetime.now(timezone.utc).isoformat(), "previous": previous,
             "snapshot_dir": str(snapshot_dir), "previous_current_record_exists": current_record_exists}
    path = active_transaction(cfg)
    update_transaction(path, value, "prepared")
    return value


def podman_import(release: VerifiedRelease, cfg: dict[str, Any]) -> tuple[str, str]:
    image_meta = release.manifest["image"]
    image_id = image_meta["image_id"]
    image_ref = image_id
    env = podman_env(cfg)
    existing = run_command(["podman", "image", "exists", image_ref], env)
    if existing.returncode == 0:
        _assert_podman_command(existing, ["podman", "image", "exists", image_ref])
        existing_id, _ = local_image_identity(image_ref, cfg)
        if existing_id != image_id:
            raise DeployError("immutable source tag already points to a different API image")
    elif existing.returncode == 1:
        if stderr_classification(existing.stderr) in {
            "storage-driver-database-override", "additional-image-store-warning", "storage-path-warning",
        }:
            raise DeployError("Podman reported an isolation warning while checking the private image store")
        command(["podman", "load", "--input", str(release.bundle_path.parent / "operatoros-api.oci.tar")], env, timeout=300)
    else:
        _assert_podman_command(existing, ["podman", "image", "exists", image_ref])
    validate_image_after_load(image_id, release.manifest["source_commit"], image_meta["source_tree_sha256"],
                              image_meta["manifest_digest"], cfg)
    return image_ref, image_id


def deploy_release(cfg: dict[str, Any], request: ReleaseRequest, backup_name: str) -> dict[str, Any]:
    with deployment_lock(cfg):
        active = active_transaction(cfg)
        if active.exists():
            raise DeployError("an incomplete deployment transaction exists; inspect status and explicitly roll it back")
        with tempfile.TemporaryDirectory(prefix="operatoros-deploy-verify-", dir=cfg["root"] / "deploy") as temp:
            os.chmod(temp, 0o700)
            release = verified_artifact(request, Path(temp))
            check_candidate_capacity(cfg, release)
            previous = preflight(cfg, release, backup_name)
            legacy_id = "legacy-" + previous["old_commit"]
            transaction_id = "deploy-" + request.release_id + "-" + str(time.time_ns())
            make_legacy_record(cfg, previous)
            tx = snapshot_state(cfg, previous | {"release_id": legacy_id}, transaction_id)
            tx_path = active_transaction(cfg)
            candidate_image_ref = ""
            try:
                candidate_image_ref, image_id = podman_import(release, cfg)
                update_transaction(tx_path, tx, "image_imported")
                schema_validate("sha256:" + image_id.removeprefix("sha256:"), cfg)
                update_transaction(tx_path, tx, "schema_compatible")
                spa_path = materialize_spa(cfg, release, request.release_id)
                update_transaction(tx_path, tx, "spa_staged")
                record = {"schema_version": 1, "release_id": request.release_id, "source_commit": request.source_sha,
                          "run_id": request.run_id, "run_attempt": request.run_attempt, "artifact_id": request.artifact_id,
                          "artifact_name": request.artifact_name, "artifact_envelope_sha256": release.envelope_sha256,
                          "bundle_sha256": release.bundle_sha256, "api_image_id": image_id,
                          "api_manifest_digest": release.manifest["image"]["manifest_digest"],
                          "api_image_ref": candidate_image_ref, "spa_sha256": release.manifest["artifacts"]["operatoros-web-client.tar.gz"],
                          "spa_files": spa_tree_hashes(spa_path / "client"),
                          "spa_path": str(spa_path), "database_schema": "validated by attested API image",
                          "recorded_at": datetime.now(timezone.utc).isoformat()}
                write_release_record(cfg, request.release_id, record)
                update_unit_image(cfg["api_unit"], candidate_image_ref)
                atomic_write(cfg["api_unit_copy"], cfg["api_unit"].read_bytes(), stat.S_IMODE(cfg["api_unit_copy"].stat().st_mode))
                update_transaction(tx_path, tx, "api_unit_updated")
                command(["systemctl", "--user", "daemon-reload"], timeout=60)
                service_call(cfg, "restart", cfg["api_service"])
                update_transaction(tx_path, tx, "api_restarted")
                wait_for_url(cfg["api_url"] + "/ready", "API readiness check")
                switch_pointer(cfg, spa_path)
                update_transaction(tx_path, tx, "spa_switched")
                service_call(cfg, "restart", cfg["caddy_service"])
                update_transaction(tx_path, tx, "caddy_restarted")
                wait_release_health(cfg)
                if sha_db_snapshot(cfg["data_dir"]) != previous["db_snapshot"]:
                    raise DeployError("database files changed during deployment; application data was not rolled back")
                current = {"release_id": request.release_id, "source_commit": request.source_sha,
                           "artifact_id": request.artifact_id, "artifact_name": request.artifact_name,
                           "artifact_envelope_sha256": release.envelope_sha256, "bundle_sha256": release.bundle_sha256,
                           "api_image_id": image_id, "api_manifest_digest": release.manifest["image"]["manifest_digest"],
                           "spa_path": str(spa_path), "deployed_at": datetime.now(timezone.utc).isoformat()}
                atomic_write(cfg["root"] / "deploy/current-release.json", (json.dumps(current, indent=2, sort_keys=True) + "\n").encode())
                update_transaction(tx_path, tx, "complete")
                archive_transaction(cfg, tx, "complete")
                return current
            except Exception as error:
                update_transaction(tx_path, tx, "rollback_started", str(error))
                try:
                    restore_snapshot(cfg, tx, health=True)
                except Exception as rollback_error:
                    update_transaction(tx_path, tx, "rollback_failed",
                                       f"deployment failed: {error}; rollback failed: {rollback_error}")
                    raise DeployError(f"deployment failed: {error}; rollback also failed: {rollback_error}; transaction preserved at {tx_path}") from error
                archive_transaction(cfg, tx, "rolled_back")
                raise DeployError(f"deployment failed and previous application release was restored: {error}") from error


def restore_snapshot(cfg: dict[str, Any], tx: dict[str, Any], *, health: bool) -> None:
    previous = tx["previous"]
    snapshot = Path(tx["snapshot_dir"])
    snapshot_parent = (cfg["root"] / "deploy/transactions").resolve(strict=True)
    if snapshot.parent != snapshot_parent or snapshot.is_symlink() or not snapshot.is_dir() or snapshot.resolve(strict=True).parent != snapshot_parent:
        raise DeployError("transaction snapshot path escapes the transaction directory")
    require_directory(snapshot, os.getuid(), "transaction snapshot", 0o077)
    old_api = snapshot / "previous-api.container"
    old_copy = snapshot / "previous-deploy-api.container"
    require_regular_owned(old_api, os.getuid(), "transaction API snapshot", 0o077)
    require_regular_owned(old_copy, os.getuid(), "transaction deployment snapshot", 0o077)
    unit_changed = cfg["api_unit"].read_bytes() != old_api.read_bytes() or cfg["api_unit_copy"].read_bytes() != old_copy.read_bytes()
    current_web, _ = current_spa(cfg)
    previous_web = Path(previous["old_release_path"]).resolve(strict=True)
    web_changed = current_web != previous_web
    if unit_changed:
        atomic_write(cfg["api_unit"], old_api.read_bytes(), stat.S_IMODE(cfg["api_unit"].stat().st_mode))
        atomic_write(cfg["api_unit_copy"], old_copy.read_bytes(), stat.S_IMODE(cfg["api_unit_copy"].stat().st_mode))
        command(["systemctl", "--user", "daemon-reload"], timeout=60)
        service_call(cfg, "restart", cfg["api_service"])
    if web_changed:
        switch_pointer(cfg, previous_web)
        service_call(cfg, "restart", cfg["caddy_service"])
    if health and (unit_changed or web_changed):
        wait_release_health(cfg)
    current_record = cfg["root"] / "deploy/current-release.json"
    if tx.get("previous_current_record_exists") is True:
        previous_record = snapshot / "previous-current-release.json"
        require_regular_owned(previous_record, os.getuid(), "previous current release record", 0o077)
        atomic_write(current_record, previous_record.read_bytes())
    elif tx.get("previous_current_record_exists") is False:
        if current_record.exists() or current_record.is_symlink():
            info = current_record.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid():
                raise DeployError("current release record is unsafe to remove during rollback")
            current_record.unlink()


def archive_transaction(cfg: dict[str, Any], tx: dict[str, Any], result: str) -> None:
    path = active_transaction(cfg)
    value = read_owned_json(path, os.getuid(), "active deployment transaction")
    if value.get("transaction_id") != tx.get("transaction_id"):
        raise DeployError("active deployment transaction identity changed")
    update_transaction(path, value, result)
    history = cfg["root"] / "deploy/transactions" / (tx["transaction_id"] + ".json")
    os.replace(path, history)


def read_release_record(cfg: dict[str, Any], release_id: str) -> dict[str, Any]:
    if not re.fullmatch(r"(?:legacy-)?[0-9a-f]{40}(?:-[1-9][0-9]*-[1-9][0-9]*)?", release_id):
        raise DeployError("release ID must identify a retained verified application release")
    path = cfg["root"] / "deploy/releases" / (release_id + ".json")
    record = read_owned_json(path, os.getuid(), "retained release record")
    if record.get("release_id") != release_id or record.get("schema_version") != 1:
        raise DeployError("retained release record identity mismatch")
    return record


def rollback_release(cfg: dict[str, Any], release_id: str) -> dict[str, Any]:
    with deployment_lock(cfg):
        tx_path = active_transaction(cfg)
        interrupted: dict[str, Any] | None = None
        if tx_path.exists():
            interrupted = read_owned_json(tx_path, os.getuid(), "active deployment transaction")
            if release_id != interrupted.get("previous", {}).get("release_id"):
                raise DeployError("an interrupted transaction can only roll back to its recorded previous release")
        target = read_release_record(cfg, release_id)
        spa = Path(target["spa_path"]).resolve(strict=True)
        if not spa.is_relative_to((cfg["root"] / "web/releases").resolve(strict=True)):
            raise DeployError("retained SPA target escapes the managed release directory")
        if not (spa / "client").is_dir():
            raise DeployError("retained SPA release is missing")
        recorded_spa_files = target.get("spa_files")
        if recorded_spa_files is not None and spa_tree_hashes(spa / "client") != recorded_spa_files:
            raise DeployError("retained SPA files differ from their verified release record")
        image_id = target.get("api_image_id", "")
        if not re.fullmatch(r"sha256:[0-9a-f]{64}", image_id):
            raise DeployError("retained API image ID is invalid")
        image_ref = target.get("api_image_ref", "")
        if not (re.fullmatch(r"localhost/operatoros-api:[0-9a-f]{40}", image_ref) or
                re.fullmatch(r"localhost/operatoros-api@sha256:[0-9a-f]{64}", image_ref) or image_ref == image_id):
            raise DeployError("retained API image reference is not a local immutable OperatorOS identity")
        actual_id, labels = local_image_identity(image_ref, cfg)
        if (actual_id != image_id or labels.get(API_IMAGE_LABELS["revision"]) != target.get("source_commit") or
            labels.get(API_IMAGE_LABELS["source_dirty"]) != "false"):
            raise DeployError("retained API image is unavailable or its source identity differs")
        before = sha_db_snapshot(cfg["data_dir"])
        manager_state = command(["systemctl", "--user", "is-system-running"], timeout=20)
        if manager_state != "running":
            raise DeployError(f"systemd user manager is not fully running: {manager_state}")
        inspect_podman_context(cfg)
        verify_runtime_units(cfg)
        verify_quadlet_service(cfg["api_service"], cfg["api_unit"], require_active=False)
        verify_quadlet_service(cfg["caddy_service"], cfg["caddy_unit"], require_active=False)
        if interrupted is None and cfg["api_unit"].read_bytes() != cfg["api_unit_copy"].read_bytes():
            raise DeployError("active API Quadlet differs from its reviewed deployment copy")
        schema_validate(image_ref, cfg)
        if sha_db_snapshot(cfg["data_dir"]) != before:
            raise DeployError("read-only rollback schema check observed SQLite file changes")
        if interrupted is not None:
            try:
                restore_snapshot(cfg, interrupted, health=True)
                current = {"release_id": release_id, "source_commit": target["source_commit"],
                           "api_image_id": image_id, "api_manifest_digest": target.get("api_manifest_digest"),
                           "spa_path": str(spa), "rolled_back_at": datetime.now(timezone.utc).isoformat()}
                atomic_write(cfg["root"] / "deploy/current-release.json", (json.dumps(current, indent=2, sort_keys=True) + "\n").encode())
                archive_transaction(cfg, interrupted, "interrupted_rollback_complete")
                return current
            except Exception as error:
                update_transaction(tx_path, interrupted, "rollback_failed", str(error))
                raise DeployError(f"interrupted application transaction could not be restored; marker preserved: {error}") from error
        current_unit = cfg["api_unit"].read_bytes()
        current_copy = cfg["api_unit_copy"].read_bytes()
        current_spa_path, current_spa_id = current_spa(cfg)
        current_image_ref = load_unit_image(cfg["api_unit"], API_NAME)
        current_image_id, current_labels = local_image_identity(current_image_ref, cfg)
        current_file = cfg["root"] / "deploy/current-release.json"
        current_exists = current_file.exists() or current_file.is_symlink()
        if current_exists:
            try:
                previous_release_id = read_owned_json(current_file, os.getuid(), "current release record")["release_id"]
            except (DeployError, KeyError) as error:
                raise DeployError("current release record is malformed; refusing rollback") from error
        else:
            previous_release_id = "legacy-" + current_labels.get(API_IMAGE_LABELS["revision"], "")
        snapshot_dir = cfg["root"] / "deploy/transactions" / ("rollback-" + str(time.time_ns()))
        snapshot_dir.mkdir(mode=0o700, parents=True)
        atomic_write(snapshot_dir / "previous-api.container", current_unit)
        atomic_write(snapshot_dir / "previous-deploy-api.container", current_copy)
        if current_exists:
            atomic_write(snapshot_dir / "previous-current-release.json", current_file.read_bytes())
        synthetic_previous = {"old_release_path": str(current_spa_path), "old_release_id": current_spa_id,
                              "old_image_ref": current_image_ref, "old_image_id": current_image_id,
                              "old_commit": "0" * 40, "release_id": previous_release_id, "db_snapshot": before}
        tx = {"schema_version": 1, "transaction_id": "rollback-" + str(time.time_ns()), "operation": "rollback",
              "started_at": datetime.now(timezone.utc).isoformat(), "previous": synthetic_previous,
              "snapshot_dir": str(snapshot_dir), "previous_current_record_exists": current_exists}
        tx_path = active_transaction(cfg)
        update_transaction(tx_path, tx, "prepared")
        try:
            update_unit_image(cfg["api_unit"], target["api_image_ref"])
            atomic_write(cfg["api_unit_copy"], cfg["api_unit"].read_bytes(), stat.S_IMODE(cfg["api_unit_copy"].stat().st_mode))
            update_transaction(tx_path, tx, "api_unit_updated")
            command(["systemctl", "--user", "daemon-reload"], timeout=60)
            service_call(cfg, "restart", cfg["api_service"])
            switch_pointer(cfg, spa)
            update_transaction(tx_path, tx, "spa_switched")
            service_call(cfg, "restart", cfg["caddy_service"])
            wait_release_health(cfg)
            if sha_db_snapshot(cfg["data_dir"]) != before:
                raise DeployError("SQLite files changed during rollback; no database restore was attempted")
            current = {"release_id": release_id, "source_commit": target["source_commit"],
                       "api_image_id": image_id, "api_manifest_digest": target.get("api_manifest_digest"),
                       "spa_path": str(spa), "rolled_back_at": datetime.now(timezone.utc).isoformat()}
            atomic_write(cfg["root"] / "deploy/current-release.json", (json.dumps(current, indent=2, sort_keys=True) + "\n").encode())
            archive_transaction(cfg, tx, "rollback_complete")
            return current
        except Exception as error:
            try:
                restore_snapshot(cfg, tx, health=True)
            except Exception as rollback_error:
                update_transaction(tx_path, tx, "rollback_failed",
                                   f"selected rollback failed: {error}; restore failed: {rollback_error}")
                raise DeployError(f"selected rollback failed: {error}; restoring pre-rollback application also failed: {rollback_error}") from error
            archive_transaction(cfg, tx, "rollback_reverted")
            raise DeployError(f"selected rollback failed; current application release was restored: {error}") from error


def status(cfg: dict[str, Any]) -> dict[str, Any]:
    active = active_transaction(cfg)
    transaction = None
    if active.exists() or active.is_symlink():
        try:
            transaction = read_owned_json(active, os.getuid(), "active deployment transaction")
        except DeployError:
            transaction = {"phase": "unreadable", "path": str(active)}
    current_file = cfg["root"] / "deploy/current-release.json"
    current = None
    if current_file.exists() or current_file.is_symlink():
        try:
            current = read_owned_json(current_file, os.getuid(), "current release record")
        except DeployError:
            current = {"state": "unreadable", "path": str(current_file)}
    api = {"service": cfg["api_service"], "state": "unknown"}
    caddy = {"service": cfg["caddy_service"], "state": "unknown"}
    for value in (api, caddy):
        result = subprocess.run(["systemctl", "--user", "is-active", value["service"]], text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=False, env=system_environment())
        value["state"] = result.stdout.strip() or f"exit-{result.returncode}"
    storage: dict[str, Any] = {"verified": False}
    try:
        storage = {"verified": True, **inspect_podman_context(cfg)}
    except DeployError as error:
        storage["detail"] = str(error)
    actual_release = "unknown"
    try:
        api["image_ref"] = load_unit_image(cfg["api_unit"], API_NAME)
        api["image_id"], api_labels = local_image_identity(api["image_ref"], cfg)
        api["source_commit"] = api_labels.get(API_IMAGE_LABELS["revision"])
        web, spa_id = current_spa(cfg)
        web_state = str(web)
        if current is None:
            actual_release = "legacy"
        elif (current.get("api_image_id") == api["image_id"] and current.get("source_commit") == api["source_commit"] and
              current.get("spa_path") == str(web) and current.get("release_id") == spa_id):
            actual_release = "consistent"
        else:
            actual_release = "mismatch"
    except (DeployError, OSError):
        web_state = "unknown"
    try:
        check_loopback_services(cfg)
        health = {"state": "healthy"}
    except DeployError as error:
        health = {"state": "unhealthy", "detail": str(error)}
    if transaction is not None:
        state = "incomplete_transaction"
    elif not storage["verified"]:
        state = "podman_storage_invalid"
    elif actual_release not in ("consistent", "legacy") or health["state"] != "healthy":
        state = "inconsistent_or_unhealthy"
    elif actual_release == "legacy":
        state = "legacy_release"
    else:
        state = "healthy"
    return {"state": state, "current_release": current, "actual_release_consistency": actual_release,
            "api": api, "caddy": caddy, "spa_path": web_state, "health": health,
            "podman_storage": storage, "incomplete_transaction": transaction}


def request_from_args(args: argparse.Namespace) -> ReleaseRequest:
    return ReleaseRequest(args.source_sha, str(args.run_id), str(args.run_attempt), str(args.artifact_id),
                          args.artifact_name, args.envelope_sha256)


def add_artifact_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--run-attempt", required=True)
    parser.add_argument("--artifact-id", required=True)
    parser.add_argument("--artifact-name", required=True)
    parser.add_argument("--envelope-sha256", required=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    for action in ("verify", "deploy"):
        command_parser = sub.add_parser(action)
        add_artifact_args(command_parser)
        if action == "deploy":
            command_parser.add_argument("--config", type=Path, required=True)
            command_parser.add_argument("--backup-name", required=True)
            command_parser.add_argument("--yes", action="store_true", help="confirm the requested application deployment")
    for action in ("status", "rollback"):
        command_parser = sub.add_parser(action)
        command_parser.add_argument("--config", type=Path, required=True)
        if action == "rollback":
            command_parser.add_argument("release_id")
            command_parser.add_argument("--yes", action="store_true", help="confirm application-only rollback")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        if args.action == "verify":
            request = request_from_args(args)
            with tempfile.TemporaryDirectory(prefix="operatoros-verify-") as temp:
                os.chmod(temp, 0o700)
                release = verified_artifact(request, Path(temp))
                print(json.dumps({"result": "verified", "source_sha": request.source_sha,
                                  "run_id": request.run_id, "run_attempt": request.run_attempt,
                                  "artifact_id": release.artifact_id, "artifact_name": release.artifact_name,
                                  "envelope_sha256": release.envelope_sha256, "bundle_sha256": release.bundle_sha256,
                                  "api_image": release.manifest["image"],
                                  "spa_sha256": release.manifest["artifacts"]["operatoros-web-client.tar.gz"]}, indent=2))
            return 0
        cfg = load_config(args.config)
        if args.action == "status":
            print(json.dumps(status(cfg), indent=2))
            return 0
        if args.action == "deploy":
            if not args.yes:
                raise DeployError("deploy requires --yes after the operator has reviewed verify output")
            result = deploy_release(cfg, request_from_args(args), args.backup_name)
            print(json.dumps({"result": "deployed", **result}, indent=2))
            return 0
        if not args.yes:
            raise DeployError("rollback requires --yes after the selected release has been reviewed")
        result = rollback_release(cfg, args.release_id)
        print(json.dumps({"result": "rolled_back", **result}, indent=2))
        return 0
    except (DeployError, OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        print(f"operatoros-deploy: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
