import React, { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { ModalShell } from '../src/ModalShell'
import { Button } from '../src/Button'
import { Popover } from '../src/Popover'
import { ToastRegion } from '../src/Toast'
import { inLight } from './in-light'

// The shell draws only the backdrop; this is a caller's own look, as Settings has its own.
const SURFACE_CSS = `.story-surface {
  width: 420px; padding: var(--tm-space-5); display: grid; gap: var(--tm-space-3);
  background: var(--tm-bg-elevated); border: 1px solid var(--tm-border-strong);
  border-radius: var(--tm-radius-md); font-family: var(--tm-font-ui); font-size: 13px;
}`

const meta = {
  title: 'Components/ModalShell',
  component: ModalShell,
  args: {
    label: 'Settings',
    className: 'story-surface',
    onDismiss: fn(),
    children: (
      <>
        <strong>Any content, in the caller’s own layout</strong>
        <Button variant="secondary">Appearance</Button>
        <Button variant="secondary">Terminal</Button>
      </>
    ),
  },
  decorators: [
    (Story) => (
      <div>
        <style>{SURFACE_CSS}</style>
        <Button variant="secondary">Behind the shell</Button>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ModalShell>

export default meta
type Story = StoryObj<typeof meta>

const shellIn = (canvasElement: HTMLElement): HTMLDialogElement =>
  within(canvasElement).getByRole<HTMLDialogElement>('dialog')

export const Default: Story = {
  play: async ({ canvasElement }) => {
    await expect(shellIn(canvasElement).matches(':modal')).toBe(true)
  },
}

export const FocusOpensOnTheFirstControl: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'Appearance' })).toHaveFocus()
  },
}

export const AutoFocusFieldTakesFocus: Story = {
  args: {
    children: (
      <>
        <Button variant="secondary">Appearance</Button>
        <input aria-label="Name" autoFocus />
      </>
    ),
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('textbox', { name: 'Name' })).toHaveFocus()
  },
}

export const PageBehindIsInert: Story = {
  play: async ({ canvasElement }) => {
    const behind = canvasElement.querySelector('button')
    behind?.focus()
    await expect(behind).not.toHaveFocus()
  },
}

export const CloseRequestDismisses: Story = {
  play: async ({ canvasElement, args }) => {
    shellIn(canvasElement).requestClose()
    await expect(args.onDismiss).toHaveBeenCalledTimes(1)
    await expect(shellIn(canvasElement).open).toBe(true)
  },
}

export const NotDismissible: Story = {
  args: { dismissible: false },
  play: async ({ canvasElement, args }) => {
    shellIn(canvasElement).requestClose()
    await userEvent.pointer({ keys: '[MouseLeft]', target: shellIn(canvasElement), coords: EDGE })
    await expect(args.onDismiss).not.toHaveBeenCalled()
  },
}

/** A point on the backdrop: the shell sits in the middle of the window. */
const EDGE = { clientX: 4, clientY: 4 }

export const PressOutsideDismisses: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.pointer({ keys: '[MouseLeft]', target: shellIn(canvasElement), coords: EDGE })
    await expect(args.onDismiss).toHaveBeenCalledTimes(1)
  },
}

export const PressInsideKeepsItOpen: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByText(/Any content/))
    await expect(args.onDismiss).not.toHaveBeenCalled()
  },
}

function OpenedFromAButton(): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open settings</Button>
      {open && (
        <ModalShell label="Settings" className="story-surface" onDismiss={() => setOpen(false)}>
          <Button onClick={() => setOpen(false)}>Done</Button>
        </ModalShell>
      )}
    </>
  )
}

export const FocusReturnsToTheOpener: Story = {
  render: () => <OpenedFromAButton />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const opener = canvas.getByRole('button', { name: 'Open settings' })
    opener.focus()
    await userEvent.click(opener)
    await userEvent.click(canvas.getByRole('button', { name: 'Done' }))
    await expect(opener).toHaveFocus()
  },
}

const dismissToast = fn()

/** A toast raised while a shell is open has to be readable and pressable over it. */
export const ToastOverTheShell: Story = {
  render: (args) => (
    <>
      <ModalShell {...args} />
      <ToastRegion
        toasts={[{ id: 'saved', message: 'Settings saved.', duration: 0 }]}
        onDismiss={dismissToast}
      />
    </>
  ),
  play: async ({ canvasElement }) => {
    const toast = within(canvasElement).getByRole('status')
    await expect(shellIn(canvasElement).contains(toast)).toBe(true)
    await userEvent.click(within(toast).getByRole('button', { name: 'Dismiss' }))
    await expect(dismissToast).toHaveBeenCalledWith('saved')
  },
}

const dismissPopover = fn()

/** A popover opened from inside the shell is part of it: on top, and usable. */
export const PopoverInsideTheShell: Story = {
  args: {
    children: (
      <div style={{ height: 120 }}>
        <div style={{ display: 'inline-block' }}>
          <Button variant="secondary">Branch</Button>
          <Popover label="Branch actions" onDismiss={dismissPopover}>
            <Button variant="ghost" size="sm" onClick={dismissPopover}>
              Rename branch
            </Button>
          </Popover>
        </div>
      </div>
    ),
  },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Rename branch' }))
    await expect(dismissPopover).toHaveBeenCalled()
    await expect(args.onDismiss).not.toHaveBeenCalled()
  },
}

function ShellInAShell(): JSX.Element {
  const [inner, setInner] = useState(true)
  return (
    <ModalShell label="Settings" className="story-surface" onDismiss={() => {}}>
      <Button variant="secondary">Appearance</Button>
      {inner && (
        <ModalShell label="Reset" className="story-surface" onDismiss={() => setInner(false)}>
          <Button variant="danger">Reset everything</Button>
        </ModalShell>
      )}
    </ModalShell>
  )
}

/** The one opened last is on top and takes the close request; the other stays. */
export const Nested: Story = {
  render: () => <ShellInAShell />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    canvas.getByRole<HTMLDialogElement>('dialog', { name: 'Reset' }).requestClose()
    await waitFor(() => expect(canvas.queryByRole('dialog', { name: 'Reset' })).toBeNull())
    await expect(canvas.getByRole('dialog', { name: 'Settings' })).toBeVisible()
  },
}

const LINES = Array.from({ length: 60 }, (_, line) => `Setting ${line + 1}`)

/** How far the shell's centre is from the window's, in pixels, on each axis. */
function centreOffset(shell: HTMLElement): { x: number; y: number } {
  const box = shell.getBoundingClientRect()
  return {
    x: box.left + box.width / 2 - window.innerWidth / 2,
    y: box.top + box.height / 2 - window.innerHeight / 2,
  }
}

/** A caller's own offset and transform do not move a shell: every modal is centred. */
export const CentredWhateverTheCallerAsks: Story = {
  args: { className: 'story-surface story-surface--pushed' },
  decorators: [
    (Story) => (
      <>
        <style>{`.story-surface--pushed { top: 0; margin-top: 15vh; transform: translateY(-40px); }`}</style>
        <Story />
      </>
    ),
  ],
  play: async ({ canvasElement }) => {
    const offset = centreOffset(shellIn(canvasElement))
    await expect(Math.abs(offset.x)).toBeLessThanOrEqual(1)
    await expect(Math.abs(offset.y)).toBeLessThanOrEqual(1)
  },
}

/** Content taller than the window scrolls inside the shell, which stays centred. */
export const TallerThanTheWindow: Story = {
  args: { children: LINES.map((line) => <span key={line}>{line}</span>) },
  play: async ({ canvasElement }) => {
    const shell = shellIn(canvasElement)
    const offset = centreOffset(shell)
    await expect(Math.abs(offset.x)).toBeLessThanOrEqual(1)
    await expect(Math.abs(offset.y)).toBeLessThanOrEqual(1)
    await expect(shell.scrollHeight).toBeGreaterThan(shell.clientHeight)
    await expect(shell.getBoundingClientRect().height).toBeLessThan(window.innerHeight)
  },
}

export const DefaultLight = inLight(Default)
export const ToastOverTheShellLight = inLight(ToastOverTheShell)
export const PopoverInsideTheShellLight = inLight(PopoverInsideTheShell)
