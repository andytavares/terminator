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

- The core renderer imports `@terminator/extension-ui/tokens.css`. Its older
  `--bg-*`, `--text-*` and `--space-*` names are aliases of the `--tm-*` tokens.
- Extension views are separate documents, so the host injects
  `EXTENSION_BASE_CSS` (`@terminator/extension-ui/extension-base-css`): the tokens
  plus `src/extension-base.css`, the icon scale (`tm-icon-sm`, `tm-icon`,
  `tm-icon-lg`) and the control resets. It is read with Vite's `?raw`, so the text
  is in the bundle and nothing is looked up on disk at run time.

**Components**

| Export                               | For                                                            |
| ------------------------------------ | -------------------------------------------------------------- |
| `Button`                             | primary, secondary, ghost, danger; sm, md; disabled; icon slot |
| `IconButton`                         | an icon-only control with a required accessible name           |
| `Tabs`                               | WAI-ARIA tabs: arrow keys, Home, End, `aria-selected`          |
| `Dialog`, `ConfirmDialog`            | a modal question or form; yes or no                            |
| `Popover`                            | a dismissible, non-modal surface anchored to a control         |
| `ToastRegion`, `Toast`               | transient messages                                             |
| `EmptyState`                         | heading, one line of why, and the control that fills it        |
| `Markdown`                           | react-markdown with GFM and sanitised raw HTML (ADR 091)       |
| `RelativeTime`, `formatRelativeTime` | "5 minutes ago" through `Intl.RelativeTimeFormat`              |

**Behaviour** — `usePolling(read, show, intervalMs)`, `useDismissible`, the focus
trap, the modal-depth registry and the layer scale (`LAYERS`, `layerValue`,
`nestedLayerValue`).

`Markdown` takes `onOpenLink` for absolute addresses and an optional `renderCode`
for fenced blocks (for example a syntax highlighter), so the package itself never
sets inner HTML.

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
