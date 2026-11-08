import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmButton } from '../../src/ConfirmButton'

// A control that destroys something says what it will destroy, first.

function setup(over: Partial<Parameters<typeof ConfirmButton>[0]> = {}) {
  const onConfirm = vi.fn()
  render(
    <ConfirmButton
      label="Start over"
      confirmLabel="Destroy it and start over"
      warning="This removes the checkout and the branch wip."
      onConfirm={onConfirm}
      {...over}
    />
  )
  return { onConfirm, user: userEvent.setup() }
}

describe('ConfirmButton', () => {
  describe('arming', armingTests)
  describe('acting and backing out', actingAndBackingOutTests)
  describe('after firing and while busy', afterFiringAndWhileBusyTests)
})

function armingTests() {
  it('shows only its own label until it is armed', () => {
    setup()
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Start over',
    ])
    expect(screen.queryByText(/removes the checkout/)).toBeNull()
  })

  it('does not act on the first click — that is the whole point', async () => {
    const { onConfirm, user } = setup()
    await user.click(screen.getByRole('button', { name: 'Start over' }))
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('names what will be destroyed once armed', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Start over' }))
    expect(document.body.textContent).toContain('This removes the checkout and the branch wip.')
  })
}

function actingAndBackingOutTests() {
  it('acts on the second click', async () => {
    const { onConfirm, user } = setup()
    await user.click(screen.getByRole('button', { name: 'Start over' }))
    await user.click(screen.getByRole('button', { name: 'Destroy it and start over' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('backs out without acting', async () => {
    const { onConfirm, user } = setup()
    await user.click(screen.getByRole('button', { name: 'Start over' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Start over',
    ])
  })
}

function afterFiringAndWhileBusyTests() {
  it('disarms after it fires, so a second run is a second decision', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Start over' }))
    await user.click(screen.getByRole('button', { name: 'Destroy it and start over' }))
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Start over',
    ])
  })

  it('cannot be armed while something else is in flight', async () => {
    const { onConfirm, user } = setup({ disabled: true })
    await user.click(screen.getByRole('button', { name: 'Start over' }))
    expect(screen.queryByText(/removes the checkout/)).toBeNull()
    expect(onConfirm).not.toHaveBeenCalled()
  })
}
