import React from 'react'
import type { Workspace, TerminalSession } from '../api/remote-client'

function basename(p: string): string {
  return p.split('/').filter(Boolean).pop() ?? p
}

interface Props {
  workspaces: Workspace[]
  terminals: TerminalSession[]
  onSelectTerminal: (t: { sessionId: string; cwd: string }) => void
  onCreateTerminal: (workspaceId: string, folderPath: string) => void
}

export function MobileTerminalList({
  workspaces,
  terminals,
  onSelectTerminal,
  onCreateTerminal,
}: Props) {
  return (
    <div className="mobile-list">
      {workspaces.map((ws) => (
        <div key={ws.id} className="mobile-list__workspace">
          <p className="mobile-list__workspace-name">{ws.name}</p>
          {terminals.map((t) => (
            <div
              key={t.sessionId}
              className="mobile-list__terminal"
              role="button"
              tabIndex={0}
              onClick={() => onSelectTerminal({ sessionId: t.sessionId, cwd: t.cwd })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSelectTerminal({ sessionId: t.sessionId, cwd: t.cwd })
              }}
            >
              <span className="mobile-list__terminal-label">{basename(t.cwd)}</span>
            </div>
          ))}
          <button
            className="mobile-list__new-terminal-btn"
            onClick={() => onCreateTerminal(ws.id, ws.folderPath)}
          >
            + New Terminal
          </button>
        </div>
      ))}
    </div>
  )
}
