# ADR 057: Quick Actions are a leader panel, not a palette

**Status**: Accepted

**Date**: 2026-09-19

**Supersedes**: ADR 027's claim, in its "Alternatives considered" section, that `⌘K` opens the command palette. ADR 027 is not edited — that line was wrong when written (the palette was always `⌘P`; `⌘K` clears the terminal) and stays as the historical record. This ADR is the correction.

## Context

Terminator had two ways to act without the mouse: a command palette (`⌘P`, label-only fuzzy search) and roughly twenty hard-coded shortcuts, taught nowhere. The user who asked for this feature had never opened the palette and could not remember which shortcut did what. Recall was the failure, not a missing feature — but the palette was also incomplete and partly broken in ways the ask never mentioned:

- **Unreachable from extension views.** An extension's UI is a separate `WebContentsView` with its own `webContents`; `⌘P` did nothing while focus was in Notes, Task Vault, Foundry or Git, because `extension-view-host.ts` had no `before-input-event` hook and the preload forwarded only Escape.
- **Manifest commands never reached it.** `notepad:quick-create` and `task-vault:capture-to-inbox` were declared in their manifests and read only to bind a shortcut, and only when the extension had a sidebar panel.
- **`api.keyboard.register` was dead.** It stored handlers in a registry nothing ever read. No extension called it.
- **Git contributed no commands**, and extension command handlers took no arguments — there was no way for a "Push" command to know what to push.
- **Coverage gaps**: Home, Close tab, Clear, cycle recent, next waiting, edit note, cycle tabs, and every extension tab were missing from the palette entirely.
- **Search matched the label only**, not the category or description — "push" would not find "Git: Push".

## Decision

**Replace the palette with a leader + which-key panel.** `⌘P` opens a panel of grouped actions, each with a one-letter mnemonic. A letter acts immediately — `g` opens the Git group, then `p` pushes, no `Enter` needed. `⌘P` stays the leader; `⌘K` stays Clear terminal. `/`, or pressing `⌘P` again inside the panel, switches to fuzzy search over label, category and description.

**Ranking is frecency plus pins, context first.** Pinned actions sit first, then the top frecency actions in a "Recent" row, both stored locally and surviving a restart. The active surface's own group ranks above that row when it has one (a Foundry tab, the Git view). An action that cannot run is shown dimmed with its reason, never hidden — the same action is always in the same place, whether or not it currently works.

**Custom actions ship in v1.** Shell commands and Claude prompts, defined in Settings, global or per-workspace, with `{cwd} {branch} {worktree} {repo} {issue} {selection}` variables and explicit refusals (see Consequences) rather than a body run with a variable silently blank.

**The extension contract grows three things, all additive:** `contributes.quickActions.group` (a manifest-declared mnemonic and label — core letters are reserved, a contested letter goes to load order with the loser falling back to its label's first free letter), `CommandContribution.requires?: 'repo' | 'session'` (core dims the action from context alone, so most extensions never call `setEnabled` by hand), and `api.window.showSelf(view?)` (bring the extension's own registered surface forward — the same path core's generated "Open `<surface>`" actions use). `api.keyboard.register` is deleted: it was dead code, and `commands.register({ shortcut })` covers what it was for — showing a hint, never binding a key.

**`⌘P` reaches an extension's own view via `before-input-event`.** `extension-view-host.ts` attaches a listener to every extension `WebContentsView`; on the leader it calls `preventDefault()`, focuses the main window and sends `quick-actions:open`. The panel's own Escape closes only the panel — it claims Escape through the same `useModalEffect` "modal depth" signal the double-Escape-exit detector already reads, so closing the panel never counts as the first half of a double-Escape extension exit.

## Alternatives considered

- **A better palette, plus a recall aid (a button, a hint toast).** Keeps one interaction model and fixes the reachability and search bugs without a new UI concept. Rejected as insufficient on its own: a palette is still a blank text field over an unknown vocabulary. Even a complete, well-indexed palette does not teach you what exists — you have to already know enough to type toward it. The user's actual failure was recall, and a search box does not solve recall; it solves lookup once you know what to look up.
- **A pinned action bar** (a persistent strip of your top N actions, always on screen). Solves recall for a fixed handful of actions with zero keystrokes, but does not scale to full coverage — a bar wide enough to hold "every common action on screen" (Goal 1) is not a bar any more, and it says nothing about actions you have not pinned yet, which is exactly the discovery problem. Rejected as a partial answer that this design still delivers, as the "Pinned & recent" row inside the panel, without giving up full coverage.
- **A hold-`⌘` cheat sheet** (holding the modifier alone overlays every bound shortcut, like some launcher apps). Teaches direct shortcuts well, but teaches nothing about actions that only exist inside a group or an extension, and does not run anything itself — it would need to coexist with a separate execution mechanism, doubling the surface. Rejected: this design's own hint toast ("Next time: `⌘D`") gets the teaching half of this for the shortcuts that matter, from the one mechanism that also runs the action.
- **Move the leader to `⌘K`.** `⌘K` already means Clear terminal, in muscle memory and in the shortcut table; moving it would fix nothing about recall and would break an existing, well-understood binding for no benefit. Rejected outright — this is also the correction to ADR 027's own mistaken claim that the palette was ever on `⌘K`.

## Consequences

- **`api.keyboard.register` is deleted.** No extension called it and nothing dispatched it; `commands.register({ shortcut })` is the only surface left, and it is documented as a display hint, not a binding, everywhere it is mentioned.
- **Custom actions carry real refusals, not silent corruption.** A shell action targeting the focused terminal is refused when that terminal is running Claude ("use a new tab" instead); a prompt action is refused when the focused session is not an agent, or its `agentState` is `working` ("Claude is mid-turn"). A shell body longer than 1024 bytes after its variables are expanded is refused outright: PTY `MAX_CANON` silently mangles a longer typed line (see the memory note `project_pty_max_canon_truncates_launches`), and Terminator would rather refuse than send something the terminal will corrupt.
- **Context-first ranking means the panel is not the same panel twice.** With a Foundry view active, the Foundry group ranks first; with none, it sits alphabetically among the others. This is intentional (Decision D5, "context first, everything reachable") but means a screenshot or a description of "the panel" is only ever true for one surface at a time.
- **Usage, pins and direct-shortcut counts persist as arrays, not records.** `deepMerge` in `settings-store.ts` replaces arrays wholesale but cannot delete a record key, and pruning an entry for an uninstalled extension or a deleted custom action needs deletes.
- **A mnemonic-less action still needs a slot.** Any action without a letter (a shortcut-only core action, or one surfaced dynamically) still renders inside the same fixed three-column row as every mnemonic'd one — the row layout has to reserve the key column whether or not there is a letter to put in it, rather than collapsing when there is nothing there.
