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
  const { workspaces, terminals, refreshTerminals } = useListings()

  const handleCreateTerminal = async (_workspaceId: string, folderPath: string) => {
    const sessionId = await createTerminalInFolder(folderPath)
    if (sessionId !== null) setRoute({ view: 'terminal', sessionId, cwd: folderPath })
  }

  if (route.view === 'terminal') {
    const handleBack = () => {
      refreshTerminals()
      setRoute({ view: 'list' })
    }
    return <MobileTerminalView sessionId={route.sessionId} cwd={route.cwd} onBack={handleBack} />
  }

  return (
    <MobileTerminalList
      workspaces={workspaces}
      terminals={terminals}
      onSelectTerminal={({ sessionId, cwd }) => setRoute({ view: 'terminal', sessionId, cwd })}
      onCreateTerminal={handleCreateTerminal}
      onAssignWorkspace={async (sessionId, workspaceId) => {
        await assignTerminalWorkspace(sessionId, workspaceId).catch(() => undefined)
        refreshTerminals()
      }}
    />
  )
}

/** A new terminal in the folder, or null when the server would not make one. */
async function createTerminalInFolder(folderPath: string): Promise<string | null> {
  try {
    const { sessionId } = await createTerminal({ cwd: folderPath, tabTitle: 'Remote' })
    return sessionId
  } catch {
    // silently ignore — toast can be added later
    return null
  }
}

/** The workspaces and terminals the list shows, loaded once on mount. A failed read leaves them as they were. */
function useListings() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [terminals, setTerminals] = useState<TerminalSession[]>([])
  const refreshTerminals = () => {
    listTerminals()
      .then(setTerminals)
      .catch(() => undefined)
  }

  useEffect(() => {
    listWorkspaces()
      .then(setWorkspaces)
      .catch(() => undefined)
    listTerminals()
      .then(setTerminals)
      .catch(() => undefined)
  }, [])
  return { workspaces, terminals, refreshTerminals }
}
