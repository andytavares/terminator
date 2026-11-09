import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { QueuedToast as Toast } from '@terminator/extension-ui'
import { useToastStore } from '../../../../src/stores/toast.store'
import { ToastContainer } from '../../../../src/components/ToastContainer'
import { useBugReportStore } from '../../../../src/stores/bug-report.store'
import { installElectronApi } from '../../../../../test-support/src/electron-api'

function withToasts(toasts: Array<Omit<Toast, 'duration'>>): void {
  useToastStore.setState({ toasts: toasts.map((toast) => ({ ...toast, duration: 3500 })) })
}

beforeEach(() => {
  withToasts([])
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ToastContainer', () => {
  it('draws nothing when there is nothing to say', () => {
    const { container } = render(<ToastContainer />)
    expect(container.innerHTML).toBe('')
  })

  it('announces each message politely, with its tone', () => {
    withToasts([
      { id: '1', type: 'info', message: 'First' },
      { id: '2', type: 'error', message: 'Second' },
    ])
    render(<ToastContainer />)
    const toasts = screen.getAllByRole('status')
    expect(toasts.map((toast) => toast.textContent)).toEqual(['First', 'Second'])
    expect(toasts.map((toast) => toast.getAttribute('data-tone'))).toEqual(['info', 'error'])
  })

  it('removes the toast from the store when dismissed', async () => {
    const user = userEvent.setup()
    withToasts([{ id: '5', type: 'info', message: 'Test' }])
    render(<ToastContainer />)
    await user.click(screen.getByLabelText('Dismiss'))
    expect(useToastStore.getState().toasts).toEqual([])
    expect(screen.queryByText('Test')).toBeNull()
  })
})

describe('ToastContainer — action', () => {
  it('draws the toast action and runs it when clicked', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    withToasts([
      { id: '7', type: 'info', message: 'Dismissed', action: { label: 'Undo', onSelect } },
    ])
    render(<ToastContainer />)
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })
})

describe('ToastContainer — leaves expiry to the store', () => {
  // The store already expires a toast; a second timer in the region would
  // remove it early and twice.
  it('leaves expiry to the store', () => {
    vi.useFakeTimers()
    withToasts([{ id: '6', type: 'success', message: 'Saved' }])
    render(<ToastContainer />)
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.getByText('Saved')).toBeTruthy()
  })
})

describe('ToastContainer — report an error', () => {
  it('offers to report an error, starting the report with what the toast said', async () => {
    const user = userEvent.setup()
    installElectronApi({ bugReport: { capture: vi.fn() } })
    useBugReportStore.setState(useBugReportStore.getInitialState())
    withToasts([{ id: '9', type: 'error', message: 'Push failed' }])
    render(<ToastContainer />)

    await user.click(screen.getByRole('button', { name: 'Report' }))

    expect(useBugReportStore.getState()).toMatchObject({
      isOpen: true,
      prefill: 'The app said: Push failed\n\n',
    })
  })

  it('offers no report for an info toast, or where bug reports do not exist', () => {
    installElectronApi({})
    withToasts([
      { id: '1', type: 'info', message: 'Copied' },
      { id: '2', type: 'error', message: 'Push failed' },
    ])
    render(<ToastContainer />)

    expect(screen.queryByRole('button', { name: 'Report' })).toBeNull()
  })
})
