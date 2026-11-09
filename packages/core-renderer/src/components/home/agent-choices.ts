import { useEffect, useState } from 'react'
import type { AgentDescriptor } from '@terminator/extension-sdk'
import { useSettingsStore } from '../../stores/settings.store'

export interface AgentChoices {
  agents: AgentDescriptor[]
  /** The agent the `agents` setting names, falling back to the built-in one. */
  defaultId: string
}

/** The agents that can be started, read once when the launcher opens. */
export function useAgentChoices(): AgentChoices {
  const [agents, setAgents] = useState<AgentDescriptor[]>([])
  const defaultId = useSettingsStore((s) => s.globalSettings?.agents.default) ?? 'claude'
  useEffect(() => {
    let current = true
    void window.electronAPI.agents
      .list()
      .then((reply) => current && 'data' in reply && setAgents(reply.data))
      // No list leaves the picker hidden and the default agent in use.
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [])
  return { agents, defaultId }
}

/** The name shown for an agent id, or the id itself when the list does not hold it. */
export function agentLabel(choices: AgentChoices, agentId: string | null): string {
  const id = agentId ?? choices.defaultId
  return choices.agents.find((a) => a.id === id)?.label ?? (id === 'claude' ? 'Claude Code' : id)
}
