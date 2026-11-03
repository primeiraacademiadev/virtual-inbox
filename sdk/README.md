# @virtual-inbox/client

Node.js 24+ client for the [Virtual Inbox](https://github.com/primeiraacademiadev/virtual-inbox) synthetic-message testing sandbox.

## Installation

```bash
npm install --save-dev @virtual-inbox/client
```

Only synthetic test data must be used. The SDK is an API client, not a Virtual Inbox server and it does not start additional instances.

## License

**MIT License — Copyright (c) 2026 Primeira Academia.** The MIT grant applies solely to the client SDK in this `sdk/` directory; see [LICENSE](LICENSE). The server, web console and other repository contents are **not** covered by this license.

## Build from source

```bash
npm install --prefix sdk --no-package-lock
npm run build --prefix sdk
npm pack --dry-run --prefix sdk
```

For API usage and configuration see the repository documentation.

## Publishing

Releases use `sdk-vX.Y.Z` Git tags matching `sdk/package.json` and the `.github/workflows/publish-sdk.yml` GitHub Actions workflow. Configure npm Trusted Publishing for owner `primeiraacademiadev`, repository `virtual-inbox`, workflow `publish-sdk.yml`. No persistent npm token should be stored in GitHub Secrets.

The first version may require an interactive `npm login` and `npm publish --access public` from `sdk/`, followed by configuring Trusted Publishing on the npm package settings. Select the direct `npm publish` permission.

The SDK's MIT license is declared in `package.json` and included in the npm tarball. Publishing remains a separate owner-controlled release action; do not create a release tag until the package, npm ownership and Trusted Publishing configuration have been checked.
