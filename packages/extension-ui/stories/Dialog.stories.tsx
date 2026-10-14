import React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { Dialog } from '../src/Dialog'
import { inLight } from './in-light'

const selectNothing = (): void => {}

const meta = {
  title: 'Components/Dialog',
  component: Dialog,
  args: {
    title: 'Rename note',
    onDismiss: fn(),
    actions: [
      { label: 'Cancel', onSelect: selectNothing },
      { label: 'Rename', tone: 'primary', onSelect: selectNothing },
    ],
    children: <p style={{ margin: 0 }}>The note keeps its history under the new name.</p>,
  },
  decorators: [
    (Story) => (
      <div>
        <p>The screen the dialog was opened from stays visible behind the backdrop.</p>
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
      { label: 'Cancel', onSelect: selectNothing },
      { label: 'Delete', tone: 'danger', onSelect: selectNothing },
    ],
  },
}

export const DisabledAction: Story = {
  args: {
    actions: [
      { label: 'Cancel', onSelect: selectNothing },
      { label: 'Rename', tone: 'primary', disabled: true, onSelect: selectNothing },
    ],
  },
}

export const WithShortcutHint: Story = {
  args: {
    actions: [
      { label: 'Cancel', onSelect: selectNothing },
      { label: 'Rename', tone: 'primary', shortcut: '⌘↵', onSelect: selectNothing },
    ],
  },
}

// A play function's keys are scripted events, which a browser does not answer with a close
// request; requestClose() is one. The real Escape is pressed in visual/modal-keys.visual.ts.
const requestClose = (canvasElement: HTMLElement): void =>
  within(canvasElement).getByRole<HTMLDialogElement>('dialog').requestClose()

export const NotDismissible: Story = {
  args: { dismissible: false },
  play: async ({ canvasElement, args }) => {
    requestClose(canvasElement)
    await expect(args.onDismiss).not.toHaveBeenCalled()
  },
}

export const CloseRequestDismisses: Story = {
  play: async ({ canvasElement, args }) => {
    requestClose(canvasElement)
    await expect(args.onDismiss).toHaveBeenCalledTimes(1)
  },
}

/** Focus opens on the first action, the safe one, and never on the close control. */
export const FocusOpensOnTheFirstAction: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'Cancel' })).toHaveFocus()
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
      { label: 'Cancel', onSelect: selectNothing },
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
export const CloseRequestDismissesLight = inLight(CloseRequestDismisses)
export const FormSubmitsOnEnterLight = inLight(FormSubmitsOnEnter)
