import './notepad.css'
import React, { useEffect, useState } from 'react'
import { DiagramView } from './DiagramView'

const DIAGRAM_ID = new URLSearchParams(window.location.search).get('diagramId') ?? ''

export function DiagramWindowView(_props: { repoRoot: string | null }): React.JSX.Element {
  const [title, setTitle] = useState('Diagram')

  useEffect(() => {
    if (!DIAGRAM_ID) return
    window.electronAPI.extensionBridge
      .invoke('terminator.notepad:diagrams.get', { id: DIAGRAM_ID })
      .then((result) => {
        const diagram = (result as { data?: { title: string } }).data
        if (diagram?.title) {
          setTitle(diagram.title)
          document.title = diagram.title
        }
      })
      .catch(console.error)
  }, [])

  useEffect(() => {
    document.title = title
  }, [title])

  if (!DIAGRAM_ID) {
    return <div className="notepad-window-loading">No diagram ID provided</div>
  }

  return (
    <div
      className="notepad-window"
      style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}
    >
      <DiagramView key={DIAGRAM_ID} diagramId={DIAGRAM_ID} />
    </div>
  )
}
