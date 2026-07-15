import re
import unicodedata
from datetime import date, datetime


def normalize_name(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).strip().casefold().split())


def normalize_identifier(value: str | int | None) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def normalize_nipd(value):
    return normalize_identifier(value)


def normalize_nisn(value):
    return normalize_identifier(value)


def normalize_nik(value):
    return normalize_identifier(value)


def normalize_gender(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    key = normalize_name(value)
    mapping = {"l": "male", "laki-laki": "male", "male": "male", "p": "female", "perempuan": "female", "female": "female"}
    if key not in mapping:
        raise ValueError("Unrecognized gender value")
    return mapping[key]


def normalize_religion(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    return " ".join(unicodedata.normalize("NFKC", value).strip().split())


def normalize_phone(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    text = value.strip()
    prefix = "+" if text.startswith("+") else ""
    digits = re.sub(r"\D", "", text)
    if not digits:
        raise ValueError("Phone number contains no digits")
    return prefix + digits


def normalize_birth_date(value: str | date | datetime | None) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = value.strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            pass
    raise ValueError("Birth date must use YYYY-MM-DD or DD/MM/YYYY")


def normalize_kelurahan(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    return " ".join(unicodedata.normalize("NFKC", value).strip().split())


def mask_identifier(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 4:
        return "*" * len(value)
    return f"{'*' * (len(value) - 4)}{value[-4:]}"
