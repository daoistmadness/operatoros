#!/usr/bin/env python3
"""Build, attest, and rehearse a registry-independent Docker candidate on CI."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
# Docker Hub's official multi-architecture manifest for Caddy 2.11.7.
CADDY_SOURCE_IMAGE = (
    "docker.io/library/caddy:2.11.7"
    "@sha256:36c24ad91a7ff7bc4c87fe22bfa8df3c4b18da0773d73fc12ee2c52b98c0bb7e"
)
COMMIT = re.compile(r"[0-9a-f]{40}")
IMAGE_REF = re.compile(r"[a-zA-Z0-9._/:@-]+")


class QualificationFailure(RuntimeError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def run(args: list[str], *, cwd: Path = ROOT, timeout: int = 120) -> str:
    completed = subprocess.run(
        args,
        cwd=cwd,
        capture_output=True,
        text=True,
        check=False,
        timeout=timeout,
    )
    if completed.returncode != 0:
        raise QualificationFailure("command_failed")
    return completed.stdout.strip()


def run_logged(args: list[str], log_path: Path, *, cwd: Path, timeout: int = 1800) -> None:
    with log_path.open("wb") as log:
        completed = subprocess.run(
            args,
            cwd=cwd,
            stdout=log,
            stderr=subprocess.STDOUT,
            check=False,
            timeout=timeout,
        )
    if completed.returncode != 0:
        raise QualificationFailure("build_failed")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def ensure_ci_root(output: Path) -> tuple[Path, Path]:
    if os.environ.get("GITHUB_ACTIONS") != "true":
        raise QualificationFailure("github_runner_required")
    if os.environ.get("RUNNER_ENVIRONMENT") != "github-hosted":
        raise QualificationFailure("github_hosted_runner_required")
    raw_temp = os.environ.get("RUNNER_TEMP")
    if not raw_temp:
        raise QualificationFailure("runner_temp_missing")
    runner_temp = Path(raw_temp).resolve(strict=True)
    if output.is_symlink():
        raise QualificationFailure("candidate_output_root_invalid")
    output = output.resolve()
    if output.parent != runner_temp or output.exists():
        raise QualificationFailure("candidate_output_root_invalid")
    if runner_temp == ROOT or ROOT in runner_temp.parents or runner_temp in ROOT.parents:
        raise QualificationFailure("runner_temp_overlaps_repository")
    output.mkdir(mode=0o700)
    try:
        private_root = Path(tempfile.mkdtemp(prefix="operatoros-docker-rehearsal-", dir=runner_temp))
    except OSError:
        output.rmdir()
        raise
    if private_root.resolve().parent != runner_temp or private_root.is_symlink():
        raise QualificationFailure("rehearsal_root_invalid")
    return output, private_root


def extract_commit(commit: str, context: Path, work: Path) -> None:
    if not COMMIT.fullmatch(commit):
        raise QualificationFailure("source_commit_invalid")
    context.mkdir(mode=0o700)
    archive = work / f"source-{commit}.tar"
    run(["git", "archive", "--format=tar", "--output", str(archive), commit])
    with tarfile.open(archive, "r:") as source:
        source.extractall(context, filter="data")


def image_id(image: str) -> str:
    value = run(["docker", "image", "inspect", "--format", "{{.Id}}", image])
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", value):
        raise QualificationFailure("image_identity_invalid")
    return value


def image_revision(image: str) -> str:
    return run(
        [
            "docker",
            "image",
            "inspect",
            "--format",
            '{{ index .Config.Labels "org.opencontainers.image.revision" }}',
            image,
        ]
    )


def get_free_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def write_private_file(path: Path, content: str) -> None:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    os.fchmod(descriptor, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as target:
        target.write(content)


def compose_environment(
    *,
    api_image: str,
    caddy_image: str,
    api_env: Path,
    data_dir: Path,
    deploy_dir: Path,
    web_root: Path,
    caddyfile: Path,
    api_port: int,
    http_port: int,
) -> str:
    values = {
        "OPERATOROS_API_IMAGE": api_image,
        "OPERATOROS_CADDY_IMAGE": caddy_image,
        "OPERATOROS_API_ENV_FILE": str(api_env),
        "OPERATOROS_DATA_DIR": str(data_dir),
        "OPERATOROS_DEPLOY_DIR": str(deploy_dir),
        "OPERATOROS_WEB_ROOT": str(web_root),
        "OPERATOROS_CADDYFILE": str(caddyfile),
        "OPERATOROS_API_PORT": str(api_port),
        "OPERATOROS_HTTP_PORT": str(http_port),
        "OPERATOROS_ALLOWED_ORIGIN": f"http://127.0.0.1:{http_port}",
    }
    if any("\n" in value or "\r" in value for value in values.values()):
        raise QualificationFailure("compose_environment_invalid")
    return "".join(f"{key}={value}\n" for key, value in values.items())


def compose_command(project: str, env_file: Path, override: Path, *args: str) -> list[str]:
    return [
        "docker",
        "compose",
        "--project-name",
        project,
        "--env-file",
        str(env_file),
        "--file",
        str(ROOT / "deploy/docker/docker-compose.yml"),
        "--file",
        str(override),
        *args,
    ]


def status_code(url: str) -> int:
    try:
        with urlopen(url, timeout=3) as response:
            response.read(1)
            return response.status
    except HTTPError as error:
        return error.code
    except (TimeoutError, URLError, OSError):
        return 0


def wait_ready(url: str, timeout_seconds: int = 120) -> None:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if status_code(url) == 200:
            return
        time.sleep(2)
    raise QualificationFailure("api_readiness_timeout")


def verify_routes(http_port: int) -> None:
    base = f"http://127.0.0.1:{http_port}"
    if status_code(f"{base}/health") != 200 or status_code(f"{base}/ready") != 200:
        raise QualificationFailure("api_health_route_failed")
    if status_code(f"{base}/") != 200 or status_code(f"{base}/student-management") != 200:
        raise QualificationFailure("spa_route_failed")
    if status_code(f"{base}/missing-candidate-asset.js") != 404:
        raise QualificationFailure("missing_static_asset_not_404")
    if status_code(f"{base}/.env") != 404:
        raise QualificationFailure("dotfile_route_not_404")


def project_resources(project: str, containers: tuple[str, str]) -> bool:
    try:
        for command in (
            ["docker", "container", "ls", "--all", "--quiet"],
            ["docker", "network", "ls", "--quiet"],
            ["docker", "volume", "ls", "--quiet"],
        ):
            completed = subprocess.run(
                [*command, "--filter", f"label=com.docker.compose.project={project}"],
                capture_output=True,
                text=True,
                check=False,
                timeout=30,
            )
            if completed.returncode != 0 or completed.stdout.strip():
                return False
        for name in containers:
            completed = subprocess.run(
                ["docker", "container", "ls", "--all", "--quiet", "--filter", f"name=^/{name}$"],
                capture_output=True,
                text=True,
                check=False,
                timeout=30,
            )
            if completed.returncode != 0 or completed.stdout.strip():
                return False
    except (OSError, subprocess.TimeoutExpired):
        return False
    return True


def assert_image_references_available(images: list[str]) -> None:
    for image in images:
        found = subprocess.run(
            ["docker", "image", "ls", "--quiet", "--no-trunc", "--filter", f"reference={image}"],
            capture_output=True,
            text=True,
            check=False,
            timeout=30,
        )
        if found.returncode != 0:
            raise QualificationFailure("image_ownership_check_failed")
        if found.stdout.strip():
            raise QualificationFailure("image_reference_already_exists")


def remove_owned_images(images: list[str]) -> bool:
    try:
        for image in images:
            found = subprocess.run(
                ["docker", "image", "ls", "--quiet", "--no-trunc", "--filter", f"reference={image}"],
                capture_output=True,
                text=True,
                check=False,
                timeout=30,
            )
            if found.returncode != 0:
                return False
            if found.stdout.strip():
                removed = subprocess.run(
                    ["docker", "image", "rm", image],
                    capture_output=True,
                    text=True,
                    check=False,
                    timeout=60,
                )
                if removed.returncode != 0:
                    return False
            remaining = subprocess.run(
                ["docker", "image", "ls", "--quiet", "--no-trunc", "--filter", f"reference={image}"],
                capture_output=True,
                text=True,
                check=False,
                timeout=30,
            )
            if remaining.returncode != 0 or remaining.stdout.strip():
                return False
    except (OSError, subprocess.TimeoutExpired):
        return False
    return True


def record_cleanup_result(report: dict[str, Any], details: dict[str, Any]) -> bool:
    report["cleanup_details"] = details
    verified = all(
        details.get(key) is True
        for key in ("project_resources_absent", "owned_images_absent", "private_root_removed")
    )
    report["cleanup_verified"] = verified
    if not verified:
        report["cleanup_failure_code"] = "cleanup_unverified"
        report.setdefault("failure_code", "cleanup_unverified")
    return verified


def make_synthetic_database(data_dir: Path) -> None:
    schema = run(["bun", "packages/db/src/schema-version-cli.ts", "--format", "current"])
    run(
        [
            "bun",
            "packages/db/src/dev-db-cli.ts",
            "ensure",
            "--repo",
            str(ROOT),
            "--data-dir",
            str(data_dir),
            "--expected-schema",
            schema,
        ],
        timeout=120,
    )
    run(["sudo", "chown", "-R", "1000:1000", str(data_dir)], timeout=30)


def create_bundle(
    output: Path,
    *,
    source: str,
    rollback_source: str,
    api_image: str,
    api_id: str,
    caddy_image: str,
    caddy_source_id: str,
    runtime: dict[str, Any],
    web_root: Path,
) -> Path:
    bundle = output / "release"
    client = bundle / "client"
    deploy = bundle / "deploy/docker"
    deploy.mkdir(parents=True, mode=0o700)
    client.mkdir(mode=0o700)
    if (
        web_root.is_symlink()
        or not web_root.is_dir()
        or any(path.is_symlink() for path in web_root.rglob("*"))
    ):
        raise QualificationFailure("built_client_symlink_found")
    shutil.copytree(
        web_root,
        client,
        dirs_exist_ok=True,
        ignore=shutil.ignore_patterns(".vite"),
    )
    (client / "release.json").write_text(json.dumps({"source_commit": source}) + "\n", encoding="utf-8")
    for name in ("docker-compose.yml", "Caddyfile", "api.env.example"):
        shutil.copy2(ROOT / "deploy/docker" / name, deploy / name)
    (bundle / "compose.env.example").write_text(
        "\n".join(
            (
                f"OPERATOROS_API_IMAGE={api_image}",
                f"OPERATOROS_CADDY_IMAGE={caddy_image}",
                "OPERATOROS_API_ENV_FILE=/replace/with/private/api.env",
                "OPERATOROS_DATA_DIR=/replace/with/private/operatoros-data",
                "OPERATOROS_DEPLOY_DIR=/replace/with/private/deploy",
                "OPERATOROS_WEB_ROOT=/replace/with/extracted/client",
                "OPERATOROS_CADDYFILE=/replace/with/extracted/deploy/docker/Caddyfile",
                "OPERATOROS_API_PORT=18090",
                "OPERATOROS_HTTP_PORT=18088",
                "OPERATOROS_ALLOWED_ORIGIN=http://127.0.0.1:18088",
                "",
            )
        ),
        encoding="utf-8",
    )
    image_archive = output / "docker-images.tar"
    image_archive.replace(bundle / "docker-images.tar")
    files = []
    for path in sorted(bundle.rglob("*")):
        if path.is_file():
            files.append(
                {
                    "path": path.relative_to(bundle).as_posix(),
                    "size": path.stat().st_size,
                    "sha256": sha256_file(path),
                }
            )
    manifest = {
        "schema_version": 1,
        "source_commit": source,
        "rollback_fixture_commit": rollback_source,
        "api_image": {"reference": api_image, "config_digest": api_id},
        "caddy_image": {
            "reference": caddy_image,
            "source_reference": CADDY_SOURCE_IMAGE,
            "config_digest": caddy_source_id,
        },
        "runtime": {
            "bun": runtime["bun"],
            "bun_binary_sha256": runtime["bunBinarySha256"],
            "sqlite": runtime["sqlite"],
            "sqlite_source_id": runtime["sqliteSourceId"],
            "fts5": runtime["fts5"],
            "finding_status": runtime["findingStatus"],
        },
        "files": files,
        "api_credentials": "not included; examples only",
    }
    (bundle / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    archive_path = output / "operatoros-docker-candidate.tar"
    with tarfile.open(archive_path, "w") as archive:
        archive.add(bundle, arcname="operatoros-docker-candidate", recursive=True)
    digest = sha256_file(archive_path)
    (output / "operatoros-docker-candidate.tar.sha256").write_text(
        f"{digest}  {archive_path.name}\n", encoding="utf-8"
    )
    return archive_path


def qualify(args: argparse.Namespace) -> int:
    report_path = Path(args.output_dir)
    source = os.environ.get("GITHUB_SHA", "")
    if not COMMIT.fullmatch(source) or run(["git", "rev-parse", "HEAD"]) != source:
        raise QualificationFailure("checkout_source_mismatch")
    for image in (args.api_image, args.rollback_image, args.caddy_image):
        if not IMAGE_REF.fullmatch(image):
            raise QualificationFailure("image_reference_invalid")

    report: dict[str, Any] = {
        "status": "FAIL",
        "source_commit": source,
        "stages": {},
        "events": [],
        "cleanup_verified": False,
    }
    output: Path | None = None
    private_root: Path | None = None
    project = ""
    api_container = ""
    caddy_container = ""
    owned_images = [args.api_image, args.rollback_image, args.caddy_image]
    docker_context_verified = False
    cleanup_ok = True
    stage = "runner_preflight"
    started = time.monotonic()
    try:
        output, private_root = ensure_ci_root(report_path)
        docker_config = private_root / "docker-config"
        docker_config.mkdir(mode=0o700)
        write_private_file(docker_config / "config.json", "{}\n")
        os.environ["DOCKER_CONFIG"] = str(docker_config)
        os.environ["DOCKER_CONTEXT"] = "default"
        context_host = run(
            ["docker", "context", "inspect", "default", "--format", "{{.Endpoints.docker.Host}}"]
        )
        if context_host != "unix:///var/run/docker.sock":
            raise QualificationFailure("docker_context_not_local_hosted_runner")
        suffix = secrets.token_hex(6)
        project = f"operatoros-docker-{suffix}"
        api_container = f"opos-api-{suffix}"
        caddy_container = f"opos-caddy-{suffix}"
        assert_image_references_available(owned_images)
        if not project_resources(project, (api_container, caddy_container)):
            raise QualificationFailure("compose_project_already_exists")
        docker_context_verified = True
        work = private_root / "build"
        work.mkdir(mode=0o700)
        candidate_context = work / "candidate-source"
        rollback_context = work / "rollback-source"

        run(["bun", "scripts/podman-source-manifest.mjs", "assert-clean", str(ROOT)])
        manifest_path = output / "source-manifest.json"
        run(["bun", "scripts/podman-source-manifest.mjs", "write-manifest", str(ROOT), str(manifest_path)])
        source_manifest_sha = sha256_file(manifest_path)
        extract_commit(source, candidate_context, work)
        rollback_source = run(["git", "merge-base", source, "origin/main"])
        if not COMMIT.fullmatch(rollback_source):
            raise QualificationFailure("rollback_source_invalid")
        extract_commit(rollback_source, rollback_context, work)

        stage = "candidate_api_build"
        run_logged(
            [
                "docker",
                "build",
                "--pull",
                "--platform=linux/amd64",
                "--file",
                "deploy/podman/Containerfile.api",
                "--build-arg",
                f"VCS_REF={source}",
                "--build-arg",
                f"SOURCE_TREE_SHA256={source_manifest_sha}",
                "--build-arg",
                "SOURCE_DIRTY=false",
                "--tag",
                args.api_image,
                ".",
            ],
            private_root / "api-build.log",
            cwd=candidate_context,
        )
        report["stages"]["docker_api_build"] = "PASS"
        if image_revision(args.api_image) != source:
            raise QualificationFailure("candidate_image_source_mismatch")
        api_id = image_id(args.api_image)

        stage = "bun_sqlite_runtime_gate"
        runtime_raw = run(
            [sys.executable, "scripts/check-bun-sqlite-runtime.py", "--engine", "docker", args.api_image],
            timeout=75,
        )
        runtime = json.loads(runtime_raw)
        if runtime.get("status") != "PASS":
            raise QualificationFailure("docker_runtime_gate_failed")
        report["runtime"] = {
            key: runtime.get(key)
            for key in ("bun", "bunBinarySha256", "sqlite", "sqliteSourceId", "fts5", "findingStatus")
        }
        report["stages"]["bun_sqlite_runtime"] = "PASS"

        stage = "caddy_image_pull"
        run(["docker", "pull", "--platform=linux/amd64", CADDY_SOURCE_IMAGE], timeout=300)
        caddy_source_id = image_id(CADDY_SOURCE_IMAGE)
        run(["docker", "tag", CADDY_SOURCE_IMAGE, args.caddy_image])
        caddy_id = image_id(args.caddy_image)
        if caddy_id != caddy_source_id:
            raise QualificationFailure("caddy_image_identity_mismatch")

        stage = "rollback_api_build"
        run_logged(
            [
                "docker",
                "build",
                "--pull",
                "--platform=linux/amd64",
                "--file",
                "deploy/podman/Containerfile.api",
                "--build-arg",
                f"VCS_REF={rollback_source}",
                "--build-arg",
                "SOURCE_TREE_SHA256=unknown",
                "--build-arg",
                "SOURCE_DIRTY=false",
                "--tag",
                args.rollback_image,
                ".",
            ],
            private_root / "rollback-build.log",
            cwd=rollback_context,
        )
        if image_revision(args.rollback_image) != rollback_source:
            raise QualificationFailure("rollback_image_source_mismatch")
        rollback_id = image_id(args.rollback_image)
        if rollback_id == api_id:
            raise QualificationFailure("rollback_image_not_distinct")
        report["rollback_fixture_commit"] = rollback_source
        report["stages"]["rollback_fixture_build"] = "PASS"

        image_archive = output / "docker-images.tar"
        run(["docker", "save", "--output", str(image_archive), args.api_image, args.caddy_image], timeout=300)
        report["docker_images_sha256"] = sha256_file(image_archive)

        stage = "synthetic_fixture_setup"
        data_dir = private_root / "data"
        deploy_dir = private_root / "deploy"
        web_root = ROOT / "apps/web/build/client"
        if not (web_root / "_shell.html").is_file():
            raise QualificationFailure("built_client_missing")
        data_dir.mkdir(mode=0o700)
        (data_dir / "backups").mkdir(mode=0o700)
        deploy_dir.mkdir(mode=0o700)
        caddy_data = deploy_dir / "caddy-data"
        caddy_config = deploy_dir / "caddy-config"
        caddy_data.mkdir(mode=0o700)
        caddy_config.mkdir(mode=0o700)
        api_env = private_root / "api.env"
        auth_secret = secrets.token_urlsafe(48)
        backup_key = base64.b64encode(secrets.token_bytes(32)).decode("ascii")
        if auth_secret == backup_key:
            raise QualificationFailure("synthetic_secrets_not_distinct")
        write_private_file(
            api_env,
            f"AUTH_COOKIE_SECRET={auth_secret}\nBACKUP_ENCRYPTION_KEY={backup_key}\nENABLE_DESTRUCTIVE_OPERATIONS=false\n",
        )
        make_synthetic_database(data_dir)
        run(["sudo", "chown", "-R", "1000:1000", str(deploy_dir)], timeout=30)

        api_port = get_free_port()
        http_port = get_free_port()
        while http_port == api_port:
            http_port = get_free_port()
        override = private_root / "compose.override.yml"
        override.write_text(
            "services:\n"
            f"  operatoros-api:\n    container_name: {api_container}\n"
            f"  operatoros-caddy:\n    container_name: {caddy_container}\n",
            encoding="utf-8",
        )
        env_file = private_root / "compose.env"
        write_private_file(
            env_file,
            compose_environment(
                api_image=args.api_image,
                caddy_image=args.caddy_image,
                api_env=api_env,
                data_dir=data_dir,
                deploy_dir=deploy_dir,
                web_root=web_root,
                caddyfile=ROOT / "deploy/docker/Caddyfile",
                api_port=api_port,
                http_port=http_port,
            ),
        )
        stage = "compose_config"
        run(compose_command(project, env_file, override, "config", "--quiet"), timeout=30)
        report["stages"]["compose_config"] = "PASS"

        stage = "candidate_compose_deploy"
        run(compose_command(project, env_file, override, "up", "--detach"), timeout=180)
        wait_ready(f"http://127.0.0.1:{http_port}/ready")
        verify_routes(http_port)
        running_id = run(["docker", "inspect", "--format", "{{.Image}}", api_container])
        if running_id != api_id:
            raise QualificationFailure("candidate_container_image_mismatch")
        report["stages"]["candidate_compose_deploy"] = "PASS"
        report["stages"]["health_readiness_spa_and_security_routes"] = "PASS"

        stage = "synthetic_image_rollback"
        write_private_file(
            env_file,
            compose_environment(
                api_image=args.rollback_image,
                caddy_image=args.caddy_image,
                api_env=api_env,
                data_dir=data_dir,
                deploy_dir=deploy_dir,
                web_root=web_root,
                caddyfile=ROOT / "deploy/docker/Caddyfile",
                api_port=api_port,
                http_port=http_port,
            ),
        )
        run(compose_command(project, env_file, override, "up", "--detach", "--no-deps", "operatoros-api"), timeout=180)
        wait_ready(f"http://127.0.0.1:{http_port}/ready")
        verify_routes(http_port)
        rolled_back_id = run(["docker", "inspect", "--format", "{{.Image}}", api_container])
        if rolled_back_id != rollback_id:
            raise QualificationFailure("rollback_container_image_mismatch")
        report["stages"]["synthetic_image_rollback"] = "PASS"

        report["events"].append({"stage": "compose_rehearsal", "status": "PASS"})
    except (QualificationFailure, OSError, subprocess.TimeoutExpired, tarfile.TarError, json.JSONDecodeError) as error:
        report["failure_stage"] = stage
        report["failure_code"] = error.code if isinstance(error, QualificationFailure) else "qualification_error"
    finally:
        cleanup_details: dict[str, Any] = {}
        if project:
            compose_env = private_root / "compose.env" if private_root else Path()
            override = private_root / "compose.override.yml" if private_root else Path()
            if private_root and compose_env.is_file() and override.is_file():
                try:
                    down = subprocess.run(
                        compose_command(
                            project,
                            compose_env,
                            override,
                            "down",
                            "--volumes",
                            "--remove-orphans",
                            "--timeout",
                            "20",
                        ),
                        capture_output=True,
                        text=True,
                        check=False,
                        timeout=60,
                    )
                    cleanup_details["compose_down_exit_code"] = down.returncode
                except (OSError, subprocess.TimeoutExpired):
                    cleanup_details["compose_down_exit_code"] = None
            else:
                cleanup_details["compose_down_exit_code"] = None
            cleanup_details["project_resources_absent"] = project_resources(
                project, (api_container, caddy_container)
            )
        else:
            cleanup_details["project_resources_absent"] = True

        if cleanup_details["project_resources_absent"] is True and docker_context_verified:
            cleanup_details["owned_images_absent"] = remove_owned_images(owned_images)
        elif docker_context_verified:
            cleanup_details["owned_images_absent"] = None
        else:
            cleanup_details["owned_images_absent"] = True

        if (
            cleanup_details["project_resources_absent"] is True
            and cleanup_details["owned_images_absent"] is True
            and private_root is not None
        ):
            try:
                shutil.rmtree(private_root)
                cleanup_details["private_root_removed"] = not private_root.exists()
            except OSError:
                cleanup_details["private_root_removed"] = False
        elif private_root is None:
            cleanup_details["private_root_removed"] = True
        else:
            cleanup_details["private_root_removed"] = False
        cleanup_ok = record_cleanup_result(report, cleanup_details)

    report["duration_seconds"] = round(time.monotonic() - started, 2)
    if not cleanup_ok:
        report["status"] = "FAIL"
    elif report.get("failure_code"):
        report["status"] = "FAIL"
    else:
        report["status"] = "PASS"

    if output is not None:
        (output / "compose-rehearsal.json").write_text(
            json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
    if report["status"] != "PASS":
        return 1

    try:
        report["failure_stage"] = "release_artifact_packaging"
        archive = create_bundle(
            output,
            source=source,
            rollback_source=report["rollback_fixture_commit"],
            api_image=args.api_image,
            api_id=api_id,
            caddy_image=args.caddy_image,
            caddy_source_id=caddy_source_id,
            runtime=runtime,
            web_root=ROOT / "apps/web/build/client",
        )
        report["artifact"] = {
            "name": archive.name,
            "sha256": sha256_file(archive),
            "registry_independent": True,
            "attestation_subject": archive.name,
        }
        report.pop("failure_stage", None)
        (output / "compose-rehearsal.json").write_text(
            json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        return 0
    except (OSError, tarfile.TarError, QualificationFailure) as error:
        report["status"] = "FAIL"
        report["failure_code"] = error.code if isinstance(error, QualificationFailure) else "artifact_packaging_failed"
        (output / "compose-rehearsal.json").write_text(
            json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--api-image", required=True)
    parser.add_argument("--rollback-image", required=True)
    parser.add_argument("--caddy-image", required=True)
    args = parser.parse_args(argv)
    try:
        return qualify(args)
    except (QualificationFailure, OSError, subprocess.TimeoutExpired):
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
