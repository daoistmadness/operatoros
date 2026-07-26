"""Cell value sanitization and spreadsheet-safe CSV serialization for OperatorOS."""

from __future__ import annotations

import csv
import io
import re
from typing import Any, List, Optional

DANGEROUS_PREFIXES = ("=", "+", "-", "@", "\t", "\r")
PURE_NUMERIC_PATTERN = re.compile(r"^-?\d+(?:\.\d+)?$")


def sanitize_cell_value(
    value: Any,
    is_numeric_field: bool = False,
    is_data_bundle: bool = False,
) -> str:
    """Sanitize cell value to prevent Excel formula injection while preserving numbers and leading zeroes."""
    if value is None:
        return ""

    text = str(value)
    if not text:
        return ""

    # If column is numeric, valid pure numbers like -5.0 or 42 are preserved
    if is_numeric_field and PURE_NUMERIC_PATTERN.match(text):
        # Preserve leading zero string identifiers like "00123"
        if text.startswith("0") and len(text) > 1 and text.isdigit():
            pass
        else:
            return text

    # Handle dangerous prefix characters
    if text.startswith(DANGEROUS_PREFIXES):
        return f"'{text}"

    return text


def decode_sanitized_cell_value(value: str) -> str:
    """Decode apostrophe-escaped formula string back to original value during bundle import."""
    if value.startswith("'") and len(value) > 1:
        rest = value[1:]
        if rest.startswith(DANGEROUS_PREFIXES) or rest.startswith("'"):
            return rest
    return value


def serialize_csv(
    headers: List[str],
    rows: List[List[Any]],
    is_numeric_columns: Optional[List[bool]] = None,
    include_bom: bool = True,
    is_data_bundle: bool = False,
) -> bytes:
    """Serialize headers and rows into UTF-8 (optional BOM) CSV bytes."""
    output = io.StringIO()
    writer = csv.writer(output, quoting=csv.QUOTE_MINIMAL, lineterminator="\n")

    writer.writerow(headers)

    num_cols = len(headers)
    is_numeric = is_numeric_columns or [False] * num_cols

    for row in rows:
        sanitized_row = []
        for idx, val in enumerate(row):
            is_num = is_numeric[idx] if idx < len(is_numeric) else False
            clean_val = sanitize_cell_value(val, is_numeric_field=is_num, is_data_bundle=is_data_bundle)
            sanitized_row.append(clean_val)
        writer.writerow(sanitized_row)

    content = output.getvalue().encode("utf-8")
    if include_bom:
        return b"\xef\xbb\xbf" + content
    return content
