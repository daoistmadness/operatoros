from __future__ import annotations

import os
from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[2]


def test_controlled_preflight_failure_does_not_finalize_missing_session(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    (data_dir / "operatoros-development.db").write_text("not sqlite", encoding="utf-8")
    environment = os.environ.copy()
    environment.update(
        {
            "OPERATOROS_DATA_DIR": str(data_dir),
            "OPERATOROS_RUNTIME_DIR": str(tmp_path / "runtime"),
            "ASTRYX_DEV_PREPARE_ONLY": "1",
        }
    )

    result = subprocess.run(
        [str(ROOT / "start-dev.sh"), "--check"],
        cwd=ROOT,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 2
    output = result.stdout + result.stderr
    assert "DEVELOPMENT_DATABASE_INTEGRITY_FAILURE" in output
    assert output.count("No OperatorOS services were started.") == 1
    assert "Traceback" not in output
    assert "FileNotFoundError" not in output
