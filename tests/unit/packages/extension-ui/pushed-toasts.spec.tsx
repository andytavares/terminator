import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { PushedToasts, type PushedNotice } from '../../../../packages/extension-ui/src/PushedToasts'

/** Stands in for `notifications.onPush`: what the test delivers reaches whoever subscribed. */
function pushChannel() {
  const listeners = new Set<(n: PushedNotice) => void>()
  return {
    subscribe: (listener: (n: PushedNotice) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    deliver: (n: PushedNotice) => act(() => listeners.forEach((listener) => listener(n))),
    listening: () => listeners.size,
  }
}

const foundryNotice = (over: Partial<PushedNotice> = {}): PushedNotice => ({
  type: 'warning',
  title: 'Waiting on you',
  message: 'Approve the plan',
  source: 'terminator.foundry',
  targets: ['toast'],
  ...over,
})

describe('PushedToasts', () => {
  it("draws this extension's pushed notifications that go to a toast", () => {
    const push = pushChannel()
    render(<PushedToasts source="terminator.foundry" subscribe={push.subscribe} />)
    push.deliver(foundryNotice())
    expect(screen.getByRole('status').textContent).toContain('Waiting on you: Approve the plan')
  })

  it("ignores another extension's, and one the settings keep out of toasts", () => {
    const push = pushChannel()
    render(<PushedToasts source="terminator.foundry" subscribe={push.subscribe} />)
    push.deliver(foundryNotice({ source: 'terminator.notepad' }))
    push.deliver(foundryNotice({ targets: ['center'] }))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('stops listening when it goes', () => {
    const push = pushChannel()
    const { unmount } = render(
      <PushedToasts source="terminator.foundry" subscribe={push.subscribe} />
    )
    expect(push.listening()).toBe(1)
    unmount()
    expect(push.listening()).toBe(0)
  })
})
