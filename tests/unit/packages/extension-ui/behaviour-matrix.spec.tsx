import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmDialog } from '../../../../packages/extension-ui/src/ConfirmDialog'
import { Popover } from '../../../../packages/extension-ui/src/Popover'
import { pressOutside } from '../../../support/modal'

/**
 * SC-002, as a measurement rather than an inference.
 *
 * The audit measured the five extensions surface by surface and found that of
 * the dismissible surfaces, 6 closed on Escape, 5 carried a dialog role, 3
 * announced modal state, 7 managed focus and 4 could be dismissed from
 * outside. The claim after this feature is that every surface passes, and that
 * claim rests on every surface using one of these primitives — so this asserts
 * the five checks against the primitives themselves, once each. Checks a
 * primitive's own spec already makes (Dialog: dialog.spec.tsx; Escape on
 * ConfirmDialog and Popover) are not repeated here.
 */

const CHECKS = [
  'closes on Escape',
  'dialog role',
  'modal state announced',
  'focus managed',
  'dismissible from outside',
]

// A native dialog opened as a modal is announced as one and holds focus without being told to.
// A test DOM does neither, so what is asserted here is that the dialog is that element, opened.
const BY_THE_BROWSER = `${CHECKS[2]} and ${CHECKS[3]}, by the browser`

function expectOpenNativeDialog(): void {
  const dialog = screen.getByRole('dialog')
  expect(dialog.tagName).toBe('DIALOG')
  expect(dialog.hasAttribute('open')).toBe(true)
}

const openConfirmDialog = (onDismiss = vi.fn()) => {
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

describe('behaviour matrix: ConfirmDialog', () => {
  it(CHECKS[1], () => {
    openConfirmDialog()
    expect(screen.getByRole('dialog', { name: 'Delete this note?' }).textContent).toContain(
      'It cannot be recovered.'
    )
  })
  it(BY_THE_BROWSER, () => {
    openConfirmDialog()
    expectOpenNativeDialog()
  })
  it(CHECKS[4], () => {
    const onDismiss = openConfirmDialog()
    pressOutside(screen.getByRole('dialog'))
    expect(onDismiss).toHaveBeenCalled()
  })
})

/**
 * A popover is deliberately NOT modal — `aria-modal` on a dropdown is a defect,
 * which is why the audit's count of 19 "modal surfaces" was the wrong shape.
 * So it passes three of the five and must fail the other two on purpose.
 */
function PopoverHarness({ onDismiss }: { onDismiss: () => void }) {
  return (
    <Popover onDismiss={onDismiss} label="Options">
      <button>One</button>
    </Popover>
  )
}

describe('behaviour matrix: Popover', () => {
  it(`${CHECKS[4]}, and is not announced as modal`, async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    render(<PopoverHarness onDismiss={onDismiss} />)
    const surface = screen.getByRole('group', { name: 'Options' })
    expect(surface.getAttribute('aria-modal')).toBeNull()
    await user.click(document.body)
    expect(onDismiss).toHaveBeenCalled()
  })
})
