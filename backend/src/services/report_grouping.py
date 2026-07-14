from typing import Literal


ReportScope = Literal["combined", "early_year", "primary", "secondary"]

LEVEL_ALIASES: dict[str, tuple[str, ...]] = {
    "early_year": ("Early Year Program", "KB", "TK", "Kiddy", "Kindergarten"),
    "primary": ("Primary", "SD"),
    "secondary": ("Secondary", "SMP"),
}

SCOPE_LABELS = {
    "combined": "Combined",
    "early_year": "Early Year Program",
    "primary": "Primary",
    "secondary": "Secondary",
}


def normalize_level_name(value: str | None) -> str:
    return " ".join((value or "").strip().casefold().split())


_NORMALIZED_ALIASES = {
    alias: scope
    for scope, names in LEVEL_ALIASES.items()
    for alias in (normalize_level_name(name) for name in names)
}


def canonical_scope_for_level(level_name: str | None) -> str | None:
    return _NORMALIZED_ALIASES.get(normalize_level_name(level_name))


def level_matches_scope(level_name: str | None, scope: ReportScope) -> bool:
    canonical = canonical_scope_for_level(level_name)
    if scope == "combined":
        return canonical in LEVEL_ALIASES
    return canonical == scope


def scope_options() -> list[dict[str, str]]:
    return [{"value": value, "label": SCOPE_LABELS[value]} for value in SCOPE_LABELS]
