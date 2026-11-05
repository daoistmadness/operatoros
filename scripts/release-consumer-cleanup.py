#!/usr/bin/env python3
"""Safely tear down the release consumer's private rootless Podman store."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tomllib


WORKSPACE_PREFIX = "operatoros-release-consumer."
CONTAINERS = ("operatoros-release-api", "operatoros-release-web")
WORKSPACE_PROFILES = {
    WORKSPACE_PREFIX: {
        "containers": CONTAINERS,
        "storage_conf": "storage.conf",
        "graphroot": "graphroot",
        "runroot": "runroot",
    },
    "operatoros-deployment-rehearsal.": {
        "containers": ("operatoros-lite-api", "operatoros-lite-caddy"),
        "storage_conf": "deploy/storage.conf",
        "graphroot": "podman-rootless/graphroot",
        "runroot": "podman-rootless/runroot",
    },
}
MAX_LOG_BYTES = 16_384


class CleanupError(RuntimeError):
    pass


def canonical_directory(value: str, label: str) -> Path:
    raw = Path(value)
    if not raw.is_absolute() or ".." in raw.parts:
        raise CleanupError(f"Refusing non-canonical {label} path.")
    resolved = Path(os.path.realpath(raw))
    if str(raw) != str(resolved):
        raise CleanupError(f"Refusing symlinked or non-canonical {label} path.")
    try:
        mode = raw.lstat().st_mode
    except OSError as error:
        raise CleanupError(f"Cannot inspect {label} path.") from error
    if not stat.S_ISDIR(mode) or stat.S_ISLNK(mode):
        raise CleanupError(f"Refusing non-directory {label} path.")
    if raw == Path("/"):
        raise CleanupError(f"Refusing root as {label} path.")
    return raw


def workspace_profile(workspace: Path) -> tuple[str, dict[str, object]] | None:
    for prefix, profile in WORKSPACE_PROFILES.items():
        if workspace.name.startswith(prefix):
            return prefix, profile
    return None


def validate_workspace(workspace_value: str, temp_parent_value: str) -> tuple[Path, Path, Path]:
    temp_parent = canonical_directory(temp_parent_value, "temporary parent")
    workspace = canonical_directory(workspace_value, "consumer workspace")
    selected = workspace_profile(workspace)
    if workspace.parent != temp_parent or selected is None:
        raise CleanupError("Refusing cleanup outside the unique consumer workspace.")
    prefix, profile = selected
    suffix = workspace.name.removeprefix(prefix)
    if len(suffix) < 8 or not suffix.isalnum():
        raise CleanupError("Consumer workspace name must have a unique temporary suffix.")
    protected_roots = [
        Path.home() / ".local/share/containers/storage",
        Path("/var/lib/containers/storage"),
        Path("/run/containers/storage"),
        Path("/mnt/podman-data"),
    ]
    for name, suffix in (
        ("XDG_DATA_HOME", "containers/storage"),
        ("XDG_RUNTIME_DIR", "containers"),
    ):
        value = os.environ.get(name)
        if value:
            path = Path(value)
            if not path.is_absolute() or ".." in path.parts:
                raise CleanupError(f"Refusing cleanup with an ambiguous {name} path.")
            protected_roots.append(path / suffix)
    data_root = os.environ.get("OPERATOROS_DATA_DIR")
    if data_root:
        data_path = Path(data_root)
        if not data_path.is_absolute() or ".." in data_path.parts:
            raise CleanupError("Refusing cleanup with an ambiguous application data root.")
        protected_roots.append(data_path)
    for protected_root in protected_roots:
        root = Path(os.path.realpath(protected_root))
        if workspace == root or root in workspace.parents or workspace in root.parents:
            raise CleanupError("Refusing a consumer workspace that overlaps shared or application storage.")
    workspace_stat = workspace.lstat()
    if workspace_stat.st_uid != os.geteuid() or workspace_stat.st_mode & 0o077:
        raise CleanupError("Consumer workspace must be private and owned by this user.")
    if os.path.ismount(workspace):
        raise CleanupError("Refusing to clean a mounted consumer workspace.")

    storage_value = os.environ.get("CONTAINERS_STORAGE_CONF")
    storage_conf = workspace / str(profile["storage_conf"])
    if storage_value != str(storage_conf):
        raise CleanupError("Podman storage config is not scoped to the consumer workspace.")
    try:
        storage_stat = storage_conf.lstat()
        if (
            not stat.S_ISREG(storage_stat.st_mode)
            or stat.S_ISLNK(storage_stat.st_mode)
            or storage_stat.st_nlink != 1
            or storage_stat.st_uid != os.geteuid()
            or storage_stat.st_mode & 0o022
        ):
            raise CleanupError("Consumer storage config must be a regular file.")
        config = tomllib.loads(storage_conf.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError) as error:
        raise CleanupError("Cannot validate consumer storage config.") from error

    storage = config.get("storage")
    if not isinstance(storage, dict) or storage.get("driver") != "vfs":
        raise CleanupError("Consumer Podman store must use the isolated VFS driver.")
    graphroot = workspace / str(profile["graphroot"])
    runroot = workspace / str(profile["runroot"])
    if storage.get("graphroot") != str(graphroot) or storage.get("runroot") != str(runroot):
        raise CleanupError("Podman graphroot and runroot must be direct workspace children.")
    for label, path in (("graphroot", graphroot), ("runroot", runroot)):
        current = workspace
        for part in path.relative_to(workspace).parts:
            current /= part
            try:
                path_stat = current.lstat()
            except FileNotFoundError:
                break
            if (not stat.S_ISDIR(path_stat.st_mode) or stat.S_ISLNK(path_stat.st_mode) or
                os.path.ismount(current)):
                raise CleanupError(f"Refusing unsafe consumer {label} path.")

    if not shutil.rmtree.avoids_symlink_attacks:
        raise CleanupError("This platform cannot safely remove the consumer workspace.")
    return workspace, temp_parent, storage_conf


def assert_no_mounts_below(root: Path) -> None:
    try:
        mountinfo = Path("/proc/self/mountinfo").read_text(encoding="utf-8")
    except OSError as error:
        raise CleanupError("Cannot verify mounts below the consumer workspace.") from error
    escaped = {r"\040": " ", r"\011": "\t", r"\012": "\n", r"\134": "\\"}
    for line in mountinfo.splitlines():
        fields = line.split()
        if len(fields) < 5:
            raise CleanupError("Cannot parse the process mount table safely.")
        target = fields[4]
        for source, replacement in escaped.items():
            target = target.replace(source, replacement)
        mountpoint = Path(target)
        if mountpoint == root or root in mountpoint.parents:
            raise CleanupError("Refusing cleanup while a mount exists below the consumer workspace.")


def diagnostic_log(path_value: str | None, temp_parent: Path, workspace: Path) -> Path | None:
    if path_value is None:
        return None
    path = Path(path_value)
    if not path.is_absolute():
        raise CleanupError("Diagnostics directory must be an absolute path.")
    expected_parent = Path(os.path.realpath(path.parent))
    profile = workspace_profile(workspace)
    expected_name = "release-diagnostics"
    if profile is not None and profile[0] == "operatoros-deployment-rehearsal.":
        suffix = workspace.name.removeprefix(profile[0])
        expected_name = "operatoros-deployment-rehearsal-diagnostics." + suffix
    if path.name != expected_name or expected_parent != temp_parent:
        raise CleanupError("Refusing diagnostics outside the runner temporary directory.")
    if workspace == path or workspace in path.parents:
        raise CleanupError("Diagnostics must remain outside the consumer workspace.")
    if path.is_symlink():
        raise CleanupError("Refusing a symlinked diagnostics directory.")
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode) or info.st_uid != os.geteuid():
        raise CleanupError("Diagnostics path must be a directory.")
    log_path = path / "consumer-cleanup.log"
    try:
        info = log_path.lstat()
    except FileNotFoundError:
        return log_path
    if (
        not stat.S_ISREG(info.st_mode)
        or info.st_nlink != 1
        or info.st_uid != os.geteuid()
    ):
        raise CleanupError("Diagnostics log must be a regular file owned by the runner.")
    return log_path


def append_log(log_path: Path | None, message: str) -> None:
    print(message, file=sys.stderr)
    if log_path is None:
        return
    flags = os.O_WRONLY | os.O_CREAT | os.O_APPEND | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(log_path, flags, 0o600)
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.geteuid():
            raise CleanupError("Refusing unsafe cleanup diagnostics file.")
        content = memoryview((message[:MAX_LOG_BYTES] + "\n").encode())
        while content:
            content = content[os.write(descriptor, content):]
    finally:
        os.close(descriptor)


def command_environment() -> dict[str, str]:
    names = ("PATH", "HOME", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS", "TMPDIR", "CONTAINERS_STORAGE_CONF")
    return {name: os.environ[name] for name in names if name in os.environ}


def run_podman(arguments: list[str], workspace: Path, log_path: Path | None) -> subprocess.CompletedProcess[str] | None:
    command = ["podman", *arguments]
    try:
        result = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            timeout=60,
            env=command_environment(),
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        append_log(log_path, f"podman {' '.join(arguments)} failed: {type(error).__name__}")
        return None
    label = " ".join(arguments).replace(str(workspace), "<consumer-workspace>")
    output = (result.stdout + result.stderr).replace(str(workspace), "<consumer-workspace>").strip()
    if output:
        output = output[:MAX_LOG_BYTES]
    append_log(log_path, f"podman {label} exit={result.returncode}" + (f" output={output}" if output else ""))
    return result


def remove_store_in_user_namespace(workspace: Path, temp_parent: Path) -> int:
    if not shutil.rmtree.avoids_symlink_attacks:
        raise CleanupError("Safe recursive removal is unavailable.")
    # Revalidate after entering Podman's user namespace. Remove only the two configured
    # store roots here; the host user removes the remaining workspace after Podman exits.
    validate_workspace(str(workspace), str(temp_parent))
    assert_no_mounts_below(workspace)
    selected = workspace_profile(workspace)
    if selected is None:
        raise CleanupError("Unknown disposable workspace profile.")
    _prefix, profile = selected
    for key in ("graphroot", "runroot"):
        path = workspace / str(profile[key])
        try:
            info = path.lstat()
        except FileNotFoundError:
            continue
        if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode) or os.path.ismount(path):
            raise CleanupError(f"Refusing unsafe consumer {key} removal.")
        shutil.rmtree(path)
    return 0


def remove_host_owned_store_residual(path: Path, workspace: Path) -> None:
    selected = workspace_profile(workspace)
    if selected is None:
        raise CleanupError("Refusing residual cleanup for an unknown workspace profile.")
    _prefix, profile = selected
    allowed_paths = {workspace / str(profile[key]) for key in ("graphroot", "runroot")}
    if path not in allowed_paths:
        raise CleanupError("Refusing store cleanup outside the consumer workspace.")
    try:
        root_stat = path.lstat()
    except FileNotFoundError:
        return
    if not stat.S_ISDIR(root_stat.st_mode) or stat.S_ISLNK(root_stat.st_mode) or os.path.ismount(path):
        raise CleanupError("Refusing unsafe residual Podman store path.")
    if root_stat.st_uid != os.geteuid():
        raise CleanupError("Refusing residual Podman store data outside the runner UID.")

    pending = [path]
    while pending:
        directory = pending.pop()
        with os.scandir(directory) as entries:
            for entry in entries:
                info = entry.stat(follow_symlinks=False)
                child = Path(entry.path)
                if stat.S_ISLNK(info.st_mode) or os.path.ismount(child):
                    raise CleanupError("Refusing symlink or mount in residual Podman store.")
                if info.st_uid != os.geteuid():
                    raise CleanupError("Refusing residual Podman store data outside the runner UID.")
                if stat.S_ISDIR(info.st_mode):
                    pending.append(child)
                elif not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                    raise CleanupError("Refusing unexpected file type in residual Podman store.")
    shutil.rmtree(path)


def cleanup(workspace_value: str, temp_parent_value: str, diagnostics_dir: str | None = None) -> int:
    try:
        workspace, temp_parent, _ = validate_workspace(workspace_value, temp_parent_value)
    except CleanupError as error:
        print(f"Refusing consumer cleanup: {error}", file=sys.stderr)
        return 1

    failures = 0
    try:
        log_path = diagnostic_log(diagnostics_dir, temp_parent, workspace)
    except (CleanupError, OSError) as error:
        print(f"Consumer cleanup diagnostics unavailable: {type(error).__name__}", file=sys.stderr)
        log_path = None
        failures += 1

    selected = workspace_profile(workspace)
    if selected is None:
        append_log(log_path, "Unknown disposable workspace profile; refusing cleanup.")
        return 1
    _prefix, profile = selected
    removed = run_podman(["rm", "--force", "--ignore", *profile["containers"]], workspace, log_path)
    if removed is None or removed.returncode != 0:
        code = "unavailable" if removed is None else str(removed.returncode)
        append_log(log_path, f"Podman consumer container removal failed with exit={code}.")
        failures += 1

    containers = run_podman(["ps", "--all", "--quiet"], workspace, log_path)
    # Rootless Podman requires mount inspection from its user namespace.
    mounts = run_podman(["unshare", "podman", "mount"], workspace, log_path)
    if containers is None or containers.returncode != 0 or containers.stdout.strip():
        append_log(log_path, "Podman container verification failed or found remaining containers.")
        append_log(log_path, "Refusing workspace removal: Podman reports remaining containers or cannot verify them.")
        return 1
    if mounts is None or mounts.returncode != 0 or mounts.stdout.strip():
        append_log(log_path, "Podman mount verification failed or found remaining mounts.")
        append_log(log_path, "Refusing workspace removal: Podman reports mounted containers or cannot verify mounts.")
        return 1

    helper = Path(__file__).resolve()
    unshare = run_podman(
        ["unshare", sys.executable, str(helper), "--remove-store", str(workspace), str(temp_parent)],
        workspace,
        log_path,
    )
    if unshare is None or unshare.returncode != 0:
        failures += 1
    else:
        try:
            validate_workspace(str(workspace), str(temp_parent))
            assert_no_mounts_below(workspace)
            selected = workspace_profile(workspace)
            if selected is None:
                raise CleanupError("Unknown disposable workspace profile.")
            _prefix, profile = selected
            for key in ("graphroot", "runroot"):
                remove_host_owned_store_residual(workspace / str(profile[key]), workspace)
            assert_no_mounts_below(workspace)
            shutil.rmtree(workspace)
        except (CleanupError, OSError) as error:
            append_log(log_path, f"Host workspace cleanup failed: {type(error).__name__}")
            failures += 1
    if failures:
        append_log(log_path, "Consumer cleanup did not complete successfully.")
        return 1
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("workspace")
    parser.add_argument("temp_parent")
    parser.add_argument("--diagnostics-dir")
    parser.add_argument("--remove-store", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.remove_store:
        try:
            workspace, temp_parent, _ = validate_workspace(args.workspace, args.temp_parent)
            remove_store_in_user_namespace(workspace, temp_parent)
        except (CleanupError, OSError) as error:
            print(f"Refusing consumer workspace removal: {error}", file=sys.stderr)
            return 1
        return 0
    return cleanup(args.workspace, args.temp_parent, args.diagnostics_dir)


if __name__ == "__main__":
    raise SystemExit(main())
