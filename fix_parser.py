import re

file_path = "backend/src/services/excel_parser.py"
with open(file_path, "r") as f:
    content = f.read()

robust_minutes_func = """import datetime

def _to_minutes_robust(value):
    if pd.isna(value):
        return 0
    if isinstance(value, (pd.Timedelta, datetime.timedelta)):
        return int(value.total_seconds() // 60)
    if isinstance(value, datetime.time):
        return (value.hour * 60) + value.minute
    if isinstance(value, str):
        val_str = value.strip()
        if not val_str:
            return 0
        try:
            parts = val_str.split(':')
            if len(parts) >= 2:
                return (int(parts[0]) * 60) + int(parts[1])
        except Exception:
            pass
        
        parsed = pd.to_timedelta(value, errors="coerce")
        if not pd.isna(parsed):
            return int(parsed.total_seconds() // 60)
    return 0

"""

# 1. Replace _parse_duration and _parse_late_excel_minutes
old_parse_funcs = """def _parse_duration(value):
    if pd.isna(value):
        return None

    parsed_value = pd.to_timedelta(value, errors="coerce")
    if pd.isna(parsed_value):
        return None
    return parsed_value


def _derive_status(check_in_time, check_out_time, late_duration: int) -> str:
    if check_in_time is not None and check_out_time is not None:
        return "late" if (late_duration or 0) > 0 else "on-time"
    if (check_in_time is not None) != (check_out_time is not None):
        return "incomplete"
    return "absent"


def _time_to_minutes(value):
    if value is None:
        return None
    return (value.hour * 60) + value.minute


def _parse_late_excel_minutes(value):
    if pd.isna(value):
        return 0

    parsed = pd.to_timedelta(value, errors="coerce")
    if pd.isna(parsed):
        return 0

    minutes = int(parsed.total_seconds() // 60)
    return max(0, minutes)"""

new_parse_funcs = robust_minutes_func + """def _parse_duration(value):
    if pd.isna(value):
        return None
    mins = _to_minutes_robust(value)
    if mins > 0:
        return datetime.timedelta(minutes=mins)
    return None


def _derive_status(check_in_time, check_out_time, late_duration: int) -> str:
    if check_in_time is not None and check_out_time is not None:
        return "late" if (late_duration or 0) > 0 else "on-time"
    if (check_in_time is not None) != (check_out_time is not None):
        return "incomplete"
    return "absent"


def _time_to_minutes(value):
    if value is None:
        return None
    return (value.hour * 60) + value.minute


def _parse_late_excel_minutes(value):
    mins = _to_minutes_robust(value)
    return max(0, mins)"""

content = content.replace(old_parse_funcs, new_parse_funcs)

# 2. Remove the forced cast in _normalize_chunk
old_chunk = """    chunk["Tanggal"] = parsed_dates
    chunk["Terlambat"] = pd.to_timedelta(chunk["Terlambat"], errors="coerce")
    chunk["Lembur"] = pd.to_timedelta(chunk["Lembur"], errors="coerce")

    before = len(chunk)"""

new_chunk = """    chunk["Tanggal"] = parsed_dates
    # Removed pd.to_timedelta cast for Terlambat/Lembur due to NaT bug with "00:00" type strings.
    # Handled inside _parse_duration and _parse_late_excel_minutes safely.
    
    before = len(chunk)"""

content = content.replace(old_chunk, new_chunk)

with open(file_path, "w") as f:
    f.write(content)

print("Replaced logic correctly in Python AST strings.")
