import React from 'react'
import { describe, it, expect, vi, beforeEach, onTestFinished, type Mock } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useReviewKeys, type ReviewKeyHandlers } from '../../src/hooks/useReviewKeys'
import { useReviewUiStore, REVIEW_KEY_EVENTS } from '../../src/stores/review-ui.store'

function TestHarness({ handlers }: { handlers: Parameters<typeof useReviewKeys>[0] }) {
  useReviewKeys(handlers)
  return (
    <div>
      <input data-testid="text-input" />
    </div>
  )
}

function fireKey(key: string, opts: Partial<KeyboardEventInit> = {}, target?: EventTarget) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts })
  ;(target ?? window).dispatchEvent(event)
}

function listenFor(type: string) {
  const listener = vi.fn()
  window.addEventListener(type, listener)
  onTestFinished(() => window.removeEventListener(type, listener))
  return listener
}

let handlers: Record<Exclude<keyof ReviewKeyHandlers, 'toggleFileList'>, Mock<() => void>>

beforeEach(() => {
  handlers = {
    nextFile: vi.fn<() => void>(),
    prevFile: vi.fn<() => void>(),
    nextChapter: vi.fn<() => void>(),
    prevChapter: vi.fn<() => void>(),
    nextUnviewedFile: vi.fn<() => void>(),
    markViewed: vi.fn<() => void>(),
    toggleInsights: vi.fn<() => void>(),
    openSubmit: vi.fn<() => void>(),
  }
  useReviewUiStore.setState({
    diffRange: 'since',
    commentVisibility: 'all',
    agentNotesOn: true,
    keyboardHelpOpen: false,
    fileListHidden: false,
  })
})

describe('useReviewKeys', () => {
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
})

describe('useReviewKeys — calls the matching handler for ], [, n and v', () => {
  it.each([
    [']', 'nextFile'],
    ['[', 'prevFile'],
    ['n', 'nextUnviewedFile'],
    ['v', 'markViewed'],
  ] as const)('calls %s → %s once', (key, handlerName) => {
    render(<TestHarness handlers={handlers} />)
    fireKey(key)
    expect(handlers[handlerName]).toHaveBeenCalledTimes(1)
  })

  it('calls nextChapter on } and prevChapter on {', () => {
    render(<TestHarness handlers={handlers} />)
    fireKey('}', { shiftKey: true })
    expect(handlers.nextChapter).toHaveBeenCalledTimes(1)
    expect(handlers.prevChapter).not.toHaveBeenCalled()
    fireKey('{', { shiftKey: true })
    expect(handlers.prevChapter).toHaveBeenCalledTimes(1)
    expect(handlers.nextFile).not.toHaveBeenCalled()
  })
})

describe('useReviewKeys — calls the latest handlers after a rerender', () => {
  it('calls the handlers of the latest render', () => {
    const { rerender } = render(<TestHarness handlers={handlers} />)
    const newer = { ...handlers, nextFile: vi.fn() }
    rerender(<TestHarness handlers={newer} />)
    rerender(<TestHarness handlers={{ ...newer }} />)
    fireKey(']')
    expect(newer.nextFile).toHaveBeenCalledTimes(1)
    expect(handlers.nextFile).not.toHaveBeenCalled()
  })

  it('toggles diffRange on s and comment visibility on c', () => {
    render(<TestHarness handlers={handlers} />)
    fireKey('s')
    expect(useReviewUiStore.getState().diffRange).toBe('whole')
    fireKey('c')
    expect(useReviewUiStore.getState().commentVisibility).toBe('unresolved')
  })

  it('toggles agentNotesOn on shift+C', () => {
    render(<TestHarness handlers={handlers} />)
    fireKey('C', { shiftKey: true })
    expect(useReviewUiStore.getState().agentNotesOn).toBe(false)
  })
})

describe('useReviewKeys — opens the keyboard help sheet on ?', () => {
  it('opens the keyboard help sheet on ?', () => {
    render(<TestHarness handlers={handlers} />)
    fireKey('?')
    expect(useReviewUiStore.getState().keyboardHelpOpen).toBe(true)
  })

  it('opens submit on Cmd+Enter', () => {
    render(<TestHarness handlers={handlers} />)
    fireKey('Enter', { metaKey: true })
    expect(handlers.openSubmit).toHaveBeenCalledTimes(1)
  })

  it('calls toggleInsights on i', () => {
    render(<TestHarness handlers={handlers} />)
    fireKey('i')
    expect(handlers.toggleInsights).toHaveBeenCalledTimes(1)
  })
})

describe('useReviewKeys — dispatches peekDefinition when g then d within 1s', () => {
  it('dispatches peekDefinition when g then d within 1s', () => {
    render(<TestHarness handlers={handlers} />)
    const spy = listenFor(REVIEW_KEY_EVENTS.peekDefinition)
    fireKey('g')
    fireKey('d')
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('useReviewKeys — dispatches askAgent, explain, comment and note events', () => {
  it.each([
    ['a', REVIEW_KEY_EVENTS.askAgent],
    ['e', REVIEW_KEY_EVENTS.explain],
    ['r', REVIEW_KEY_EVENTS.comment],
    ['m', REVIEW_KEY_EVENTS.note],
  ])('dispatches %s → %s once', (key, eventType) => {
    render(<TestHarness handlers={handlers} />)
    const listener = listenFor(eventType)
    fireKey(key)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('toggles the file list on t via the store when no override is given', () => {
    render(<TestHarness handlers={handlers} />)
    fireKey('t')
    expect(useReviewUiStore.getState().fileListHidden).toBe(true)
  })
})

describe('useReviewKeys — calls an explicit toggleFileList handler on t when given', () => {
  it('calls an explicit toggleFileList handler on t when given', () => {
    const toggleFileList = vi.fn()
    render(<TestHarness handlers={{ ...handlers, toggleFileList }} />)
    fireKey('t')
    expect(toggleFileList).toHaveBeenCalledTimes(1)
    expect(useReviewUiStore.getState().fileListHidden).toBe(false)
  })

  it('runs no handler and changes no state on Escape', () => {
    render(<TestHarness handlers={handlers} />)
    const stateBefore = useReviewUiStore.getState()
    fireKey('Escape')
    const handlersCalled = Object.entries(handlers).filter(
      ([, handler]) => handler.mock.calls.length
    )
    expect(handlersCalled).toEqual([])
    expect(useReviewUiStore.getState()).toBe(stateBefore)
  })

  it('ignores keydown while typing in an input, textarea or contenteditable', () => {
    render(<TestHarness handlers={handlers} />)
    const input = screen.getByTestId('text-input')
    fireKey('v', {}, input)
    expect(handlers.markViewed).not.toHaveBeenCalled()
  })
})

describe('useReviewKeys — ignores keys held with an unrelated modifier', () => {
  it('ignores keys held with an unrelated modifier', () => {
    render(<TestHarness handlers={handlers} />)
    fireKey('v', { ctrlKey: true })
    fireKey('v', { altKey: true })
    expect(handlers.markViewed).not.toHaveBeenCalled()
  })

  it('unbinds the listener on unmount', () => {
    const { unmount } = render(<TestHarness handlers={handlers} />)
    unmount()
    fireKey('v')
    expect(handlers.markViewed).not.toHaveBeenCalled()
  })
})
