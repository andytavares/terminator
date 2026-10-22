import React, { useRef } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { useDismissible } from '../../../../packages/extension-ui/src/useDismissible'
import { MODAL_DEPTH_KEY } from '../../../../packages/extension-ui/src/modal-depth'

// The behaviour half of a dismissible surface, for the panels that already have
// a layout worth keeping and were only ever missing the behaviour.

function Panel({
  onDismiss,
  manageFocus,
  closeOnOutsideClick,
}: {
  onDismiss: () => void
  manageFocus?: boolean
  closeOnOutsideClick?: boolean
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useDismissible({ ref, onDismiss, manageFocus, closeOnOutsideClick })
  return (
    <div ref={ref} data-tmui-surface="">
      <button type="button">Inside</button>
    </div>
  )
}

// The outside-click listener binds a timer tick after mount: the tests run that tick by hand.
beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

const settle = () =>
  act(() => {
    vi.advanceTimersByTime(0)
  })

describe('useDismissible', () => {
  it('closes on Escape', () => {
    const onDismiss = vi.fn()
    render(<Panel onDismiss={onDismiss} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('ignores other keys', () => {
    const onDismiss = vi.fn()
    render(<Panel onDismiss={onDismiss} />)
    fireEvent.keyDown(document, { key: 'a' })
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('closes on an outside click', async () => {
    const onDismiss = vi.fn()
    render(<Panel onDismiss={onDismiss} />)
    await settle()
    fireEvent.mouseDown(document.body)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('stays open on a click inside', async () => {
    const onDismiss = vi.fn()
    render(<Panel onDismiss={onDismiss} />)
    await settle()
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Inside' }))
    expect(onDismiss).not.toHaveBeenCalled()
  })
})

describe('useDismissible — leaves the outside click alone when the surface owns its own', () => {
  it('leaves the outside click alone when the surface owns its own', async () => {
    const onDismiss = vi.fn()
    render(<Panel onDismiss={onDismiss} closeOnOutsideClick={false} />)
    await settle()
    fireEvent.mouseDown(document.body)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('returns focus to whatever opened it', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const { unmount } = render(<Panel onDismiss={() => {}} />)
    expect(document.activeElement).not.toBe(opener)
    unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('leaves focus alone when asked to', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    render(<Panel onDismiss={() => {}} manageFocus={false} />)
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})

function EmptyPanel(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useDismissible({ ref, onDismiss: () => {} })
  return <div ref={ref} data-tmui-surface="" tabIndex={-1} aria-label="Legend" role="group" />
}

describe('useDismissible — where focus goes', () => {
  it('focuses the surface itself when it holds nothing focusable', () => {
    render(<EmptyPanel />)
    expect(document.activeElement).toBe(screen.getByRole('group', { name: 'Legend' }))
  })

  // Inside a modal shell the key's default asks the dialog to close as well.
  it('prevents the default of the Escape it answers', () => {
    render(<Panel onDismiss={() => {}} />)
    expect(fireEvent.keyDown(document.body, { key: 'Escape' })).toBe(false)
  })
})

describe('useDismissible — counts toward the open-surface depth', () => {
  it('counts toward the open-surface depth', () => {
    delete window[MODAL_DEPTH_KEY]
    const { unmount } = render(<Panel onDismiss={() => {}} />)
    expect(window[MODAL_DEPTH_KEY]).toBe(1)
    unmount()
    expect(window[MODAL_DEPTH_KEY]).toBe(0)
  })

  // A picker opened inside a dialog must not take the dialog down with it.
  it('only the surface opened last answers Escape', () => {
    const outer = vi.fn()
    const inner = vi.fn()
    render(
      <>
        <Panel onDismiss={outer} />
        <Panel onDismiss={inner} />
      </>
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(inner).toHaveBeenCalledTimes(1)
    expect(outer).not.toHaveBeenCalled()
  })
})

// An anchored popover has to treat its own trigger as inside, or clicking the
// trigger to close it dismisses and immediately reopens.
describe('a re-rendered onDismiss', () => {
  it('is the one called on Escape and on an outside click', async () => {
    const first = vi.fn()
    const latest = vi.fn()
    const view = render(<Panel onDismiss={first} />)
    await settle()
    view.rerender(<Panel onDismiss={latest} />)

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.mouseDown(document.body)

    expect(latest).toHaveBeenCalledTimes(2)
    expect(first).not.toHaveBeenCalled()
  })

  it('does not rebind the document listeners when only the callback changes', async () => {
    const add = vi.spyOn(document, 'addEventListener')
    const view = render(<Panel onDismiss={vi.fn()} />)
    await settle()
    const bound = add.mock.calls.length
    view.rerender(<Panel onDismiss={vi.fn()} />)
    await settle()
    expect(add.mock.calls.length).toBe(bound)
    add.mockRestore()
  })
})

function Anchored({ onDismiss }: { onDismiss: () => void }): JSX.Element {
  const trigger = useRef<HTMLButtonElement>(null)
  const surface = useRef<HTMLDivElement>(null)
  useDismissible({ ref: surface, onDismiss, alsoInside: [trigger] })
  return (
    <>
      <button type="button" ref={trigger}>
        Open
      </button>
      <div ref={surface} data-tmui-surface="">
        <button type="button">Inside</button>
      </div>
    </>
  )
}

describe('alsoInside', () => {
  it('treats a click on the trigger as inside', async () => {
    const onDismiss = vi.fn()
    render(<Anchored onDismiss={onDismiss} />)
    await settle()
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Open' }))
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('still closes on a click that is outside both', async () => {
    const onDismiss = vi.fn()
    render(<Anchored onDismiss={onDismiss} />)
    await settle()
    fireEvent.mouseDown(document.body)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})

describe('enabled', () => {
  it('binds nothing while the surface is closed', () => {
    delete window[MODAL_DEPTH_KEY]
    const onDismiss = vi.fn()
    function Closed(): JSX.Element {
      const ref = useRef<HTMLDivElement>(null)
      useDismissible({ ref, onDismiss, enabled: false })
      return <div ref={ref} />
    }
    render(<Closed />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onDismiss).not.toHaveBeenCalled()
    expect(window[MODAL_DEPTH_KEY] ?? 0).toBe(0)
  })
})
