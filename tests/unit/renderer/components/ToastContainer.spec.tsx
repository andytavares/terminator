import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { useToastStore } from '../../../../src/renderer/stores/toast.store'
import { ToastContainer } from '../../../../src/renderer/components/ToastContainer'

vi.mock('../../../../src/renderer/stores/toast.store', () => ({
  useToastStore: vi.fn(),
}))

const mockRemoveToast = vi.fn()

function withToasts(toasts: { id: string; type: string; message: string }[]): void {
  vi.mocked(useToastStore).mockReturnValue({
    toasts,
    removeToast: mockRemoveToast,
  } as unknown as ReturnType<typeof useToastStore>)
}

beforeEach(() => {
  mockRemoveToast.mockReset()
  withToasts([])
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ToastContainer', () => {
  it('draws nothing when there is nothing to say', () => {
    const { container } = render(<ToastContainer />)
    expect(container.firstChild).toBeNull()
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

  it('removes the toast from the store when dismissed', () => {
    withToasts([{ id: '5', type: 'info', message: 'Test' }])
    render(<ToastContainer />)
    fireEvent.click(screen.getByLabelText('Dismiss'))
    expect(mockRemoveToast).toHaveBeenCalledWith('5')
  })

  // The store already expires a toast; a second timer in the region would
  // remove it early and twice.
  it('leaves expiry to the store', () => {
    vi.useFakeTimers()
    withToasts([{ id: '6', type: 'success', message: 'Saved' }])
    render(<ToastContainer />)
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(mockRemoveToast).not.toHaveBeenCalled()
  })
})
