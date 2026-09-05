import React, { useState } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { Dialog } from '../../../../packages/extension-ui/src/Dialog'
import { ConfirmDialog } from '../../../../packages/extension-ui/src/ConfirmDialog'
import { MODAL_DEPTH_KEY } from '../../../../packages/extension-ui/src/modal-depth'

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

beforeEach(() => {
  delete (window as unknown as Record<string, unknown>)[MODAL_DEPTH_KEY]
})

describe('Dialog', () => {
  describe('announces itself', () => {
    it('exposes a dialog role', () => {
      renderDialog()
      expect(screen.getByRole('dialog')).toBeTruthy()
    })

    it('marks itself modal', () => {
      renderDialog()
      expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true')
    })

    it('takes its accessible name from the title', () => {
      renderDialog({ title: 'Remove branch?' })
      expect(screen.getByRole('dialog', { name: 'Remove branch?' })).toBeTruthy()
    })
  })

  describe('dismissal', () => {
    it('closes on Escape', () => {
      const { onDismiss } = renderDialog()
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(onDismiss).toHaveBeenCalledTimes(1)
    })

    it('closes on a click outside the panel', () => {
      const { onDismiss, container } = renderDialog()
      fireEvent.click(container.querySelector('.tmui-dialog__scrim')!)
      expect(onDismiss).toHaveBeenCalledTimes(1)
    })

    it('does not close on a click inside the panel', () => {
      const { onDismiss } = renderDialog()
      fireEvent.click(screen.getByRole('dialog'))
      expect(onDismiss).not.toHaveBeenCalled()
    })

    it('offers a close control that dismisses', () => {
      const { onDismiss } = renderDialog()
      fireEvent.click(screen.getByRole('button', { name: 'Close' }))
      expect(onDismiss).toHaveBeenCalledTimes(1)
    })

    // The one escape hatch, for a surface holding unsaved work. It suppresses
    // the two implicit routes only — the explicit close control still works, or
    // the dialog would be a trap.
    describe('when dismissible is false', () => {
      it('ignores Escape', () => {
        const { onDismiss } = renderDialog({ dismissible: false })
        fireEvent.keyDown(document, { key: 'Escape' })
        expect(onDismiss).not.toHaveBeenCalled()
      })

      it('ignores an outside click', () => {
        const { onDismiss, container } = renderDialog({ dismissible: false })
        fireEvent.click(container.querySelector('.tmui-dialog__scrim')!)
        expect(onDismiss).not.toHaveBeenCalled()
      })

      it('still offers the explicit close control', () => {
        const { onDismiss } = renderDialog({ dismissible: false })
        fireEvent.click(screen.getByRole('button', { name: 'Close' }))
        expect(onDismiss).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('focus', () => {
    it('moves focus into the dialog on open', () => {
      renderDialog()
      expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
    })

    it('returns focus to whatever opened it', () => {
      const opener = document.createElement('button')
      document.body.appendChild(opener)
      opener.focus()
      expect(document.activeElement).toBe(opener)

      const { unmount } = renderDialog()
      expect(document.activeElement).not.toBe(opener)

      unmount()
      expect(document.activeElement).toBe(opener)
      opener.remove()
    })

    it('keeps Tab inside the dialog', () => {
      renderDialog({
        actions: [
          { label: 'Cancel', onSelect: noop },
          { label: 'Remove', tone: 'danger', onSelect: noop },
        ],
      })
      const panel = screen.getByRole('dialog')
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]')
      )
      const last = focusables[focusables.length - 1]
      last.focus()
      fireEvent.keyDown(panel, { key: 'Tab' })
      expect(panel.contains(document.activeElement)).toBe(true)
      expect(document.activeElement).toBe(focusables[0])
    })

    it('wraps backwards on Shift+Tab', () => {
      renderDialog()
      const panel = screen.getByRole('dialog')
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>('button'))
      focusables[0].focus()
      fireEvent.keyDown(panel, { key: 'Tab', shiftKey: true })
      expect(document.activeElement).toBe(focusables[focusables.length - 1])
    })
  })

  describe('modal depth', () => {
    it('registers while open so the exit gesture stands down', () => {
      renderDialog()
      expect((window as unknown as Record<string, number>)[MODAL_DEPTH_KEY]).toBe(1)
    })

    it('releases on close', () => {
      const { unmount } = renderDialog()
      unmount()
      expect((window as unknown as Record<string, number>)[MODAL_DEPTH_KEY]).toBe(0)
    })

    it('counts nested dialogs', () => {
      const first = renderDialog()
      const second = render(
        <Dialog title="Second" actions={[{ label: 'Ok', onSelect: noop }]} onDismiss={noop} />
      )
      expect((window as unknown as Record<string, number>)[MODAL_DEPTH_KEY]).toBe(2)
      second.unmount()
      expect((window as unknown as Record<string, number>)[MODAL_DEPTH_KEY]).toBe(1)
      first.unmount()
      expect((window as unknown as Record<string, number>)[MODAL_DEPTH_KEY]).toBe(0)
    })
  })

  describe('actions', () => {
    it('renders every action', () => {
      renderDialog({
        actions: [
          { label: 'Cancel', onSelect: noop },
          { label: 'Save brief', tone: 'primary', onSelect: noop },
        ],
      })
      expect(screen.getByRole('button', { name: /Cancel/ })).toBeTruthy()
      expect(screen.getByRole('button', { name: /Save brief/ })).toBeTruthy()
    })

    it('invokes the action that was chosen', () => {
      const onSelect = vi.fn()
      renderDialog({ actions: [{ label: 'Remove', onSelect }] })
      fireEvent.click(screen.getByRole('button', { name: /Remove/ }))
      expect(onSelect).toHaveBeenCalledTimes(1)
    })

    it('shows a shortcut hint when one is given', () => {
      renderDialog({ actions: [{ label: 'Save', onSelect: noop, shortcut: '⌘↵' }] })
      expect(screen.getByText('⌘↵')).toBeTruthy()
    })
  })

  it('renders the body it was given', () => {
    renderDialog({ children: <p>This cannot be undone.</p> })
    expect(screen.getByText('This cannot be undone.')).toBeTruthy()
  })

  // The scrim dims what is behind; it must never remove it. Hiding the content
  // is what a core-hosted dialog would have had to do, and is why dialogs render
  // in the calling view instead (ADR 038).
  it('keeps the content behind it in the document', () => {
    render(<p data-testid="behind">the board</p>)
    renderDialog()
    expect(screen.getByTestId('behind')).toBeTruthy()
  })
})

describe('ConfirmDialog', () => {
  it('confirms', () => {
    const onConfirm = vi.fn()
    render(<ConfirmDialog title="Remove branch?" onConfirm={onConfirm} onClose={noop} />)
    fireEvent.click(screen.getByRole('button', { name: /Confirm/ }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('takes a custom confirm label so the button says what happens', () => {
    render(
      <ConfirmDialog title="Remove branch?" confirmLabel="Remove" onConfirm={noop} onClose={noop} />
    )
    expect(screen.getByRole('button', { name: /Remove/ })).toBeTruthy()
  })

  it('cancels', () => {
    const onClose = vi.fn()
    render(<ConfirmDialog title="Remove branch?" onConfirm={noop} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /Cancel/ }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape, like every other surface', () => {
    const onClose = vi.fn()
    render(<ConfirmDialog title="Remove branch?" onConfirm={noop} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('shows the description when given one', () => {
    render(
      <ConfirmDialog
        title="Remove branch?"
        description="Its worktree stays on disk."
        onConfirm={noop}
        onClose={noop}
      />
    )
    expect(screen.getByText('Its worktree stays on disk.')).toBeTruthy()
  })

  // Focus starts on the safe choice, matching the core dialog this generalises.
  it('opens with focus on cancel rather than on the destructive action', () => {
    render(<ConfirmDialog title="Remove branch?" danger onConfirm={noop} onClose={noop} />)
    expect((document.activeElement as HTMLElement).textContent).toContain('Cancel')
  })
})

describe('nested surfaces', () => {
  it('renders a dialog opened from inside a dialog above its parent', () => {
    function Nested(): JSX.Element {
      const [open, setOpen] = useState(false)
      return (
        <Dialog
          title="Outer"
          actions={[{ label: 'Open inner', onSelect: () => setOpen(true) }]}
          onDismiss={noop}
        >
          {open && (
            <Dialog title="Inner" actions={[{ label: 'Ok', onSelect: noop }]} onDismiss={noop} />
          )}
        </Dialog>
      )
    }
    const { container } = render(<Nested />)
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Open inner/ }))
    })
    const panels = Array.from(container.querySelectorAll<HTMLElement>('.tmui-dialog__panel'))
    expect(panels).toHaveLength(2)
    const outer = Number(panels[0].style.zIndex)
    const inner = Number(panels[1].style.zIndex)
    expect(inner).toBeGreaterThan(outer)
  })
})
