import React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { Markdown } from '../src/Markdown'
import { inLight } from './in-light'

const PROSE = `## Release notes

A paragraph with **bold**, _emphasis_, \`inline code\` and a [link](https://example.com/docs).

- First item
- Second item
  - A nested item

1. Step one
2. Step two

> A quotation, set apart from the text.`

const TABLE = `| File | Change |
| ---- | ------ |
| \`src/index.ts\` | Added |
| \`README.md\` | Edited |

- [x] Tests written
- [ ] Docs updated`

const HTML = `<details><summary>Logs</summary>

The build log.

</details>

Water is H<sub>2</sub>O.<br>New line.`

const CODE = '```ts\nconst answer: number = 42\n```'

const meta = {
  title: 'Components/Markdown',
  component: Markdown,
  args: { children: PROSE, onOpenLink: fn() },
} satisfies Meta<typeof Markdown>

export default meta
type Story = StoryObj<typeof meta>

export const Prose: Story = {}
export const TablesAndTaskLists: Story = { args: { children: TABLE } }

export const RawHtmlIsRenderedAndSanitised: Story = {
  args: { children: `${HTML}\n\n<script>alert(1)</script>` },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('details > summary')).not.toBeNull())
    await expect(canvasElement.querySelector('script')).toBeNull()
  },
}

export const PlainFencedCode: Story = { args: { children: CODE } }

export const CodeDrawnByTheCaller: Story = {
  args: {
    children: CODE,
    renderCode: (code, language) => (
      <pre>
        <code data-language={language}>{code}</code>
      </pre>
    ),
  },
}

export const LinkOpensThroughTheCaller: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('link', { name: 'link' }))
    await expect(args.onOpenLink).toHaveBeenCalledWith('https://example.com/docs')
  },
}

export const InlineInAButton: Story = {
  args: { children: 'Hide **done** tickets in `Orders.tsx`, *not* grey', inline: true },
  render: (args) => (
    <button type="button">
      <Markdown {...args} />
    </button>
  ),
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('button p, button div')).toBeNull()
  },
}

export const FetchesNothing: Story = {
  args: {
    fetchesNothing: true,
    children: `${PROSE}\n\n![tracking pixel](https://example.com/pixel.png)\n\n<b>raw HTML is dropped</b>`,
  },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('img, b')).toBeNull()
  },
}

export const ProseLight = inLight(Prose)
export const InlineInAButtonLight = inLight(InlineInAButton)
export const FetchesNothingLight = inLight(FetchesNothing)
export const TablesAndTaskListsLight = inLight(TablesAndTaskLists)
export const CodeDrawnByTheCallerLight = inLight(CodeDrawnByTheCaller)
export const RawHtmlIsRenderedAndSanitisedLight = inLight(RawHtmlIsRenderedAndSanitised)
