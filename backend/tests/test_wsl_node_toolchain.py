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


def _toolchain_fixture(tmp_path: Path, *, node_version: str = "v24.0.0", release: str = "node", npm_usable: bool = True):
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
        f"if [ \"${{1:-}}\" = \"--version\" ]; then echo 11.0.0; exit {npm_exit}; fi\n"
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


def test_linux_node_22_and_paired_linux_npm_pass(tmp_path):
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
    assert "major version must be 24" in result.stdout + result.stderr


def test_windows_mount_and_extensions_are_rejected_without_execution():
    result = _run_helper(
        os.environ.copy(),
        "operatoros_wsl_path_is_rejected /mnt/c/nvm4w/nodejs/node.exe && "
        "operatoros_wsl_path_is_rejected /mnt/d/Program\\ Files/node/npm.cmd",
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
