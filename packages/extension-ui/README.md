# @terminator/extension-ui

The design system of Terminator (ADR 098, Constitution XIII). The core application
and every extension build their screens from it, so a control looks and lines up
the same everywhere. The package is source-only: it has no build step, and `react`,
`react-dom` and `lucide-react` are peer dependencies.

## What is in it

**Tokens** — `src/tokens.css`. The one definition of colour, space, type, radius
and layer tokens for both themes, under the published `--tm-*` names. `:root` is
the dark default. `[data-theme='light']` replaces the tokens that differ. No other file
defines a colour.

- The core renderer imports `@terminator/extension-ui/tokens.css` and uses the `--tm-*` names
  directly. A token has no second name.
- Extension views are separate documents, so the host injects
  `EXTENSION_BASE_CSS` (`@terminator/extension-ui/extension-base-css`): the tokens
  plus `src/extension-base.css`, the icon scale (`tm-icon-sm`, `tm-icon`,
  `tm-icon-lg`) and the control resets. Vite's `?raw` reads it, so the text
  is in the bundle and nothing is looked up on disk at run time.

**Components**

| Export                                           | For                                                                                                                                                      |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`                                         | primary, secondary, ghost, danger; sm, md; disabled; icon slot                                                                                           |
| `IconButton`                                     | an icon-only control with a required accessible name; optional longer `description` tooltip; sm and md, each at the control height of its size; disabled |
| `Tabs`; `TabsRoot`, `TabList`, `Tab`, `TabPanel` | WAI-ARIA tabs: arrow keys, Home, End, roving `tabindex`; assembled or in parts                                                                           |
| `SegmentedControl`                               | one choice out of a few, as joined buttons (WAI-ARIA radio group); sm, md                                                                                |
| `ListInput`, `listItems`                         | a list of short strings, edited one item per line (globs, tool names); trimmed, blank lines dropped                                                      |
| `ModalShell`                                     | the modal behaviour around any content, as a native `<dialog>`; `label` or `labelledBy`, `className`, `dismissible`                                      |
| `Dialog`, `ConfirmDialog`                        | the shell with a title, a body and one to three actions; yes or no                                                                                       |
| `Popover`                                        | a dismissible, non-modal surface anchored to a control                                                                                                   |
| `ToastRegion`, `Toast`                           | transient messages; shown inside the top modal shell while a shell is open                                                                               |
| `EmptyState`                                     | heading, one line that says why, and the control that fills it                                                                                           |
| `installIconTooltips`                            | call once per document: names every icon-only control, from its title or aria-label, on hover (after 500 ms) or keyboard focus                           |
| `PushedToasts`                                   | draws the pushed notifications of the extension that go to a toast; mount one per view (`source`, `subscribe`)                                           |
| `Markdown`                                       | react-markdown with GFM and sanitised raw HTML (ADR 091); `inline`, `fetchesNothing`                                                                     |
| `RelativeTime`, `formatRelativeTime`             | "5 minutes ago" through `Intl.RelativeTimeFormat`                                                                                                        |

**Sizes** — every control of a size has one height: `--tm-control-height` (28px) for fields, selects, `Button` and `IconButton`, and `--tm-control-height-sm` (22px) for their `sm`. A control beside another control uses the same size. `tests/e2e/extension-smoke.spec.ts` fails on any two side-by-side controls that differ in height or centre.

**Fields** — no component. Every `input`, `textarea` and `select` is the themed field from `controls.css` at the weight of one element, so any class refines it. A field inside a box that draws the edge sets `border: none; padding: 0; outline: none`, and the box takes `:focus-within`.

**Behaviour** — `usePolling(read, show, intervalMs)`, `everyWhileVisible(tick, intervalMs)`, `useCloseOnOutsidePress` (for a list that cannot be a `Popover`, such as a combobox, whose field sits outside the list) and the layer scale (`LAYERS`, `layerValue`).

**Popover and Menu** — `Popover` is a native `popover="auto"` element. CSS anchor positioning places it under the element it is rendered inside (`align="end"` lines it up with the right edge; `at={{ x, y }}` opens it at a point). The browser closes it on Escape or a click outside and returns focus. `Menu` is a `Popover` with `role="menu"`. Its `MenuItem`s (any child with a `menuitem*` role) move with the arrow keys, Home and End. `document.querySelector('dialog:modal, :popover-open')` tells whether a modal dialog or a popover is open. No component counts anything.

## Modal surfaces

Every modal surface is a `ModalShell` ([ADR 110](../../docs/adr/110-modal-surfaces-use-the-native-dialog-element.md)):
a native `<dialog>` opened with `showModal()` for as long as it is mounted. The
browser keeps focus inside, makes the page behind inert, paints the shell above
every `z-index`, and returns focus to the element that had it. The shell draws the backdrop
(`--tm-scrim`) and centres itself in the window on both axes. The caller's `className` sets the look. No class, offset or transform moves a modal off centre:
the placement of the shell is `!important`. Content taller than the window scrolls
inside the shell.

```tsx
<ModalShell label="Settings" className="settings-panel" onDismiss={close}>
  …
</ModalShell>
```

- `onDismiss` runs for Escape, the back gesture of a phone and a press on the backdrop.
  The caller then unmounts the shell. `dismissible={false}` refuses all three, for
  a surface that holds unsaved work and must offer its own way out.
- Focus opens on the first control inside, or on the field with `autoFocus`.
  Put the safe choice first: `Dialog` lists Cancel before the action and puts its
  close control last in the document.
- A caller with its own Escape (Quick Actions) handles the keydown and prevents
  its default. The shell then does not receive a close request.
- Anything that opens from inside a shell must be inside it, because everything outside is
  inert. `Popover` and `Menu` render in place. `ToastRegion`
  moves itself. A surface that you portal to `document.body` must portal to
  `trigger.closest('dialog') ?? document.body` instead.
- The entrance animation of a shell changes opacity only. The shell refuses `transform`,
  which would move it and make it the containing block of a toast shown in it.
- An e2e spec that opens a modal measures it with `expectCentredInWindow`
  (`tests/e2e/modal-centre.ts`): the centre of the box must be within 1px of the centre of the window.
- Do not put `tabindex` on the shell. If a surface needs a place for focus to
  rest, give an element inside it `tabIndex={-1}`.

In a unit test, the DOM supplies only `showModal()`, `close()` and the `cancel`
event after Escape (`tests/support/native-dialog.ts`). `pressOutside` from
`tests/support/modal.ts` presses the backdrop. The stories and
`visual/modal-keys.visual.ts` assert focus and the inert page. `visual/modal-keys.visual.ts` presses real
keys against the built Storybook.

**Fonts** — `@terminator/extension-ui/fonts` imports the IBM Plex Sans and Mono
faces that the tokens name. Every document imports it once from its entry: the core
renderer, the Storybook preview and each extension view (`extensions/<name>/src/renderer/main.tsx`).
An extension view inherits nothing from the core, and injected CSS cannot
carry font files. The bundler copies the woff2 files next to the script of the view.

`Dialog` actions take `submit: true`. The content sits in a `<form>`, so Enter in a
field runs that action once. A field with `autoFocus` takes focus when the dialog
opens, and focus still returns to the control that opened the dialog.

`Tabs` follows the [WAI-ARIA tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)
with automatic activation. The arrow keys move focus and select (Up and Down in a
`vertical` list), Home and End jump to the ends, disabled tabs are skipped, and only
the selected tab is in the Tab order. It comes in two forms:

- `Tabs` takes `label`, `tabs` (`id`, `label`, `panel`, optional `disabled`) and
  puts the list directly over the selected panel.
- The parts, shaped like [Radix Tabs](https://www.radix-ui.com/primitives/docs/components/tabs)
  (Root, List, Trigger, Content), serve every other layout. `TabsRoot` holds `selectedId`
  and `onSelect` and draws no element. `TabList` (`label`, `orientation`) can share
  a toolbar row with other controls. Each `Tab` (`id`) takes any content. Each
  `TabPanel` (`id`) renders only while its tab is selected, wherever the caller
  puts it, so a loading or error block can sit between the list and the panel.

`SegmentedControl` follows the [WAI-ARIA radio group pattern](https://www.w3.org/WAI/ARIA/apg/patterns/radio/):
`label`, `options` (`value`, `label`, optional `accessibleName`, `disabled`, `title`),
`value` and `onChange`. Every arrow key moves focus and the choice together, Home
and End jump to the ends, disabled options are skipped, and only the chosen option
is in the Tab order. Use it for a value that a form or view reads (a time window, what
kind of thing to create). Use `Tabs` when each choice has a panel of its own.

A tab whose content is more than words, such as a count, takes `accessibleName`
("Needs you, 3"). Without it, a screen reader reads "Needs you3". Put
the count in a `tmui-tabs__count` span. The `aria-controls` of a tab names its panel only
while that panel is in the document. A list whose content the caller draws
elsewhere (a chapter list over a file list) therefore points at nothing that is missing.

`formatRelativeTime` returns `''`, and `RelativeTime` renders nothing, for a time
that does not parse.

`Markdown` takes `onOpenLink` for absolute http(s) and mailto addresses and an
optional `renderCode` for fenced blocks (for example a syntax highlighter), so the
package itself never sets inner HTML. Any other link cannot navigate the
view. `Markdown` has two modes:

- `inline` renders a `span` that holds only code, bold, italic, strikethrough and
  links, for one line inside a button or a label. The span takes its size and colour
  from there. Other blocks keep only their words.
- `fetchesNothing` is for text that anyone can write, such as an issue in a tracker. It drops raw
  HTML without parsing it, and no image or other `src` survives, so
  opening the text fetches nothing (a remote image would be a tracking pixel). The core's
  issue drawer, Foundry and Task Vault render with it.

## Storybook

Every exported component has stories for its states, each in the dark and the
light theme. The Theme switch in the toolbar sets `data-theme` on the document, as the
app does for an extension view.

```bash
npm run storybook          # http://localhost:6006
npm run build-storybook    # static site in packages/extension-ui/storybook-static
npm run test:stories       # every story as a test, in Chromium
```

The stories run as tests through the
[Vitest addon](https://storybook.js.org/docs/writing-tests/integrations/vitest-addon)
in browser mode, so they need Playwright's Chromium (`npx playwright install
chromium`). Their config is `vitest.stories.config.ts`, separate from the
`vitest.config.ts` of the repository.

## Screenshots

```bash
npm run build-storybook
npm run test:visual                       # compare every story with its baseline
npm run test:visual -- --update-snapshots # (inside this package) write new baselines after a deliberate change
```

`playwright.visual.config.ts` serves `storybook-static` with `vite preview`. `visual/stories.visual.ts` takes one screenshot per story in its `index.json`, at 1280×800, after
the play function of the story and the fonts have finished. Baselines are
per platform (`visual/__screenshots__/{platform}/`), as the
[Playwright docs](https://playwright.dev/docs/test-snapshots) advise. CI
compares on macOS only, in the Stories job, because Terminator ships only for macOS.
Generate baselines on macOS with the Chromium build that the pinned Playwright installs
(`npx playwright install chromium`).
The Stories job runs with `--update-snapshots=missing`. It compares every committed baseline.
A story without a baseline fails and gets a baseline written, which the job uploads
as the `story-baselines-macos` artifact. To commit the baselines, add the
`update-story-baselines` label to the pull request. The Story baselines workflow
(`.github/workflows/story-baselines.yml`) then writes the missing baselines on macOS into `__screenshots__/darwin/` under `visual/`
(`snapshotPathTemplate` in `playwright.visual.config.ts`),
commits them to the branch and removes the label. It never overwrites an existing
baseline. Review the committed images in the diff of the pull request.

Add a component here before you use it anywhere else, with a behaviour spec in
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

The package, its stories and its tests follow the function size limits of the core (at most 30
lines, complexity 10, three parameters; see `docs/CONTRIBUTING.md`). Split a component or story that
outgrows the limits into named subcomponents and hooks.
