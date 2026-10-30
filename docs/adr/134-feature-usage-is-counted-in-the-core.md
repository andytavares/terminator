# ADR 134: Feature usage is counted in the core, per day, on this machine

**Status**: Accepted

**Date**: 2026-10-29

**Relates to**: [ADR 117](117-extensions-send-home-data-core-draws-it.md), [ADR 114](114-extension-views-are-frames-in-the-window.md), [ADR 127](127-a-task-is-the-unit-of-work.md)

## Context

The operator must decide which features to build further and which to retire. Nothing recorded which features are used. The ranking list of the palette (`quickActions.usage`) keeps one count per action. It deletes the entry when the action goes away, so it cannot show a feature that nobody used.

## Decision

The core counts uses and draws them on a core Usage screen. Extensions report through the SDK, and the core attaches the extension id.

- **Automatic capture at chokepoints.** Screens and panels (the extension registry), palette runs, shortcuts, menus and extension commands (`executeExtensionCommand`) record without code in each feature. Controls inside a screen record with one call each.
- **A declared catalog.** Every feature id is declared before it counts. Core ids are in `src/shared/usage/core-features.ts`. Extension ids are in `contributes.usage`. Screens and commands are declared when they register. The core drops and logs an undeclared id. The catalog is what lets a zero show as "Never used".
- **Daily rows in a core-only file.** `<userData>/usage.sqlite` keeps one row per day, feature and path (`click`, `palette`, `shortcut`, `menu`, `remote`, `app`, `shown`) with uses, failures and active time. The app never deletes rows. Extensions cannot reach the file through `api.db`.
- **The core names the source.** `api.usage.record` and `electronAPI.usage.record` of a view record under the own extension id of the caller. The id comes from the host connection or the frame. The frame bridge refuses `usage:*` channels from views.
- **Nothing leaves the machine, and the app stores no content.** Ids come from declared lists. A command whose id holds data sets `CommandContribution.usage` to a fixed id.

## Alternatives considered

- **Explicit calls only.** Each count has an exact meaning, but a forgotten call reads as "Never used".
- **Count every IPC call.** This is one change in `channel-registrar.ts`. But it counts polling (`metrics:system` every 2 s) and misses views that never call main.
- **One row per event.** This gives sequences, but it grows a row per use without limit. The questions of the operator need daily totals.
- **A table in `app.sqlite`.** This reuses a connection, but every extension can write there through `api.db`.
- **A hosted analytics service or the OpenTelemetry SDK.** This sends data off the machine, or adds a dependency with no local store or screen (Constitution IV).

## Consequences

- A new screen or command counts on its first day with no work. A new control inside a screen needs its id declared and one `record` call. A zero for a control that you know you use points at a missing call.
- The Usage screen states facts (Used, Not used in period, Never used, New, Gone, Extension off). It recommends nothing.
- Views can still call other core channels through the shared registry (`frame-bridge.ts`). This ADR closes the registry for `usage:*` only.
