/** The bounds and defaults the settings page declares, and the views apply. */
export const NOTEPAD_SETTING_BOUNDS = {
  autosaveMs: { default: 800, min: 100, max: 10_000 },
  editorFontSize: { default: 14, min: 8, max: 32 },
} as const

export interface NotepadSettings {
  /** How long typing must pause before a note is written. */
  autosaveMs: number
  /** The editor's text size in pixels. */
  editorFontSize: number
}

type Bounds = (typeof NOTEPAD_SETTING_BOUNDS)[keyof typeof NOTEPAD_SETTING_BOUNDS]

/** The settings page stores what was typed, so an empty or out-of-range entry lands here. */
function withinBounds(stored: unknown, bounds: Bounds): number {
  const value = Number(stored)
  if (stored === '' || stored === undefined || !Number.isFinite(value)) return bounds.default
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(value)))
}

/** Notepad's settings from the stored values, each defaulted and kept within its bounds. */
export function notepadSettingsFrom(values: Record<string, unknown>): NotepadSettings {
  return {
    autosaveMs: withinBounds(
      values['terminator.notepad.autosaveMs'],
      NOTEPAD_SETTING_BOUNDS.autosaveMs
    ),
    editorFontSize: withinBounds(
      values['terminator.notepad.editorFontSize'],
      NOTEPAD_SETTING_BOUNDS.editorFontSize
    ),
  }
}
