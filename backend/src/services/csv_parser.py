"""Strict CSV and ZIP bundle parser for OperatorOS data portability."""

from __future__ import annotations

import csv
import hashlib
import io
import json
import unicodedata
from pathlib import PurePosixPath
from typing import Any, Dict, List, Optional, Tuple
from zipfile import ZipFile, ZipInfo

from core.fixture_http import HTTPException

from services.csv_contract import FORMAT_VERSION, DATASET_CONTRACTS
from services.csv_serializer import decode_sanitized_cell_value

MAX_CSV_BYTES = 25 * 1024 * 1024
MAX_UNCOMPRESSED_ZIP_BYTES = 50 * 1024 * 1024
MAX_ROW_COUNT = 5000


def detect_delimiter(header_line: str) -> str:
    """Detect comma vs semicolon delimiter deterministically."""
    comma_count = header_line.count(",")
    semicolon_count = header_line.count(";")

    if comma_count > 0 and semicolon_count == 0:
        return ","
    if semicolon_count > 0 and comma_count == 0:
        return ";"
    if comma_count > 0 and semicolon_count > 0:
        if comma_count > semicolon_count * 2:
            return ","
        if semicolon_count > comma_count * 2:
            return ";"
        raise HTTPException(status_code=400, detail="Ambiguous CSV delimiter detected")
    # Default fallback if no delimiters in single column header
    return ","


def parse_csv_bytes(
    file_bytes: bytes,
    filename: str = "upload.csv",
    expected_headers: Optional[List[str]] = None,
    max_rows: int = MAX_ROW_COUNT,
) -> Tuple[List[str], List[Dict[str, str]], str]:
    """Parse CSV raw bytes with strict header, delimiter, row count, and encoding validation."""
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded CSV file is empty")
    if len(file_bytes) > MAX_CSV_BYTES:
        raise HTTPException(status_code=400, detail=f"CSV file exceeds maximum size limit of {MAX_CSV_BYTES // (1024*1024)} MB")

    file_hash = hashlib.sha256(file_bytes).hexdigest()

    # Strip UTF-8 BOM if present
    raw_content = file_bytes
    if raw_content.startswith(b"\xef\xbb\xbf"):
        raw_content = raw_content[3:]

    try:
        text_content = raw_content.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail="CSV file must be UTF-8 encoded") from exc

    lines = [line for line in text_content.splitlines() if line.strip()]
    if not lines:
        raise HTTPException(status_code=400, detail="CSV file contains no data rows")

    delimiter = detect_delimiter(lines[0])
    reader = csv.reader(io.StringIO(text_content), delimiter=delimiter)

    try:
        raw_headers = next(reader)
    except StopIteration:
        raise HTTPException(status_code=400, detail="CSV header row is missing")

    headers = [h.strip() for h in raw_headers]
    if not headers or any(h == "" for h in headers):
        raise HTTPException(status_code=400, detail="CSV contains empty header names")

    if len(headers) != len(set(headers)):
        raise HTTPException(status_code=400, detail="CSV contains duplicate header names")

    if expected_headers:
        missing = [h for h in expected_headers if h not in headers]
        if missing:
            raise HTTPException(status_code=400, detail=f"CSV is missing required headers: {', '.join(missing)}")

    rows: List[Dict[str, str]] = []
    for line_idx, raw_row in enumerate(reader, start=2):
        if line_idx - 1 > max_rows:
            raise HTTPException(status_code=400, detail=f"CSV exceeds maximum row threshold of {max_rows} rows")
        if not raw_row or all(c.strip() == "" for c in raw_row):
            continue  # Skip blank row
        
        row_dict: Dict[str, str] = {}
        for h_idx, header in enumerate(headers):
            val = raw_row[h_idx] if h_idx < len(raw_row) else ""
            row_dict[header] = decode_sanitized_cell_value(val.strip())
        row_dict["_source_row"] = str(line_idx)
        rows.append(row_dict)

    return headers, rows, file_hash


def parse_zip_bundle(file_bytes: bytes, filename: str) -> Tuple[str, Dict[str, Any], bytes]:
    """Safely unpack ZIP data bundle, validating path traversal, entries, manifest, and checksums."""
    if not file_bytes or len(file_bytes) > MAX_CSV_BYTES:
        raise HTTPException(status_code=400, detail="ZIP bundle size exceeds safe limit")

    try:
        with ZipFile(io.BytesIO(file_bytes)) as archive:
            members = archive.infolist()
            if len(members) > 5:
                raise HTTPException(status_code=400, detail="ZIP bundle contains too many entries")

            total_uncompressed = sum(m.file_size for m in members)
            if total_uncompressed > MAX_UNCOMPRESSED_ZIP_BYTES:
                raise HTTPException(status_code=400, detail="ZIP bundle uncompressed size exceeds safe limit")

            csv_member: Optional[ZipInfo] = None
            manifest_member: Optional[ZipInfo] = None

            for m in members:
                path = PurePosixPath(m.filename.replace("\\", "/"))
                if path.is_absolute() or ".." in path.parts:
                    raise HTTPException(status_code=400, detail="ZIP bundle contains an unsafe file path")
                if m.is_dir():
                    continue
                if m.filename.casefold() == "manifest.json":
                    manifest_member = m
                elif m.filename.casefold().endswith(".csv"):
                    csv_member = m
                else:
                    raise HTTPException(status_code=400, detail=f"ZIP bundle contains unexpected file: {m.filename}")

            if not manifest_member or not csv_member:
                raise HTTPException(status_code=400, detail="ZIP bundle must contain data.csv and manifest.json")

            manifest_bytes = archive.read(manifest_member)
            csv_bytes = archive.read(csv_member)

            try:
                manifest = json.loads(manifest_bytes.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise HTTPException(status_code=400, detail="ZIP bundle manifest.json is invalid JSON") from exc

            if manifest.get("operatoros_format") != FORMAT_VERSION:
                raise HTTPException(status_code=400, detail=f"Unsupported format version: {manifest.get('operatoros_format')}")

            dataset = manifest.get("dataset")
            if not dataset or dataset not in DATASET_CONTRACTS:
                raise HTTPException(status_code=400, detail=f"Unrecognized bundle dataset: {dataset}")

            computed_sha = hashlib.sha256(csv_bytes).hexdigest()
            manifest_sha = manifest.get("csv_sha256") or manifest.get("sha256")
            if manifest_sha and computed_sha != manifest_sha:
                raise HTTPException(status_code=400, detail="CSV file checksum does not match manifest.json declaration")

            return dataset, manifest, csv_bytes
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail="The uploaded file is not a valid ZIP bundle archive") from exc
