# Extension house style

The five bundled extensions were written at different times and read like it: the
same control is a `Button` in one and a `button` in another, one says `M` where
another says `Changed`, and three different views spell "stale" three ways. This
is the one rule set they all follow.

Scope: every string an extension puts on screen, in any of the five bundled
extensions and in `packages/extension-ui`. Identifiers, IPC channel names, CSS
class names, database columns and type names are **not** in scope — they keep
whatever name they have.

Enforcement: the three vocabulary rules below are `no-restricted-syntax`
selectors in `eslint.config.mjs`, scoped to `extensions/*/src/**/*.tsx` and
`packages/extension-ui/src/**/*.tsx`. Their fixture spec is
`tests/unit/lint/extension-vocabulary.spec.ts`. Everything else here is a
convention a reviewer applies.

---

## 1. Say what the reader sees, not how it is stored

A person using Notepad has notes. They do not have a vault, and they have never
heard of SQLite. A person running a Spec Kit phase gets files. The word
"artifact" is a build-system term that arrived from the pipeline that produces
them, not from anything the reader asked for.

| Never                                       | Say                                        |
| ------------------------------------------- | ------------------------------------------ |
| `saved to vault`, `local SQLite vault`      | `saved`, `stored on this machine`          |
| `Artifacts`, `Select an artifact`           | `Files`, `Select a file`                   |
| `Stalls`, `stalls are recorded here`        | `Stuck runs`, `recorded here`              |
| `Public URL (ngrok)`, `ngrok not installed` | `Public address`, `needs one more program` |
| `excess connections are rejected`           | `only N devices can watch at once`         |

Two exemptions, both deliberate:

- **The extension's own name.** "Task Vault" is what the reader is looking for
  in the sidebar. Lowercase `vault` as a common noun is the thing being
  forbidden; the capitalised product name is not.
- **A command the reader types verbatim.** `<code>brew install ngrok</code>` has
  to say ngrok, because that is the command. The rule skips `JSXText` whose
  direct parent is a `<code>` element, and nothing else.

## 2. Sentence case everywhere

Headings, section labels, tab names, buttons, menu items, table columns. Not
Title Case, and never `ALL CAPS` — caps are how a label shouts a word the reader
does not need shouted, and they force an abbreviation (`HIGH`, `MED`) that then
needs a legend nobody has.

Proper nouns keep their capitals: GitHub, Spec Kit, Task Vault, macOS.

```
✅ Read these first        ❌ READ THESE FIRST
✅ Connected now           ❌ Connected Now
✅ High risk               ❌ HIGH
```

## 3. A button says what pressing it does

Verb first, in the present tense, naming the outcome. The word on the button is
the word in the confirmation that follows it: "Publish" produces "Published".

```
✅ Turn on          ❌ Enable Remote Control Server
✅ Commit & push    ❌ Submit
✅ Disconnect       ❌ Kill
✅ Review           ❌ Approve   (when the click opens the diff)
```

A control must never name an outcome the click does not produce. That is the
most expensive mistake in this document, and it shipped: the PR queue row was a
single button whose `onClick` opened the diff, labelled `Approve`.

Two buttons side by side get one visual weight between them. If both look
primary, neither is.

## 4. An empty state has three parts

A heading that says what is not here, one line that says why, and — when there
is one — the control that fills it. Never a bare "No items."

```
✅ No notes yet
   Capture your first note from anywhere in Terminator, even mid-command.
   [ New note ]

❌ No notes.
```

An empty surface must be distinguishable from a broken one. A panel that renders
nothing when it has nothing looks exactly like a panel that failed to load, and
only one of those is fine — so the frame stays and the frame says which.

## 5. Destructive and irreversible actions

- Never the primary action in a list row. The row is the surface furthest from
  having read what it is about.
- Styling does not soften with the tool's own risk score. A heuristic that
  scored a PR "low risk" is a guess; an approval is permanent.
- Say what will happen, in the sentence, before it happens: "Anyone with this
  address and password can type into your terminals."

## 6. Numbers

- A count is the real count, not the page size. If more are still loading, say
  the total and mark the partial figure as a floor ("at least 210 min").
- A duration carries its unit: `~4 min`, not `4m`.
- Digits that line up in a column get `font-variant-numeric: tabular-nums`.

## 7. Icons

Constitution Principle XII: lucide-react only, flat, inheriting `currentColor`.

**Size comes from the scale, never from a `size` prop.** Three steps, injected
into every extension document alongside the colour tokens, so nothing needs
importing:

| Class        | Size | For                                        |
| ------------ | ---- | ------------------------------------------ |
| `tm-icon-sm` | 12px | Inline with small text, chips, status dots |
| `tm-icon`    | 14px | The default — buttons, rows, list items    |
| `tm-icon-lg` | 16px | Section headers, primary controls          |

```tsx
✅ <Check aria-hidden="true" className="tm-icon" />
❌ <Check size={14} />
```

Anything outside those three sizes gets a rule on its own selector — an empty
state's 36px glyph, a status dot's 7px tick — not a fourth scale step. The
`size` prop is an ESLint error, with two named exemptions: `<select size={n}>`
is the HTML rows attribute, and a generator that computes a raster from a pixel
count (`QRCodeSVG`) is not CSS-sizable.

**No unicode as a visual element.** `⚠ ✓ ✕ ← → ↑ ↓ ↺ ↻ ▸ ▾ ℹ ✦` standing for a
state or an action are `TriangleAlert`, `Check`, `X`, `ArrowLeft`,
`ChevronRight`, `ChevronUp`, `ArrowDown`, `RotateCcw`, `RefreshCw`,
`ChevronRight`, `ChevronDown` and `Info`.

Typography is not iconography, and stays:

| Keep                        | Because                                                     |
| --------------------------- | ----------------------------------------------------------- |
| `3× Ours`                   | a multiplication sign                                       |
| `−12`                       | a minus                                                     |
| `Modified by X · Y`         | punctuation                                                 |
| `Committing…`               | an ellipsis                                                 |
| `⌘↵ Save · Esc Cancel`      | the glyphs printed on the keys                              |
| `old/path.ts → new/path.ts` | a relational mark between two named things, like an en dash |

The line is whether the character stands **alone as a control** (an icon) or
sits **between two named things in a sentence** (typography).

## 8. Colour

Every colour comes from the published `--tm-*` tokens, and
`packages/extension-ui/src/tokens.css` is the only place one is defined — for
the core, for every extension view and for the remote client. An extension view
does not load the core stylesheet, so a raw hex is a value that cannot follow the
theme, and `rgba(255,255,255,0.08)` is a light-theme bug waiting for someone to
switch themes. State is never carried by hue alone — pair it with a word, a
shape or a position.

## 9. Layering

Stacking comes from the published scale in `@terminator/extension-ui`:
`layerValue()` / `nestedLayerValue()` in TypeScript, `var(--tm-layer-*)` in CSS.
A raw `z-index` number is how 38 unmanaged values ended up deciding order by
whoever picked the biggest.

## 10. Control height

Every single-line `<input>` and `<select>` is `var(--tm-control-height)` (28px),
set by a zero-specificity base rule in both the core and the extension
stylesheets, so a search box and the Sort beside it are always the same height
whatever padding or font size each class picks. Do not size a control with
padding. A field drawn borderless inside a container that is the visible box (the
sidebar search, the Quick Actions search), or an inline rename in a dense row (a
tab, a branch row), opts out with `height: auto` on its own selector.

## 11. Use the components

If `@terminator/extension-ui` has the control, use it; do not write another. A
missing one is added there first (ADR 098). Storybook shows each in both themes:
`npm run storybook`.

| Need                           | Use                                                                                                 |
| ------------------------------ | --------------------------------------------------------------------------------------------------- |
| A button                       | `Button` (primary, secondary, ghost, danger; sm, md)                                                |
| An icon-only button            | `IconButton`, which requires its accessible name                                                    |
| Switching between views        | `Tabs`, the WAI-ARIA tabs pattern                                                                   |
| Markdown from a person/agent   | `Markdown`, never `dangerouslySetInnerHTML`; `inline` in a label, `fetchesNothing` for tracker text |
| "5 minutes ago"                | `RelativeTime` / `formatRelativeTime`, never hand-made                                              |
| Re-reading something on a tick | `usePolling`                                                                                        |
| A dropdown or menu that closes | `useDismissible` (Escape, a click outside, the open-surface count), never a document listener       |

A button's icon is the `icon` prop, sized by the stylesheet, not by `size`.

Fonts ship with the app. Each view's entry imports `@terminator/extension-ui/fonts`
once (the core renderer does the same); do not add a `<link>` to a font service or
an `@import url(https://…)`; the UI must draw offline.

A form in a dialog is a `Dialog` whose primary action has `submit: true`, so Enter
submits; do not draw your own overlay, title or action row.

Every story is screenshot by `npm run test:visual` (Playwright, over the built
Storybook, both themes). A change that moves a component's pixels updates its
baseline in `packages/extension-ui/visual/__screenshots__/linux/` in the same
commit, generated on Linux with the Playwright version the repository pins.
