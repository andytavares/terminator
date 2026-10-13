import React, { useEffect, useState } from 'react'

export interface TerminalSession {
  sessionId: string
  projectId: string
  tabTitle: string
}

/**
 * The open terminal sessions, read over the bridge (never from the core's
 * stores), and a label for each: workspace › project › tab. Loads while
 * `enabled`.
 */
export function useTerminalSessions(enabled: boolean): {
  sessions: TerminalSession[]
  labelOf: (session: TerminalSession) => string
} {
  const [sessions, setSessions] = useState<TerminalSession[]>([])
  const [places, setPlaces] = useState<Map<string, string[]>>(new Map())

  useEffect(() => {
    if (!enabled) return
    void window.electronAPI.terminal.listSessions().then(setSessions)
    void projectPlaces().then(setPlaces)
  }, [enabled])

  const labelOf = (s: TerminalSession): string => {
    const parts = [...(places.get(s.projectId) ?? []), s.tabTitle].filter(Boolean)
    return parts.length ? parts.join(' › ') : s.sessionId.slice(0, 8)
  }
  return { sessions, labelOf }
}

/** For each project id, its workspace's name and its own. */
async function projectPlaces(): Promise<Map<string, string[]>> {
  const { workspaces } = await window.electronAPI.workspace.list()
  const places = new Map<string, string[]>()
  await Promise.all(
    workspaces.map(async (ws) => {
      const { projects } = await window.electronAPI.project.list(ws.id)
      for (const p of projects) places.set(p.id, [ws.name, p.name].filter(Boolean))
    })
  )
  return places
}

/** The options of a terminal-session select: a disabled placeholder, then one per session. */
export function SessionOptions({
  sessions,
  labelOf,
  placeholder,
}: {
  sessions: TerminalSession[]
  labelOf: (session: TerminalSession) => string
  placeholder: string
}): React.JSX.Element {
  return (
    <>
      <option value="" disabled>
        {placeholder}
      </option>
      {sessions.map((s) => (
        <option key={s.sessionId} value={s.sessionId}>
          {labelOf(s)}
        </option>
      ))}
    </>
  )
}
