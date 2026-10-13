# Handoff: the overhaul branch (claude/brave-newton-5ssiux, draft PR #259)

Written 2026-10-13 so the work can move to another machine with `claude --teleport`
(https://code.claude.com/docs/en/claude-code-on-the-web). Teleport carries the conversation and the
pushed branch only. Worker branches that were never merged and background workers do not move, so
everything worth keeping is merged into the branch before this file was committed.

## What is done

The phases in `docs/research/perf/` and the ADRs 093–105 record each decision. In short:

- Electron 44, with `predev`/`prepreview` running `install-electron` so `npm run dev` works on a
  fresh clone (Electron 44 no longer downloads its binary on install). A CI Start job checks a
  fresh `npm ci` + `dev`, `preview` and the packaged app.
- Extension host in a utilityProcess (ADR 094); SDK contract with zod channel specs (ADR 096).
- node:sqlite replaces PGlite (ADR 099); Remote Control credentials (ADR 100).
- Shell exec limited to declared roots (ADR 102); per-extension data folders (ADR 103).
- CI gates: typecheck of every project, coverage on the patch (ADR 095), one version per dependency
  (syncpack), unused code (knip, ADR 104), duplicate code (jscpd, ADR 105), temp-dir leak check,
  selective e2e (`scripts/e2e-select.mjs`), perf budgets (`npm run test:perf`), Storybook stories.
- Design system in Storybook (ADR 098); Linux baselines come from the `update-story-baselines`
  label workflow (`.github/workflows/story-baselines.yml`).
- Real-app e2e for the features the coverage map listed as undriven
  (`docs/research/feature-coverage.md`), with network services stubbed locally.
- Test audit: tests that failed the standard were fixed or removed (`docs/research/test-audit-core.md`).
- Function size limits (≤30 lines, complexity ≤10, ≤3 params) enforced by ESLint for
  git-integration, task-vault, notepad and remote-control.

## What is left

1. Function size limits for Foundry (about 380 source and 600 test functions) and the core
   (`src/main`, `src/renderer`, `src/renderer-remote`, `src/shared`, `packages`; about 250
   functions, including `ExtensionsSection` and `executor.execute`), then turn the ESLint rule on
   for them.
2. Clean-gate final report items: 929 repeated names and 255 runs of comments.
3. Settings that nothing reads: `autosaveMs`, `editorFontSize`, `mcpSidecar`, git
   `commit.signOff`, `maxDisplayedFiles`, `staleThresholdDays`. Each is implemented with a test of
   its effect, or removed with its migration.
4. Foundry `readOnlyTools` and `criticalPaths` settings need multi-line input.
5. Tests for the effect of each remaining setting.
6. Remote Control: 4 of 9 channels are driven end to end; the other 5 need e2e.
7. `knip --production` as a second gate.
8. Final review, the PR description with a "How to read this change" section, CI green on the head.

## Decisions made without the user

Each entry: what was decided, why, and how to undo it.

1. Story baselines are written by CI on the `update-story-baselines` label: the artifact host was
   blocked here, and baselines must come from the platform that compares them
   (https://playwright.dev/docs/test-snapshots). Undo: delete the workflow and the PNGs.
2. Broken links inside docs/adr and docs/research (34) stay: ADRs are immutable (Principle IX) and
   research notes are dated records.
3. Constitution Principle X named `scripts/build-extensions.js`; the file is `.cjs`. Fixed as a PATCH
   amendment (2.0.0 → 2.0.1).
4. Foundry: closing an agent's tab archives the run as "stopped", not "ended". node-pty reports a
   signal kill as exit 0; the core now reports null.
5. Foundry verification keeps a status file next to its log (dash has no pipefail).
6. Verification commands keep the user's full shell environment (rc files).
7. Foundry checks run as `$SHELL -i -l -c "exec $SHELL <script>"`. A zsh check whose tab closes
   mid-run reads as failed; under bash it reads "not measured". Neither reads as a pass.
8. The lazy-load memory fix (fastify, electron-store) was reverted, then relanded once the real
   cause of the Remote Control failures (fixed ports) was fixed with port 0.
9. Packaging config moved to `electron-builder.cjs` so the bundled extensions ship; `npmRebuild` is
   off because node-pty loads N-API prebuilds. macOS signing runs only in the release workflow.
10. Network services are stubbed locally in e2e, never called live.
11. Notepad: a title set by hand stays; `commentExportFormat` works.
12. The global capture shortcut cannot be faked on macOS without Accessibility consent, so it runs
    in a Linux e2e job under xvfb.
13. git-integration bugs the coverage specs found were fixed: PR-created confirmation with a link,
    "Commit without hooks" for plain git hook failures, atomic merge-flow writes.
14. No worker may install system packages or run `npm install` in a shared container.

## How to continue

- Node 24 (`.nvmrc`). `npm ci`, then `npm run dev`.
- Checks before every push: `npm run typecheck`, `npm run lint`, `npm run format:check`,
  `npm run lint:unused`, `npm run lint:duplicates`, `npx vitest run`.
- On Linux as root, run vitest under
  `setpriv --bounding-set=-dac_override,-dac_read_search` so the chmod specs can fail a write.
- Work items 1–8 above split cleanly by area. Each can be a separate worker in its own worktree:
  write the failing test first, keep functions within the limits, one commit per logical unit,
  and merge into this branch only after the full checks pass.
