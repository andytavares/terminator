import { useEffect } from 'react'
import { create } from 'zustand'
import { notepadSettingsFrom, type NotepadSettings } from '../notepad-settings'

/** Notepad's settings as this view last read them. */
export const useNotepadSettingsStore = create<NotepadSettings>(() => notepadSettingsFrom({}))

function loadNotepadSettings(): void {
  window.electronAPI.extension
    .getSettingsValues()
    .then(({ values }) => useNotepadSettingsStore.setState(notepadSettingsFrom(values)))
    .catch(() => {})
}

/** Reads the settings when the view mounts, and again whenever one changes in Settings. */
export function useNotepadSettings(): void {
  useEffect(() => {
    loadNotepadSettings()
    return window.electronAPI.extension.onSettingsChanged(loadNotepadSettings)
  }, [])
}
