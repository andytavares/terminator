import React, { useEffect } from 'react'
import { NotepadView } from '../components/NotepadView'
import { NoteWindowView } from '../components/NoteWindowView'
import { DiagramWindowView } from '../components/DiagramWindowView'
import { QuickCreateOverlay } from '../components/QuickCreateOverlay'
import { useNotesStore } from '../stores/notes.store'

export function App(): JSX.Element {
  const view = new URLSearchParams(window.location.search).get('view')
  useQuickCreateRequests()
  return (
    <>
      <WindowContent view={view} />
      <QuickCreateOverlay />
    </>
  )
}

/** Opens the quick-create overlay when the shortcut fires, including before this view existed. */
function useQuickCreateRequests(): void {
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
}

/** The window's own view: a note, a diagram, or the notepad panel. */
function WindowContent({ view }: { view: string | null }): JSX.Element {
  if (view === 'note') return <NoteWindowView />
  if (view === 'diagram') return <DiagramWindowView />
  return <NotepadView />
}
