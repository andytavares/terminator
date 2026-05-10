import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useToastStore } from '../../../../src/renderer/stores/toast.store'
import { ToastContainer } from '../../../../src/renderer/components/ToastContainer'

vi.mock('../../../../src/renderer/stores/toast.store', () => ({
  useToastStore: vi.fn(),
}))

const mockRemoveToast = vi.fn()

beforeEach(() => {
  vi.mocked(useToastStore).mockReturnValue({
    toasts: [],
    removeToast: mockRemoveToast,
  } as unknown as ReturnType<typeof useToastStore>)
})

describe('ToastContainer', () => {
  it('renders empty container with no toasts', () => {
    const { container } = render(<ToastContainer />)
    expect(container.querySelector('.toast-container')).toBeTruthy()
    expect(container.querySelectorAll('.toast').length).toBe(0)
  })

  it('renders info toast', () => {
    vi.mocked(useToastStore).mockReturnValue({
      toasts: [{ id: '1', type: 'info', message: 'Hello world' }],
      removeToast: mockRemoveToast,
    } as unknown as ReturnType<typeof useToastStore>)
    render(<ToastContainer />)
    expect(screen.getByText('Hello world')).toBeTruthy()
    expect(screen.getByText('ℹ')).toBeTruthy()
  })

  it('renders success toast', () => {
    vi.mocked(useToastStore).mockReturnValue({
      toasts: [{ id: '2', type: 'success', message: 'Done!' }],
      removeToast: mockRemoveToast,
    } as unknown as ReturnType<typeof useToastStore>)
    render(<ToastContainer />)
    expect(screen.getByText('Done!')).toBeTruthy()
    expect(screen.getByText('✓')).toBeTruthy()
  })

  it('renders error toast', () => {
    vi.mocked(useToastStore).mockReturnValue({
      toasts: [{ id: '3', type: 'error', message: 'Failed!' }],
      removeToast: mockRemoveToast,
    } as unknown as ReturnType<typeof useToastStore>)
    render(<ToastContainer />)
    expect(screen.getByText('Failed!')).toBeTruthy()
  })

  it('renders warning toast', () => {
    vi.mocked(useToastStore).mockReturnValue({
      toasts: [{ id: '4', type: 'warning', message: 'Careful!' }],
      removeToast: mockRemoveToast,
    } as unknown as ReturnType<typeof useToastStore>)
    render(<ToastContainer />)
    expect(screen.getByText('Careful!')).toBeTruthy()
    expect(screen.getByText('⚠')).toBeTruthy()
  })

  it('calls removeToast when dismiss button is clicked', () => {
    vi.mocked(useToastStore).mockReturnValue({
      toasts: [{ id: '5', type: 'info', message: 'Test' }],
      removeToast: mockRemoveToast,
    } as unknown as ReturnType<typeof useToastStore>)
    render(<ToastContainer />)
    fireEvent.click(screen.getByLabelText('Dismiss'))
    expect(mockRemoveToast).toHaveBeenCalledWith('5')
  })

  it('renders multiple toasts', () => {
    vi.mocked(useToastStore).mockReturnValue({
      toasts: [
        { id: '1', type: 'info', message: 'First' },
        { id: '2', type: 'error', message: 'Second' },
      ],
      removeToast: mockRemoveToast,
    } as unknown as ReturnType<typeof useToastStore>)
    const { container } = render(<ToastContainer />)
    expect(container.querySelectorAll('.toast').length).toBe(2)
  })
})
