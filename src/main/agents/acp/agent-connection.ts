import { spawn } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { delimiter, join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { ClientSideConnection, ndJsonStream } from '@agentclientprotocol/sdk'
import { loginShellPathReady } from '../../shell/login-shell-path.js'
import type { AgentsSettings } from '../../../shared/schemas/settings.schema.js'
import { CLAUDE_AGENT_ID, resolveAgent, withClaudeExecutable } from './agent-registry.js'
import type { AgentServiceDeps } from './agent-service.js'

/** A `connect` for the agent service: starts the agent's process and speaks ACP over its
 * stdin and stdout. */
export function createConnector(settings: () => AgentsSettings): AgentServiceDeps['connect'] {
  return async ({ agentId, client }) => {
    const launch = resolveAgent(settings(), agentId)
    if (!launch) throw new Error(`There is no agent named "${agentId}"`)
    const child = spawn(launch.command, launch.args, {
      env: launch.env,
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    child.stdin.on('error', () => undefined) // The exit event reports a process that is gone.
    const stream = ndJsonStream(
      Writable.toWeb(child.stdin),
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
    )
    return {
      agent: new ClientSideConnection(() => client, stream),
      onExit(listener) {
        child.once('exit', (exitCode) => listener(exitCode))
        child.once('error', () => listener(null))
      },
      kill: () => void child.kill(),
    }
  }
}

function claudeOnPath(): string | null {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    const candidate = join(directory, 'claude')
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      // Not in this directory.
    }
  }
  return null
}

/** The built-in agent runs the user's own `claude`, found once the login-shell PATH is known. */
export async function agentMeta(request: {
  agentId: string
  meta?: Record<string, unknown>
}): Promise<Record<string, unknown>> {
  if (request.agentId !== CLAUDE_AGENT_ID) return request.meta ?? {}
  await loginShellPathReady()
  const executable = claudeOnPath()
  return executable ? withClaudeExecutable(request.meta, executable) : (request.meta ?? {})
}
