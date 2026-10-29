import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { ShareBar } from '../src/ShareBar'
import { inLight } from './in-light'

const meta = {
  title: 'Components/ShareBar',
  component: ShareBar,
  args: {
    label: 'How Notes was reached',
    shares: [
      { label: 'Click', value: 64, tone: 'accent' },
      { label: 'Palette', value: 24, tone: 'info' },
      { label: 'Shortcut', value: 9, tone: 'good' },
      { label: 'Menu', value: 3, tone: 'warning' },
    ],
  },
} satisfies Meta<typeof ShareBar>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('img', {
        name: 'How Notes was reached: Click 64, Palette 24, Shortcut 9, Menu 3',
      })
    ).toBeTruthy()
  },
}
export const DefaultLight = inLight(Default)
