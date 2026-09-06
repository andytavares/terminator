import React, { useRef } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Dialog } from '../../../../packages/extension-ui/src/Dialog'
import { ConfirmDialog } from '../../../../packages/extension-ui/src/ConfirmDialog'
import { Popover } from '../../../../packages/extension-ui/src/Popover'
import { useDismissible } from '../../../../packages/extension-ui/src/useDismissible'
import { getModalDepth } from '../../../../packages/extension-ui/src/modal-depth'

/**
 * SC-002, as a measurement rather than an inference.
 *
 * The audit measured the five extensions surface by surface and found that of
 * the dismissible surfaces, 6 closed on Escape, 5 carried a dialog role, 3
 * announced modal state, 7 managed focus and 4 could be dismissed from
 * outside. The claim after this feature is that every surface passes, and that
 * claim rests on every surface using one of these primitives — so this asserts
 * the five checks against the primitives themselves, once each.
 *
 * The surfaces that keep their own markup (a composer, a search palette, a
 * drawer) go through `useDismissible`, which is checked here too — that is the
 * whole of what they inherit.
 */

const CHECKS = [
  'closes on Escape',
  'dialog role',
  'modal state announced',
  'focus managed',
  'dismissible from outside',
]

describe('behaviour matrix: Dialog', () => {
  const open = (onDismiss = vi.fn()) => {
    render(
      <Dialog title="Rename" onDismiss={onDismiss} actions={[{ label: 'Go', onSelect: vi.fn() }]}>
        <input aria-label="name" />
      </Dialog>
    )
    return onDismiss
  }

  it(CHECKS[0], () => {
    const onDismiss = open()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalled()
  })

  it(CHECKS[1], () => {
    open()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it(CHECKS[2], () => {
    open()
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true')
  })

  it(CHECKS[3], () => {
    open()
    // Focus moved into the surface rather than being left behind it.
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
  })

  it(CHECKS[4], () => {
    const onDismiss = open()
    fireEvent.mouseDown(document.querySelector('.tmui-dialog__scrim') as Element)
    fireEvent.click(document.querySelector('.tmui-dialog__scrim') as Element)
    expect(onDismiss).toHaveBeenCalled()
  })

  it('counts toward the modal depth the exit gesture reads', () => {
    expect(getModalDepth(window as unknown as Record<string, unknown>)).toBe(0)
    const { unmount } = render(
      <Dialog title="X" onDismiss={vi.fn()} actions={[]}>
        <p>body</p>
      </Dialog>
    )
    expect(getModalDepth(window as unknown as Record<string, unknown>)).toBe(1)
    unmount()
    expect(getModalDepth(window as unknown as Record<string, unknown>)).toBe(0)
  })
})

describe('behaviour matrix: ConfirmDialog', () => {
  const open = (onDismiss = vi.fn()) => {
    render(
      <ConfirmDialog
        title="Delete this note?"
        description="It cannot be recovered."
        onConfirm={vi.fn()}
        onClose={onDismiss}
      />
    )
    return onDismiss
  }

  it(CHECKS[0], () => {
    const onDismiss = open()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalled()
  })
  it(CHECKS[1], () => {
    open()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
  it(CHECKS[2], () => {
    open()
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true')
  })
  it(CHECKS[3], () => {
    open()
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
  })
  it(CHECKS[4], () => {
    const onDismiss = open()
    const scrim = document.querySelector('.tmui-dialog__scrim') as Element
    fireEvent.mouseDown(scrim)
    fireEvent.click(scrim)
    expect(onDismiss).toHaveBeenCalled()
  })
})

/**
 * A popover is deliberately NOT modal — `aria-modal` on a dropdown is a defect,
 * which is why the audit's count of 19 "modal surfaces" was the wrong shape.
 * So it passes three of the five and must fail the other two on purpose.
 */
describe('behaviour matrix: Popover', () => {
  function Harness({ onDismiss }: { onDismiss: () => void }) {
    return (
      <Popover onDismiss={onDismiss} label="Options">
        <button>One</button>
      </Popover>
    )
  }

  it(CHECKS[0], () => {
    const onDismiss = vi.fn()
    render(<Harness onDismiss={onDismiss} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalled()
  })

  it(`${CHECKS[4]}, and is not announced as modal`, async () => {
    const onDismiss = vi.fn()
    const { container } = render(<Harness onDismiss={onDismiss} />)
    const surface = container.querySelector('[data-tmui-surface]') as HTMLElement
    expect(surface.getAttribute('aria-modal')).toBeNull()
    // The outside-click listener binds a tick late on purpose: the click that
    // opened the surface is still propagating when it mounts.
    await new Promise((r) => setTimeout(r, 0))
    fireEvent.mouseDown(document.body)
    expect(onDismiss).toHaveBeenCalled()
  })
})

/**
 * What a surface keeping its own markup inherits. Notepad's composer, its
 * search palette and its edit dialog all take this route.
 */
describe('behaviour matrix: useDismissible', () => {
  function Custom({ onDismiss }: { onDismiss: () => void }) {
    const ref = useRef<HTMLDivElement>(null)
    useDismissible({ ref, onDismiss })
    return (
      <div ref={ref} data-tmui-surface="" role="dialog" aria-modal="true" aria-label="Custom">
        <button>Inside</button>
      </div>
    )
  }

  it(CHECKS[0], () => {
    const onDismiss = vi.fn()
    render(<Custom onDismiss={onDismiss} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalled()
  })

  it(CHECKS[3], () => {
    const onDismiss = vi.fn()
    render(<Custom onDismiss={onDismiss} />)
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
  })

  it('counts toward modal depth — the guard the three Notepad surfaces lacked', () => {
    const onDismiss = vi.fn()
    const { unmount } = render(<Custom onDismiss={onDismiss} />)
    expect(getModalDepth(window as unknown as Record<string, unknown>)).toBe(1)
    unmount()
    expect(getModalDepth(window as unknown as Record<string, unknown>)).toBe(0)
  })
})
