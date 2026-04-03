`sloppy.svg` is the shared SVG source for web-facing logo usage and SVG favicons.

`app-icon.png` is the square source of truth for generated raster app icons. It matches the approved desktop app icon source and is what we use when a platform needs fixed PNG/ICO/ICNS sizes.

Regenerate a Tauri icon bundle:

```sh
cargo-tauri icon /Users/carlid/dev/slop-slop-slop/logo/app-icon.png --output /absolute/path/to/src-tauri/icons
```

Regenerate the extension icon set:

```sh
tmpdir=$(mktemp -d /tmp/slop-ext-icons.XXXXXX)
cargo-tauri icon /Users/carlid/dev/slop-slop-slop/logo/app-icon.png --output "$tmpdir" --png 16,48,128
cp -f "$tmpdir/16x16.png" /Users/carlid/dev/slop-slop-slop/apps/extension/icons/icon16.png
cp -f "$tmpdir/48x48.png" /Users/carlid/dev/slop-slop-slop/apps/extension/icons/icon48.png
cp -f "$tmpdir/128x128.png" /Users/carlid/dev/slop-slop-slop/apps/extension/icons/icon128.png
```
