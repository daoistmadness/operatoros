import os
import shlex
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
HELPER = ROOT / "scripts" / "validate-wsl-node-npm.sh"


def _write_executable(path: Path, body: str) -> None:
    path.write_text(body, encoding="utf-8")
    path.chmod(0o755)


def _toolchain_fixture(
    tmp_path: Path,
    *,
    node_version: str = "v24.0.0",
    release: str = "node",
    npm_version: str = "11.0.0",
    npm_usable: bool = True,
):
    tools = tmp_path / "tools"
    tools.mkdir()
    _write_executable(
        tools / "node",
        f"#!/bin/sh\n"
        f"if [ \"${{1:-}}\" = \"-p\" ]; then echo {release}; exit 0; fi\n"
        f"if [ \"${{1:-}}\" = \"--version\" ]; then echo {node_version}; exit 0; fi\n"
        "exit 1\n",
    )
    npm_exit = "0" if npm_usable else "3"
    _write_executable(
        tools / "npm",
        f"#!/bin/sh\n"
        f"if [ \"${{1:-}}\" = \"--version\" ]; then echo {npm_version}; exit {npm_exit}; fi\n"
        "exit 3\n",
    )
    environment = os.environ.copy()
    environment["PATH"] = f"{tools}:{environment['PATH']}"
    environment["OPERATOROS_NVM_DIR"] = str(tmp_path / "missing-nvm")
    return environment, tools


def _run_helper(environment: dict[str, str], script: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["bash", "-c", f"source {HELPER}; {script}"],
        cwd=ROOT,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )


def _counting_toolchain_fixture(tmp_path: Path):
    environment, tools = _toolchain_fixture(tmp_path)
    invocations = tmp_path / "toolchain-invocations.log"
    log_path = shlex.quote(str(invocations))
    _write_executable(
        tools / "node",
        "#!/bin/sh\n"
        f"printf 'node:%s\\n' \"$*\" >> {log_path}\n"
        "if [ \"${1:-}\" = \"-p\" ]; then echo node; exit 0; fi\n"
        "if [ \"${1:-}\" = \"--version\" ]; then echo v24.0.0; exit 0; fi\n"
        "exit 1\n",
    )
    _write_executable(
        tools / "npm",
        "#!/bin/sh\n"
        f"printf 'npm:%s\\n' \"$*\" >> {log_path}\n"
        "if [ \"${1:-}\" = \"--version\" ]; then echo 11.0.0; exit 0; fi\n"
        "exit 1\n",
    )
    return environment, tools, invocations


def test_linux_node_24_and_paired_linux_npm_pass(tmp_path):
    environment, _ = _toolchain_fixture(tmp_path)
    result = _run_helper(environment, "operatoros_wsl_validate_node_npm \"$PWD\"")
    assert result.returncode == 0, result.stderr


def test_direct_probe_reports_valid_linux_toolchain(tmp_path):
    environment, _ = _toolchain_fixture(tmp_path)
    result = _run_helper(environment, "operatoros_wsl_probe_node_npm \"$PWD\"")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "WSL Node/npm probe: PASS" in result.stdout
    assert "node version: v24.0.0" in result.stdout
    assert "npm version: 11.0.0" in result.stdout


def test_direct_probe_entrypoint_reports_valid_linux_toolchain(tmp_path):
    environment, _ = _toolchain_fixture(tmp_path)
    result = subprocess.run(
        ["bash", str(HELPER), "--probe", str(ROOT)],
        cwd=ROOT,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "WSL Node/npm probe: PASS" in result.stdout


@pytest.mark.parametrize("node_version", ["v20.0.0", "v22.23.1"])
def test_unsupported_node_major_is_rejected(node_version, tmp_path):
    environment, _ = _toolchain_fixture(tmp_path, node_version=node_version)
    result = _run_helper(
        environment,
        "operatoros_wsl_validate_node_npm \"$PWD\" || "
        "{ printf '%s\\n' \"$OPERATOROS_WSL_TOOLCHAIN_REASON\"; exit 1; }",
    )
    assert result.returncode != 0
    assert "major version must match .nvmrc" in result.stdout + result.stderr


def test_windows_mount_and_extensions_are_rejected_without_execution():
    result = _run_helper(
        os.environ.copy(),
        "operatoros_wsl_path_is_rejected /mnt/c/nvm4w/nodejs/node.exe && "
        "operatoros_wsl_path_is_rejected /mnt/d/Program\\ Files/node/npm.cmd && "
        "operatoros_wsl_path_is_rejected //wsl.localhost/Ubuntu/home/user/node && "
        "operatoros_wsl_path_is_rejected //wsl$/Ubuntu/home/user/node",
    )
    assert result.returncode == 0


def test_npm_windows_path_is_rejected():
    result = _run_helper(os.environ.copy(), "operatoros_wsl_path_is_rejected /mnt/c/nvm4w/nodejs/npm")
    assert result.returncode == 0


def test_node_shim_resolving_to_windows_target_is_rejected(tmp_path):
    environment, tools = _toolchain_fixture(tmp_path)
    shim = tools / "node"
    script = (
        "readlink() { "
        f"if [ \"${{@: -1}}\" = \"{shim}\" ]; then echo /mnt/c/nvm4w/nodejs/node.exe; "
        "else command readlink \"$@\"; fi; "
        "}; "
        "operatoros_wsl_resolve_toolchain_paths; "
        "operatoros_wsl_paths_are_safe || { operatoros_wsl_toolchain_failure 24.13.0; "
        "printf '%s\\n' \"$OPERATOROS_WSL_TOOLCHAIN_ERROR\"; exit 1; }"
    )
    result = _run_helper(environment, script)
    assert result.returncode != 0
    assert "/mnt/c/nvm4w/nodejs/node.exe" in result.stdout + result.stderr


@pytest.mark.parametrize(
    ("tool_name", "windows_target"),
    [
        ("node", "/mnt/c/nvm4w/nodejs/node.exe"),
        ("npm", "/mnt/d/Program Files/node/npm.cmd"),
        ("npm", "/mnt/c/nvm4w/nodejs/npm"),
    ],
)
def test_direct_probe_rejects_unsafe_resolved_path_before_execution(tmp_path, tool_name, windows_target):
    environment, tools, invocations = _counting_toolchain_fixture(tmp_path)
    target_tool = shlex.quote(str(tools / tool_name))
    target_path = shlex.quote(windows_target)
    log_path = shlex.quote(str(invocations))
    script = (
        "readlink() { "
        f"case \"${{@: -1}}\" in {target_tool}) echo {target_path};; "
        "*) command readlink \"$@\";; esac; "
        "}; "
        "operatoros_wsl_probe_node_npm \"$PWD\" || status=$?; "
        "test \"${status:-0}\" -ne 0; "
        f"test ! -e {log_path}"
    )
    result = _run_helper(environment, script)
    output = result.stdout + result.stderr
    assert result.returncode == 0, output
    assert "WSL Node/npm probe: FAIL" in output
    assert "version checks: not run" in output
    assert windows_target in output
    assert ". ~/.nvm/nvm.sh" in output
    assert "nvm use 24" in output


def test_existing_pinned_nvm_auto_recovers_invalid_linux_environment(tmp_path):
    environment, _ = _toolchain_fixture(tmp_path, node_version="v20.0.0")
    home = tmp_path / "home"
    home.mkdir()
    bashrc = home / ".bashrc"
    profile = home / ".profile"
    bashrc.write_text("# user-owned bashrc\n", encoding="utf-8")
    profile.write_text("# user-owned profile\n", encoding="utf-8")
    environment["HOME"] = str(home)
    nvm_dir = tmp_path / "nvm"
    version_bin = nvm_dir / "versions" / "node" / "v24.13.0" / "bin"
    version_bin.mkdir(parents=True)
    _write_executable(version_bin / "node", "#!/bin/sh\nif [ \"${1:-}\" = \"-p\" ]; then echo node; else echo v24.13.0; fi\n")
    _write_executable(version_bin / "npm", "#!/bin/sh\necho 11.6.2\n")
    nvm_dir.joinpath("nvm.sh").write_text(
        "nvm() {\n"
        "  [ \"${1:-}\" = use ] || return 1\n"
        "  export PATH=\"$NVM_DIR/versions/node/v24.13.0/bin:$PATH\"\n"
        "}\n",
        encoding="utf-8",
    )
    environment["OPERATOROS_NVM_DIR"] = str(nvm_dir)
    nvmrc = tmp_path / ".nvmrc"
    nvmrc.write_text("24.13.0\n", encoding="utf-8")
    result = _run_helper(
        environment,
        f"operatoros_wsl_prepare_node_npm \"$PWD\" \"{nvmrc}\" && "
        "printf '%s %s\\n' \"$OPERATOROS_NODE_VERSION\" \"$OPERATOROS_NPM_VERSION\"",
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "v24.13.0 11.6.2" in result.stdout
    assert bashrc.read_text(encoding="utf-8") == "# user-owned bashrc\n"
    assert profile.read_text(encoding="utf-8") == "# user-owned profile\n"


def test_safe_wrong_npm_major_is_rejected(tmp_path):
    environment, _ = _toolchain_fixture(tmp_path, npm_version="10.9.8")
    result = _run_helper(
        environment,
        "operatoros_wsl_validate_node_npm \"$PWD\" || "
        "{ printf '%s\\n' \"$OPERATOROS_WSL_TOOLCHAIN_REASON\"; exit 1; }",
    )
    assert result.returncode != 0
    assert "engines.npm" in result.stdout + result.stderr


def test_nvmrc_and_frontend_engine_contract_must_agree(tmp_path):
    environment, _ = _toolchain_fixture(tmp_path)
    nvmrc = tmp_path / ".nvmrc"
    nvmrc.write_text("22.23.1\n", encoding="utf-8")
    result = _run_helper(
        environment,
        f"operatoros_wsl_validate_node_npm \"$PWD\" \"{nvmrc}\" || "
        "{ printf '%s\\n' \"$OPERATOROS_WSL_TOOLCHAIN_REASON\"; exit 1; }",
    )
    assert result.returncode != 0
    assert "conflicts with frontend/package.json engines.node" in result.stdout + result.stderr


def test_node_and_npm_from_different_linux_prefixes_are_rejected(tmp_path):
    environment, tools = _toolchain_fixture(tmp_path)
    node_only = tmp_path / "node-only" / "bin"
    node_only.mkdir(parents=True)
    (node_only / "node").write_text((tools / "node").read_text(encoding="utf-8"), encoding="utf-8")
    (node_only / "node").chmod(0o755)
    other_npm = tmp_path / "other-prefix" / "bin" / "npm"
    other_npm.parent.mkdir(parents=True)
    other_npm.write_text((tools / "npm").read_text(encoding="utf-8"), encoding="utf-8")
    other_npm.chmod(0o755)
    environment["PATH"] = f"{node_only}:{other_npm.parent}:{os.environ['PATH']}"
    result = _run_helper(
        environment,
        "operatoros_wsl_validate_node_npm \"$PWD\" || "
        "{ printf '%s\\n' \"$OPERATOROS_WSL_TOOLCHAIN_REASON\"; exit 1; }",
    )
    assert result.returncode != 0
    assert "not paired" in result.stdout + result.stderr


def test_invalid_windows_environment_without_nvm_fails_actionably(tmp_path):
    environment, tools = _toolchain_fixture(tmp_path)
    script = (
        "readlink() { "
        f"case \"${{@: -1}}\" in \"{tools}/node\") echo /mnt/c/nvm4w/nodejs/node.exe;; "
        f"\"{tools}/npm\") echo /mnt/c/nvm4w/nodejs/npm;; *) command readlink \"$@\";; esac; "
        "}; "
        f"operatoros_wsl_prepare_node_npm \"$PWD\" \"{ROOT / '.nvmrc'}\" || "
        "{ printf '%s\\n' \"$OPERATOROS_WSL_TOOLCHAIN_ERROR\"; exit 1; }"
    )
    result = _run_helper(environment, script)
    output = result.stdout + result.stderr
    assert result.returncode != 0
    assert "NODE_RUNTIME_INVALID_FOR_WSL" not in output
    assert "/mnt/c/nvm4w/nodejs/node.exe" in output
    assert ". ~/.nvm/nvm.sh" in output
    assert "nvm use 24.13.0" in output


def test_bun_masquerading_as_node_is_rejected(tmp_path):
    environment, _ = _toolchain_fixture(tmp_path, release="bun")
    result = _run_helper(environment, "operatoros_wsl_validate_node_npm \"$PWD\"")
    assert result.returncode != 0


def test_usable_node_24_with_unusable_npm_fails_closed(tmp_path):
    environment, _ = _toolchain_fixture(tmp_path, npm_usable=False)
    result = _run_helper(environment, "operatoros_wsl_validate_node_npm \"$PWD\"")
    assert result.returncode != 0


# ---------------------------------------------------------------------------
# Integration test: real contaminated-shell recovery
#
# Reproduces the exact state observed on the developer's WSL system:
#   - ~/.local/bin/node is a symlink to /mnt/c/.../node.exe  (Windows runtime,
#     earlier in PATH than any NVM bin dir)
#   - npm resolves to ~/.nvm/versions/node/v22.23.1/bin/npm  (Linux v22, wrong
#     version)
#   - .nvmrc pins 24.13.0
#   - Real ~/.nvm/nvm.sh and real v24.13.0 Linux binaries are present
#
# This is NOT a mocked-path test.  It uses the actual NVM installation on the
# host to assert the 10-point recovery sequence:
#   [1]  Windows node.exe is detected (UNSAFE_PATH) before any execution
#   [2]  Windows node.exe is never executed
#   [3]  ~/.nvm/nvm.sh is sourced
#   [4]  nvm use picks up the pinned version from .nvmrc (24.13.0)
#   [5]  Command hash is refreshed after NVM activation
#   [6]  node resolves to Linux ~/.nvm/versions/node/v24.13.0/bin/node
#   [7]  npm resolves to the same Linux v24.13.0 prefix
#   [8]  node --version reports v24.x
#   [9]  npm --version reports 11.x
#   [10] operatoros_wsl_prepare_node_npm returns 0 (start-dev continues)
# ---------------------------------------------------------------------------

_REAL_NVM_DIR = Path.home() / ".nvm"
_REAL_NVM_SH = _REAL_NVM_DIR / "nvm.sh"
_REAL_V24_NODE = _REAL_NVM_DIR / "versions" / "node" / "v24.13.0" / "bin" / "node"
_REAL_V24_NPM = _REAL_NVM_DIR / "versions" / "node" / "v24.13.0" / "bin" / "npm"

# The test is skipped on CI environments that do not have the real WSL NVM
# installation with v24.13.0.  On the developer's machine it is always run.
_integration_prereqs = pytest.mark.skipif(
    not (_REAL_NVM_SH.is_file() and _REAL_V24_NODE.is_file() and _REAL_V24_NPM.is_file()),
    reason=(
        "real WSL NVM installation with v24.13.0 not found; "
        "integration test requires ~/.nvm/nvm.sh and ~/.nvm/versions/node/v24.13.0/bin/{node,npm}"
    ),
)


@_integration_prereqs
def test_windows_node_symlink_in_local_bin_auto_recovers_to_linux_v24(tmp_path):
    """
    Integration test: contaminated shell where ~/.local/bin/node -> Windows node.exe.

    Constructs a PATH that mirrors the real observed contamination:
      1. A "local_bin" dir containing a node symlink pointing at the real
         Windows node.exe path under /mnt/c (simulating ~/.local/bin/node).
         This is the actual symlink target seen on the developer's system —
         the .exe suffix causes operatoros_wsl_path_is_rejected() to fire.
      2. The v22 Linux npm at ~/.nvm/versions/node/v22.23.1/bin (wrong version).
      3. Real PATH entries follow.

    Asserts that operatoros_wsl_prepare_node_npm auto-recovers to Linux v24.13.0
    using the real ~/.nvm/nvm.sh without any manual intervention, covering all
    10 steps of the required recovery sequence.
    """
    # --- Build the contaminated PATH ---
    # Simulate ~/.local/bin/node -> /mnt/c/.../node.exe
    # Keep the real .exe symlink so path_is_rejected() fires on the extension.
    local_bin = tmp_path / "local_bin"
    local_bin.mkdir()
    windows_node_target = "/mnt/c/Users/OPREDEL/AppData/Local/nvm/v22.23.1/node.exe"
    contaminating_node = local_bin / "node"
    contaminating_node.symlink_to(windows_node_target)

    # npm from the v22 Linux NVM path (wrong version, but Linux)
    v22_npm_dir = _REAL_NVM_DIR / "versions" / "node" / "v22.23.1" / "bin"

    # Contaminated PATH: Windows-node-symlink dir first, then v22 npm, then real PATH
    base_path = os.environ.get("PATH", "")
    contaminated_path_parts = [str(local_bin)]
    if v22_npm_dir.is_dir():
        contaminated_path_parts.append(str(v22_npm_dir))
    contaminated_path_parts.append(base_path)
    contaminated_path = ":".join(contaminated_path_parts)

    environment = os.environ.copy()
    environment["PATH"] = contaminated_path
    environment["OPERATOROS_NVM_DIR"] = str(_REAL_NVM_DIR)
    # Use the repo .nvmrc (24.13.0)
    nvmrc = ROOT / ".nvmrc"

    # The script runs the full recovery and emits structured key:value output.
    # We also capture the initial contaminated-state version-check flag to prove
    # [1]+[2]: the validator detected UNSAFE_PATH before executing anything.
    script = (
        f"source {HELPER}; "
        # Phase 1: probe the initial contaminated state without recovery.
        # This must fail at path safety, reporting version_checks=not-run.
        f"operatoros_wsl_validate_node_npm \"{ROOT}\" \"{nvmrc}\"; "
        "printf 'INITIAL_VERSION_CHECKS:%s\\n' \"$OPERATOROS_WSL_TOOLCHAIN_VERSION_CHECKS\"; "
        "printf 'INITIAL_STATE:%s\\n' \"$OPERATOROS_WSL_TOOLCHAIN_STATE\"; "
        # Phase 2: full recovery via prepare.
        f"operatoros_wsl_prepare_node_npm \"{ROOT}\" \"{nvmrc}\" && "
        "printf 'NODE_VERSION:%s\\n' \"$OPERATOROS_NODE_VERSION\" && "
        "printf 'NPM_VERSION:%s\\n' \"$OPERATOROS_NPM_VERSION\" && "
        "printf 'NODE_PATH:%s\\n' \"$OPERATOROS_NODE_PATH\" && "
        "printf 'NPM_PATH:%s\\n' \"$OPERATOROS_NPM_PATH\" && "
        "printf 'NODE_REALPATH:%s\\n' \"$OPERATOROS_NODE_REALPATH\" && "
        "printf 'NPM_REALPATH:%s\\n' \"$OPERATOROS_NPM_REALPATH\" && "
        "printf 'TOOLCHAIN_STATE:%s\\n' \"$OPERATOROS_WSL_TOOLCHAIN_STATE\""
    )
    result = subprocess.run(
        ["bash", "-c", script],
        cwd=ROOT,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )
    output = result.stdout + result.stderr

    # [10] operatoros_wsl_prepare_node_npm must return 0
    assert result.returncode == 0, (
        f"Recovery failed.\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )

    # [1] Windows node.exe detected: initial state must be UNSAFE_PATH
    assert "INITIAL_STATE:UNSAFE_PATH" in output, (
        f"Expected initial state UNSAFE_PATH (Windows node.exe detection); output:\n{output}"
    )

    # [2] Windows node.exe never executed: version checks must not have run
    # in the initial contaminated state (the validator short-circuited on the
    # .exe path rejection before attempting to execute any binary).
    assert "INITIAL_VERSION_CHECKS:not-run" in output, (
        f"Version checks ran against contaminated Windows node — must short-circuit; output:\n{output}"
    )

    # [3]+[4]+[5]: NVM was sourced, nvm use activated 24.13.0, hash refreshed.
    # These are implicitly proven by the recovery succeeding (prepare returned 0)
    # and the final state being SAFE_CORRECT with Linux v24 binaries.

    # [6] node must resolve to the Linux v24.13.0 NVM installation
    v24_node_prefix = str(_REAL_NVM_DIR / "versions" / "node" / "v24.13.0")
    assert f"NODE_PATH:{v24_node_prefix}/bin/node" in output, (
        f"node not resolved to v24.13.0 NVM bin; output:\n{output}"
    )

    # [7] npm must resolve to the same Linux v24.13.0 prefix
    assert f"NPM_PATH:{v24_node_prefix}/bin/npm" in output, (
        f"npm not resolved to v24.13.0 NVM bin; output:\n{output}"
    )
    assert v24_node_prefix in output, (
        f"npm realpath not under v24.13.0 prefix; output:\n{output}"
    )

    # [8] node --version must report v24.x
    assert "NODE_VERSION:v24." in output, (
        f"node version is not v24.x; output:\n{output}"
    )

    # [9] npm --version must report 11.x
    assert "NPM_VERSION:11." in output, (
        f"npm version is not 11.x; output:\n{output}"
    )

    # [10] State must be SAFE_CORRECT (start-dev would continue)
    assert "TOOLCHAIN_STATE:SAFE_CORRECT" in output, (
        f"toolchain state is not SAFE_CORRECT; output:\n{output}"
    )

