# Contract: Extension Scaffolding CLI

**Version**: 1.0.0
**Date**: 2026-05-07
**Branch**: `002-git-github-integration`

The scaffolding CLI is a plain Node.js script at `scripts/create-extension.js`. It generates a new extension directory pre-populated with a complete hello-world implementation that exercises the full v1.1.0 `ExtensionAPI`.

---

## Invocation

```bash
# Via Node directly
node scripts/create-extension.js <name> [options]

# Via npm script (recommended — ensures correct Node version)
npm run create-extension -- <name> [options]
```

---

## Arguments

| Argument | Required | Description                                                                                                                                                   |
| -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<name>` | Yes      | Short kebab-case name for the extension (e.g., `my-extension`). Used as the directory name under `extensions/` and as the default suffix of the extension ID. |

## Options

| Option                     | Default              | Description                                                                                       |
| -------------------------- | -------------------- | ------------------------------------------------------------------------------------------------- |
| `--id <reverse-domain-id>` | `com.example.<name>` | Full reverse-domain extension ID (e.g., `com.acme.my-extension`). Must be globally unique.        |
| `--dir <output-dir>`       | `extensions/<name>`  | Absolute or relative output directory. Defaults to `extensions/<name>` relative to the repo root. |
| `--help`, `-h`             | —                    | Print usage information and exit.                                                                 |

---

## Exit Codes

| Code | Meaning                                                                            |
| ---- | ---------------------------------------------------------------------------------- |
| `0`  | Extension generated successfully.                                                  |
| `1`  | Bad arguments (missing name, invalid characters, etc.).                            |
| `2`  | Output directory already exists. The CLI will not overwrite an existing directory. |
| `3`  | Filesystem write error.                                                            |

---

## Generated File Tree

```
extensions/<name>/
├── manifest.json
└── src/
    └── index.ts
```

### `manifest.json`

```json
{
  "id": "<id>",
  "name": "<Title-Cased Name>",
  "version": "0.1.0",
  "description": "A Terminator extension.",
  "main": "src/index.ts",
  "minAppVersion": "0.1.0"
}
```

### `src/index.ts`

A complete, working hello-world that:

1. Registers a settings section (one boolean toggle, one string input)
2. Registers a sidebar item that calls `api.notifications.showToast` on click
3. Registers a keyboard shortcut (`CmdOrCtrl+Shift+H`) that also shows a toast
4. Subscribes to `api.terminal.onSessionCreate` and logs to the sidebar label
5. Includes commented-out stubs (with `// TODO:` markers) for v1.1.0 surfaces: `sidebar.registerPanel`, `topBar.registerMenuItem`, `api.shell.exec`, `api.fs.watch`
6. Disposes all registrations in `deactivate()`

The generated `index.ts` compiles without errors against the existing `ExtensionAPI` types.

---

## Validation Rules (enforced by the CLI)

- `<name>` must match `/^[a-z][a-z0-9-]*$/` (kebab-case, starts with letter).
- `<name>` must be between 3 and 50 characters.
- `--id` must match `/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/` (reverse-domain format).
- Output directory must not already exist (the CLI never overwrites).

---

## npm Script Registration

The following entry is added to `package.json` `"scripts"`:

```json
"create-extension": "node scripts/create-extension.js"
```

---

## Example Output

```bash
$ npm run create-extension -- hello-world

✓ Created extensions/hello-world/manifest.json
✓ Created extensions/hello-world/src/index.ts

Extension "hello-world" created at extensions/hello-world/

Next steps:
  1. Open extensions/hello-world/src/index.ts and customise your extension.
  2. Run `npm run dev` — the extension loads automatically on startup.
  3. Open Settings → Extensions to enable/disable it.
  4. See docs/EXTENSION-DEVELOPMENT.md for the full API reference.
```
