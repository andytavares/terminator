import React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { Dialog } from '../src/Dialog'
import { inLight } from './in-light'

const noop = (): void => {}

const meta = {
  title: 'Components/Dialog',
  component: Dialog,
  args: {
    title: 'Rename note',
    onDismiss: fn(),
    actions: [
      { label: 'Cancel', onSelect: noop },
      { label: 'Rename', tone: 'primary', onSelect: noop },
    ],
    children: <p style={{ margin: 0 }}>The note keeps its history under the new name.</p>,
  },
  decorators: [
    (Story) => (
      <div>
        <p>The screen the dialog was opened from stays visible behind the scrim.</p>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Dialog>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Wide: Story = { args: { size: 'wide' } }

export const DangerAction: Story = {
  args: {
    title: 'Delete note',
    actions: [
      { label: 'Cancel', onSelect: noop },
      { label: 'Delete', tone: 'danger', onSelect: noop },
    ],
  },
}

export const DisabledAction: Story = {
  args: {
    actions: [
      { label: 'Cancel', onSelect: noop },
      { label: 'Rename', tone: 'primary', disabled: true, onSelect: noop },
    ],
  },
}

export const WithShortcutHint: Story = {
  args: {
    actions: [
      { label: 'Cancel', onSelect: noop },
      { label: 'Rename', tone: 'primary', shortcut: '⌘↵', onSelect: noop },
    ],
  },
}

export const NotDismissible: Story = {
  args: { dismissible: false },
  play: async ({ args }) => {
    await userEvent.keyboard('{Escape}')
    await expect(args.onDismiss).not.toHaveBeenCalled()
  },
}

export const EscapeDismisses: Story = {
  play: async ({ args }) => {
    await userEvent.keyboard('{Escape}')
    await expect(args.onDismiss).toHaveBeenCalledTimes(1)
  },
}

export const CloseControlDismisses: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Close' }))
    await expect(args.onDismiss).toHaveBeenCalledTimes(1)
  },
}

export const FormSubmitsOnEnter: Story = {
  args: {
    actions: [
      { label: 'Cancel', onSelect: noop },
      { label: 'Rename', tone: 'primary', submit: true, onSelect: fn() },
    ],
    children: <input aria-label="Name" defaultValue="Standup notes" />,
  },
  play: async ({ canvasElement, args }) => {
    await userEvent.type(within(canvasElement).getByRole('textbox', { name: 'Name' }), '{Enter}')
    await expect(args.actions[1].onSelect).toHaveBeenCalledTimes(1)
  },
}

export const DefaultLight = inLight(Default)
export const WideLight = inLight(Wide)
export const DangerActionLight = inLight(DangerAction)
export const DisabledActionLight = inLight(DisabledAction)
export const EscapeDismissesLight = inLight(EscapeDismisses)
export const FormSubmitsOnEnterLight = inLight(FormSubmitsOnEnter)
