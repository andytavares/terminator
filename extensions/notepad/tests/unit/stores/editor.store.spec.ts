import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from '../../../src/stores/editor.store'

describe('editor.store', () => {
  beforeEach(() => {
    useEditorStore.setState({
      activeNoteId: null,
      bodyDraft: '',
      isDirty: false,
      saveStatus: 'idle',
      previewMode: true,
    })
  })

  it('starts with no active note', () => {
    expect(useEditorStore.getState().activeNoteId).toBeNull()
    expect(useEditorStore.getState().isDirty).toBe(false)
    expect(useEditorStore.getState().saveStatus).toBe('idle')
  })

  it('setActiveNote updates activeNoteId and resets draft', () => {
    useEditorStore.getState().setActiveNote('n1', '# Hello')
    const s = useEditorStore.getState()
    expect(s.activeNoteId).toBe('n1')
    expect(s.bodyDraft).toBe('# Hello')
    expect(s.isDirty).toBe(false)
    expect(s.saveStatus).toBe('idle')
  })

  it('markDirty sets isDirty true and updates bodyDraft', () => {
    useEditorStore.getState().markDirty('new content')
    expect(useEditorStore.getState().isDirty).toBe(true)
    expect(useEditorStore.getState().bodyDraft).toBe('new content')
  })

  it('markSaving sets saveStatus to saving', () => {
    useEditorStore.getState().markSaving()
    expect(useEditorStore.getState().saveStatus).toBe('saving')
  })

  it('markSaved sets saveStatus to saved and clears isDirty', () => {
    useEditorStore.getState().markDirty('x')
    useEditorStore.getState().markSaved()
    const s = useEditorStore.getState()
    expect(s.saveStatus).toBe('saved')
    expect(s.isDirty).toBe(false)
  })

  it('togglePreviewMode flips previewMode', () => {
    expect(useEditorStore.getState().previewMode).toBe(true)
    useEditorStore.getState().togglePreviewMode()
    expect(useEditorStore.getState().previewMode).toBe(false)
    useEditorStore.getState().togglePreviewMode()
    expect(useEditorStore.getState().previewMode).toBe(true)
  })
})
