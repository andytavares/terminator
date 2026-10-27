import { spawn, type ChildProcess } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { delimiter, join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { ClientSideConnection, ndJsonStream } from '@agentclientprotocol/sdk'
import { loginShellPathReady } from '../../shell/login-shell-path.js'
import type { AgentsSettings } from '../../../shared/schemas/settings.schema.js'
import { CLAUDE_AGENT_ID, resolveAgent } from './agent-registry.js'
import type { AgentServiceDeps } from './agent-service.js'

/** A `connect` for the agent service: starts the agent's process and speaks ACP over its
 * stdin and stdout. */
export function createConnector(settings: () => AgentsSettings): AgentServiceDeps['connect'] {
  return async ({ agentId, client }) => {
    const launch = resolveAgent(settings(), agentId, await claudeFor(agentId))
    if (!launch) throw new Error(`There is no agent named "${agentId}"`)
    const child = spawn(launch.command, launch.args, {
      env: launch.env,
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    child.stdin.on('error', () => undefined) // The exit event reports a process that is gone.
    const exited = exitOf(child)
    const stream = ndJsonStream(
      Writable.toWeb(child.stdin),
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
    )
    return {
      agent: new ClientSideConnection(() => client, stream),
      onExit: (listener) => void exited.then(listener),
      kill: () => void child.kill(),
    }
  }
}

/** The exit code, or null for a process that could not start. Listened to at once: a spawn
 * error with no listener would throw in the main process. */
function exitOf(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => {
    child.once('exit', (exitCode) => resolve(exitCode))
    child.once('error', () => resolve(null))
  })
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

/** The user's own `claude` for the built-in agent, found once the login-shell PATH is known. */
async function claudeFor(agentId: string): Promise<string | null> {
  if (agentId !== CLAUDE_AGENT_ID) return null
  await loginShellPathReady()
  return claudeOnPath()
}
