# Quickstart: SpecKit Pilot Extension

**Branch**: `004-speckit-pilot-extension`

---

## Prerequisites

- Node.js 20+
- Terminator dev environment running (`npm run dev`)
- Spec-Kit slash commands available in Claude Code (e.g., `/speckit-specify`)
- An active Claude Code terminal session open in Terminator

---

## Scaffold the Extension

```bash
npm run create-extension -- speckit-pilot
```

This creates `extensions/speckit-pilot/` with the manifest and entry point.

---

## Install Extension Dependencies

Add to `extensions/speckit-pilot/package.json`:

```json
{
  "name": "@terminator/extension-speckit-pilot",
  "version": "0.1.0",
  "private": true,
  "dependencies": {
    "diff": "5.2.0",
    "minimatch": "9.0.5"
  }
}
```

Then from the repo root:

```bash
npm install
```

---

## Build

After editing TypeScript source files:

```bash
npm run build:extensions
```

The compiled `extensions/speckit-pilot/src/index.js` is a build artifact — do not edit it directly or commit it.

---

## Run Tests

```bash
npm run test -- --project=speckit-pilot
# or watch mode:
npm run test -- --project=speckit-pilot --watch
```

---

## Initialize SpecKit Pilot in a Workspace

1. Open Terminator and navigate to a repo that has `.specify/` initialized.
2. Open a Claude Code terminal session (agent session type).
3. Click the **SpecKit Pilot** item in the sidebar — the lifecycle view opens.
4. If no feature is selected, click **+ New feature** to create one.
5. Click **Run** on the Constitution phase to begin, or skip if a constitution already exists.

---

## Development Loop

```
Edit TypeScript → npm run build:extensions → Reload Terminator window → Test in UI
```

Use `npm run dev` which watches for extension changes and auto-reloads.
