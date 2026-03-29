# Homebrew Tap for SLOP Desktop

This directory contains the Homebrew cask formula for SLOP Desktop.

## Setup

Create a separate repo `devteapot/homebrew-slop` and push the `Casks/` directory there.

## Usage

```bash
brew tap devteapot/slop
brew install --cask slop-desktop
```

## How it works

1. The `release-desktop.yml` GitHub Action builds the Tauri app for macOS (ARM + Intel) and Linux
2. It creates a GitHub Release with the `.dmg` files
3. The Homebrew formula points to the release assets
4. After each release, update the formula's version and sha256

## Updating after a release

1. Download the new `.dmg` from the GitHub Release
2. Get the sha256: `shasum -a 256 SLOP-Desktop_*.dmg`
3. Update `Casks/slop-desktop.rb` with the new version and sha256
4. Push to `devteapot/homebrew-slop`
