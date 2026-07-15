# Tauri capability baseline

The Phase 11.0 frontend receives no native Tauri permissions. `capabilities/default.json` targets the `main` window with an empty `permissions` array.

No command handlers or plugins are registered. In particular, the shell does not enable filesystem, shell, process, dialog, network plugin, clipboard, notification, or tray access. Ordinary web requests continue through the browser Fetch API and the existing API client; they are not Tauri commands.

The window definition and normal application lifecycle are owned by Rust configuration and are not exposed as frontend-callable operations.

## Review template for future additions

Every capability addition must be documented before it is enabled:

```text
Capability:
Why required:
Scope:
Risk:
Alternative considered:
```

Capability changes require a focused security review, a narrowly scoped permission entry, and a regression check that the browser build still works without Tauri.
