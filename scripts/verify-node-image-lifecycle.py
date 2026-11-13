#!/usr/bin/env python3
"""Exercise the exact candidate API image on disposable SQLite data."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import secrets
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any


class LifecycleFailure(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def command(arguments: list[str]) -> str:
    result = subprocess.run(arguments, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise LifecycleFailure("container_command_failed")
    return result.stdout.strip()


def write_env(path: Path, values: dict[str, str]) -> None:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        for key, value in values.items():
            if "\n" in value or "\r" in value:
                raise LifecycleFailure("invalid_generated_environment")
            handle.write(f"{key}={value}\n")


def write_report(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True)
    parser.add_argument("--image-metadata", required=True, type=Path)
    parser.add_argument("--archive-metadata", required=True, type=Path)
    parser.add_argument("--source", required=True)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    report: dict[str, Any] = {
        "status": "FAIL",
        "source_commit": args.source,
        "stages": {},
    }
    stage = "verify_image_identity"
    started = time.monotonic()
    containers: list[str] = []
    temp_root: Path | None = None

    def passed(name: str, evidence: dict[str, Any] | None = None) -> None:
        report["stages"][name] = {"status": "PASS", **(evidence or {})}
        write_report(args.output, report)

    try:
        metadata = json.loads(args.image_metadata.read_text(encoding="utf-8"))
        archive = json.loads(args.archive_metadata.read_text(encoding="utf-8"))
        archived_image = archive.get("image")
        if not re.fullmatch(r"[0-9a-f]{40}", args.source) or archive.get("source_commit") != args.source:
            raise LifecycleFailure("candidate_source_mismatch")
        if not re.fullmatch(r"sha256:[0-9a-f]{64}", str(metadata.get("manifest_digest", ""))):
            raise LifecycleFailure("candidate_manifest_digest_invalid")
        if not re.fullmatch(r"sha256:[0-9a-f]{64}", str(metadata.get("image_id", ""))):
            raise LifecycleFailure("candidate_image_id_invalid")
        if not re.fullmatch(r"[0-9a-f]{64}", str(archive.get("archive_sha256", ""))):
            raise LifecycleFailure("candidate_archive_digest_invalid")
        source_tree_sha256 = str(archived_image.get("source_tree_sha256", "")) if isinstance(archived_image, dict) else ""
        if not re.fullmatch(r"[0-9a-f]{64}", source_tree_sha256):
            raise LifecycleFailure("candidate_source_tree_digest_invalid")
        if metadata.get("source_tree_sha256") != source_tree_sha256 or metadata.get("platform") != "linux/amd64":
            raise LifecycleFailure("candidate_image_report_mismatch")
        if archived_image.get("image_id") != metadata.get("image_id") or archived_image.get("manifest_digest") != metadata.get("manifest_digest"):
            raise LifecycleFailure("candidate_report_identity_mismatch")
        image_id = command(["podman", "image", "inspect", "--format", "{{.Id}}", args.image])
        if re.fullmatch(r"[0-9a-f]{64}", image_id):
            image_id = f"sha256:{image_id}"
        if not re.fullmatch(r"sha256:[0-9a-f]{64}", image_id):
            raise LifecycleFailure("podman_image_id_invalid")
        if image_id != metadata.get("image_id"):
            raise LifecycleFailure("candidate_image_id_mismatch")
        image_revision = command([
            "podman", "image", "inspect", "--format",
            '{{ index .Labels "org.opencontainers.image.revision" }}', args.image,
        ])
        if image_revision != args.source:
            raise LifecycleFailure("candidate_image_source_mismatch")
        image_source_tree = command([
            "podman", "image", "inspect", "--format",
            '{{ index .Labels "org.operatoros.source.tree-sha256" }}', args.image,
        ])
        if image_source_tree != source_tree_sha256:
            raise LifecycleFailure("candidate_image_tree_mismatch")
        source_dirty = command([
            "podman", "image", "inspect", "--format",
            '{{ index .Labels "org.operatoros.source.dirty" }}', args.image,
        ])
        if source_dirty != "false":
            raise LifecycleFailure("candidate_source_dirty")
        report.update({
            "oci_manifest_digest": metadata.get("manifest_digest"),
            "image_config_digest": image_id,
            "oci_archive_sha256": archive.get("archive_sha256"),
            "source_tree_sha256": source_tree_sha256,
            "source_dirty": source_dirty,
            "platform": metadata["platform"],
        })
        passed("verify_image_identity")

        stage = "prepare_synthetic_environment"
        temp_root = Path(tempfile.mkdtemp(prefix="operatoros-node-lifecycle-"))
        temp_root.chmod(0o700)
        data_dir = temp_root / "data"
        backup_source = temp_root / "backup-source"
        restore_target = temp_root / "restore-target"
        for path in (data_dir, backup_source, restore_target):
            path.mkdir(mode=0o700)

        username = f"operatoros_ci_{secrets.token_hex(6)}"
        password = f"Synthetic-{secrets.token_hex(24)}"
        setup_token = secrets.token_hex(32)
        auth_secret = secrets.token_hex(32)
        backup_key = base64.b64encode(secrets.token_bytes(32)).decode("ascii")
        env_file = temp_root / "api.env"
        write_env(env_file, {
            "NODE_ENV": "production",
            "HOST": "127.0.0.1",
            "PORT": "8090",
            "OPERATOROS_DATA_DIR": "/var/lib/operatoros/data",
            "AUTH_COOKIE_SECRET": auth_secret,
            "BACKUP_ENCRYPTION_KEY": backup_key,
            "BACKUP_ENCRYPTION_KEY_ID": f"candidate-{args.source[:12]}",
            "ASTRYX_SETUP_TOKEN": setup_token,
            "OPERATOROS_CANDIDATE_ADMIN_USERNAME": username,
            "OPERATOROS_CANDIDATE_ADMIN_PASSWORD": password,
            "ALLOWED_ORIGINS": "http://127.0.0.1:8090",
            "COOKIE_SECURE": "false",
            "ENABLE_DESTRUCTIVE_OPERATIONS": "false",
        })
        probe = temp_root / "lifecycle-probe.mjs"
        probe.write_text(
            '''const origin = "http://127.0.0.1:8090";
let stage = "readiness";
const fail = () => { console.error(`probe_failed:${stage}`); process.exit(1); };
const expectStatus = async (path, expected, options = {}) => {
  const response = await fetch(`${origin}${path}`, options);
  if (response.status !== expected) fail();
  return response;
};
const login = async () => {
  stage = "login";
  const response = await expectStatus("/api/auth/login", 200, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({
      username: process.env.OPERATOROS_CANDIDATE_ADMIN_USERNAME,
      password: process.env.OPERATOROS_CANDIDATE_ADMIN_PASSWORD,
    }),
  });
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!cookie) fail();
  const me = await expectStatus("/api/auth/me", 200, { headers: { cookie, origin } });
  const user = await me.json();
  if (user.username !== process.env.OPERATOROS_CANDIDATE_ADMIN_USERNAME) fail();
  return cookie;
};

try {
  await expectStatus("/ready", 200);
  if (process.argv[2] === "initialize") {
    stage = "first_admin_setup";
    await expectStatus("/api/setup/admin", 201, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({
        username: process.env.OPERATOROS_CANDIDATE_ADMIN_USERNAME,
        password: process.env.OPERATOROS_CANDIDATE_ADMIN_PASSWORD,
        password_confirmation: process.env.OPERATOROS_CANDIDATE_ADMIN_PASSWORD,
        setup_token: process.env.ASTRYX_SETUP_TOKEN,
      }),
    });
    const cookie = await login();
    stage = "encrypted_backup";
    const backupResponse = await expectStatus("/api/admin/backups", 200, {
      method: "POST", headers: { cookie, origin },
    });
    const backup = await backupResponse.json();
    if (backup.encrypted !== true || typeof backup.filename !== "string" || !/^backup_[0-9T:-]+Z(?:_[0-9]+)?[.]sqlite3$/.test(backup.filename)) fail();
    console.log(JSON.stringify({ status: "PASS", filename: backup.filename, encrypted: true }));
  } else {
    await login();
    console.log(JSON.stringify({ status: "PASS", authenticated: true }));
  }
} catch {
  fail();
}
''',
            encoding="utf-8",
        )
        passed("prepare_synthetic_environment", {"credentials": "ephemeral_generated"})

        stage = "bootstrap_synthetic_database"
        command([
            "podman", "run", "--rm", "--network", "none",
            "--userns", "keep-id:uid=10000,gid=10000", "--user", "10000:10000",
            "--read-only", "--read-only-tmpfs=true", "--cap-drop", "all",
            "--security-opt", "no-new-privileges", "--volume", f"{data_dir}:/var/lib/operatoros/data:rw",
            "--entrypoint", "node", args.image,
            "apps/api/dist/db-cli.mjs", "bootstrap", "--data-dir", "/var/lib/operatoros/data",
        ])
        passed("bootstrap_synthetic_database")

        suffix = secrets.token_hex(5)
        api_name = f"operatoros-candidate-api-{suffix}"
        restore_name = f"operatoros-candidate-restore-{suffix}"
        containers.extend((api_name, restore_name))
        probe_mount = f"{probe}:/tmp/operatoros-candidate-lifecycle.mjs:ro"
        def start_api(container: str, mounted_data: Path) -> None:
            command([
                "podman", "run", "--detach", "--name", container,
                "--label", f"io.operatoros.candidate-source={args.source}",
                "--network", "none", "--userns", "keep-id:uid=10000,gid=10000",
                "--user", "10000:10000", "--read-only", "--read-only-tmpfs=true",
                "--cap-drop", "all", "--security-opt", "no-new-privileges",
                "--health-cmd", "/usr/local/bin/operatoros-api-healthcheck",
                "--health-interval", "30s", "--health-timeout", "5s",
                "--health-start-period", "30s", "--health-retries", "3",
                "--volume", f"{mounted_data}:/var/lib/operatoros/data:rw",
                "--volume", probe_mount, "--env-file", str(env_file), args.image,
            ])

        def wait_ready(container: str) -> None:
            deadline = time.monotonic() + 60
            while time.monotonic() < deadline:
                result = subprocess.run([
                    "podman", "exec", container, "node", "--input-type=module", "-e",
                    'fetch("http://127.0.0.1:8090/ready").then((r) => process.exit(r.status === 200 ? 0 : 1)).catch(() => process.exit(1))',
                ], capture_output=True, check=False)
                if result.returncode == 0:
                    return
                time.sleep(1)
            raise LifecycleFailure("readiness_timeout")

        def run_probe(container: str, mode: str) -> dict[str, Any]:
            output = command([
                "podman", "exec", container, "node",
                "/tmp/operatoros-candidate-lifecycle.mjs", mode,
            ])
            value = json.loads(output)
            if value.get("status") != "PASS":
                raise LifecycleFailure("application_probe_failed")
            return value

        stage = "start_candidate_api"
        start_api(api_name, data_dir)
        wait_ready(api_name)
        command(["podman", "healthcheck", "run", api_name])
        health = command(["podman", "inspect", "--format", "{{.State.Health.Status}}", api_name])
        if health != "healthy":
            raise LifecycleFailure("container_healthcheck_failed")
        passed("start_candidate_api", {"readiness": "PASS", "healthcheck": health})

        stage = "create_encrypted_backup"
        backup = run_probe(api_name, "initialize")
        stage = "verify_encrypted_backup"
        backup_name = backup.get("filename", "")
        if Path(backup_name).name != backup_name or not backup_name.endswith(".sqlite3"):
            raise LifecycleFailure("backup_filename_invalid")
        backup_path = data_dir / "backups" / backup_name
        metadata_path = backup_path.with_name(backup_path.name + ".meta.json")
        if not backup_path.is_file() or not metadata_path.is_file():
            raise LifecycleFailure("encrypted_backup_files_missing")
        backup_hash = hashlib.sha256(backup_path.read_bytes()).hexdigest()
        metadata_hash = hashlib.sha256(metadata_path.read_bytes()).hexdigest()
        passed("create_encrypted_backup", {
            "encrypted": True,
            "backup_sha256": backup_hash,
            "metadata_sha256": metadata_hash,
        })

        stage = "clean_shutdown_and_persistence"
        command(["podman", "stop", "--time", "30", api_name])
        exit_code = command(["podman", "inspect", "--format", "{{.State.ExitCode}}", api_name])
        if exit_code != "0":
            raise LifecycleFailure("candidate_api_shutdown_unclean")
        command(["podman", "start", api_name])
        wait_ready(api_name)
        run_probe(api_name, "verify")
        passed("clean_shutdown_and_persistence", {"sigterm_exit_code": 0, "admin_login_after_restart": "PASS"})

        stage = "restore_encrypted_backup"
        backup_source.mkdir(mode=0o700, exist_ok=True)
        (backup_source / "backups").mkdir(mode=0o700)
        shutil.copy2(backup_path, backup_source / "backups" / backup_name)
        shutil.copy2(metadata_path, backup_source / "backups" / metadata_path.name)
        for copied in (backup_source / "backups" / backup_name, backup_source / "backups" / metadata_path.name):
            copied.chmod(0o600)
        command(["podman", "stop", "--time", "30", api_name])
        exit_code = command(["podman", "inspect", "--format", "{{.State.ExitCode}}", api_name])
        if exit_code != "0":
            raise LifecycleFailure("candidate_api_shutdown_unclean")
        command(["podman", "rm", api_name])
        containers.remove(api_name)

        command([
            "podman", "run", "--rm", "--name", restore_name,
            "--label", f"io.operatoros.candidate-source={args.source}",
            "--network", "none", "--userns", "keep-id:uid=10000,gid=10000",
            "--user", "10000:10000", "--read-only", "--read-only-tmpfs=true",
            "--cap-drop", "all", "--security-opt", "no-new-privileges",
            "--tmpfs", "/tmp:rw,exec,nosuid,nodev,size=256m",
            "--volume", f"{backup_source}:/var/lib/operatoros/data:rw",
            "--volume", f"{restore_target}:/tmp/operatoros-restore:rw",
            "--env-file", str(env_file), "--entrypoint", "node", args.image,
            "apps/api/dist/backup-cli.mjs", "restore-disposable", backup_name, "/tmp/operatoros-restore",
        ])
        command([
            "podman", "run", "--rm", "--network", "none",
            "--userns", "keep-id:uid=10000,gid=10000", "--user", "10000:10000",
            "--read-only", "--read-only-tmpfs=true", "--cap-drop", "all",
            "--security-opt", "no-new-privileges", "--volume", f"{restore_target}:/var/lib/operatoros/data:ro",
            "--env", "OPERATOROS_DATA_DIR=/var/lib/operatoros/data", "--entrypoint", "node", args.image,
            "apps/api/dist/db-cli.mjs", "validate", "--data-dir", "/var/lib/operatoros/data",
        ])
        restored_name = f"operatoros-candidate-restored-api-{suffix}"
        containers.append(restored_name)
        start_api(restored_name, restore_target)
        wait_ready(restored_name)
        run_probe(restored_name, "verify")
        passed("restore_encrypted_backup", {
            "encrypted": True,
            "restored_schema_validation": "PASS",
            "restored_admin_login": "PASS",
            "backup_sha256": backup_hash,
            "metadata_sha256": metadata_hash,
        })

        stage = "final_shutdown"
        command(["podman", "stop", "--time", "30", restored_name])
        exit_code = command(["podman", "inspect", "--format", "{{.State.ExitCode}}", restored_name])
        if exit_code != "0":
            raise LifecycleFailure("restored_api_shutdown_unclean")
        passed("final_shutdown", {"sigterm_exit_code": 0})
        report["status"] = "PASS"
        report["duration_seconds"] = round(time.monotonic() - started, 3)
        write_report(args.output, report)
        print(f"PASS exact candidate lifecycle for {args.source} ({report['oci_manifest_digest']})")
        return 0
    except Exception as error:
        report["failed_stage"] = stage
        report["failure_code"] = error.code if isinstance(error, LifecycleFailure) else type(error).__name__
        report["duration_seconds"] = round(time.monotonic() - started, 3)
        write_report(args.output, report)
        print(f"FAIL exact candidate lifecycle at {stage}")
        return 1
    finally:
        for container in reversed(containers):
            subprocess.run(["podman", "rm", "--force", container], capture_output=True, check=False)
        if temp_root is not None:
            shutil.rmtree(temp_root, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
