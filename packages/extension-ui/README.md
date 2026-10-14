# @terminator/extension-ui

The design system of Terminator (ADR 098, Constitution XIII). The core application
and every extension build their screens from it, so a control looks and lines up
the same everywhere. Source-only: there is no build step, and `react`, `react-dom`
and `lucide-react` are peer dependencies.

## What is in it

**Tokens** — `src/tokens.css`. The one definition of colour, space, type, radius
and layer tokens for both themes, under the published `--tm-*` names. `:root` is
the dark default; `[data-theme='light']` replaces what differs. No other file
should define a colour.

- The core renderer imports `@terminator/extension-ui/tokens.css` and uses the `--tm-*` names
  directly; a token has no second name.
- Extension views are separate documents, so the host injects
  `EXTENSION_BASE_CSS` (`@terminator/extension-ui/extension-base-css`): the tokens
  plus `src/extension-base.css`, the icon scale (`tm-icon-sm`, `tm-icon`,
  `tm-icon-lg`) and the control resets. It is read with Vite's `?raw`, so the text
  is in the bundle and nothing is looked up on disk at run time.

**Components**

| Export                                           | For                                                                                                                           |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `Button`                                         | primary, secondary, ghost, danger; sm, md; disabled; icon slot                                                                |
| `IconButton`                                     | an icon-only control with a required accessible name; optional longer `description` tooltip; sm (20px), md (26px); disabled   |
| `Tabs`; `TabsRoot`, `TabList`, `Tab`, `TabPanel` | WAI-ARIA tabs: arrow keys, Home, End, roving `tabindex`; assembled or in parts                                                |
| `SegmentedControl`                               | one choice out of a few, as joined buttons: WAI-ARIA radio group; sm, md                                                      |
| `ListInput`, `listItems`                         | a list of short strings edited one item per line (globs, tool names); trimmed, blank lines dropped                            |
| `ModalShell`                                     | the modal behaviour around any content: a native `<dialog>`; `label` or `labelledBy`, `className`, `dismissible`              |
| `Dialog`, `ConfirmDialog`                        | the shell with a title, a body and one to three actions; yes or no                                                            |
| `Popover`                                        | a dismissible, non-modal surface anchored to a control                                                                        |
| `ToastRegion`, `Toast`                           | transient messages; shown inside the modal shell on top while one is open                                                     |
| `EmptyState`                                     | heading, one line of why, and the control that fills it                                                                       |
| `installIconTooltips`                            | call once per document: names every icon-only control on hover (after 500 ms) or keyboard focus, from its title or aria-label |
| `Markdown`                                       | react-markdown with GFM and sanitised raw HTML (ADR 091); `inline`, `fetchesNothing`                                          |
| `RelativeTime`, `formatRelativeTime`             | "5 minutes ago" through `Intl.RelativeTimeFormat`                                                                             |

**Behaviour** — `usePolling(read, show, intervalMs)`, `everyWhileVisible(tick, intervalMs)`, `useDismissible`,
the modal-depth registry and the layer scale (`LAYERS`, `layerValue`).

## Modal surfaces

Every modal surface is a `ModalShell` ([ADR 110](../../docs/adr/110-modal-surfaces-use-the-native-dialog-element.md)):
a native `<dialog>` opened with `showModal()` for as long as it is mounted. The
browser keeps focus inside, makes the page behind inert, paints the shell above
every `z-index`, and returns focus to what had it. The shell draws the backdrop
(`--tm-scrim`) and centres itself in the window on both axes; the look is the
caller's `className`. No class, offset or transform moves a modal off centre:
the shell's placement is `!important`. Content taller than the window scrolls
inside the shell.

```tsx
<ModalShell label="Settings" className="settings-panel" onDismiss={close}>
  …
</ModalShell>
```

- `onDismiss` runs for Escape, a phone's back gesture and a press on the backdrop;
  the caller then unmounts the shell. `dismissible={false}` refuses all three, for
  a surface holding unsaved work, which must offer its own way out.
- Focus opens on the first control inside, or on the field with `autoFocus`.
  Put the safe choice first: `Dialog` lists Cancel before the action and puts its
  close control last in the document.
- A caller with its own Escape (Quick Actions) handles the keydown and prevents
  its default; the shell is then not asked to close.
- What opens from inside a shell must be inside it, because everything outside is
  inert. `Popover` and `useDismissible` panels render in place; `ToastRegion`
  moves itself; a surface you portal to `document.body` must portal to
  `trigger.closest('dialog') ?? document.body` instead.
- A shell's entrance animation is opacity only: the shell refuses `transform`,
  which would move it and make it the containing block of a toast shown in it.
- An e2e spec that opens a modal measures it with `expectCentredInWindow`
  (`tests/e2e/modal-centre.ts`): the box's centre within 1px of the window's.
- Do not put `tabindex` on the shell. A surface that needs a place for focus to
  rest gives an element inside it `tabIndex={-1}`.

In a unit test the DOM supplies only `showModal()`, `close()` and the `cancel`
event after Escape (`tests/support/native-dialog.ts`); `pressOutside` from
`tests/support/modal.ts` presses the backdrop. Focus and the inert page are
asserted in the stories and in `visual/modal-keys.visual.ts`, which presses real
keys against the built Storybook.

**Fonts** — `@terminator/extension-ui/fonts` imports the IBM Plex Sans and Mono
faces the tokens name. Every document imports it once from its entry: the core
renderer, the Storybook preview and each extension view (`extensions/<name>/src/renderer/main.tsx`),
because an extension view inherits nothing from the core and injected CSS cannot
carry font files. The bundler copies the woff2 files next to the view's script.

`Dialog` actions take `submit: true`: the content sits in a `<form>`, so Enter in a
field runs that action once. A field with `autoFocus` takes focus when the dialog
opens, and focus still returns to the control that opened it.

`Tabs` follows the [WAI-ARIA tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)
with automatic activation: the arrow keys move focus and select (Up and Down in a
`vertical` list), Home and End jump to the ends, disabled tabs are skipped, and only
the selected tab is in the Tab order. It comes two ways:

- `Tabs` takes `label`, `tabs` (`id`, `label`, `panel`, optional `disabled`) and
  puts the list directly over the selected panel.
- The parts, shaped like [Radix Tabs](https://www.radix-ui.com/primitives/docs/components/tabs)
  (Root, List, Trigger, Content), for anything else: `TabsRoot` holds `selectedId`
  and `onSelect` and draws no element; `TabList` (`label`, `orientation`) can share
  a toolbar row with other controls; each `Tab` (`id`) takes any content; each
  `TabPanel` (`id`) renders, only while its tab is selected, wherever the caller
  puts it, so a loading or error block can sit between the list and the panel.

`SegmentedControl` follows the [WAI-ARIA radio group pattern](https://www.w3.org/WAI/ARIA/apg/patterns/radio/):
`label`, `options` (`value`, `label`, optional `accessibleName`, `disabled`, `title`),
`value` and `onChange`. Every arrow key moves focus and the choice together, Home
and End jump to the ends, disabled options are skipped, and only the chosen option
is in the Tab order. Use it for a value a form or view reads (a time window, what
kind of thing to create); use `Tabs` when each choice has a panel of its own.

A tab whose content is more than words, such as a count, takes `accessibleName`
("Needs you, 3"), which a screen reader would otherwise read as "Needs you3"; put
the count in a `tmui-tabs__count` span. A tab's `aria-controls` names its panel only
while that panel is in the document, so a list whose content the caller draws
elsewhere (a chapter list over a file list) points at nothing that is missing.

`formatRelativeTime` returns `''`, and `RelativeTime` renders nothing, for a time
that does not parse.

`Markdown` takes `onOpenLink` for absolute http(s) and mailto addresses and an
optional `renderCode` for fenced blocks (for example a syntax highlighter), so the
package itself never sets inner HTML. Any other link is kept from navigating the
view. Two modes:

- `inline` renders a `span` holding only code, bold, italic, strikethrough and
  links, for one line inside a button or a label; it takes its size and colour
  from there. Other blocks keep only their words.
- `fetchesNothing` is for text anyone can write, such as a tracker's issue: raw
  HTML is dropped without being parsed, and no image or other `src` survives, so
  opening it fetches nothing (a remote image would be a tracking pixel). The core's
  issue drawer, Foundry and Task Vault render with it.

## Storybook

Every exported component has stories for its states, each in the dark and the
light theme. The toolbar's Theme switch sets `data-theme` on the document, as the
app does for an extension view.

```bash
npm run storybook          # http://localhost:6006
npm run build-storybook    # static site in packages/extension-ui/storybook-static
npm run test:stories       # every story as a test, in Chromium
```

The stories run as tests through the
[Vitest addon](https://storybook.js.org/docs/writing-tests/integrations/vitest-addon)
in browser mode, so they need Playwright's Chromium (`npx playwright install
chromium`). Their config is `vitest.stories.config.ts`, apart from the
repository's own `vitest.config.ts`.

## Screenshots

```bash
npm run build-storybook
npm run test:visual                       # compare every story with its baseline
npm run test:visual -- --update-snapshots # (inside this package) write new baselines after a deliberate change
```

`playwright.visual.config.ts` serves `storybook-static` with `vite preview` and
`visual/stories.visual.ts` takes one screenshot per story in its `index.json`, after
the story's play function and the fonts have finished, at 1280×800. Baselines are
per platform (`visual/__screenshots__/{platform}/`), as the
[Playwright docs](https://playwright.dev/docs/test-snapshots) advise, and CI
compares on Linux only, in the Stories job. Generate them on Linux with the
Chromium build the pinned Playwright installs (`npx playwright install chromium`).
The Stories job runs with `--update-snapshots=missing`: every committed baseline is
compared, and a story without one fails and gets one written, which the job uploads
as the `story-baselines-linux` artifact. To commit them, add the
`update-story-baselines` label to the pull request: the Story baselines workflow
(`.github/workflows/story-baselines.yml`) writes the missing baselines on Linux into `__screenshots__/linux/` under `visual/`
(`snapshotPathTemplate` in `playwright.visual.config.ts`),
commits them to the branch and removes the label. It never overwrites an existing
baseline; review the committed images in the pull request's diff.

Add a component here before using it anywhere else, with a behaviour spec in
`tests/unit/packages/extension-ui` and a story file in `stories/` (use `inLight`
for the light twin of each state).

## Writing a story

```tsx
import type { Meta, StoryObj } from '@storybook/react-vite'
import { inLight } from './in-light'
import { Button } from '../src/Button'

const meta = { title: 'Components/Button', component: Button } satisfies Meta<typeof Button>
export default meta

export const Primary: StoryObj<typeof meta> = { args: { children: 'Save', variant: 'primary' } }
export const PrimaryLight = inLight(Primary)
```

The package, its stories and its tests are held to the core's function size limits (at most 30
lines, complexity 10, three parameters; see `docs/CONTRIBUTING.md`). A component or story that
outgrows them is split into named subcomponents and hooks.
