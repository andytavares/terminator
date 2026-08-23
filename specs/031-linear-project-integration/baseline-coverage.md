# Baseline coverage (T003)

Captured 2026-08-22 on `031-linear-project-integration` before any feature code, via
`npx vitest run --coverage`. Recorded because the patch-coverage gate measures the **whole file**,
so a pre-existing file already near 80% can be tipped under by an unrelated edit.

Project totals: statements 95.04% · branches 88.22% · functions 91.79% · lines 96.25%

| File this feature edits                                   | Stmts | Branch | Funcs     | Lines | Note                                                                                                                                                                       |
| --------------------------------------------------------- | ----- | ------ | --------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/electron-api/manifest.ts`                     | 83.82 | 100    | **81.35** | 83.33 | **Thinnest margin.** Functions is 1.35 points above the gate — adding channel specs without extending `manifest.spec.ts` could tip it under. T023/T024 must land together. |
| `src/main/terminal/pty-manager.ts`                        | 96.89 | 95.23  | 86.66     | 99.11 | Comfortable                                                                                                                                                                |
| `src/renderer/components/sidebar/SessionGroup.tsx`        | 94.11 | 100    | 86.66     | 93.33 | Comfortable                                                                                                                                                                |
| `src/renderer/components/settings/SettingsPanel.tsx`      | 100   | 100    | 100       | 100   | Not listed by the text reporter, which omits fully-covered files                                                                                                           |
| `src/renderer/components/sidebar/ScopeMenu.tsx`           | 100   | 100    | 100       | 100   | As above                                                                                                                                                                   |
| `src/renderer/components/sidebar/CreateProjectDialog.tsx` | 100   | 100    | 100       | 100   | As above                                                                                                                                                                   |

No file this feature touches is below the 80% gate today. `manifest.ts` is the one to watch.

## T004 — test collection proved, not assumed

Throwaway failing specs were placed at `tests/unit/integrations/__glob-probe.spec.ts` and
`tests/unit/renderer/components/__GlobProbe.spec.tsx`. Both were collected and both failed as
designed — the `.tsx` one in the `jsdom` project, the `.ts` one in `node` — confirming
`NODE_INCLUDE`/`JSDOM_INCLUDE` need no change. Probes deleted afterwards.
