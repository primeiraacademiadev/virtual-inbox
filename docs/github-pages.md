# Documentation website maintenance

This website uses MkDocs Material and the repository's existing Markdown sources under `docs/`. The localized guides in `docs/i18n/{en,pt-PT,fr}/` are shared with the console: do not fork the documentation into a second content tree.

## Local preview

From the repository root:

```sh
python -m pip install -r requirements-docs.txt
mkdocs serve
```

Build with `mkdocs build --clean`. Review navigation and warnings when adding or renaming guides. Update `mkdocs.yml` navigation to match. The website build uses the same documentation tree as the console.

## GitHub Pages

The `docs-pages.yml` GitHub Actions workflow builds the site for documentation PRs, and builds/deploys for pushes to `main` or manual dispatch. In repository Settings → Pages, select **GitHub Actions** as the source before first publication. The expected site URL is https://primeiraacademiadev.github.io/virtual-inbox/.

Documentation changes should be reviewed through PRs. The SMTP/POP3 test sessions and fault injection work was integrated into `main` in PR #20. Keep future website updates aligned with released functionality.

The Pages site is static; it is not a demo server. Keep tokens, private certificates, real credentials and internal deployment details out of public documentation. The README states that the source is proprietary; publishing documentation does not change that licensing statement.
