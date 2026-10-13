import React, { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { ListInput } from '../src/ListInput'
import { inLight } from './in-light'

function Controlled({ initial, placeholder }: { initial: string[]; placeholder?: string }) {
  const [items, setItems] = useState(initial)
  return (
    <div style={{ width: 320 }}>
      <ListInput
        label="Critical paths"
        value={items}
        onChange={setItems}
        placeholder={placeholder}
      />
      <output data-testid="items">{JSON.stringify(items)}</output>
    </div>
  )
}

const meta = {
  title: 'Components/ListInput',
  component: ListInput,
  args: { label: 'Critical paths', value: [], onChange: () => {} },
  render: () => <Controlled initial={['src/auth/**', 'migrations/**']} />,
} satisfies Meta<typeof ListInput>

export default meta
type Story = StoryObj<typeof meta>

export const WithItems: Story = {}
export const WithItemsLight = inLight(WithItems)

export const Empty: Story = {
  render: () => <Controlled initial={[]} placeholder="One glob per line" />,
}
export const EmptyLight = inLight(Empty)

export const TypingOneItemPerLine: Story = {
  render: () => <Controlled initial={[]} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(
      canvas.getByRole('textbox', { name: 'Critical paths' }),
      'docs/**{enter}{enter}  src/** '
    )
    await expect(canvas.getByTestId('items')).toHaveTextContent('["docs/**","src/**"]')
  },
}
