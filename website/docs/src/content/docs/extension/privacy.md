---
title: "Chrome Extension Privacy Policy"
description: "Privacy policy for the SLOP Chrome extension"
---
_Effective date: 2026-04-03_

This Privacy Policy explains how the SLOP Chrome extension handles data.

The SLOP Chrome extension helps AI assistants understand application state in the browser through the SLOP protocol. It can detect SLOP-enabled pages, show an in-page chat overlay, optionally scan a page into a structured accessibility-based state view, and optionally connect to a local desktop bridge.

## Summary

- We do not sell user data.
- We do not use user data for advertising.
- We do not use user data for creditworthiness or lending decisions.
- We do not include remote executable code in the extension package.
- We only use and transfer data to provide the extension's core functionality.

## Data we handle

Depending on how you use the extension, the extension may handle the following categories of data:

- Extension settings and preferences
  - whether the extension is enabled
  - whether the floating chat UI is enabled
  - whether the desktop bridge is enabled
- Model connection settings
  - model profile names
  - model provider type
  - API endpoint URLs
  - selected model names
  - API keys or tokens you configure
- Current page and application context
  - page titles
  - SLOP provider metadata exposed by the page
  - structured application state made available through SLOP
- Page scan output when you explicitly use "Scan this page"
  - accessible labels and descriptions
  - link URLs
  - image URLs and alt text
  - checkbox and radio states
  - form field and text field values that are present in the page at the time of the scan
- Prompts and model responses
  - messages you send through the extension chat UI
  - responses returned by your configured AI provider

## How we use data

We use data only to operate the extension's user-facing features, including:

- detecting whether a page exposes a SLOP provider
- building and displaying the current app or page state in the extension UI
- allowing you to inspect and invoke available actions
- sending your prompts and relevant page/app context to the AI provider you configure
- saving your settings so you do not need to reconfigure the extension each time
- optionally relaying browser providers to a local desktop app that you choose to run

## Where data is stored

The extension stores configuration data in Chrome storage so your settings persist across sessions.

This can include:

- extension preferences
- model profiles
- endpoint URLs
- selected models
- API credentials you choose to save

We do not use the extension for analytics, advertising telemetry, or behavioral tracking.

## When data leaves your device

Data may be transmitted off-device only in the following cases:

1. When you use the AI chat feature, prompts and relevant page/app context are sent to the model endpoint you configured.
2. When you enable the optional desktop bridge, provider metadata and relay traffic may be sent to the local desktop service running on your machine at `ws://127.0.0.1:9339/slop-bridge`.

The extension supports user-configured providers such as local model servers and third-party AI APIs. If you configure a third-party provider, your use of that provider is also subject to that provider's own privacy policy and terms.

## Website content and page scans

The extension is designed to work on arbitrary web applications. Because of that, it may process website content that appears in the current page.

If a page already exposes a SLOP provider, the extension uses the structured state that page provides.

If you explicitly choose "Scan this page," the extension builds a structured representation of page content using accessibility and DOM information. That scanned representation can include visible labels, descriptions, links, image references, and current form values present in the page.

You should avoid using the extension on pages containing sensitive information unless you are comfortable sending the necessary context to your configured AI provider.

## Data sharing

We do not sell user data.

We do not share user data with data brokers, advertisers, or analytics platforms.

We only transfer data when necessary to provide the extension's requested functionality, such as:

- sending prompts and context to the AI provider you selected
- relaying messages to the optional local desktop bridge you enabled

## Data retention

Stored configuration data remains in Chrome storage until you change or remove it, uninstall the extension, or clear the extension's stored data.

Operational chat and page context are generally processed in memory as part of the current session unless they are included in saved settings you explicitly configure.

## Security

We take reasonable steps to limit data use to the extension's core purpose. However, if you store API keys in the extension or send page context to a third-party AI provider, you are responsible for choosing providers and environments you trust.

## Your choices

You can control extension behavior by:

- enabling or disabling the extension
- enabling or disabling the floating chat UI
- enabling or disabling the desktop bridge
- choosing whether to use the page scan feature
- changing or deleting saved model profiles and API credentials
- uninstalling the extension at any time

## Children

The extension is not intended for children.

## Changes to this policy

We may update this Privacy Policy from time to time. If we make material changes, we will update this page and revise the effective date above.

## Contact

For questions about this Privacy Policy or the extension, see the project repository:

- [SLOP on GitHub](https://github.com/devteapot/slop)
