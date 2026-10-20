import { describe, it, expect, vi, afterEach } from 'vitest'
import { createToastStore } from '../../../../packages/extension-ui/src/toast-store'

afterEach(() => {
  vi.useRealTimers()
})

describe('createToastStore', () => {
  it('keeps the action a toast was added with', () => {
    vi.useFakeTimers()
    const store = createToastStore()
    const onSelect = vi.fn()
    store
      .getState()
      .addToast({ type: 'info', message: 'Dismissed', action: { label: 'Undo', onSelect } })
    const [toast] = store.getState().toasts
    toast.action?.onSelect()
    expect(toast.action?.label).toBe('Undo')
    expect(onSelect).toHaveBeenCalledTimes(1)
  })
})
