import { describe, it, expect } from 'vitest'
import { notepadSettingsFrom } from '../../src/notepad-settings'

const AUTOSAVE = 'terminator.notepad.autosaveMs'
const FONT_SIZE = 'terminator.notepad.editorFontSize'

describe('notepadSettingsFrom', () => {
  it('reads the autosave delay and the editor font size the user stored', () => {
    expect(notepadSettingsFrom({ [AUTOSAVE]: 2000, [FONT_SIZE]: 18 })).toEqual({
      autosaveMs: 2000,
      editorFontSize: 18,
    })
  })

  it('starts from 800 ms and 14 px when nothing is stored', () => {
    expect(notepadSettingsFrom({})).toEqual({ autosaveMs: 800, editorFontSize: 14 })
  })

  it('keeps each within the bounds its setting declares', () => {
    expect(notepadSettingsFrom({ [AUTOSAVE]: 0, [FONT_SIZE]: 2 })).toEqual({
      autosaveMs: 100,
      editorFontSize: 8,
    })
    expect(notepadSettingsFrom({ [AUTOSAVE]: 99999, [FONT_SIZE]: 90 })).toEqual({
      autosaveMs: 10000,
      editorFontSize: 32,
    })
  })

  it('takes an emptied or unreadable field as its default', () => {
    expect(notepadSettingsFrom({ [AUTOSAVE]: '', [FONT_SIZE]: 'big' })).toEqual({
      autosaveMs: 800,
      editorFontSize: 14,
    })
  })
})
