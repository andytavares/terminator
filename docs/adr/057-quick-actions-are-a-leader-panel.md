# ADR 057: Quick Actions are a leader panel, not a palette

**Status**: Accepted

**Date**: 2026-09-19

**Supersedes**: ADR 027's claim, in its "Alternatives considered" section, that `⌘K` opens the command palette. We do not edit ADR 027. That line was wrong when written (the palette was always `⌘P`; `⌘K` clears the terminal), and it stays as the historical record. This ADR is the correction.

## Context

Terminator had two ways to act without the mouse: a command palette (`⌘P`, label-only fuzzy search) and roughly twenty hard-coded shortcuts that nothing taught. The user who asked for this feature had never opened the palette and could not remember which shortcut did what. Recall was the failure, not a missing feature. The palette was also incomplete and partly broken, in ways the ask never mentioned:

- **Extension views could not reach it.** An extension's UI is a separate `WebContentsView` with its own `webContents`. `⌘P` did nothing while focus was in Notes, Task Vault, Foundry or Git, because `extension-view-host.ts` had no `before-input-event` hook and the preload forwarded only Escape.
- **Manifest commands never reached it.** `notepad:quick-create` and `task-vault:capture-to-inbox` were declared in their manifests. Terminator read them only to bind a shortcut, and only when the extension had a sidebar panel.
- **`api.keyboard.register` was dead.** It stored handlers in a registry that nothing ever read. No extension called it.
- **Git contributed no commands.** Extension command handlers took no arguments, so a "Push" command had no way to know what to push.
- **Coverage gaps.** The palette had no entry at all for Home, Close tab, Clear, cycle recent, next waiting, edit note, cycle tabs, or any extension tab.
- **Search matched the label only**, not the category or description. "push" would not find "Git: Push".

## Decision

**Replace the palette with a leader + which-key panel.** `⌘P` opens a panel of grouped actions, each with a one-letter mnemonic. A letter acts immediately: `g` opens the Git group, then `p` pushes, with no `Enter` needed. `⌘P` stays the leader, and `⌘K` stays Clear terminal. `/`, or pressing `⌘P` again inside the panel, switches to fuzzy search over label, category and description.

**Ranking is frecency plus pins, context first.** Pinned actions sit first. The top frecency actions follow in a "Recent" row. Both are stored locally and survive a restart. The active surface's own group ranks above that row when it has one (a Foundry tab, the Git view). The panel shows an action that cannot run dimmed, with its reason, and never hides it. The same action is always in the same place, whether or not it currently works.

**Custom actions ship in v1.** They are shell commands and Claude prompts, defined in Settings, global or per-workspace. They use the variables `{cwd} {branch} {worktree} {repo} {issue} {selection}`. When a variable is blank, Terminator refuses explicitly (see Consequences) and does not run a body with a variable silently blank.

**The extension contract grows three things, all additive:**

- `contributes.quickActions.group` is a manifest-declared mnemonic and label. Core letters are reserved. Load order decides a contested letter, and the loser falls back to its label's first free letter.
- `CommandContribution.requires?: 'repo' | 'session'` lets core dim the action from context alone, so most extensions never call `setEnabled` by hand.
- `api.window.showSelf(view?)` brings the extension's own registered surface forward. It uses the same path as core's generated "Open `<surface>`" actions.

We delete `api.keyboard.register`. It was dead code, and `commands.register({ shortcut })` covers what it was for: showing a hint, never binding a key.

**`⌘P` reaches an extension's own view through `before-input-event`.** `extension-view-host.ts` attaches a listener to every extension `WebContentsView`. On the leader, it calls `preventDefault()`, focuses the main window and sends `quick-actions:open`. The panel's own Escape closes only the panel. It claims Escape through the same `useModalEffect` "modal depth" signal that the double-Escape-exit detector already reads. So closing the panel never counts as the first half of a double-Escape extension exit.

## Alternatives considered

- **A better palette, plus a recall aid (a button, a hint toast).** This keeps one interaction model. It fixes the reachability and search bugs without a new UI concept. Rejected as insufficient on its own: a palette is still a blank text field over an unknown vocabulary. Even a complete, well-indexed palette does not teach you what exists. You have to know enough already to type toward it. The user's actual failure was recall. A search box solves lookup once you know what to look up, and it does not solve recall.
- **A pinned action bar** (a persistent strip of your top N actions, always on screen). This solves recall for a fixed handful of actions with zero keystrokes. It does not scale to full coverage. A bar wide enough to hold "every common action on screen" (Goal 1) is not a bar any more. It also says nothing about actions that you have not pinned yet, which is exactly the discovery problem. Rejected as a partial answer. This design still delivers it, as the "Pinned & recent" row inside the panel, without giving up full coverage.
- **A hold-`⌘` cheat sheet** (holding the modifier alone overlays every bound shortcut, like some launcher apps). It teaches direct shortcuts well. It teaches nothing about actions that exist only inside a group or an extension. It also runs nothing itself, so it would need to coexist with a separate execution mechanism, which doubles the surface. Rejected: this design's own hint toast ("Next time: `⌘D`") teaches the shortcuts that matter, through the one mechanism that also runs the action.
- **Move the leader to `⌘K`.** `⌘K` already means Clear terminal, in muscle memory and in the shortcut table. Moving the leader would fix nothing about recall, and it would break an existing, well-understood binding for no benefit. Rejected outright. This is also the correction to ADR 027's own mistaken claim that the palette was ever on `⌘K`.

## Consequences

- **`api.keyboard.register` is deleted.** No extension called it and nothing dispatched it. `commands.register({ shortcut })` is the only surface left. Every place that mentions it documents it as a display hint, not a binding.
- **Custom actions carry real refusals, not silent corruption.** Terminator refuses a shell action that targets the focused terminal when that terminal is running Claude ("use a new tab" instead). It refuses a prompt action when the focused session is not an agent, or when its `agentState` is `working` ("Claude is mid-turn"). It refuses outright a shell body longer than 1024 bytes after its variables are expanded. PTY `MAX_CANON` silently mangles a longer typed line (see the memory note `project_pty_max_canon_truncates_launches`). Terminator would rather refuse than send something that the terminal will corrupt.
- **Context-first ranking means the panel is not the same panel twice.** With a Foundry view active, the Foundry group ranks first. With none, it sits alphabetically among the others. This is intentional (Decision D5, "context first, everything reachable"). It also means that a screenshot or a description of "the panel" is true for only one surface at a time.
- **Usage, pins and direct-shortcut counts persist as arrays, not records.** `deepMerge` in `settings-store.ts` replaces arrays wholesale but cannot delete a record key. Pruning an entry for an uninstalled extension or a deleted custom action needs deletes.
- **A mnemonic-less action still needs a slot.** Some actions have no letter: a shortcut-only core action, or one surfaced dynamically. Each still renders inside the same fixed three-column row as every action with a mnemonic. The row layout must reserve the key column whether or not there is a letter to put in it. The row must not collapse when there is nothing there.
