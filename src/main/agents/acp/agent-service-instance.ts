import { app } from 'electron'
import { join } from 'node:path'
import { getGlobalSettings } from '../../storage/settings-store.js'
import { RETENTION_MS } from '../../../shared/session-records/retention.js'
import { createAgentLog } from './agent-log.js'
import { createConnector } from './agent-connection.js'
import { listAgents } from './agent-registry.js'
import { recordAgentTab } from './record-agent-tab.js'
import { createAgentService, type AgentService } from './agent-service.js'

let service: AgentService | undefined

/** Creates the one agent service of the app; `broadcast` reaches every window. */
export function startAgentService(
  broadcast: (channel: string, payload: unknown) => void
): AgentService {
  const userData = app.getPath('userData')
  const log = createAgentLog({ directory: join(userData, 'agent-log'), now: Date.now })
  // As long as a session record outlives its session.
  log.prune(RETENTION_MS)
  service = createAgentService({
    connect: createConnector(() => getGlobalSettings().agents),
    listAgents: () => listAgents(getGlobalSettings().agents),
    defaultAgentId: () => getGlobalSettings().agents.default,
    log,
    scratchDirectory: join(userData, 'agent-scratch'),
    scrollbackLimit: () => getGlobalSettings().terminal.scrollbackLimit,
    broadcast,
    recordTab: (session) => recordAgentTab(session, () => new Date().toISOString()),
    now: Date.now,
  })
  return service
}

export function agentService(): AgentService {
  if (!service) throw new Error('The agent service has not started')
  return service
}

/** Ends every agent process, for the app's quit. */
export async function disposeAgentService(): Promise<void> {
  await service?.disposeAll()
}
