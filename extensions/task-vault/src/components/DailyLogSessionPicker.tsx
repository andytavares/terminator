import React, { useEffect, useState } from 'react'
import { IconButton } from '@terminator/extension-ui'
import { X } from 'lucide-react'

interface ActiveSession {
  sessionId: string
  projectId: string
  tabTitle: string
}

interface ProjectLabel {
  wsName: string
  projName: string
}

/** The session a task is linked to. */
export interface SessionChoice {
  sessionId: string
  projectId: string
}

interface SessionPickerProps {
  onSelect: (session: SessionChoice) => void
  onClose: () => void
}

/** Every project's workspace and project name, by project id. */
async function loadProjectLabels(
  workspaces: { id: string; name: string }[]
): Promise<Map<string, ProjectLabel>> {
  const labels = new Map<string, ProjectLabel>()
  await Promise.all(
    workspaces.map(async (ws) => {
      const { projects } = await window.electronAPI.project.list(ws.id)
      for (const p of projects) labels.set(p.id, { wsName: ws.name, projName: p.name })
    })
  )
  return labels
}

/** The open terminal sessions and the labels to show them by. */
function useSessions() {
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([])
  const [projectLabels, setProjectLabels] = useState<Map<string, ProjectLabel>>(new Map())
  useEffect(() => {
    async function load() {
      const [sessions, wsResult] = await Promise.all([
        window.electronAPI.terminal.listSessions(),
        window.electronAPI.workspace.list(),
      ])
      setActiveSessions(sessions)
      setProjectLabels(await loadProjectLabels(wsResult.workspaces))
    }
    void load()
  }, [])
  return { activeSessions, projectLabels }
}

/** Workspace › project › tab, as far as they are known; else the id's start. */
function sessionLabel(s: ActiveSession, labels: Map<string, ProjectLabel>): string {
  const ctx = labels.get(s.projectId)
  const parts = [ctx?.wsName, ctx?.projName, s.tabTitle].filter((p): p is string => !!p)
  return parts.length ? parts.join(' › ') : s.sessionId.slice(0, 8)
}

export function SessionPicker({ onSelect, onClose }: SessionPickerProps): React.JSX.Element {
  const { activeSessions, projectLabels } = useSessions()
  if (activeSessions.length === 0) {
    return (
      <span className="daily-log__link-picker">
        <span className="tv-text-muted-sm">No active terminal sessions.</span>
        <IconButton icon={X} label="Close" size="sm" onClick={onClose} />
      </span>
    )
  }
  const choose = (id: string) => {
    const s = activeSessions.find((a) => a.sessionId === id)
    if (s) onSelect({ sessionId: s.sessionId, projectId: s.projectId })
  }
  return (
    <span className="daily-log__link-picker">
      <select onChange={(e) => choose(e.target.value)} defaultValue="">
        <option value="" disabled>
          Select a terminal session…
        </option>
        {activeSessions.map((s) => (
          <option key={s.sessionId} value={s.sessionId}>
            {sessionLabel(s, projectLabels)}
          </option>
        ))}
      </select>
      <IconButton icon={X} label="Close" size="sm" onClick={onClose} />
    </span>
  )
}
