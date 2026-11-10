# ADR 157: Settle is the one word for "off my list until it moves"

**Status**: Accepted

**Date**: 2026-11-10

**Supersedes**: [ADR 118](118-dismissed-means-gone.md), [ADR 149](149-a-new-session-brings-a-dismissed-row-back.md)

**Amends**: [ADR 146](146-a-closed-session-leaves-home.md), [ADR 148](148-the-inbox-sidebar-reuses-home-threads.md)

## Context

Home and the Inbox sidebar draw the same work threads (ADR 148) but had two actions for one intent. Home's **Dismiss** hid a row until a new session started on it and deleted its ended sessions at once (ADR 118, 146, 149). The Inbox's **Settle** folded a card until its agent ended a turn or asked something. Each had its own store, so settling in one did not change the other. Home's asks used a third word, **Done** (`E`), and Insights called the same call Dismiss. Issue #407 asks for one word per action on every screen.

## Decision

- **Settle** is the one word and the one behavior on every screen. A thread is settled when it was settled by hand, is snoozed, or has had no activity for 24 hours. A pinned thread and an unanswered ask never settle on their own (`isSettled` in `src/home/settle.ts`).
- One store holds the marks for Home and the Inbox (`useWorkMarks` in `src/home/work-marks.ts`). The localStorage keys keep their names. On first load, each old Home dismissal becomes a settled mark and the old keys are removed.
- A settled thread wakes when its state leaves `running` or enters `needs-you` (`wokenKeys`). The wake runs in `useWorkThreads`, so it works in either sidebar mode. A facet update alone does not wake it, which keeps the fix ADR 118 made for pull request rows.
- Settle deletes nothing. A settled thread's ended sessions go when **Delete closed sessions after** says, as every closed session's does (ADR 146).
- Home hides every settled thread from Tasks and lists them under **Settled (N)** with **Restore**. Start work restores the thread it starts.
- **Dismiss** means only removing a notification, toast, alert or extension finding for good.
- Identifiers, IPC channels and the ask store's `kind: 'done'` keep their names. The rename is user-visible only, as in ADR 032.

## Consequences

- A thread the operator wanted gone comes back when its agent acts. The maintainer chose this over a permanent hide (2026-11-10).
- Home hides quiet work after 24 hours. It shows in **Settled (N)** and comes back on new activity.
- Ended session records of settled work stay on disk up to the retention window, 24 hours by default.
