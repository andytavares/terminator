import React, { useEffect, useState } from 'react'
import { listWorkspaces, listProjects, type Workspace, type Project } from '../api/remote-client'

interface WorkspaceNavProps {
  onOpenTerminal: (cwd: string) => void
}

export function WorkspaceNav({ onOpenTerminal }: WorkspaceNavProps): JSX.Element {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [selectedWorkspace, setSelectedWorkspace] = useState<string | null>(null)
  const [projects, setProjects] = useState<Project[]>([])

  useEffect(() => {
    listWorkspaces()
      .then(setWorkspaces)
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!selectedWorkspace) return
    listProjects(selectedWorkspace)
      .then(setProjects)
      .catch(() => {})
  }, [selectedWorkspace])

  return (
    <div style={{ width: 200, borderRight: '1px solid #333', padding: 8, overflowY: 'auto' }}>
      <strong style={{ fontSize: 11, textTransform: 'uppercase', color: '#888' }}>
        Workspaces
      </strong>
      {workspaces.map((ws) => (
        <div key={ws.id} style={{ marginTop: 4 }}>
          <button
            style={{
              background: selectedWorkspace === ws.id ? '#333' : 'transparent',
              border: 'none',
              color: '#e0e0e0',
              cursor: 'pointer',
              width: '100%',
              textAlign: 'left',
              padding: '4px 8px',
            }}
            onClick={() => setSelectedWorkspace(ws.id)}
          >
            {ws.name}
          </button>
          {selectedWorkspace === ws.id && (
            <div style={{ paddingLeft: 8 }}>
              {projects.map((p) => (
                <button
                  key={p.id}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#aaa',
                    cursor: 'pointer',
                    width: '100%',
                    textAlign: 'left',
                    padding: '2px 8px',
                    fontSize: 12,
                  }}
                  onClick={() => onOpenTerminal(p.worktreePath || ws.folderPath)}
                >
                  {p.name}
                </button>
              ))}
              <button
                style={{
                  background: 'transparent',
                  border: '1px solid #444',
                  color: '#aaa',
                  cursor: 'pointer',
                  padding: '2px 8px',
                  fontSize: 12,
                  marginTop: 4,
                }}
                onClick={() => onOpenTerminal(ws.folderPath)}
              >
                + New Terminal
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
