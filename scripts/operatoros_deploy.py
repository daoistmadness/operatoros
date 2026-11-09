#!/usr/bin/env python3
"""Verify and install an attested OperatorOS release on one rootless host."""

from __future__ import annotations

import argparse
import base64
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
HOST_ROOT_FREE_FLOOR = 15 * 1024 * 1024 * 1024
HOST_DATA_FREE_FLOOR = 7 * 1024 * 1024 * 1024
HOST_MIN_FREE_INODES = 50_000
HOST_DATA_OPERATION_HEADROOM_BYTES = 2 * 1024 * 1024 * 1024
HOST_OPERATION_HEADROOM_INODES = 30_000
HOST_ROOT_OPERATION_HEADROOM_BYTES = 1 * 1024 * 1024 * 1024
HOST_DATA_MOUNTPOINT = Path("/mnt/podman-data")
HOST_D1_ROOT_NAME = "operatoros-d1-synthetic"
HOST_D1_UID = 1002
HOST_D1_SUBID_START = 231072
HOST_D1_SUBID_COUNT = 65_536
HOST_D1_API_URL = "http://127.0.0.1:18190"
HOST_D1_WEB_URL = "http://127.0.0.1:18188"
API_NAME = "operatoros-lite-api"
CADDY_NAME = "operatoros-lite-caddy"
CADDY_IMAGE = "docker.io/library/caddy@sha256:e70b164da81ef698b3ad19af799ea6086ce6d9e48ed4079eb9fe26f6fbf14ee5"
REHEARSAL_WORKSPACE_PREFIX = "operatoros-deployment-rehearsal."
SCHEMA_VALIDATION_FAILURE_CODES = frozenset({
    "DATABASE_MIGRATION_REQUIRED",
    "DATABASE_SCHEMA_INVALID",
})
PODMAN_STORAGE_WARNING_CLASSES = frozenset({
    "storage-driver-database-override", "additional-image-store-warning",
    "storage-path-warning", "storage-configuration-warning",
})
PODMAN_FAILURE_CLASSIFICATIONS = frozenset({
    "additional-image-store-warning", "command_not_found", "container_command_failed",
    "container_command_not_found", "container_command_not_invokable", "database_schema_rejected",
    "empty_stderr", "filesystem_failure", "missing_path", "oci_runtime_failure",
    "permission_rejected", "podman_engine_failure",
    "storage-configuration-warning", "storage-driver-database-override", "storage-path-warning",
    "sqlite_snapshot_changed", "subprocess_timeout", "unsupported_podman_option",
})


class DeployError(RuntimeError):
    def __init__(self, message: str, *, exit_code: int | None = None,
                 diagnostic_code: str | None = None, failure_classification: str | None = None):
        if diagnostic_code is not None and diagnostic_code not in SCHEMA_VALIDATION_FAILURE_CODES:
            raise ValueError("invalid deployment diagnostic code")
        if failure_classification is not None and failure_classification not in PODMAN_FAILURE_CLASSIFICATIONS:
            raise ValueError("invalid deployment failure classification")
        self.exit_code = exit_code
        self.diagnostic_code = diagnostic_code
        self.failure_classification = failure_classification
        super().__init__(message)


class SchemaValidationError(DeployError):
    """A sanitized, allowlisted rejection from the read-only database validator."""

    def __init__(self, failure_code: str, *, exit_code: int):
        if (failure_code not in SCHEMA_VALIDATION_FAILURE_CODES or type(exit_code) is not int or
            exit_code == 0):
            raise ValueError("invalid schema validation rejection")
        self.failure_code = failure_code
        super().__init__("read-only schema validation rejected the database", exit_code=exit_code,
                         failure_classification="database_schema_rejected")


def schema_validation_failure_code(stderr: str) -> str | None:
    """Recognize only one complete allowlisted database rejection line."""
    lines = [line for line in stderr.splitlines() if line.strip()]
    if len(lines) != 1:
        return None
    match = re.fullmatch(r"(DATABASE_MIGRATION_REQUIRED|DATABASE_SCHEMA_INVALID): [^\r\n]+", lines[0])
    return match.group(1) if match is not None else None


PODMAN_CONTEXT_FAILURES = {
    "CTX_WORKSPACE_FAILURE": "The private rehearsal workspace is unavailable, noncanonical, or unsafe.",
    "CTX_CONFIG_FAILURE": "private Podman configuration failed validation or selected an unexpected image or container store",
    "CTX_PODMAN_INFO_FAILURE": "The Podman info command did not complete successfully.",
    "CTX_PODMAN_INFO_INVALID_JSON": "Podman info returned malformed or incomplete JSON storage identity.",
    "CTX_ROOTLESS_MISMATCH": "Podman is not running in the required local rootless VFS/systemd context.",
    "CTX_GRAPHROOT_MISMATCH": "Podman graphRoot is outside the approved private storage context.",
    "CTX_RUNROOT_MISMATCH": "Podman runRoot is outside the approved private storage context.",
    "CTX_CONFIGFILE_MISMATCH": "Podman configFile does not identify the private storage configuration.",
    "CTX_METADATA_PATH_MISMATCH": "Podman staticDir or metadata paths differ from the private context.",
    "CTX_ADDITIONAL_STORE": "Podman reported an additional image store outside the private configuration.",
    "CTX_INVENTORY_INVALID": "Podman did not report a verifiable image or container inventory.",
    "CTX_NONEMPTY_STORE": "private Podman context exposes pre-existing containers, images, or volumes; it already contains resources.",
    "CTX_STORE_INVENTORY_FAILURE": "The private Podman inventory command did not complete successfully.",
    "CTX_ENVIRONMENT_MISMATCH": "Podman inventory command environment differs from the verified private context.",
    "CTX_IDMAP_INVALID": "Podman user namespace mappings are invalid or too small.",
    "CTX_UNCLASSIFIED_FAILURE": "Private Podman context qualification failed unexpectedly.",
}
PODMAN_CONTEXT_STAGES = frozenset({
    "workspace_creation", "private_context_creation", "private_configuration",
    "podman_environment", "podman_info", "podman_info_json",
    "podman_store_validation", "store_inventory", "uid_gid_map_validation",
})
PODMAN_CONTEXT_GUARDS = frozenset({
    "none", "artifact_verified", "workspace_created", "private_context_created",
    "private_environment_verified", "podman_info_returned", "podman_info_parsed",
    "private_config_validated", "rootless_runtime_validated", "configfile_matched",
    "graphroot_matched", "runroot_matched", "metadata_paths_matched",
    "inventory_shape_validated", "podman_store_identity_verified", "store_inventory_empty",
    "uid_map_verified", "gid_map_verified",
})
PODMAN_CONTEXT_VALUES = frozenset({
    "private_workspace", "private_storage_config", "local_rootless_vfs_systemd_context",
    "private_graphroot", "private_runroot", "private_metadata_paths", "empty_store",
    "successful_podman_info", "at_least_65536_numeric_mapping_ids",
    "complete_private_store_identity", "verifiable_empty_inventory",
    "unavailable", "unsafe", "rootless_or_runtime_mismatch", "different_path",
    "different_config", "incomplete_identity", "additional_store_present",
    "invalid_inventory", "nonempty_store", "nonzero_exit", "storage_warning",
    "command_failed", "command_timeout", "command_unavailable", "empty_json",
    "malformed_json", "environment_mismatch", "invalid_mapping", "insufficient_mapping",
})


class PodmanContextError(DeployError):
    """A fail-closed private-context error with fields safe for rehearsal evidence."""

    def __init__(self, code: str, stage: str, last_completed_guard: str, *,
                 exit_code: int | None = None,
                 expected: str | None = None, observed: str | None = None):
        if code not in PODMAN_CONTEXT_FAILURES:
            raise ValueError("invalid private Podman failure code")
        if stage not in PODMAN_CONTEXT_STAGES or last_completed_guard not in PODMAN_CONTEXT_GUARDS:
            raise ValueError("invalid private Podman diagnostic stage or guard")
        if exit_code is not None and type(exit_code) is not int:
            raise ValueError("private Podman process exit code must be an integer")
        if expected is not None and expected not in PODMAN_CONTEXT_VALUES:
            raise ValueError("invalid private Podman expected-value label")
        if observed is not None and observed not in PODMAN_CONTEXT_VALUES:
            raise ValueError("invalid private Podman observed-value label")
        self.code = code
        self.stage = stage
        self.last_completed_guard = last_completed_guard
        self.expected = expected
        self.observed = observed
        self.explanation = PODMAN_CONTEXT_FAILURES[code]
        super().__init__(self.explanation, exit_code=exit_code)

    def diagnostic_record(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "stage": self.stage,
            "last_completed_guard": self.last_completed_guard,
            "exit_code": self.exit_code,
            "explanation": self.explanation,
            "expected": self.expected,
            "observed": self.observed,
        }


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
    artifact_expires_at: str


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

    deploy_dir = root / "deploy"
    deploy_dir.mkdir(mode=0o700, exist_ok=True)
    deploy_info = deploy_dir.lstat()
    if (not stat.S_ISDIR(deploy_info.st_mode) or stat.S_ISLNK(deploy_info.st_mode) or
        deploy_info.st_uid != os.getuid() or stat.S_IMODE(deploy_info.st_mode) & 0o077 or
        deploy_dir.resolve(strict=True) != deploy_dir):
        raise DeployError("private Podman configuration directory is unsafe")

    podman_root = root / "podman-rootless"
    paths = {
        "home": podman_root / "home",
        "graphroot": podman_root / "graphroot",
        "runroot": podman_root / "runroot",
        "static_dir": podman_root / "metadata",
        "volume_path": podman_root / "volumes",
        "image_copy_tmp_dir": podman_root / "image-tmp",
        "xdg_config_home": deploy_dir / "xdg-config",
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

    storage_conf = paths["xdg_config_home"] / "containers/storage.conf"
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
        storage_conf=deploy_dir / "xdg-config/containers/storage.conf",
        containers_conf=deploy_dir / "containers.conf",
        graphroot=podman_root / "graphroot",
        runroot=podman_root / "runroot",
        static_dir=podman_root / "metadata",
        volume_path=podman_root / "volumes",
        image_copy_tmp_dir=podman_root / "image-tmp",
        xdg_config_home=deploy_dir / "xdg-config",
        xdg_data_home=podman_root / "xdg-data",
        home=podman_root / "home",
        registry_auth_file=deploy_dir / "registry-auth.json",
    )


def validate_private_podman_config(context: PrivatePodmanContext, *,
                                   last_completed_guard: str = "private_context_created") -> None:
    """Validate private config files before starting Podman or creating units."""
    try:
        _validate_private_podman_config(context)
    except PodmanContextError:
        raise
    except (DeployError, OSError, UnicodeError, tomllib.TOMLDecodeError) as error:
        raise PodmanContextError(
            "CTX_CONFIG_FAILURE", "private_configuration", last_completed_guard,
            expected="private_storage_config", observed="unsafe",
        ) from error


def _validate_private_podman_config(context: PrivatePodmanContext) -> None:
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
    validate_private_podman_config(context, last_completed_guard="podman_info_parsed")
    last_completed_guard = "private_config_validated"
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
            raise PodmanContextError(
                "CTX_ROOTLESS_MISMATCH", "podman_store_validation", last_completed_guard,
                expected="local_rootless_vfs_systemd_context", observed="rootless_or_runtime_mismatch",
            )
        last_completed_guard = "rootless_runtime_validated"
        for key, expected in expected_paths.items():
            code, guard, label = {
                "configFile": ("CTX_CONFIGFILE_MISMATCH", "configfile_matched", "private_storage_config"),
                "graphRoot": ("CTX_GRAPHROOT_MISMATCH", "graphroot_matched", "private_graphroot"),
                "runRoot": ("CTX_RUNROOT_MISMATCH", "runroot_matched", "private_runroot"),
                "volumePath": ("CTX_METADATA_PATH_MISMATCH", "metadata_paths_matched", "private_metadata_paths"),
                "imageCopyTmpDir": ("CTX_METADATA_PATH_MISMATCH", "metadata_paths_matched", "private_metadata_paths"),
            }[key]
            try:
                actual = Path(store[key])
                canonical = actual.resolve(strict=True)
                expected_canonical = expected.resolve(strict=True)
            except (TypeError, ValueError, OSError) as error:
                raise PodmanContextError(
                    code, "podman_store_validation", last_completed_guard,
                    expected=label, observed="different_path",
                ) from error
            if (not actual.is_absolute() or canonical != actual or actual != expected or
                actual != expected_canonical):
                raise PodmanContextError(
                    code, "podman_store_validation", last_completed_guard,
                    expected=label, observed="different_path",
                )
            last_completed_guard = guard
        if "staticDir" in store:
            try:
                static_dir = Path(store["staticDir"])
                canonical_static_dir = static_dir.resolve(strict=True)
            except (TypeError, ValueError, OSError) as error:
                raise PodmanContextError(
                    "CTX_METADATA_PATH_MISMATCH", "podman_store_validation", last_completed_guard,
                    expected="private_metadata_paths", observed="different_path",
                ) from error
            if (not static_dir.is_absolute() or canonical_static_dir != static_dir or
                static_dir != context.static_dir):
                raise PodmanContextError(
                    "CTX_METADATA_PATH_MISMATCH", "podman_store_validation", last_completed_guard,
                    expected="private_metadata_paths", observed="different_path",
                )
            last_completed_guard = "metadata_paths_matched"
        additional_stores = store.get("additionalImageStores", [])
        if additional_stores not in ([], None):
            raise PodmanContextError(
                "CTX_ADDITIONAL_STORE", "podman_store_validation", last_completed_guard,
                expected="private_storage_config", observed="additional_store_present",
            )
        for key in ("imageStore", "containerStore"):
            if not isinstance(store.get(key), dict) or type(store[key].get("number")) is not int:
                raise PodmanContextError(
                    "CTX_INVENTORY_INVALID", "podman_store_validation", last_completed_guard,
                    expected="verifiable_empty_inventory", observed="invalid_inventory",
                )
        last_completed_guard = "inventory_shape_validated"
        if require_empty:
            for field in ("containerStore", "imageStore"):
                value = store.get(field)
                if not isinstance(value, dict) or value.get("number") != 0:
                    raise PodmanContextError(
                        "CTX_NONEMPTY_STORE", "podman_store_validation", last_completed_guard,
                        expected="empty_store", observed="nonempty_store",
                    )
            last_completed_guard = "store_inventory_empty"
        try:
            canonical_static_dir = context.static_dir.resolve(strict=True)
        except OSError as error:
            raise PodmanContextError(
                "CTX_METADATA_PATH_MISMATCH", "podman_store_validation", last_completed_guard,
                expected="private_metadata_paths", observed="unavailable",
            ) from error
        if canonical_static_dir != context.static_dir:
            raise PodmanContextError(
                "CTX_METADATA_PATH_MISMATCH", "podman_store_validation", last_completed_guard,
                expected="private_metadata_paths", observed="different_path",
            )
    except PodmanContextError:
        raise
    except (AttributeError, KeyError, TypeError, ValueError, OSError) as error:
        raise PodmanContextError(
            "CTX_PODMAN_INFO_INVALID_JSON", "podman_store_validation", last_completed_guard,
            expected="complete_private_store_identity", observed="incomplete_identity",
        ) from error


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


def safe_command_name(args: list[str]) -> str:
    return Path(args[0]).name if args else "unknown_command"


def podman_failure_classification(stderr: str, exit_code: int) -> str:
    """Reduce Podman's stderr to a stable allowlisted category without retaining it."""
    diagnostic = stderr_classification(stderr)
    if diagnostic in PODMAN_STORAGE_WARNING_CLASSES:
        return diagnostic
    if diagnostic == "empty":
        return "empty_stderr"
    value = stderr.casefold()
    if any(marker in value for marker in ("unknown flag", "unknown option", "unrecognized option")):
        return "unsupported_podman_option"
    if "permission denied" in value or "eacces" in value:
        return "permission_rejected"
    if "no such file or directory" in value or "enoent" in value:
        return "missing_path"
    if any(marker in value for marker in ("oci runtime", "crun:", "runc:", "conmon")):
        return "oci_runtime_failure"
    if exit_code == 125:
        return "podman_engine_failure"
    if exit_code == 126:
        return "container_command_not_invokable"
    if exit_code == 127:
        return "container_command_not_found"
    return "container_command_failed"


def _assert_podman_command(result: subprocess.CompletedProcess[str], args: list[str], *,
                           schema_validation: bool = False) -> None:
    command_name = safe_command_name(args)
    diagnostic = stderr_classification(result.stderr)
    if result.returncode != 0:
        failure_code = None
        if schema_validation and diagnostic not in PODMAN_STORAGE_WARNING_CLASSES:
            failure_code = schema_validation_failure_code(result.stderr)
        failure_classification = (
            podman_failure_classification(result.stderr, result.returncode)
            if command_name == "podman" else None
        )
        raise DeployError(f"command failed ({result.returncode}): {command_name} (stderr={diagnostic})",
                          exit_code=result.returncode, diagnostic_code=failure_code,
                          failure_classification=failure_classification)
    if command_name == "podman" and diagnostic in PODMAN_STORAGE_WARNING_CLASSES:
        raise DeployError(f"Podman reported an isolation warning (stderr={diagnostic})",
                          failure_classification=diagnostic)


def command_json(args: list[str], env: dict[str, str] | None = None, *, timeout: int = 60,
                 context_diagnostics: bool = False) -> Any:
    command_name = safe_command_name(args)
    try:
        result = run_command(args, env=env, timeout=timeout)
    except DeployError as error:
        if not context_diagnostics:
            raise
        cause = error.__cause__
        observed = "command_timeout" if isinstance(cause, subprocess.TimeoutExpired) else "command_unavailable"
        raise PodmanContextError(
            "CTX_PODMAN_INFO_FAILURE", "podman_info", "private_environment_verified",
            expected="successful_podman_info", observed=observed,
        ) from error
    try:
        _assert_podman_command(result, args)
    except DeployError as error:
        if not context_diagnostics:
            raise
        observed = "nonzero_exit" if result.returncode != 0 else "storage_warning"
        raise PodmanContextError(
            "CTX_PODMAN_INFO_FAILURE", "podman_info", "private_environment_verified",
            exit_code=result.returncode, expected="successful_podman_info", observed=observed,
        ) from error
    if not result.stdout.strip():
        if context_diagnostics:
            raise PodmanContextError(
                "CTX_PODMAN_INFO_INVALID_JSON", "podman_info_json", "podman_info_returned",
                exit_code=result.returncode, expected="complete_private_store_identity", observed="empty_json",
            )
        raise DeployError(f"{command_name} returned empty JSON (exit={result.returncode}, stderr={stderr_classification(result.stderr)})")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as error:
        if context_diagnostics:
            raise PodmanContextError(
                "CTX_PODMAN_INFO_INVALID_JSON", "podman_info_json", "podman_info_returned",
                exit_code=result.returncode, expected="complete_private_store_identity", observed="malformed_json",
            ) from error
        raise DeployError(f"{command_name} returned malformed JSON (stderr={stderr_classification(result.stderr)})") from error


def run_command(args: list[str], env: dict[str, str] | None = None, *, timeout: int = 60) -> subprocess.CompletedProcess[str]:
    command_name = safe_command_name(args)
    try:
        return subprocess.run(args, env=env if env is not None else system_environment(), text=True,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        failure_classification = None
        if command_name == "podman":
            if isinstance(error, FileNotFoundError):
                failure_classification = "command_not_found"
            elif isinstance(error, PermissionError):
                failure_classification = "permission_rejected"
            elif isinstance(error, subprocess.TimeoutExpired):
                failure_classification = "subprocess_timeout"
            else:
                failure_classification = "filesystem_failure"
        raise DeployError(f"command failed to execute: {command_name} ({type(error).__name__})",
                          failure_classification=failure_classification) from error


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
    expires_at = artifact.get("expires_at")
    if not isinstance(expires_at, str):
        raise DeployError("GitHub artifact expiration is missing or malformed")
    try:
        expiration = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
    except (AttributeError, ValueError) as error:
        raise DeployError("GitHub artifact expiration is missing or malformed") from error
    if expiration.tzinfo is None:
        raise DeployError("GitHub artifact expiration must include a timezone")
    if expiration.astimezone(timezone.utc) <= datetime.now(timezone.utc):
        raise DeployError("GitHub artifact has expired")
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
                           request.artifact_id, request.artifact_name, artifact["expires_at"])


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


def host_runroot(uid: int) -> Path:
    return Path(f"/run/user/{uid}/operatoros-podman-runroot")


def verify_storage_mount(cfg: dict[str, Any]) -> None:
    """Require the configured host deployment root to live on its exact filesystem."""
    if cfg.get("profile") != "host":
        return
    mountpoint = cfg["storage_mountpoint"]
    root = cfg["root"]
    if not root.is_relative_to(mountpoint) or root == mountpoint:
        raise DeployError("deployment root must be below the approved data mountpoint")
    try:
        result = run_command(
            ["findmnt", "--json", "--target", str(root), "--output", "TARGET,UUID,FSTYPE,OPTIONS"],
            env=system_environment(), timeout=15,
        )
        if result.returncode != 0:
            raise DeployError("cannot verify the configured data filesystem mount")
        filesystems = json.loads(result.stdout).get("filesystems")
    except (DeployError, json.JSONDecodeError, AttributeError, TypeError) as error:
        raise DeployError("cannot verify the configured data filesystem mount") from error
    if not isinstance(filesystems, list) or len(filesystems) != 1 or not isinstance(filesystems[0], dict):
        raise DeployError("cannot verify the configured data filesystem mount")
    mounted = filesystems[0]
    options = set(str(mounted.get("options", "")).split(","))
    if (mounted.get("target") != str(mountpoint) or mounted.get("uuid") != cfg["storage_uuid"] or
        mounted.get("fstype") != cfg["storage_fstype"] or "rw" not in options or "ro" in options):
        raise DeployError("data filesystem identity or writable mount state does not match deployment config")
    usage = shutil.disk_usage(cfg["root"])
    statvfs = os.statvfs(cfg["root"])
    if usage.free < cfg["min_free_bytes"] or statvfs.f_favail < cfg["min_free_inodes"]:
        raise DeployError("data filesystem is below the configured free-space or inode reserve")
    if shutil.disk_usage(Path("/")).free < cfg["root_min_free_bytes"]:
        raise DeployError("root filesystem is below the configured free-space reserve")


def verify_host_storage_config(cfg: dict[str, Any]) -> None:
    if cfg.get("profile") != "host":
        return
    for directory, label in (
        (cfg["root"], "D1 deployment root"),
        (cfg["root"] / "deploy", "D1 deployment directory"),
        (cfg["root"] / "deploy/config", "D1 private config directory"),
        (cfg["root"] / "podman-rootless", "D1 Podman storage parent"),
        (cfg["graphroot"], "rootless Podman graphroot"),
        (cfg["data_dir"], "D1 SQLite directory"),
        (cfg["root"] / "web", "D1 web directory"),
        (cfg["root"] / "web/releases", "D1 web releases directory"),
    ):
        require_directory(directory, os.getuid(), label, 0o077)
    require_regular_owned(cfg["storage_conf"], os.getuid(), "Podman storage config", 0o077)
    require_directory(cfg["runroot"], os.getuid(), "rootless Podman runroot", 0o077)
    try:
        value = tomllib.loads(cfg["storage_conf"].read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError) as error:
        raise DeployError("Podman storage config is unreadable or malformed") from error
    expected = {"storage": {"driver": cfg["storage_driver"],
                             "graphroot": str(cfg["graphroot"]),
                             "runroot": str(cfg["runroot"])}}
    if value != expected:
        raise DeployError("Podman storage config must select only the approved D1 overlay store")


def verify_user_manager_storage_context(cfg: dict[str, Any]) -> None:
    """Check only the Podman selectors in the user manager environment; never log its contents."""
    if cfg.get("profile") != "host":
        return
    try:
        output = command(["systemctl", "--user", "show-environment"], timeout=20)
    except DeployError as error:
        raise DeployError("cannot verify the user manager Podman storage context") from error
    selected = {"CONTAINERS_STORAGE_CONF", "CONTAINERS_CONF", "CONTAINERS_CONF_OVERRIDE",
                "CONTAINER_HOST", "CONTAINER_CONNECTION", "DOCKER_HOST", "STORAGE_DRIVER", "STORAGE_OPTS",
                "GH_TOKEN", "GITHUB_TOKEN", "OPERATOROS_RELEASE_TOKEN", "AUTH_COOKIE_SECRET",
                "BACKUP_ENCRYPTION_KEY", "ASTRYX_SETUP_TOKEN"}
    values: dict[str, list[str]] = {}
    for line in output.splitlines():
        name, separator, value = line.partition("=")
        if separator and name in selected:
            values.setdefault(name, []).append(value)
    expected = str(cfg["storage_conf"])
    if values.get("CONTAINERS_STORAGE_CONF") != [expected] or any(
        name in values for name in selected - {"CONTAINERS_STORAGE_CONF"}
    ):
        raise DeployError("user manager does not select the configured rootless Podman storage context")


def verify_process_storage_context(cfg: dict[str, Any], *, require_explicit: bool = False) -> None:
    if cfg.get("profile") != "host":
        return
    selected = os.environ.get("CONTAINERS_STORAGE_CONF")
    expected = str(cfg["storage_conf"])
    if ((selected != expected if require_explicit else selected not in (None, expected)) or
        any(os.environ.get(name) for name in ("CONTAINERS_CONF", "CONTAINERS_CONF_OVERRIDE"))):
        raise DeployError("process does not select the configured rootless Podman storage context")


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
    host_mount_keys = {"storage_mountpoint", "storage_uuid", "storage_fstype", "storage_driver",
                       "root_min_free_bytes"}
    host_services = (cfg.get("api_service"), cfg.get("caddy_service")) == (
        "operatoros-lite-api.service", "operatoros-lite-caddy.service"
    )
    expected_keys = required | host_mount_keys if host_services else required
    if set(cfg) != expected_keys:
        raise DeployError("deployment config keys differ from the documented schema")
    numeric_settings = ["expected_uid", "min_free_bytes", "min_free_inodes", "backup_max_age_seconds"]
    if host_services:
        numeric_settings.append("root_min_free_bytes")
    if any(type(cfg[key]) is not int for key in numeric_settings):
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
    if host_services:
        paths += ("storage_mountpoint",)
    for key in paths:
        cfg[key] = path_from_config(cfg[key], key)
    root = cfg["root"].resolve(strict=True)
    cfg["profile"] = deployment_profile(cfg, root)
    if cfg["profile"] == "host":
        if (not isinstance(cfg["storage_uuid"], str) or
            not re.fullmatch(r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}", cfg["storage_uuid"]) or
            not isinstance(cfg["storage_fstype"], str) or not re.fullmatch(r"[A-Za-z0-9_-]+", cfg["storage_fstype"])):
            raise DeployError("configured data filesystem identity is invalid")
        if not cfg["storage_mountpoint"].is_dir():
            raise DeployError("configured data mountpoint must be a directory")
        if cfg["storage_driver"] != "overlay":
            raise DeployError("the D1 host runtime requires the configured overlay storage driver")
        if (cfg["min_free_bytes"] < HOST_DATA_FREE_FLOOR or
            cfg["min_free_inodes"] < HOST_MIN_FREE_INODES or
            cfg["root_min_free_bytes"] < HOST_ROOT_FREE_FLOOR):
            raise DeployError("host storage reserves are below the reviewed D1 capacity floors")
        expected_root = cfg["storage_mountpoint"] / HOST_D1_ROOT_NAME
        expected_paths = {
            "root": expected_root,
            "storage_conf": expected_root / "deploy/storage.conf",
            "graphroot": expected_root / "podman-rootless/graphroot",
            "runroot": host_runroot(cfg["expected_uid"]),
            "data_dir": expected_root / "data/sqlite",
            "backup_dir": expected_root / "data/sqlite/backups",
            "api_unit": Path.home() / ".config/containers/systemd/operatoros-lite-api.container",
            "caddy_unit": Path.home() / ".config/containers/systemd/operatoros-lite-caddy.container",
            "api_unit_copy": expected_root / "deploy/operatoros-lite-api.container",
        }
        if (cfg["expected_uid"] != HOST_D1_UID or
            cfg["api_url"] != HOST_D1_API_URL or cfg["web_url"] != HOST_D1_WEB_URL or
            cfg["storage_mountpoint"] != HOST_DATA_MOUNTPOINT or
            any(cfg[key].resolve(strict=True) != expected.resolve() for key, expected in expected_paths.items()) or
            path.resolve(strict=True) != expected_root / "deploy/config/operatoros.toml"):
            raise DeployError("host deployment configuration must match the isolated D1 contract")
    for key in ("storage_conf", "graphroot"):
        if not cfg[key].resolve(strict=True).is_relative_to(root):
            raise DeployError(f"{key} must remain inside the configured rootless OperatorOS storage root")
    for key in ("data_dir", "backup_dir"):
        if not cfg[key].resolve(strict=True).is_relative_to(root):
            raise DeployError(f"{key} must be inside the configured OperatorOS root")
    runtime_runroot = host_runroot(cfg["expected_uid"])
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
           "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8"}
    if context is None:
        env["CONTAINERS_STORAGE_CONF"] = str(storage_conf)
    else:
        env.update(context.environment())
    return env


def system_environment() -> dict[str, str]:
    names = ("PATH", "HOME", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS", "LANG", "LC_ALL")
    return {name: os.environ[name] for name in names if name in os.environ}


def command(args: list[str], env: dict[str, str] | None = None, *, timeout: int = 60,
            schema_validation: bool = False) -> str:
    result = run_command(args, env=env, timeout=timeout)
    _assert_podman_command(result, args, schema_validation=schema_validation)
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
    elif cfg.get("profile") == "host":
        verify_storage_mount(cfg)
        verify_host_storage_config(cfg)
        verify_user_manager_storage_context(cfg)
        verify_process_storage_context(cfg)
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
    graph_driver = str(store.get("graphDriverName") or "unknown")
    if cfg.get("profile") == "host" and graph_driver != cfg["storage_driver"]:
        raise DeployError("Podman is not using the configured rootless storage driver")
    config_file = store.get("configFile")
    if cfg.get("profile") == "host" and (
        not isinstance(config_file, str) or Path(config_file).resolve() != cfg["storage_conf"].resolve()
    ):
        raise DeployError("Podman is not using the configured rootless storage config")
    if config_file and Path(config_file).resolve() != cfg["storage_conf"].resolve():
        raise DeployError("Podman is reading a different storage configuration file")
    additional_stores = store.get("additionalImageStores", [])
    if cfg.get("profile") == "host" and additional_stores:
        raise DeployError("Podman exposes an additional image store outside the isolated D1 context")
    return {
        "storage_conf": str(cfg["storage_conf"]),
        "graphroot": str(graphroot),
        "runroot": str(runroot),
        "graph_driver": graph_driver,
    }


def validate_host_subid_map(mapping: str, *, uid: int, name: str) -> None:
    expected = [(0, uid, 1), (1, HOST_D1_SUBID_START, HOST_D1_SUBID_COUNT)]
    try:
        observed = [tuple(map(int, line.split())) for line in mapping.splitlines() if line.strip()]
    except ValueError as error:
        raise DeployError(f"Podman rootless {name} mapping is malformed") from error
    if observed != expected:
        raise DeployError(f"Podman rootless {name} mapping does not match the approved D1 subordinate range")


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
    storage = validate_host_podman_store(info, cfg)
    if cfg.get("profile") == "host":
        for name in ("uid", "gid"):
            mapping = command(["podman", "unshare", "cat", f"/proc/self/{name}_map"], env)
            validate_host_subid_map(mapping, uid=cfg["expected_uid"], name=name)
    return storage


def require_empty_podman_store(context: PrivatePodmanContext, env: dict[str, str]) -> None:
    """Prove the private store cannot see pre-existing containers, images, or volumes."""
    if any(env.get(name) != value for name, value in context.environment().items()):
        raise PodmanContextError(
            "CTX_ENVIRONMENT_MISMATCH", "store_inventory", "podman_store_identity_verified",
            expected="private_workspace", observed="environment_mismatch",
        )
    commands = (
        ["podman", "ps", "--all", "--quiet"],
        ["podman", "image", "ls", "--quiet"],
        ["podman", "volume", "ls", "--quiet"],
    )
    for args in commands:
        try:
            output = command(args, env)
        except DeployError as error:
            raise PodmanContextError(
                "CTX_STORE_INVENTORY_FAILURE", "store_inventory", "podman_store_identity_verified",
                exit_code=error.exit_code, expected="empty_store", observed="command_failed",
            ) from error
        if output.strip():
            raise PodmanContextError(
                "CTX_NONEMPTY_STORE", "store_inventory", "podman_store_identity_verified",
                expected="empty_store", observed="nonempty_store",
            )


def validate_user_namespace_map(mapping: str, *, name: str, last_completed_guard: str) -> None:
    if name not in {"uid", "gid"}:
        raise ValueError("user namespace map name must be uid or gid")
    sizes: list[int] = []
    for line in mapping.splitlines():
        fields = line.split()
        if (not line.isascii() or len(fields) != 3 or any(len(field) > 20 for field in fields) or
            any(not field.isdecimal() for field in fields) or int(fields[2]) < 1):
            raise PodmanContextError(
                "CTX_IDMAP_INVALID", "uid_gid_map_validation", last_completed_guard,
                expected="at_least_65536_numeric_mapping_ids", observed="invalid_mapping",
            )
        sizes.append(int(fields[2]))
    if sum(sizes) < 65_536:
        raise PodmanContextError(
            "CTX_IDMAP_INVALID", "uid_gid_map_validation", last_completed_guard,
            expected="at_least_65536_numeric_mapping_ids", observed="insufficient_mapping",
        )


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
            if name == "operatoros.sqlite-shm" or (name == "operatoros.sqlite-wal" and info.st_size == 0):
                continue
            snapshot[name] = (info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns, info.st_mode)
    if "operatoros.sqlite" not in snapshot:
        raise DeployError("application SQLite database is missing")
    return snapshot


def sqlite_main_identity(data_dir: Path) -> tuple[int, int]:
    path = data_dir / "operatoros.sqlite"
    try:
        info = path.lstat()
    except OSError as error:
        raise DeployError("application SQLite database is unavailable") from error
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077):
        raise DeployError("application SQLite database ownership or permissions are unsafe")
    return info.st_dev, info.st_ino


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


def unit_section_values(text: str, section: str, key: str) -> list[str]:
    current = ""
    values: list[str] = []
    for line in text.splitlines():
        if line.startswith("[") and line.endswith("]"):
            current = line[1:-1]
        elif current == section and line.startswith(key + "="):
            values.append(line[len(key) + 1:])
    return values


def verify_host_unit_storage_guards(text: str, cfg: dict[str, Any]) -> None:
    if cfg.get("profile") != "host":
        return
    cli = cfg["root"] / "deploy/operatoros_deploy.py"
    config = cfg["root"] / "deploy/config/operatoros.toml"
    expected_check = f"/usr/bin/python3 {cli} storage-check --config {config}"
    expected_runroot = f"/usr/bin/install -d -m 0700 {cfg['runroot']}"
    if (unit_section_values(text, "Unit", "RequiresMountsFor") != [str(cfg["storage_mountpoint"])] or
        unit_section_values(text, "Unit", "ConditionPathIsMountPoint") != [str(cfg["storage_mountpoint"])] or
        unit_section_values(text, "Service", "Environment") != [f"CONTAINERS_STORAGE_CONF={cfg['storage_conf']}"] or
        unit_section_values(text, "Service", "ExecStartPre") != [expected_runroot, expected_check] or
        unit_section_values(text, "Service", "Restart") != ["on-failure"] or
        "[Install]" in text):
        raise DeployError("Quadlet must verify the approved mount and Podman context before service startup")


def verify_host_api_environment(cfg: dict[str, Any]) -> None:
    path = cfg["root"] / "deploy/api.env"
    require_regular_owned(path, os.getuid(), "API environment file", 0o077)
    required = {"AUTH_COOKIE_SECRET", "BACKUP_ENCRYPTION_KEY", "BACKUP_ENCRYPTION_KEY_ID",
                "ALLOWED_ORIGINS", "COOKIE_SECURE", "ENABLE_DESTRUCTIVE_OPERATIONS",
                "ASTRYX_SETUP_TOKEN"}
    values: dict[str, str] = {}
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as error:
        raise DeployError("API environment file is unavailable") from error
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        name, separator, value = line.partition("=")
        if not separator or not re.fullmatch(r"[A-Z][A-Z0-9_]*", name) or name in values:
            raise DeployError("API environment file must use unique KEY=value entries")
        values[name] = value
    cookie_secret = values.get("AUTH_COOKIE_SECRET", "")
    backup_key = values.get("BACKUP_ENCRYPTION_KEY", "")
    setup_token = values.get("ASTRYX_SETUP_TOKEN", "")
    try:
        decoded_key = base64.b64decode(backup_key, validate=True)
    except (ValueError, base64.binascii.Error):
        decoded_key = b""
    if (set(values) != required or len(cookie_secret.strip()) < 32 or cookie_secret != cookie_secret.strip() or
        re.fullmatch(r"[A-Za-z0-9_-]{32,256}", setup_token) is None or
        setup_token in (cookie_secret, backup_key) or
        not decoded_key or len(decoded_key) != 32 or base64.b64encode(decoded_key).decode("ascii") != backup_key or
        backup_key == cookie_secret or
        not re.fullmatch(r"[A-Za-z0-9._-]{1,64}", values.get("BACKUP_ENCRYPTION_KEY_ID", "")) or
        values.get("ALLOWED_ORIGINS") != cfg["web_url"] or values.get("COOKIE_SECURE") != "false" or
        values.get("ENABLE_DESTRUCTIVE_OPERATIONS") != "false" or
        any(marker in (cookie_secret + backup_key + setup_token).upper()
            for marker in ("REPLACE", "GENERATE", "PLACEHOLDER"))):
        raise DeployError("API environment file is missing valid synthetic-only D1 configuration")


def verify_runtime_units(cfg: dict[str, Any]) -> None:
    api_text = cfg["api_unit"].read_text(encoding="utf-8")
    verify_host_unit_storage_guards(api_text, cfg)
    if cfg.get("profile") == "host":
        require_regular_owned(cfg["root"] / "deploy/operatoros_deploy.py", os.getuid(), "deployment CLI", 0o077)
        require_regular_owned(cfg["root"] / "deploy/release-bundle.py", os.getuid(), "release bundle verifier", 0o077)
        require_regular_owned(cfg["api_unit_copy"], os.getuid(), "managed API Quadlet copy", 0o077)
        if cfg["api_unit"].read_bytes() != cfg["api_unit_copy"].read_bytes():
            raise DeployError("active API Quadlet differs from its reviewed deployment copy")
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
    if cfg.get("profile") == "host":
        expected_api.update({
            "HealthCmd": "/usr/local/bin/operatoros-api-healthcheck",
            "HealthInterval": "30s",
            "LogDriver": "journald",
        })
    for key, expected in expected_api.items():
        if unit_values(api_text, key) != [expected]:
            raise DeployError(f"API Quadlet {key} does not match the approved loopback and persistent-data contract")
    if unit_values(api_text, "AddCapability"):
        raise DeployError("API Quadlet grants an unexpected capability")
    if cfg.get("profile") == "host":
        verify_host_api_environment(cfg)
    else:
        require_regular_owned(cfg["root"] / "deploy/api.env", os.getuid(), "API environment file", 0o077)

    caddy_text = cfg["caddy_unit"].read_text(encoding="utf-8")
    verify_host_unit_storage_guards(caddy_text, cfg)
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
    }
    if cfg.get("profile") == "host":
        expected_caddy["LogDriver"] = "journald"
    for key, expected in expected_caddy.items():
        if unit_values(caddy_text, key) != [expected]:
            raise DeployError(f"Caddy Quadlet {key} does not match the approved loopback proxy contract")
    capabilities = unit_values(caddy_text, "AddCapability")
    if ((cfg.get("profile") == "host" and capabilities) or
        (cfg.get("profile") == "rehearsal" and capabilities != ["net_bind_service"])):
        raise DeployError("Caddy Quadlet grants an unexpected capability")
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
    required_inodes = cfg["min_free_inodes"]
    if cfg.get("profile") == "host":
        required += HOST_DATA_OPERATION_HEADROOM_BYTES
        required_inodes += HOST_OPERATION_HEADROOM_INODES
        root_required = cfg["root_min_free_bytes"] + HOST_ROOT_OPERATION_HEADROOM_BYTES
        if shutil.disk_usage(Path("/")).free < root_required:
            raise DeployError("insufficient root filesystem capacity for deployment staging")
    for root in roots:
        usage = shutil.disk_usage(root)
        statvfs = os.statvfs(root)
        if usage.free < required or statvfs.f_favail < required_inodes:
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
    db_identity = sqlite_main_identity(cfg["data_dir"])
    check_loopback_services(cfg)
    isolated_schema_preflight(release, cfg)
    if sha_db_snapshot(cfg["data_dir"]) != db_before:
        raise DeployError("SQLite main/WAL/SHM changed during preflight; no application change was made")
    return {"old_release_path": str(old_release), "old_release_id": old_release_id, "old_image_ref": old_image_ref,
            "old_image_id": old_image_id, "old_commit": old_commit, "backup": backup.name,
            "db_snapshot": db_before, "db_identity": db_identity}


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
    try:
        command(args, podman_env(cfg), timeout=60, schema_validation=True)
    except DeployError as error:
        after = sha_db_snapshot(cfg["data_dir"])
        if after != before:
            raise DeployError(
                "read-only schema validation observed a SQLite main/WAL/SHM change; aborting for database activity review",
                exit_code=error.exit_code, failure_classification="sqlite_snapshot_changed",
            ) from error
        if error.diagnostic_code is not None:
            if error.exit_code is None:
                raise DeployError("schema validation rejection omitted its process exit status") from error
            raise SchemaValidationError(error.diagnostic_code, exit_code=error.exit_code) from error
        raise
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
    required_bytes = max(cfg["min_free_bytes"], spa_size * 2)
    required_inodes = cfg["min_free_inodes"]
    if cfg.get("profile") == "host":
        required_bytes += HOST_DATA_OPERATION_HEADROOM_BYTES
        required_inodes += HOST_OPERATION_HEADROOM_INODES
    if (web_free < required_bytes or
        os.statvfs(cfg["root"] / "web").f_favail < required_inodes):
        raise DeployError("insufficient storage for staged SPA release")


def active_transaction(cfg: dict[str, Any]) -> Path:
    return cfg["root"] / "deploy/active-transaction.json"


@contextmanager
def deployment_lock(cfg: dict[str, Any]):
    verify_storage_mount(cfg)
    verify_host_storage_config(cfg)
    verify_user_manager_storage_context(cfg)
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
                sha_db_snapshot(cfg["data_dir"])
                if sqlite_main_identity(cfg["data_dir"]) != previous["db_identity"]:
                    raise DeployError("primary SQLite database file was replaced during deployment")
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
        database_identity = sqlite_main_identity(cfg["data_dir"])
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
            sha_db_snapshot(cfg["data_dir"])
            if sqlite_main_identity(cfg["data_dir"]) != database_identity:
                raise DeployError("primary SQLite database file was replaced during rollback")
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
    verify_storage_mount(cfg)
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
    for action in ("status", "rollback", "storage-check"):
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
                                  "artifact_expires_at": release.artifact_expires_at,
                                  "envelope_sha256": release.envelope_sha256, "bundle_sha256": release.bundle_sha256,
                                  "manifest_sha256": hashlib.sha256(release.files["manifest.json"]).hexdigest(),
                                  "repository": release.manifest["repository"],
                                  "workflow": release.manifest["workflow"],
                                  "source_ref": release.manifest["source_ref"],
                                  "attestation": "verified",
                                  "artifact_checksums": release.manifest["artifacts"],
                                  "scanner": release.manifest["scanner"],
                                  "security_scope": release.manifest["security_scope"],
                                  "api_image": release.manifest["image"],
                                  "spa_sha256": release.manifest["artifacts"]["operatoros-web-client.tar.gz"]}, indent=2))
            return 0
        cfg = load_config(args.config)
        if args.action == "storage-check":
            verify_storage_mount(cfg)
            verify_host_storage_config(cfg)
            verify_user_manager_storage_context(cfg)
            verify_process_storage_context(cfg, require_explicit=True)
            verify_runtime_units(cfg)
            current_spa(cfg)
            print(json.dumps({"result": "storage_ready"}))
            return 0
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
