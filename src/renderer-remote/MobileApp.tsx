import React, { useState, useEffect } from 'react'
import {
  listWorkspaces,
  listTerminals,
  createTerminal,
  assignTerminalWorkspace,
} from './api/remote-client'
import type { Workspace, TerminalSession } from './api/remote-client'
import { MobileTerminalList } from './components/MobileTerminalList'
import { MobileTerminalView } from './components/MobileTerminalView'

type Route = { view: 'list' } | { view: 'terminal'; sessionId: string; cwd: string }

export function MobileApp() {
  const [route, setRoute] = useState<Route>({ view: 'list' })
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [terminals, setTerminals] = useState<TerminalSession[]>([])

  useEffect(() => {
    listWorkspaces()
      .then(setWorkspaces)
      .catch(() => undefined)
    listTerminals()
      .then(setTerminals)
      .catch(() => undefined)
  }, [])

  const handleSelectTerminal = ({ sessionId, cwd }: { sessionId: string; cwd: string }) => {
    setRoute({ view: 'terminal', sessionId, cwd })
  }

  const handleCreateTerminal = async (workspaceId: string, folderPath: string) => {
    try {
      const { sessionId } = await createTerminal({
        cwd: folderPath,
        tabTitle: 'Remote',
      })
      setRoute({ view: 'terminal', sessionId, cwd: folderPath })
    } catch {
      // silently ignore — toast can be added later
    }
    void workspaceId
  }

  const handleAssignWorkspace = async (sessionId: string, workspaceId: string | null) => {
    await assignTerminalWorkspace(sessionId, workspaceId).catch(() => undefined)
    listTerminals()
      .then(setTerminals)
      .catch(() => undefined)
  }

  function handleBack() {
    listTerminals()
      .then(setTerminals)
      .catch(() => undefined)
    setRoute({ view: 'list' })
  }

  if (route.view === 'terminal') {
    return <MobileTerminalView sessionId={route.sessionId} cwd={route.cwd} onBack={handleBack} />
  }

  return (
    <MobileTerminalList
      workspaces={workspaces}
      terminals={terminals}
      onSelectTerminal={handleSelectTerminal}
      onCreateTerminal={handleCreateTerminal}
      onAssignWorkspace={handleAssignWorkspace}
    />
  )
}
