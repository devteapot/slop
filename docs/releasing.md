# Releasing

This repo uses a single SemVer release tag for everything that ships:

- npm packages
- Python package
- Rust crate
- Chrome extension
- desktop app
- Go module

Create GitHub releases with tags like `v0.2.0` (stable) or `v0.2.0-rc.1` (pre-release). The release workflows use that tag as the source of truth and sync the version into:

- `packages/typescript/*/package.json`
- `packages/python/slop-ai/pyproject.toml`
- `packages/rust/slop-ai/Cargo.toml`
- `apps/extension/package.json`
- `apps/extension/manifest.json`
- `apps/desktop/package.json`
- `apps/desktop/src-tauri/tauri.conf.json`
- `apps/desktop/src-tauri/Cargo.toml`

## What Happens On Release

Publishing a GitHub release triggers these distribution steps:

1. TypeScript packages are published to npm in dependency order.
2. The Python package is built and published to PyPI.
3. The Rust crate is published to crates.io.
4. The Chrome extension is built, zipped, uploaded to the GitHub release, and optionally submitted to the Chrome Web Store.
5. The desktop app is built for macOS, Linux, and Windows and uploaded to the same GitHub release.
6. The workflow creates and pushes a Go subdirectory tag for the monorepo module.

## Pre-release / Release Candidate

To smoke-test the release pipeline without publishing a stable version, create a GitHub release marked as **pre-release** with a tag like `v0.1.0-rc.1`.

Version handling differs per ecosystem:

| Ecosystem | Version for `v0.1.0-rc.1` | Notes |
|---|---|---|
| npm (TypeScript) | `0.1.0-rc.1` | Published under the `next` dist-tag (`npm install @slop-ai/core@next`) |
| PyPI (Python) | `0.1.0rc1` | Converted to PEP 440; pip treats it as a pre-release |
| crates.io (Rust) | `0.1.0-rc.1` | Native semver pre-release support |
| Go module | `packages/go/slop-ai/v0.1.0-rc.1` | Native semver pre-release tag |
| Chrome extension | **skipped** | `manifest.json` only supports `X.Y.Z` |
| Desktop app | **skipped** | Tauri config only supports `X.Y.Z` |

The extension and desktop app `package.json` / `manifest.json` / `tauri.conf.json` files are synced to the base version (`0.1.0`) but their build and publish jobs are skipped entirely for pre-releases.

## Required Secrets

### npm packages

No secret required. npm publishing uses [Trusted Publishing](https://docs.npmjs.com/generating-provenance-statements#publishing-packages-with-provenance-via-github-actions) via GitHub OIDC. Each `@slop-ai/*` package must have `devteapot/slop` + `release.yml` configured as a trusted publisher in its npmjs.com settings.

### Chrome Web Store

- `CHROME_EXTENSION_ID`
- `CHROME_PUBLISHER_ID`
- `CHROME_SERVICE_ACCOUNT_JSON`

If the Chrome Web Store secrets are missing, the workflow still uploads the extension zip to the GitHub release and skips store publishing.

### Homebrew tap

- `HOMEBREW_TAP_TOKEN`

When this secret is configured, the `update-homebrew.yml` workflow updates
`devteapot/homebrew-slop` automatically for each published `vX.Y.Z` release.

### Python

- `PYPI_API_TOKEN`

### Rust

- `CARGO_REGISTRY_TOKEN`

### macOS desktop signing + notarization

- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_API_ISSUER`
- `APPLE_API_KEY`
- `APPLE_API_PRIVATE_KEY`

These are required if you want the macOS desktop artifacts uploaded by the
release workflow to be Developer ID signed and notarized.

## Local Dry Run

Validate the release version sync without changing files:

```bash
bun run release:sync-version v0.2.0 --dry-run
bun run release:sync-version v0.2.0-rc.1 --dry-run
```

Build all publishable TypeScript packages:

```bash
bun run build
```

Build and stage the extension release bundle:

```bash
cd apps/extension
bun run build
cd ../..
bun run release:sync-version v0.2.0
bun run release:stage-extension v0.2.0
```

Publish the Python package locally after syncing the version:

```bash
python3 -m pip install --upgrade build twine
bun run release:publish-python v0.2.0
```

Publish the Rust crate locally after syncing the version:

```bash
bun run release:publish-rust v0.2.0
```

Build a signed + notarized macOS app bundle locally:

```bash
cd apps/desktop
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_API_ISSUER="..."
export APPLE_API_KEY="..."
export APPLE_API_KEY_PATH="/absolute/path/to/AuthKey_XXXXXXX.p8"
bunx tauri build --bundles app
```

Validate the resulting macOS bundle:

```bash
spctl --assess -vv "src-tauri/target/release/bundle/macos/SLOP Desktop.app"
xcrun stapler validate "src-tauri/target/release/bundle/macos/SLOP Desktop.app"
```

Create the Go module tag manually if you ever need to backfill a release:

```bash
git tag "packages/go/slop-ai/v0.2.0" "$(git rev-list -n 1 v0.2.0)"
git push origin "packages/go/slop-ai/v0.2.0"
```

## Notes

- Release tags use SemVer: `vX.Y.Z` for stable releases, `vX.Y.Z-rc.N` (or any pre-release suffix) for release candidates. Pre-release npm packages are published under the `next` dist-tag.
- TypeScript packages are published via `npm publish --provenance` using npm Trusted Publishing (OIDC). No `NPM_TOKEN` secret is required — the workflow uses `id-token: write` permissions and GitHub's OIDC provider. Builds still use Bun; only the publish step uses npm for provenance support.
- The desktop workflow builds distributable binaries, but platform signing and notarization can be layered on separately if you want trusted installers.
- The release workflow now expects the macOS signing + notarization secrets above on macOS runners and will fail the macOS desktop build if they are missing.
- The Go module path now matches the monorepo subdirectory: `github.com/devteapot/slop/packages/go/slop-ai`.
- Because the module lives in a repository subdirectory, Go release tags must be prefixed with that subdirectory. For `v0.2.0`, the Go tag is `packages/go/slop-ai/v0.2.0`.
- The release workflow creates that Go tag automatically from the GitHub release tag.
