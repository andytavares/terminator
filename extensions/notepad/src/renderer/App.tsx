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

  // On first mount, check whether the shortcut fired before this view existed.
  useEffect(() => {
    window.electronAPI.extensionBridge
      .invoke('terminator.notepad:ui.consumePendingQuickCreate')
      .then((result: unknown) => {
        if ((result as { data?: { pending?: boolean } }).data?.pending) setShowQuickCreate(true)
      })
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
