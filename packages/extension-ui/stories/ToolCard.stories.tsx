import React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { FileText, Search, Terminal } from 'lucide-react'
import { Chip } from '../src/Chip'
import { ToolCard } from '../src/ToolCard'
import { inLight } from './in-light'

const nineLines = [
  'RUN  v3.2.4 /repo',
  '✓ tests/unit/branch.spec.ts (4 tests) 12ms',
  '✓ tests/unit/chip.spec.tsx (2 tests) 8ms',
  '✓ tests/unit/tool-card.spec.tsx (9 tests) 31ms',
  '✓ tests/unit/tabs.spec.tsx (6 tests) 22ms',
  '',
  'Test Files  4 passed (4)',
  '     Tests  21 passed (21)',
  '  Duration  1.21s',
].join('\n')

const meta = {
  title: 'Components/ToolCard',
  component: ToolCard,
  args: { icon: <Terminal />, title: 'Ran', detail: 'npm test', status: 'completed' },
  decorators: [(Story) => <div style={{ width: 480 }}>{Story()}</div>],
} satisfies Meta<typeof ToolCard>

export default meta
type Story = StoryObj<typeof meta>

export const Pending: Story = { args: { status: 'pending' } }
export const PendingLight = inLight(Pending)

export const Running: Story = { args: { status: 'in_progress' } }
export const RunningLight = inLight(Running)

export const Done: Story = { args: { status: 'completed' } }
export const DoneLight = inLight(Done)

export const Failed: Story = {
  args: { status: 'failed', preview: 'npm ERR! missing script: tests' },
}
export const FailedLight = inLight(Failed)

export const Cancelled: Story = { args: { status: 'cancelled' } }
export const CancelledLight = inLight(Cancelled)

export const LongPreview: Story = {
  args: { preview: nineLines },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByText(/Duration 1\.21s/)).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Show all 9 lines' }))
    await expect(canvas.getByText(/Duration 1\.21s/)).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Show less' })).toBeVisible()
  },
}
export const LongPreviewLight = inLight(LongPreview)

export const ShortPreview: Story = {
  args: {
    icon: <FileText />,
    title: 'Read',
    detail: 'src/index.ts',
    preview: 'export * from "./ToolCard"',
  },
}
export const ShortPreviewLight = inLight(ShortPreview)

export const WithChildren: Story = {
  args: {
    icon: <Search />,
    title: 'ToolSearch',
    detail: null,
    children: (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <Chip>Read</Chip>
        <Chip>Edit</Chip>
        <Chip>Bash</Chip>
      </div>
    ),
  },
}
export const WithChildrenLight = inLight(WithChildren)

export const LongDetail: Story = {
  args: {
    detail:
      'npx vitest run packages/extension-ui/tests/unit/tool-card.spec.tsx packages/core-renderer/tests/unit/renderer/components/BranchSelect.spec.tsx --reporter verbose',
  },
}
export const LongDetailLight = inLight(LongDetail)
