import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { notepadSettingsFrom } from '../../src/notepad-settings'
import { useNotepadSettings, useNotepadSettingsStore } from '../../src/stores/settings.store'

const getSettingsValues = vi.fn()
const changeListeners = new Set<() => void>()
const fakeOnSettingsChanged = (handler: () => void) => {
  changeListeners.add(handler)
  return () => void changeListeners.delete(handler)
}

beforeEach(() => {
  changeListeners.clear()
  useNotepadSettingsStore.setState(notepadSettingsFrom({}))
  Object.defineProperty(window, 'electronAPI', {
    value: { extension: { getSettingsValues, onSettingsChanged: fakeOnSettingsChanged } },
    writable: true,
    configurable: true,
  })
})

describe('useNotepadSettings', () => {
  it('loads the stored settings when the view mounts', async () => {
    getSettingsValues.mockResolvedValue({ values: { 'terminator.notepad.editorFontSize': 20 } })
    renderHook(() => useNotepadSettings())
    await vi.waitFor(() => expect(useNotepadSettingsStore.getState().editorFontSize).toBe(20))
  })

  it('reads them again when a setting changes in Settings', async () => {
    getSettingsValues.mockResolvedValue({ values: {} })
    renderHook(() => useNotepadSettings())
    await vi.waitFor(() => expect(getSettingsValues).toHaveBeenCalled())
    getSettingsValues.mockResolvedValue({ values: { 'terminator.notepad.autosaveMs': 3000 } })
    act(() => changeListeners.forEach((listener) => listener()))
    await vi.waitFor(() => expect(useNotepadSettingsStore.getState().autosaveMs).toBe(3000))
  })

  it('stops listening when the view goes away', () => {
    getSettingsValues.mockResolvedValue({ values: {} })
    const { unmount } = renderHook(() => useNotepadSettings())
    unmount()
    expect(changeListeners.size).toBe(0)
  })
})
