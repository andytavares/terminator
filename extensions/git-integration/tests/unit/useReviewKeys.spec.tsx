import React from 'react'
import { describe, it, expect, vi, beforeEach, onTestFinished, type Mock } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useReviewKeys, type ReviewKeyHandlers } from '../../src/hooks/useReviewKeys'
import { useReviewUiStore, REVIEW_KEY_EVENTS } from '../../src/stores/review-ui.store'

function TestHarness({ handlers }: { handlers: ReviewKeyHandlers }) {
  useReviewKeys(handlers)
  return (
    <div>
      <input data-testid="text-input" />
      <textarea data-testid="text-area" />
    </div>
  )
}

function fireKey(key: string, opts: Partial<KeyboardEventInit> = {}, target?: EventTarget) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts })
  ;(target ?? window).dispatchEvent(event)
  return event
}

function listenFor(type: string) {
  const listener = vi.fn()
  window.addEventListener(type, listener)
  onTestFinished(() => window.removeEventListener(type, listener))
  return listener
}

let handlers: Record<keyof ReviewKeyHandlers, Mock<() => void>>

beforeEach(() => {
  handlers = { focusVerdictBar: vi.fn<() => void>() }
  useReviewUiStore.setState({ diffRange: 'since', keyboardHelpOpen: false })
})

describe('useReviewKeys — hunk keys', () => {
  it('dispatches nextHunk on k and prevHunk on j', () => {
    render(<TestHarness handlers={handlers} />)
    const nextSpy = listenFor(REVIEW_KEY_EVENTS.nextHunk)
    const prevSpy = listenFor(REVIEW_KEY_EVENTS.prevHunk)
    fireKey('k')
    expect(nextSpy).toHaveBeenCalledTimes(1)
    expect(prevSpy).not.toHaveBeenCalled()
    fireKey('j')
    expect(prevSpy).toHaveBeenCalledTimes(1)
    expect(nextSpy).toHaveBeenCalledTimes(1)
  })

  it.each([
    [' ', REVIEW_KEY_EVENTS.markHunkRead],
    ['c', REVIEW_KEY_EVENTS.comment],
    ['l', REVIEW_KEY_EVENTS.later],
  ])('dispatches %j → %s once', (key, eventType) => {
    render(<TestHarness handlers={handlers} />)
    const listener = listenFor(eventType)
    fireKey(key)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('stops Space from scrolling the pane', () => {
    render(<TestHarness handlers={handlers} />)
    expect(fireKey(' ').defaultPrevented).toBe(true)
  })
})

describe('useReviewKeys — submit shortcut', () => {
  it('focuses the verdict bar on Cmd+Enter', () => {
    render(<TestHarness handlers={handlers} />)
    fireKey('Enter', { metaKey: true })
    expect(handlers.focusVerdictBar).toHaveBeenCalledTimes(1)
  })

  it('focuses the verdict bar on Ctrl+Enter', () => {
    render(<TestHarness handlers={handlers} />)
    fireKey('Enter', { ctrlKey: true })
    expect(handlers.focusVerdictBar).toHaveBeenCalledTimes(1)
  })

  it('calls the handlers of the latest render', () => {
    const { rerender } = render(<TestHarness handlers={handlers} />)
    const newer = { focusVerdictBar: vi.fn() }
    rerender(<TestHarness handlers={newer} />)
    fireKey('Enter', { metaKey: true })
    expect(newer.focusVerdictBar).toHaveBeenCalledTimes(1)
    expect(handlers.focusVerdictBar).not.toHaveBeenCalled()
  })
})

const REMOVED_KEYS = [']', '[', '}', '{', 'n', 'v', 's', 'a', 'e', 'r', 'i', '?', 'g', 'd']

describe('useReviewKeys — removed keys', () => {
  it.each(REMOVED_KEYS)('does nothing on %j', (key) => {
    render(<TestHarness handlers={handlers} />)
    const stateBefore = useReviewUiStore.getState()
    const event = fireKey(key)
    expect(event.defaultPrevented).toBe(false)
    expect(useReviewUiStore.getState()).toBe(stateBefore)
  })

  it('runs no handler and changes no state on Escape', () => {
    render(<TestHarness handlers={handlers} />)
    const stateBefore = useReviewUiStore.getState()
    fireKey('Escape')
    expect(handlers.focusVerdictBar).not.toHaveBeenCalled()
    expect(useReviewUiStore.getState()).toBe(stateBefore)
  })
})

describe('useReviewKeys — typing', () => {
  it('ignores Space while typing in a textarea, and lets it type', () => {
    render(<TestHarness handlers={handlers} />)
    const listener = listenFor(REVIEW_KEY_EVENTS.markHunkRead)
    const event = fireKey(' ', {}, screen.getByTestId('text-area'))
    expect(listener).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('ignores c while typing in an input', () => {
    render(<TestHarness handlers={handlers} />)
    const listener = listenFor(REVIEW_KEY_EVENTS.comment)
    fireKey('c', {}, screen.getByTestId('text-input'))
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('useReviewKeys — modifiers and unmount', () => {
  it('ignores keys held with an unrelated modifier', () => {
    render(<TestHarness handlers={handlers} />)
    const listener = listenFor(REVIEW_KEY_EVENTS.comment)
    fireKey('c', { ctrlKey: true })
    fireKey('c', { altKey: true })
    expect(listener).not.toHaveBeenCalled()
  })

  it('unbinds the listener on unmount', () => {
    const { unmount } = render(<TestHarness handlers={handlers} />)
    unmount()
    fireKey('Enter', { metaKey: true })
    expect(handlers.focusVerdictBar).not.toHaveBeenCalled()
  })
})
