#!/usr/bin/env python3
"""Validate the generated site's language selector and localized entry points."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"

for locale, expected_heading in (
    ("", "Getting started"),
    ("pt/", "Começar"),
    ("fr/", "Démarrer"),
):
    page = SITE / locale / "index.html"
    if not page.is_file():
        raise SystemExit(f"Missing localized homepage: {page}")
    content = page.read_text(encoding="utf-8")
    if expected_heading not in content:
        raise SystemExit(f"Missing {expected_heading!r} in {page}")
    if "md-select" not in content:
        raise SystemExit(f"No language selector in {page}")

reference = SITE / "reference" / "api" / "index.html"
if not reference.is_file():
    raise SystemExit(f"Missing shared technical reference: {reference}")
print("Website entry points, language switcher and reference navigation verified.")
