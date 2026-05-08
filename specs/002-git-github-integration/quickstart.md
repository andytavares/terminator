# Developer Quick-Start: Git & GitHub Integration Extension

**Branch**: `002-git-github-integration` | **Date**: 2026-05-07

This guide covers what you need to know to work on the git integration extension or build a new extension that uses the v1.1.0 API additions.

---

## Prerequisites

Same as Phase 1 (see `specs/001-extension-first-terminal/quickstart.md`), plus:

- `git` CLI on your PATH (any version ≥ 2.25 for `--porcelain=v1 -z` support)
- `gh` CLI installed and authenticated (`gh auth status` returns exit 0) for GitHub features

---

## Creating a New Extension with the Scaffold CLI

The fastest way to start a new extension — or to use as a hello-world baseline while working on the git integration:

```bash
# Create a new extension named "hello-world" in extensions/hello-world/
npm run create-extension -- hello-world

# With a custom reverse-domain ID
npm run create-extension -- hello-world --id com.acme.hello-world

# To a custom directory
npm run create-extension -- hello-world --dir /path/to/my/ext
```

The generated `src/index.ts`:
- Registers a settings section, a sidebar item, and a keyboard shortcut using the v1.0.0 surfaces (all active by default)
- Includes commented-out stubs (`// TODO:`) for v1.1.0 surfaces: `sidebar.registerPanel`, `topBar.registerMenuItem`, `api.shell.exec`, `api.fs.watch`
- Disposes everything in `deactivate()`

After generation, run `npm run dev` — the extension loads automatically. No additional steps.

---

## Running the Extension in Development

The git integration extension is pre-bundled. It loads automatically when you run the app:

```bash
npm run dev          # Starts Electron in dev mode; extension loads from extensions/git-integration/
```

To develop the extension with hot reload:

```bash
npm run dev          # App rebuilds on changes to src/ and extensions/
```

The extension logs activation to the in-app Log Window (View → Show Log).

---

## Extension Structure at a Glance

```
extensions/git-integration/
├── manifest.json          # id: "terminator.git-integration", version: "1.0.0"
├── src/
│   ├── index.ts           # activate() wires everything up; deactivate() disposes all
│   ├── git/
│   │   ├── git-service.ts # Calls api.shell.exec for git operations
│   │   └── git-parser.ts  # Pure functions: parseStatus(), parseDiff()
│   ├── github/
│   │   └── gh-service.ts  # Calls api.shell.exec for gh operations
│   ├── components/        # React components rendered inside registered panels
│   └── stores/
│       └── git.store.ts   # Zustand store (status, selected file, diff cache)
```

---

## Key API Surfaces Used

### Registering the right sidebar panel

```typescript
// In activate():
const disposable = api.sidebar.registerPanel('right-sidebar', {
  id: 'git-changes',
  title: 'Git Changes',
  component: GitSidebarPanel,
  defaultVisible: api.settings.get('git.sidebar.defaultOpen') ?? false,
})
```

### Registering the top bar menu item

```typescript
const disposable = api.topBar.registerMenuItem({
  id: 'git-view',
  label: 'Git',
  onClick: () => openGitView(),
  tooltip: 'Open Git view',
})
```

### Running a git command

```typescript
const result = await api.shell.exec({
  command: 'git',
  args: ['status', '--porcelain=v1', '-z'],
  cwd: projectRoot,
})
if (result.exitCode !== 0) {
  api.notifications.showToast('error', `Git status failed: ${result.stderr}`)
  return
}
const status = parseStatus(result.stdout)
```

### Watching for file changes

```typescript
const watcher = api.fs.watch((event) => {
  // Debounce + refresh git status
  scheduleStatusRefresh(event.projectRoot)
})
// In deactivate():
watcher.dispose()
```

### Showing a toast

```typescript
api.notifications.showToast('success', 'Committed 3 files')
api.notifications.showToast('error', 'gh CLI not found — install GitHub CLI to use PR features')
```

---

## Running Tests

```bash
# Unit tests for git-parser and gh-service
npm test -- extensions/git-integration/tests/unit

# Integration tests (requires git on PATH)
npm test -- extensions/git-integration/tests/integration

# Full test suite
npm test
```

---

## Adding a New Extension API Surface

If you are extending the `ExtensionAPI` (beyond what v1.1.0 defines):

1. Add the new surface to the `ExtensionAPI` interface in `src/main/extensions/api.ts`
2. Implement the surface in the `buildExtensionAPI()` function
3. Add the corresponding IPC channel to `src/main/ipc/` and `src/renderer/electron.d.ts`
4. Update `specs/001-extension-first-terminal/contracts/extension-api.md` with the new surface
5. Update `docs/EXTENSION-DEVELOPMENT.md`
6. Write an ADR if the addition has architectural implications
7. Bump the `ExtensionAPI` version (MINOR for additions, MAJOR for breaking changes)

---

## Disabling the Extension (for testing)

In workspace settings (`.terminator/settings.json` in your project root):

```json
{
  "terminator.git-integration": {
    "git.enabled": false
  }
}
```

Or in global settings via the app's Settings panel → Git Integration → Enable Git Integration (toggle off).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Sidebar doesn't appear | `git.enabled` is false | Check workspace settings |
| Sidebar shows "not a git repository" | Project folder is not inside a git repo | `git init` in the project root |
| "gh CLI not found" toast | `gh` not on PATH | Install GitHub CLI or set `git.ghCliPath` |
| Sidebar not refreshing | Watch fallback polling paused | Check `git.sidebar.refreshIntervalMs` setting |
| Diff view shows "Diff too large" | File diff > 500KB | Open the file in an external editor |
| File list shows cap banner | > 500 files changed | Review `.gitignore`; raise `git.maxDisplayedFiles` if intentional |
