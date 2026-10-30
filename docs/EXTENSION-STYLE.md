# Extension house style

The five bundled extensions were written at different times and are not consistent. The same control is a `Button` in one and a `button` in another. One says `M` where another says `Changed`. Three views spell "stale" three ways. This is the one rule set they all follow.

Scope: every string an extension shows on screen, in the five bundled extensions and in `packages/extension-ui`. Identifiers, IPC channel names, CSS class names, database columns and type names are **not** in scope. They keep their names.

Enforcement: the three vocabulary rules below are `no-restricted-syntax` selectors in `eslint.config.mjs`, scoped to `extensions/*/src/**/*.tsx` and `packages/extension-ui/src/**/*.tsx`. Their fixture spec is `tests/unit/lint/extension-rules.spec.ts`. A reviewer applies every other rule here.

---

## 1. Say what the reader sees, not how it is stored

A person using Notepad has notes. They have no vault and have never heard of SQLite. A person running a Spec Kit phase gets files. The word "artifact" is a build-system term from the pipeline that produces the files. The reader did not ask for it.

| Never                                       | Say                                        |
| ------------------------------------------- | ------------------------------------------ |
| `saved to vault`, `local SQLite vault`      | `saved`, `stored on this machine`          |
| `Artifacts`, `Select an artifact`           | `Files`, `Select a file`                   |
| `Stalls`, `stalls are recorded here`        | `Stuck runs`, `recorded here`              |
| `Public URL (ngrok)`, `ngrok not installed` | `Public address`, `needs one more program` |
| `excess connections are rejected`           | `only N devices can watch at once`         |

There are two exemptions. Both are deliberate:

- **The extension's own name.** "Task Vault" is what the reader looks for in the sidebar. The rule forbids lowercase `vault` as a common noun. It does not forbid the capitalised product name.
- **A command the reader types verbatim.** `<code>brew install ngrok</code>` must say ngrok, because that is the command. The rule skips `JSXText` whose direct parent is a `<code>` element, and nothing else.

## 2. Sentence case everywhere

Use sentence case for headings, section labels, tab names, buttons, menu items and table columns. Do not use Title Case. Never use `ALL CAPS`: caps shout a word the reader does not need shouted, and they force an abbreviation (`HIGH`, `MED`) that then needs a legend nobody has.

Proper nouns keep their capitals: GitHub, Spec Kit, Task Vault, macOS.

```
✅ Read these first        ❌ READ THESE FIRST
✅ Connected now           ❌ Connected Now
✅ High risk               ❌ HIGH
```

## 3. A button says what pressing it does

Start with a verb in the present tense and name the outcome. The word on the button is the word in the confirmation that follows: "Publish" produces "Published".

```
✅ Turn on          ❌ Enable Remote Control Server
✅ Commit & push    ❌ Submit
✅ Disconnect       ❌ Kill
✅ Review           ❌ Approve   (when the click opens the diff)
```

A control must never name an outcome that the click does not produce. This is the most expensive mistake in this document, and it shipped: the PR queue row was one button labelled `Approve` whose `onClick` opened the diff.

Two buttons side by side share one visual weight. If both look primary, neither is.

## 4. An empty state has three parts

Give a heading that says what is not here, one line that says why, and, when one exists, the control that fills it. Never write a bare "No items."

```
✅ No notes yet
   Capture your first note from anywhere in Terminator, even mid-command.
   [ New note ]

❌ No notes.
```

An empty surface must look different from a broken one. A panel that renders nothing when it has nothing looks the same as a panel that failed to load, and only one of those is acceptable. So the frame stays, and the frame says which case it is.

## 5. Destructive and irreversible actions

- Never make it the primary action in a list row. The row is the surface where the reader has least read what the action is about.
- Do not soften the styling because of the tool's own risk score. A heuristic that scored a PR "low risk" is a guess. An approval is permanent.
- Say what will happen, in the sentence, before it happens: "Anyone with this address and password can type into your terminals."

## 6. Numbers

- Show the real count, not the page size. If more are still loading, show the total and mark the partial figure as a floor ("at least 210 min").
- Give a duration its unit: `~4 min`, not `4m`.
- Give digits that line up in a column `font-variant-numeric: tabular-nums`.

## 7. Icons

Constitution Principle XII: lucide-react only, flat, inheriting `currentColor`.

**Size comes from the scale, never from a `size` prop.** The scale has three steps. The app injects them into every extension document with the colour tokens, so nothing needs importing:

| Class        | Size | For                                        |
| ------------ | ---- | ------------------------------------------ |
| `tm-icon-sm` | 12px | Inline with small text, chips, status dots |
| `tm-icon`    | 14px | The default — buttons, rows, list items    |
| `tm-icon-lg` | 16px | Section headers, primary controls          |

```tsx
✅ <Check aria-hidden="true" className="tm-icon" />
❌ <Check size={14} />
```

A size outside those three gets a rule on its own selector, not a fourth scale step. Examples are an empty state's 36px glyph and a status dot's 7px tick. The `size` prop is an ESLint error, with two named exemptions. `<select size={n}>` is the HTML rows attribute. A generator that computes a raster from a pixel count (`QRCodeSVG`) cannot be sized with CSS.

**No unicode as a visual element.** When `⚠ ✓ ✕ ← → ↑ ↓ ↺ ↻ ▸ ▾ ℹ ✦` stand for a state or an action, use `TriangleAlert`, `Check`, `X`, `ArrowLeft`,
`ChevronRight`, `ChevronUp`, `ArrowDown`, `RotateCcw`, `RefreshCw`,
`ChevronRight`, `ChevronDown` and `Info`.

Typography is not iconography. Keep it:

| Keep                        | Because                                                     |
| --------------------------- | ----------------------------------------------------------- |
| `3× Ours`                   | a multiplication sign                                       |
| `−12`                       | a minus                                                     |
| `Modified by X · Y`         | punctuation                                                 |
| `Committing…`               | an ellipsis                                                 |
| `⌘↵ Save · Esc Cancel`      | the glyphs printed on the keys                              |
| `old/path.ts → new/path.ts` | a relational mark between two named things, like an en dash |

The test: a character that stands **alone as a control** is an icon. A character that sits **between two named things in a sentence** is typography.

## 8. Colour

Every colour comes from the published `--tm-*` tokens. `packages/extension-ui/src/tokens.css` is the only place that defines one, for the core, for every extension view and for the remote client. An extension view does not load the core stylesheet, so a raw hex cannot follow the theme. `rgba(255,255,255,0.08)` is a light-theme bug that appears when someone switches themes. Never carry state by hue alone: pair it with a word, a shape or a position.

## 9. Layering

Stacking comes from the published scale in `@terminator/extension-ui`: `layerValue()` in TypeScript, `var(--tm-layer-*)` in CSS. A modal surface is a `ModalShell`, which the browser stacks itself (ADR 110). A raw `z-index` number let 38 unmanaged values decide the order by whoever picked the biggest.

## 10. Control height

Every single-line `<input>` and `<select>` is `var(--tm-control-height)` (28px). A zero-specificity base rule sets it in both the core and the extension stylesheets. A search box and the Sort beside it are therefore the same height, whatever padding or font size each class picks. Do not size a control with padding. Two kinds of field opt out with `height: auto` on their own selector: a borderless field inside a container that is the visible box (the sidebar search, the Quick Actions search), and an inline rename in a dense row (a tab, a branch row).

## 11. Use the components

If `@terminator/extension-ui` has the control, use it. Do not write another. Add a missing control there first (ADR 098). Storybook shows each control in both themes: `npm run storybook`.

| Need                           | Use                                                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| A button                       | `Button` (primary, secondary, ghost, danger; sm, md)                                                       |
| An icon-only button            | `IconButton`, which requires its accessible name; `size="sm"` in a dense row                               |
| Switching between views        | `Tabs`, the WAI-ARIA tabs pattern; its parts when the list shares a row or the panel sits elsewhere        |
| One short choice out of a few  | `SegmentedControl`, the WAI-ARIA radio group: a time window, what kind of thing to create                  |
| Markdown from a person/agent   | `Markdown`, never `dangerouslySetInnerHTML`; `inline` in a label, `fetchesNothing` for tracker text        |
| "5 minutes ago"                | `RelativeTime` / `formatRelativeTime`, never hand-made                                                     |
| Re-reading something on a tick | `usePolling`                                                                                               |
| A dropdown or menu that closes | `Popover` / `Menu` (Escape, a click outside and focus return are the browser's), never a document listener |

A button's icon is the `icon` prop. The stylesheet sizes it, not `size`.

Fonts ship with the app. Each view's entry imports `@terminator/extension-ui/fonts` once (the core renderer does the same). Do not add a `<link>` to a font service or an `@import url(https://…)`. The UI must draw offline.

A form in a dialog is a `Dialog` whose primary action has `submit: true`, so Enter submits. Do not draw your own overlay, title or action row.

`npm run test:visual` takes a screenshot of every story (Playwright, over the built Storybook, both themes). A change that moves a component's pixels updates its baseline in the same commit. Generate the baseline on Linux with the Playwright version the repository pins. Baselines live under `__screenshots__/linux/` in `packages/extension-ui/visual/` (the `snapshotPathTemplate` in `packages/extension-ui/playwright.visual.config.ts`). The Story baselines workflow gives a story without a baseline one (`update-story-baselines` label, see `packages/extension-ui/README.md`).
