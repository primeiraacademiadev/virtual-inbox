#!/usr/bin/env python3
"""Stage multilingual MkDocs sources without changing the console's Markdown.

The web console owns docs/i18n/{en,pt-PT,fr}; the website consumes those same
files through a generated suffix-language tree understood by mkdocs-static-i18n.
All generated content is disposable and excluded from git.
"""
from pathlib import Path
import re
import shutil

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "docs"
TARGET = ROOT / ".cache" / "docs-site" / "docs"
PAGES = ("overview", "demo", "integration", "api", "sdk", "tls", "architecture", "development")
LANGUAGES = {"en": "", "pt-PT": ".pt", "fr": ".fr"}
OMIT_REFERENCE = {
    "index.md", "backlog.md", "code-style.md", "documentation-review.md",
    "sonarcloud-quality-gate.md", "sonarqube.md",
}


def main() -> None:
    if TARGET.exists():
        shutil.rmtree(TARGET)
    TARGET.mkdir(parents=True)
    reference = TARGET / "reference"
    reference.mkdir()

    for source in SOURCE.glob("*.md"):
        if source.name not in OMIT_REFERENCE:
            shutil.copyfile(source, reference / source.name)

    for source_locale, suffix in LANGUAGES.items():
        for page in PAGES:
            original = SOURCE / "i18n" / source_locale / (page + ".md")
            if not original.is_file():
                raise FileNotFoundError(original)
            content = original.read_text(encoding="utf-8")
            # The website's overview is its index; leave the console originals as-is.
            content = re.sub(r"(\]\()overview\.md(?=[)#])", r"\1index.md", content)
            # The console's relative reference path is different from the website's.
            content = content.replace("](../../openapi.md)", "](reference/openapi.md)")
            name = "index" if page == "overview" else page
            (TARGET / (name + suffix + ".md")).write_text(content, encoding="utf-8")

    print(f"Staged {len(PAGES) * len(LANGUAGES)} localized pages and "
          f"{len(list(reference.glob('*.md')))} reference pages in {TARGET}")


if __name__ == "__main__":
    main()
