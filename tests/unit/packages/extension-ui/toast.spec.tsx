import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { Toast, ToastRegion } from '../../../../packages/extension-ui/src/Toast'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('Toast', () => {
  it('announces politely rather than taking focus', () => {
    render(<Toast message="Saved" onDismiss={vi.fn()} />)
    // role="status" is what lets a toast appear over an open dialog without
    // interrupting whoever is typing in it.
    expect(screen.getByRole('status')).toBeTruthy()
    expect(document.activeElement).toBe(document.body)
  })

  it('dismisses itself after its duration', () => {
    const onDismiss = vi.fn()
    render(<Toast message="Saved" duration={1000} onDismiss={onDismiss} />)
    expect(onDismiss).not.toHaveBeenCalled()
    act(() => void vi.advanceTimersByTime(1000))
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('leaves an error on screen, because it is the one you have to read', () => {
    const onDismiss = vi.fn()
    render(<Toast message="Could not save" tone="error" onDismiss={onDismiss} />)
    act(() => void vi.advanceTimersByTime(60_000))
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('lets the caller own dismissal with a zero duration', () => {
    const onDismiss = vi.fn()
    render(<Toast message="Saved" duration={0} onDismiss={onDismiss} />)
    act(() => void vi.advanceTimersByTime(60_000))
    expect(onDismiss).not.toHaveBeenCalled()
  })

  /**
   * The container this replaced made the whole toast a click target with
   * nothing on screen to say so — an affordance the reader cannot see is one
   * they will not use, and one they will hit reaching for the dismiss.
   */
  it('offers somewhere to go as a named button', () => {
    const onSelect = vi.fn()
    render(
      <Toast
        message="Completed: write the spec"
        action={{ label: 'View', onSelect }}
        onDismiss={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'View' }))
    expect(onSelect).toHaveBeenCalledOnce()
  })

  it('has no action button when there is nowhere to go', () => {
    render(<Toast message="Saved" onDismiss={vi.fn()} />)
    expect(screen.getAllByRole('button')).toHaveLength(1) // dismiss only
  })
})

describe('ToastRegion', () => {
  it('renders nothing when there is nothing to say', () => {
    const { container } = render(<ToastRegion toasts={[]} onDismiss={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('dismisses the toast that was closed, not the first one', () => {
    const onDismiss = vi.fn()
    render(
      <ToastRegion
        toasts={[
          { id: 'a', message: 'First' },
          { id: 'b', message: 'Second' },
        ]}
        onDismiss={onDismiss}
      />
    )
    fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss' })[1])
    expect(onDismiss).toHaveBeenCalledWith('b')
  })

  it('sits above every other layer, modals included', () => {
    const { container } = render(
      <ToastRegion toasts={[{ id: 'a', message: 'Saved' }]} onDismiss={vi.fn()} />
    )
    const region = container.querySelector('.tmui-toast-region') as HTMLElement
    expect(Number(region.style.zIndex)).toBe(400)
  })
})
