# Releasing

This repo now uses a single stable SemVer release tag for everything that ships:

- npm packages
- Python package
- Rust crate
- Chrome extension
- desktop app
- Go module

Create GitHub releases with tags like `v0.2.0`. The release workflows use that tag as the source of truth and sync the version into:

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

## Required Secrets

### npm packages

- `NPM_TOKEN`

The TypeScript package release path now uses `bun publish` instead of `npm publish`.

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
```

Build all publishable TypeScript packages:

```bash
bun run build
```

Dry-run the version sync for all registries:

```bash
bun run release:sync-version v0.2.0 --dry-run
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

- Release tags must be stable SemVer in the form `vX.Y.Z`.
- The TypeScript package publish step is Bun-native. Bun 1.3.x does not expose npm's `--provenance` flag, so switching away from `npm publish` also drops provenance signing for now.
- The desktop workflow builds distributable binaries, but platform signing and notarization can be layered on separately if you want trusted installers.
- The release workflow now expects the macOS signing + notarization secrets above on macOS runners and will fail the macOS desktop build if they are missing.
- The Go module path now matches the monorepo subdirectory: `github.com/devteapot/slop/packages/go/slop-ai`.
- Because the module lives in a repository subdirectory, Go release tags must be prefixed with that subdirectory. For `v0.2.0`, the Go tag is `packages/go/slop-ai/v0.2.0`.
- The release workflow creates that Go tag automatically from the GitHub release tag.
