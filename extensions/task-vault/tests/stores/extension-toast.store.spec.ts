import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useExtensionToastStore, addExtensionToast } from '../../src/stores/extension-toast.store'

beforeEach(() => {
  useExtensionToastStore.setState({ toasts: [] })
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useExtensionToastStore', () => {
  it('adds a toast and removes it after duration', () => {
    useExtensionToastStore.getState().addToast({ type: 'success', message: 'Done', duration: 1000 })
    expect(useExtensionToastStore.getState().toasts).toHaveLength(1)
    expect(useExtensionToastStore.getState().toasts[0]).toMatchObject({
      type: 'success',
      message: 'Done',
    })

    vi.advanceTimersByTime(1000)
    expect(useExtensionToastStore.getState().toasts).toHaveLength(0)
  })

  it('removes toast by id', () => {
    useExtensionToastStore.getState().addToast({ type: 'info', message: 'Hello' })
    const id = useExtensionToastStore.getState().toasts[0].id
    useExtensionToastStore.getState().removeToast(id)
    expect(useExtensionToastStore.getState().toasts).toHaveLength(0)
  })

  it('stores optional onClick handler', () => {
    const onClick = vi.fn()
    useExtensionToastStore.getState().addToast({ type: 'info', message: 'Click me', onClick })
    expect(useExtensionToastStore.getState().toasts[0].onClick).toBe(onClick)
  })

  it('uses 6000ms default duration for errors', () => {
    useExtensionToastStore.getState().addToast({ type: 'error', message: 'Error' })
    vi.advanceTimersByTime(5999)
    expect(useExtensionToastStore.getState().toasts).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(useExtensionToastStore.getState().toasts).toHaveLength(0)
  })

  it('uses 3500ms default duration for non-errors', () => {
    useExtensionToastStore.getState().addToast({ type: 'success', message: 'OK' })
    vi.advanceTimersByTime(3499)
    expect(useExtensionToastStore.getState().toasts).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(useExtensionToastStore.getState().toasts).toHaveLength(0)
  })
})

describe('addExtensionToast', () => {
  it('adds a toast via the store', () => {
    addExtensionToast('warning', 'Watch out')
    expect(useExtensionToastStore.getState().toasts).toHaveLength(1)
    expect(useExtensionToastStore.getState().toasts[0]).toMatchObject({
      type: 'warning',
      message: 'Watch out',
    })
  })

  it('forwards onClick', () => {
    const onClick = vi.fn()
    addExtensionToast('success', 'Done', { onClick })
    expect(useExtensionToastStore.getState().toasts[0].onClick).toBe(onClick)
  })
})
