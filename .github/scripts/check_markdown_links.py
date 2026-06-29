from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MARKDOWN_LINK_RE = re.compile(r"(?<!\!)\[[^\]]+\]\(([^)]+)\)")
IMAGE_LINK_RE = re.compile(r"!\[[^\]]*\]\(([^)]+)\)")
TARGET_PATHS = [
    ROOT / "README.md",
    ROOT / "AGENTS.md",
    ROOT / "PROJECT_CONTEXT.md",
    ROOT / "COMMANDS.md",
    ROOT / "CONVENTIONS.md",
    ROOT / "MEMORY.md",
    ROOT / "ERRORS.md",
    ROOT / "backend" / "README.md",
    ROOT / "frontend" / "README.md",
]


def iter_markdown_files() -> list[Path]:
    files = list(TARGET_PATHS)
    docs_dir = ROOT / "docs"
    if docs_dir.exists():
        files.extend(sorted(docs_dir.rglob("*.md")))
    return files


def main() -> int:
    problems: list[str] = []

    for file_path in iter_markdown_files():
        text = file_path.read_text(encoding="utf-8")
        for match in MARKDOWN_LINK_RE.finditer(text):
            target = match.group(1).strip()
            if not target or target.startswith(("http://", "https://", "mailto:", "#")):
                continue

            target_path = target.split("#", 1)[0].split("?", 1)[0]
            resolved = (file_path.parent / target_path).resolve()
            if not resolved.exists():
                problems.append(f"{file_path.relative_to(ROOT)} -> {target}")

        for match in IMAGE_LINK_RE.finditer(text):
            target = match.group(1).strip()
            if not target or target.startswith(("http://", "https://", "mailto:", "#")):
                continue

            target_path = target.split("#", 1)[0].split("?", 1)[0]
            resolved = (file_path.parent / target_path).resolve()
            if not resolved.exists():
                problems.append(f"{file_path.relative_to(ROOT)} -> {target}")

    if problems:
        for problem in problems:
            print(problem)
        return 1

    print("Markdown links look valid.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
