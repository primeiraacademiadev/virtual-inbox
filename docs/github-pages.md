# Documentation website maintenance

The website uses MkDocs Material and `mkdocs-static-i18n`. The language selector is in the header; the sidebar contains **only the current language's chapters**, plus a collapsed technical reference. The default language is English; Portuguese and French live at `/pt/` and `/fr/`.

## One source of truth

Keep editing the Markdown sources under `docs/`. The localized guides in `docs/i18n/{en,pt-PT,fr}/` are also read by the console. **Do not move, rename or fork them** just to accommodate the website.

`scripts/prepare-docs-site.py` creates temporary localized Markdown in `.cache/docs-site/docs/`, mapping `overview.md` to `index.md`, and copying the shared technical reference. The staged files are not committed. Changes to the source documentation require rerunning the preparation step for local preview.

## Local preview

From the repository root:

```sh
python -m pip install -r requirements-docs.txt
python scripts/prepare-docs-site.py
mkdocs serve
```

For a deployment-equivalent validation:

```sh
python scripts/prepare-docs-site.py
mkdocs build --strict --clean
python scripts/check-docs-site.py
```

Review the language selector, translated chapter names and collapsed technical reference on both mobile and desktop. Keep the navigation labels in `mkdocs.yml` synchronized with the documentation's chapters.

## GitHub Pages

`.github/workflows/docs-pages.yml` builds the site for documentation PRs, and builds/deploys for pushes to `main` or manual dispatch. Set the repository Pages source to **GitHub Actions**. The public site is https://primeiraacademiadev.github.io/virtual-inbox/.

The Pages site is static; it is not a demo server. Keep tokens, private certificates, real credentials and internal deployment details out of public documentation. Publishing documentation does not change the source's proprietary licensing statement.
