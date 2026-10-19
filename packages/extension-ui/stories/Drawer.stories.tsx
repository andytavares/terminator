import React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within } from 'storybook/test'
import { Drawer } from '../src/Drawer'
import { StageBar } from '../src/StageBar'
import { inLight } from './in-light'

const meta = {
  title: 'Components/Drawer',
  component: Drawer,
  args: {
    label: 'Fix the login redirect',
    onDismiss: fn(),
    children: (
      <>
        <h4 style={{ margin: 0, padding: 18 }}>Fix the login redirect</h4>
        <div style={{ padding: '0 18px' }}>
          <StageBar stage="in-review" size="large" />
        </div>
      </>
    ),
  },
  decorators: [
    (Story) => (
      <div>
        <p>The page the drawer was opened from stays visible behind the dimmed backdrop.</p>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Drawer>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const drawer = within(canvasElement).getByRole<HTMLDialogElement>('dialog', {
      name: 'Fix the login redirect',
    })
    await expect(drawer.matches(':modal')).toBe(true)
    await expect(drawer.contains(document.activeElement)).toBe(true)
  },
}
export const DefaultLight = inLight(Default)
