import React, { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Dialog } from '../../../../../extension-ui/src/Dialog'
import { ConfirmDialog } from '../../../../../extension-ui/src/ConfirmDialog'
import { isSurfaceOpen } from '../../../../../core-shared/src/double-escape'
import { pressOutside } from '../../../../../test-support/src/modal'

// The five behaviours every dismissible surface in the product must have. They
// were measured across the 19 extension surfaces before this package existed:
// Escape closed 6, role="dialog" was set on 5, aria-modal on 3, focus was
// managed in 7, click-outside dismissed 4. Each was written by hand, and no two
// agreed. Asserting them here is what makes them inherited rather than
// remembered.

const noop = (): void => {}

function renderDialog(overrides: Partial<React.ComponentProps<typeof Dialog>> = {}) {
  const onDismiss = overrides.onDismiss ?? vi.fn()
  const utils = render(
    <Dialog
      title="Remove branch?"
      actions={[{ label: 'Remove', tone: 'danger', onSelect: noop }]}
      {...overrides}
      onDismiss={onDismiss}
    />
  )
  return { ...utils, onDismiss }
}

describe('Dialog — announces itself', () => {
  it('exposes one dialog role', () => {
    renderDialog()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })

  // A native dialog opened as a modal is announced as one; the attribute is not needed.
  it('is the native dialog element, opened', () => {
    renderDialog()
    expect(screen.getByRole('dialog').tagName).toBe('DIALOG')
    expect(screen.getByRole('dialog').hasAttribute('open')).toBe(true)
  })

  it('takes its accessible name from the title', () => {
    renderDialog({ title: 'Remove branch?' })
    expect(screen.getByRole('dialog').getAttribute('aria-labelledby')).toBe(
      screen.getByRole('heading', { name: 'Remove branch?' }).id
    )
  })
})

describe('Dialog — dismissal', () => {
  it('closes on Escape', async () => {
    const user = userEvent.setup()
    const { onDismiss } = renderDialog()
    await user.keyboard('{Escape}')
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('closes on a press outside the panel', () => {
    const { onDismiss } = renderDialog()
    pressOutside(screen.getByRole('dialog'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('does not close on a press inside the panel', async () => {
    const user = userEvent.setup()
    const { onDismiss } = renderDialog()
    await user.pointer({
      keys: '[MouseLeft>]',
      target: screen.getByRole('heading', { name: 'Remove branch?' }),
    })
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('offers a close control that dismisses', async () => {
    const user = userEvent.setup()
    const { onDismiss } = renderDialog()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})

// The one escape hatch, for a surface holding unsaved work. It suppresses
// the two implicit routes only — the explicit close control still works, or
// the dialog would be a trap.
describe('Dialog — dismissal — when dismissible is false', () => {
  it('ignores Escape', async () => {
    const user = userEvent.setup()
    const { onDismiss } = renderDialog({ dismissible: false })
    await user.keyboard('{Escape}')
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('ignores an outside press', () => {
    const { onDismiss } = renderDialog({ dismissible: false })
    pressOutside(screen.getByRole('dialog'))
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('still offers the explicit close control', async () => {
    const user = userEvent.setup()
    const { onDismiss } = renderDialog({ dismissible: false })
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})

// Focus moving in, staying in and returning to the opener are the browser's: the Dialog and
// ModalShell stories and visual/modal-keys.visual.ts assert them in one.
describe('Dialog — focus', () => {
  it('puts the close control after the actions, so focus opens on the content', () => {
    renderDialog()
    const buttons = screen.getAllByRole('button').map((button) => button.textContent)
    expect(buttons[0]).toContain('Remove')
    expect(screen.getAllByRole('button').at(-1)?.getAttribute('aria-label')).toBe('Close')
  })

  // A form dialog focuses its first field itself; moving focus off it would
  // blur the field and run its validation before anyone typed.
  it('leaves focus on a field that took it as the dialog opened', () => {
    renderDialog({
      actions: [{ label: 'Create', onSelect: noop }],
      children: (
        <>
          <input aria-label="Search" />
          <input aria-label="Name" autoFocus />
        </>
      ),
    })
    expect(screen.getByRole('textbox', { name: 'Name' }).matches(':focus')).toBe(true)
  })
})

describe('Dialog — is open for the exit gesture to read', () => {
  it('is a modal dialog while open, and none after it closes', () => {
    const { unmount } = renderDialog()
    expect(isSurfaceOpen(document)).toBe(true)
    unmount()
    expect(isSurfaceOpen(document)).toBe(false)
  })

  it('stays open under the first while a nested one closes', () => {
    const first = renderDialog()
    const second = render(
      <Dialog title="Second" actions={[{ label: 'Ok', onSelect: noop }]} onDismiss={noop} />
    )
    second.unmount()
    expect(isSurfaceOpen(document)).toBe(true)
    first.unmount()
    expect(isSurfaceOpen(document)).toBe(false)
  })
})

describe('Dialog — actions', () => {
  it('renders every action', () => {
    renderDialog({
      actions: [
        { label: 'Cancel', onSelect: noop },
        { label: 'Save brief', tone: 'primary', onSelect: noop },
      ],
    })
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Cancel',
      'Save brief',
      '',
    ])
  })

  it('invokes the action that was chosen', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderDialog({ actions: [{ label: 'Remove', onSelect }] })
    await user.click(screen.getByRole('button', { name: /Remove/ }))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('shows a shortcut hint when one is given', () => {
    renderDialog({ actions: [{ label: 'Save', onSelect: noop, shortcut: '⌘↵' }] })
    expect(screen.getByRole('button', { name: /Save/ }).textContent).toBe('Save⌘↵')
  })
})

describe('Dialog — renders the body it was given', () => {
  it('renders the body it was given', () => {
    renderDialog({ children: <p>This cannot be undone.</p> })
    expect(screen.getByRole('dialog').textContent).toContain('This cannot be undone.')
  })

  // The scrim dims what is behind; it must never remove it. Hiding the content
  // is what a core-hosted dialog would have had to do, and is why dialogs render
  // in the calling view instead (ADR 038).
  it('keeps the content behind it in the document', () => {
    render(<p>the board</p>)
    renderDialog()
    expect(document.body.contains(screen.getByText('the board'))).toBe(true)
  })
})

describe('ConfirmDialog', () => {
  it('confirms', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<ConfirmDialog title="Remove branch?" onConfirm={onConfirm} onClose={noop} />)
    await user.click(screen.getByRole('button', { name: /Confirm/ }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('takes a custom confirm label so the button says what happens', () => {
    render(
      <ConfirmDialog title="Remove branch?" confirmLabel="Remove" onConfirm={noop} onClose={noop} />
    )
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toContain('Remove')
  })

  it('cancels', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ConfirmDialog title="Remove branch?" onConfirm={noop} onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: /Cancel/ }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape, like every other surface', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ConfirmDialog title="Remove branch?" onConfirm={noop} onClose={onClose} />)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})

describe('ConfirmDialog — shows the description when given one', () => {
  it('shows the description when given one', () => {
    render(
      <ConfirmDialog
        title="Remove branch?"
        description="Its worktree stays on disk."
        onConfirm={noop}
        onClose={noop}
      />
    )
    expect(screen.getByRole('dialog').textContent).toContain('Its worktree stays on disk.')
  })

  // Focus opens on the first control, so the safe choice comes first.
  it('lists cancel before the destructive action', () => {
    render(<ConfirmDialog title="Remove branch?" danger onConfirm={noop} onClose={noop} />)
    expect(screen.getAllByRole('button')[0].textContent).toContain('Cancel')
  })
})

function DialogInADialog({ onOuter, onInner }: { onOuter: () => void; onInner: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog
      title="Outer"
      actions={[{ label: 'Open inner', onSelect: () => setOpen(true) }]}
      onDismiss={onOuter}
    >
      {open && (
        <Dialog title="Inner" actions={[{ label: 'Ok', onSelect: noop }]} onDismiss={onInner} />
      )}
    </Dialog>
  )
}

describe('nested surfaces', () => {
  it('dismisses only the dialog opened from inside another on Escape', async () => {
    const user = userEvent.setup()
    const onOuter = vi.fn()
    const onInner = vi.fn()
    render(<DialogInADialog onOuter={onOuter} onInner={onInner} />)
    await user.click(screen.getByRole('button', { name: /Open inner/ }))
    await user.click(screen.getByRole('button', { name: 'Ok' }))
    expect(screen.getByRole('button', { name: 'Ok' }).matches(':focus')).toBe(true)
    await user.keyboard('{Escape}')
    expect(onInner).toHaveBeenCalledTimes(1)
    expect(onOuter).not.toHaveBeenCalled()
  })
})

// Added after migrating PrDialog: replacing a `disabled` attribute with a guard
// inside onSelect left a button that looked pressable and did nothing, which is
// the confusion the audit found in the git panel's commit controls.
describe('a disabled action', () => {
  it('is disabled in the DOM, not merely inert', () => {
    render(
      <Dialog
        title="Open Pull Request"
        actions={[{ label: 'Create PR', disabled: true, onSelect: () => {} }]}
        onDismiss={() => {}}
      />
    )
    expect((screen.getByRole('button', { name: /Create PR/ }) as HTMLButtonElement).disabled).toBe(
      true
    )
  })
})

describe('a disabled action — is enabled by default', () => {
  it('is enabled by default', () => {
    render(
      <Dialog
        title="Open Pull Request"
        actions={[{ label: 'Create PR', onSelect: () => {} }]}
        onDismiss={() => {}}
      />
    )
    expect((screen.getByRole('button', { name: /Create PR/ }) as HTMLButtonElement).disabled).toBe(
      false
    )
  })
})

// A dialog holding fields submits on Enter, as a form does. Without it the
// core's create and rename dialogs would lose the keyboard path they had.
function renderForm(onSelect: () => void, disabled = false) {
  render(
    <Dialog
      title="Name this terminal"
      actions={[
        { label: 'Cancel', onSelect: () => {} },
        { label: 'Open', tone: 'primary', submit: true, disabled, onSelect },
      ]}
      onDismiss={() => {}}
    >
      <input aria-label="Name" />
      <input aria-label="Colour" />
    </Dialog>
  )
}

describe('a submitting action', () => {
  it('runs once when Enter is pressed in a field', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderForm(onSelect)
    await user.type(screen.getByRole('textbox', { name: 'Name' }), '{Enter}')
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('runs once when clicked', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderForm(onSelect)
    await user.click(screen.getByRole('button', { name: /Open/ }))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('does not run on Enter while disabled', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderForm(onSelect, true)
    await user.type(screen.getByRole('textbox', { name: 'Name' }), '{Enter}')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('puts the dialog content in a form', () => {
    renderForm(() => {})
    const nameField = screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement
    expect(screen.getByRole('dialog').contains(nameField.form)).toBe(true)
  })
})
