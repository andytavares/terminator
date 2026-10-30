import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { usePaneWidth } from '../../src/hooks/usePaneWidth'
import { partialFake } from '../../../../tests/support/fakes'

function Pane() {
  const { paneRef, width } = usePaneWidth()
  return <div ref={paneRef}>{width === null ? 'not measured' : `${width}px`}</div>
}

/** The observers the hook made; tests/setup.ts installs one that never reports. */
const observers = new Set<{ callback: ResizeObserverCallback; targets: Set<Element> }>()

class FakeResizeObserver {
  private entry: { callback: ResizeObserverCallback; targets: Set<Element> }
  constructor(callback: ResizeObserverCallback) {
    this.entry = { callback, targets: new Set() }
    observers.add(this.entry)
  }
  observe(target: Element) {
    this.entry.targets.add(target)
  }
  unobserve(target: Element) {
    this.entry.targets.delete(target)
  }
  disconnect() {
    this.entry.targets.clear()
    observers.delete(this.entry)
  }
}

/** Reports a new content width for every observed element, as a layout change would. */
function resizeTo(width: number) {
  for (const { callback, targets } of observers) {
    const entries = [...targets].map((target) =>
      partialFake<ResizeObserverEntry>({ target, contentRect: partialFake<DOMRect>({ width }) })
    )
    callback(entries, partialFake<ResizeObserver>({}))
  }
}

beforeEach(() => {
  observers.clear()
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('usePaneWidth', () => {
  it('reports no width until the pane is measured', () => {
    render(<Pane />)
    expect(screen.getByText('not measured')).toBeTruthy()
  })

  it('reports the width the observer measures, and each later one', () => {
    render(<Pane />)
    act(() => resizeTo(1180))
    expect(screen.getByText('1180px')).toBeTruthy()
    act(() => resizeTo(760))
    expect(screen.getByText('760px')).toBeTruthy()
  })

  it('stops observing when the pane goes away', () => {
    const { unmount } = render(<Pane />)
    expect(observers.size).toBe(1)
    unmount()
    expect(observers.size).toBe(0)
  })
})
