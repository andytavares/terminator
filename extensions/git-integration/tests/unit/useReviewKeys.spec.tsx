import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { useReviewKeys } from '../../src/hooks/useReviewKeys'
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

describe('useReviewKeys', () => {
  let handlers: {
    nextFile: ReturnType<typeof vi.fn>
    prevFile: ReturnType<typeof vi.fn>
    nextUnviewedFile: ReturnType<typeof vi.fn>
    markViewed: ReturnType<typeof vi.fn>
    toggleInsights: ReturnType<typeof vi.fn>
    openSubmit: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    handlers = {
      nextFile: vi.fn(),
      prevFile: vi.fn(),
      nextUnviewedFile: vi.fn(),
      markViewed: vi.fn(),
      toggleInsights: vi.fn(),
      openSubmit: vi.fn(),
    }
    useReviewUiStore.setState({
      diffRange: 'since',
      commentVisibility: 'all',
      agentNotesOn: true,
      keyboardHelpOpen: false,
      fileListHidden: false,
    })
  })

  it('dispatches nextHunk on k and prevHunk on j', () => {
    render(<TestHarness handlers={handlers} />)
    const nextSpy = vi.fn()
    const prevSpy = vi.fn()
    window.addEventListener(REVIEW_KEY_EVENTS.nextHunk, nextSpy)
    window.addEventListener(REVIEW_KEY_EVENTS.prevHunk, prevSpy)
    fireKey('k')
    expect(nextSpy).toHaveBeenCalledTimes(1)
    expect(prevSpy).not.toHaveBeenCalled()
    fireKey('j')
    expect(prevSpy).toHaveBeenCalledTimes(1)
    expect(nextSpy).toHaveBeenCalledTimes(1)
    window.removeEventListener(REVIEW_KEY_EVENTS.nextHunk, nextSpy)
    window.removeEventListener(REVIEW_KEY_EVENTS.prevHunk, prevSpy)
  })

  it('calls the matching handler for ], [, n and v', () => {
    render(<TestHarness handlers={handlers} />)
    fireKey(']')
    fireKey('[')
    fireKey('n')
    fireKey('v')
    expect(handlers.nextFile).toHaveBeenCalledTimes(1)
    expect(handlers.prevFile).toHaveBeenCalledTimes(1)
    expect(handlers.nextUnviewedFile).toHaveBeenCalledTimes(1)
    expect(handlers.markViewed).toHaveBeenCalledTimes(1)
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

  it('dispatches peekDefinition when g then d within 1s', () => {
    render(<TestHarness handlers={handlers} />)
    const spy = vi.fn()
    window.addEventListener(REVIEW_KEY_EVENTS.peekDefinition, spy)
    fireKey('g')
    fireKey('d')
    expect(spy).toHaveBeenCalledTimes(1)
    window.removeEventListener(REVIEW_KEY_EVENTS.peekDefinition, spy)
  })

  it('dispatches askAgent, explain, comment and note events', () => {
    render(<TestHarness handlers={handlers} />)
    const askAgent = vi.fn()
    const explain = vi.fn()
    const comment = vi.fn()
    const note = vi.fn()
    window.addEventListener(REVIEW_KEY_EVENTS.askAgent, askAgent)
    window.addEventListener(REVIEW_KEY_EVENTS.explain, explain)
    window.addEventListener(REVIEW_KEY_EVENTS.comment, comment)
    window.addEventListener(REVIEW_KEY_EVENTS.note, note)
    fireKey('a')
    fireKey('e')
    fireKey('r')
    fireKey('m')
    expect(askAgent).toHaveBeenCalledTimes(1)
    expect(explain).toHaveBeenCalledTimes(1)
    expect(comment).toHaveBeenCalledTimes(1)
    expect(note).toHaveBeenCalledTimes(1)
  })

  it('toggles the file list on t via the store when no override is given', () => {
    render(<TestHarness handlers={handlers} />)
    fireKey('t')
    expect(useReviewUiStore.getState().fileListHidden).toBe(true)
  })

  it('calls an explicit toggleFileList handler on t when given', () => {
    const toggleFileList = vi.fn()
    render(<TestHarness handlers={{ ...handlers, toggleFileList }} />)
    fireKey('t')
    expect(toggleFileList).toHaveBeenCalledTimes(1)
    expect(useReviewUiStore.getState().fileListHidden).toBe(false)
  })

  it('never binds Escape', () => {
    render(<TestHarness handlers={handlers} />)
    fireKey('Escape')
    expect(useReviewUiStore.getState().keyboardHelpOpen).toBe(false)
  })

  it('ignores keydown while typing in an input, textarea or contenteditable', () => {
    const { getByTestId } = render(<TestHarness handlers={handlers} />)
    const input = getByTestId('text-input')
    fireKey('v', {}, input)
    expect(handlers.markViewed).not.toHaveBeenCalled()
  })

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
