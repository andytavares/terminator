import './notepad.css'
import React, { useEffect, useState } from 'react'
import { DiagramView } from './DiagramView'

export function DiagramWindowView(_props: { repoRoot: string | null }): React.JSX.Element {
  // Read at component init so this component is testable with a mocked location.
  const diagramId = new URLSearchParams(window.location.search).get('diagramId') ?? ''
  const [title, setTitle] = useState('Diagram')

  useEffect(() => {
    if (!diagramId) return
    window.electronAPI.extensionBridge
      .invoke('terminator.notepad:diagrams.get', { id: diagramId })
      .then((result) => {
        const diagram = (result as { data?: { title: string } }).data
        if (diagram?.title) setTitle(diagram.title)
      })
      .catch(console.error)
  }, [diagramId])

  useEffect(() => {
    document.title = title
  }, [title])

  if (!diagramId) {
    return <div className="notepad-window-loading">No diagram ID provided</div>
  }

  return (
    <div
      className="notepad-window"
      style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}
    >
      <DiagramView key={diagramId} diagramId={diagramId} />
    </div>
  )
}
