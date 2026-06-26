import React, { useEffect } from 'react'
import { NotepadView } from '../components/NotepadView'
import { NoteWindowView } from '../components/NoteWindowView'
import { DiagramWindowView } from '../components/DiagramWindowView'
import { QuickCreateOverlay } from '../components/QuickCreateOverlay'
import { useNotesStore } from '../stores/notes.store'

export function App(): JSX.Element {
  const view = new URLSearchParams(window.location.search).get('view')
  const { setShowQuickCreate } = useNotesStore()

  useEffect(() => {
    const off = window.electronAPI.extensionBridge.on('terminator.notepad:ui.openQuickCreate', () =>
      setShowQuickCreate(true)
    )
    return off
  }, [setShowQuickCreate])

  let content: React.ReactElement
  if (view === 'note') {
    content = <NoteWindowView />
  } else if (view === 'diagram') {
    content = <DiagramWindowView />
  } else {
    content = <NotepadView />
  }

  return (
    <>
      {content}
      <QuickCreateOverlay />
    </>
  )
}
