# ADR 148: The Inbox sidebar reuses Home's work threads

**Status**: Accepted

**Date**: 2026-11-07

## Context

The sidebar lists repos and branches. Operators who run many agents want a flat list of work, sorted by what needs them, that they can clear when they are done with an item. T3 Code ships this as an opt-in "inbox" sidebar (pingdotgg/t3code#21039). Home already joins sessions, facets, tasks and tickets into work threads (`src/renderer/home/work-threads.ts`), with Needs you, snooze and search.

## Decision

- **A setting, not a replacement.** `ui.sidebarMode` is `tree` (default) or `inbox`. Settings → Interface → Sidebar and the quick action `core.toggle-sidebar-inbox` switch it without a restart. Tree mode renders as before.
- **No second thread model.** The Inbox draws `useWorkThreads()` threads. Search reuses `threadMatches` from `desk-search.ts`, cards reuse `StateGlyph`, `compactAge`, `SnoozeMenu` and `leadSessionOf`, and opening uses `revealSession`.
- **Marks live in the renderer.** Settled, pinned and snoozed work keys are three localStorage maps per profile: `terminator.sidebar.inbox-settled`, `terminator.sidebar.inbox-pinned`, `terminator.sidebar.inbox-snoozed` (`inbox-marks.ts`). An entry is forgotten 30 days after its thread is gone, the rule `dismissed-threads.ts` uses.
- **Order.** Needs you, then pinned, then the rest by `focusFirst`. Settled threads are listed last, most recent activity first, in a folded section.
- **Waking.** A settled or snoozed thread wakes when its state leaves `running` (a turn ended) or enters `needs-you` (an ask). Output alone does not wake it, because `lastActivityAt` moves on every printed line.
- **Auto-settle.** A thread with no activity for 24 hours is settled by derivation, not by a stored mark, so new activity brings it back with nothing to clear. A pinned thread and an unanswered ask never auto-settle.

## Consequences

- Settled state is per machine and profile. It does not sync between machines or reach the browser remote.
- Waking is detected while the app runs. A turn that ends while the app is closed does not wake a settled thread.
- Settling is separate from Home's Mark done and Archive. Settling a thread in the sidebar does not change Home.
