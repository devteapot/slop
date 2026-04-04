---
name: slop
description: Inspect connected SLOP application state and available actions
---

# Connected Applications

!`cat "${CLAUDE_PLUGIN_DATA}/state-cache.txt" 2>/dev/null || echo "No SLOP applications are currently connected."`

Use `app_action` or `app_action_batch` tools to interact with these applications.
