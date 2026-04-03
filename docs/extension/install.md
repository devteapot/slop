# Chrome Extension

The Chrome extension discovers browser-based SLOP providers, opens an AI chat overlay, and can bridge those providers into the desktop app.

## Release builds

The release workflow produces a packaged extension artifact alongside tagged releases. For development and local testing, sideload the extension from source.

## Build from source

```bash
git clone https://github.com/devteapot/slop.git
cd slop/apps/extension
bun install
bun run build
```

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the `apps/extension` directory.

## What it does

- discovers browser providers via the SLOP discovery tag
- opens an AI chat overlay on supported pages
- relays browser providers to the desktop app when the bridge is enabled
- supports multiple LLM backends configured from the popup

## Example workflows

### Test a local SPA without leaving the page

Open your app in Chrome, load the unpacked extension, and use the chat overlay directly in the page. This is useful when you want to verify that:

- the page's provider is being discovered correctly
- the current tree matches the visible UI
- invoking affordances from chat produces the expected changes

### Prototype with the accessibility adapter

If the current page is not SLOP-native yet, use the popup's page scan to activate the accessibility adapter. That gives you a temporary provider-like view of the page so you can exercise the browser consumer before your native integration is finished.

### Send browser state into the desktop app

Enable the desktop bridge in the popup, then start the desktop app. The extension re-announces active providers after reconnects or service-worker restarts, which makes it practical to keep a browser tab attached to a larger multi-provider desktop workspace.

## Desktop bridge

When enabled, the extension connects to the desktop bridge at `ws://localhost:9339` and re-announces active browser providers after reconnects or service-worker restarts.

## Related pages

- [Consumer guide](/guides/consumer)
- [Desktop app docs](/desktop/install)
- [Extension privacy policy](./privacy.md)
