import { createRequire } from 'node:module'
import type { AgentDescriptor } from '@terminator/extension-sdk'
import { envWithoutParentClaude } from '@terminator/extension-sdk/node'
import type { AgentsSettings } from '../../../shared/schemas/settings.schema.js'

export const CLAUDE_AGENT_ID = 'claude'

export interface AgentLaunch {
  command: string
  args: string[]
  env: Record<string, string>
}

const CLAUDE_LABEL = 'Claude Code'

/** The built-in agent first, unless a custom agent named `claude` replaces it. */
export function listAgents(settings: AgentsSettings): AgentDescriptor[] {
  const custom = settings.custom.map(({ id, label }) => ({ id, label }))
  const replaced = custom.some((agent) => agent.id === CLAUDE_AGENT_ID)
  return replaced ? custom : [{ id: CLAUDE_AGENT_ID, label: CLAUDE_LABEL }, ...custom]
}

/** A custom agent runs as set; the built-in one runs the Claude adapter on Electron's own Node,
 * with the user's `claude` when one was found. */
export function resolveAgent(
  settings: AgentsSettings,
  agentId: string,
  claudeExecutable: string | null = null
): AgentLaunch | null {
  const env = envWithoutParentClaude(process.env)
  const custom = settings.custom.find((agent) => agent.id === agentId)
  if (custom) return { command: custom.command, args: custom.args, env }
  if (agentId === CLAUDE_AGENT_ID) {
    const adapter = createRequire(import.meta.url)
      .resolve('@agentclientprotocol/claude-agent-acp/dist/index.js')
      // asarUnpack puts the adapter on disk, where a child process can read it.
      .replace('app.asar/', 'app.asar.unpacked/')
    // The adapter reads its binary only from this variable; a session option is overwritten.
    const executable: Record<string, string> = claudeExecutable
      ? { CLAUDE_CODE_EXECUTABLE: claudeExecutable }
      : {}
    return {
      command: process.execPath,
      args: [adapter],
      env: { ...env, ...executable, ELECTRON_RUN_AS_NODE: '1' },
    }
  }
  return null
}
