import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ModalShell } from '../../../../packages/extension-ui/src/ModalShell'
import { getModalDepth, MODAL_DEPTH_KEY } from '../../../../packages/extension-ui/src/modal-depth'
import { pressOutside } from '../../../support/modal'

// The test DOMs supply only showModal(), close() and Escape's `cancel` (tests/support/
// native-dialog.ts). Focus, the inert page and the top layer are asserted in the stories.

type ShellProps = React.ComponentProps<typeof ModalShell>

function renderShell(overrides: Partial<ShellProps> = {}) {
  const onDismiss = overrides.onDismiss ?? vi.fn()
  const utils = render(
    <ModalShell label="Settings" {...overrides} onDismiss={onDismiss}>
      {overrides.children ?? <button>Appearance</button>}
    </ModalShell>
  )
  return { ...utils, onDismiss, dialog: screen.getByRole('dialog') }
}

beforeEach(() => {
  delete window[MODAL_DEPTH_KEY]
})

describe('ModalShell — what it is', () => {
  it('is a native dialog, opened, holding the caller’s content', () => {
    const { dialog } = renderShell()
    expect(dialog.tagName).toBe('DIALOG')
    expect(dialog.hasAttribute('open')).toBe(true)
    expect(dialog.contains(screen.getByRole('button', { name: 'Appearance' }))).toBe(true)
  })

  it('is named by its label', () => {
    renderShell({ label: 'Quick actions' })
    expect(screen.getByRole('dialog', { name: 'Quick actions' })).toBeTruthy()
  })

  it('is named by a visible title when given its id', () => {
    renderShell({ label: undefined, labelledBy: 'heading', children: <h2 id="heading">Logs</h2> })
    expect(screen.getByRole('dialog', { name: 'Logs' })).toBeTruthy()
  })

  it('carries the caller’s class', () => {
    expect(renderShell({ className: 'settings-panel' }).dialog.classList).toContain(
      'settings-panel'
    )
  })
})

describe('ModalShell — dismissal', () => {
  it('dismisses on Escape', () => {
    const { onDismiss } = renderShell()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('stays open after Escape until the caller removes it', () => {
    const { dialog } = renderShell()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(dialog.hasAttribute('open')).toBe(true)
  })

  it('dismisses on a press outside its box', () => {
    const { onDismiss, dialog } = renderShell()
    pressOutside(dialog)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('ignores a press on its own content', () => {
    const { onDismiss } = renderShell()
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Appearance' }))
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('ignores a press on its own padding', () => {
    const { onDismiss, dialog } = renderShell()
    fireEvent.mouseDown(dialog, { clientX: 0, clientY: 0 })
    expect(onDismiss).not.toHaveBeenCalled()
  })
})

describe('ModalShell — dismissal — when dismissible is false', () => {
  it('ignores Escape', () => {
    const { onDismiss } = renderShell({ dismissible: false })
    fireEvent.keyDown(screen.getByRole('button', { name: 'Appearance' }), { key: 'Escape' })
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('ignores a close request that is not a key, such as a phone’s back gesture', () => {
    const { onDismiss, dialog } = renderShell({ dismissible: false })
    fireEvent(dialog, new Event('cancel', { cancelable: true }))
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('ignores a press outside', () => {
    const { onDismiss, dialog } = renderShell({ dismissible: false })
    pressOutside(dialog)
    expect(onDismiss).not.toHaveBeenCalled()
  })
})

describe('ModalShell — a caller with its own Escape', () => {
  it('is not dismissed when the caller prevents the key’s default', () => {
    const { onDismiss } = renderShell({
      children: <input aria-label="Search" onKeyDown={(e) => e.preventDefault()} />,
    })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search' }), { key: 'Escape' })
    expect(onDismiss).not.toHaveBeenCalled()
  })
})

describe('ModalShell — events from inside it', () => {
  it('is not dismissed by a file field’s cancel, which bubbles', () => {
    const { onDismiss } = renderShell({ children: <input aria-label="File" type="file" /> })
    fireEvent(screen.getByLabelText('File'), new Event('cancel', { bubbles: true }))
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('reopens when the browser closes it without asking', () => {
    const { dialog } = renderShell()
    ;(dialog as HTMLDialogElement).close()
    expect(dialog.hasAttribute('open')).toBe(true)
  })
})

function NestedShells({ onOuter, onInner }: { onOuter: () => void; onInner: () => void }) {
  return (
    <ModalShell label="Outer" onDismiss={onOuter}>
      <ModalShell label="Inner" onDismiss={onInner}>
        <button>Inside</button>
      </ModalShell>
    </ModalShell>
  )
}

describe('ModalShell — nested', () => {
  it('dismisses only the inner shell on Escape', () => {
    const onOuter = vi.fn()
    const onInner = vi.fn()
    render(<NestedShells onOuter={onOuter} onInner={onInner} />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Inside' }), { key: 'Escape' })
    expect(onInner).toHaveBeenCalledTimes(1)
    expect(onOuter).not.toHaveBeenCalled()
  })

  it('dismisses only the inner shell on a press outside it', () => {
    const onOuter = vi.fn()
    const onInner = vi.fn()
    render(<NestedShells onOuter={onOuter} onInner={onInner} />)
    pressOutside(screen.getByRole('dialog', { name: 'Inner' }))
    expect(onInner).toHaveBeenCalledTimes(1)
    expect(onOuter).not.toHaveBeenCalled()
  })

  it('lets Escape reach a dismissible shell inside one that is not', () => {
    const onInner = vi.fn()
    render(
      <ModalShell label="Outer" dismissible={false} onDismiss={() => {}}>
        <ModalShell label="Inner" onDismiss={onInner}>
          <button>Inside</button>
        </ModalShell>
      </ModalShell>
    )
    fireEvent.keyDown(screen.getByRole('button', { name: 'Inside' }), { key: 'Escape' })
    expect(onInner).toHaveBeenCalledTimes(1)
  })
})

describe('ModalShell — modal depth', () => {
  it('counts while open, so the exit gesture stands down, and releases on close', () => {
    const { unmount } = renderShell()
    expect(getModalDepth(window)).toBe(1)
    unmount()
    expect(getModalDepth(window)).toBe(0)
  })
})
