import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAgentLog } from '../../src/main/agents/acp/agent-log'
import { createConnector } from '../../src/main/agents/acp/agent-connection'
import { createAgentService, type AgentService } from '../../src/main/agents/acp/agent-service'
import { proposalJsonSchema } from '../../extensions/foundry/src/order/proposal'
import { roleSettings, type RoleFacts } from '../../extensions/foundry/src/runtime/role-settings'
import {
  agentStartInput,
  type StartSupervisedRunOptions,
} from '../../extensions/foundry/src/runtime/supervised-runner'
import { makeTempDir, removeTempDirs } from '../support/temp-dir'

// Each role's real start options against the real adapter and the signed-in `claude`, closed before
// any prompt, so it costs no model tokens. Run with `npm run test:live`.

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('../../src/main/logger', () => ({
  makeLogger: () => ({ error: console.error, warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}))
vi.mock('../../src/main/agents/ask-watcher', () => ({ raiseAsk: vi.fn(), clearAsk: vi.fn() }))

const NOTHING_ELSE = {
  autonomy: 'standard',
  letModeDecide: false,
  outputsDir: null,
  skillsMount: null,
  mayUseTool: () => true,
  probedCommands: [],
  readOnlyTools: [],
} as const

// The facts each role launches with (forge/intake-turn.ts `readOnlyTurn`, line/node-session.ts `settingsOf`).
const ROLES: Record<string, { facts: Partial<RoleFacts>; outputSchema?: object }> = {
  architect: {
    facts: { readOnly: true, docsOnly: false, restrictedWrites: true, outputPath: null },
    outputSchema: proposalJsonSchema(),
  },
  scout: {
    facts: {
      readOnly: true,
      docsOnly: false,
      restrictedWrites: true,
      outputPath: '/tmp/scout.json',
    },
  },
  'red team': {
    facts: {
      readOnly: true,
      docsOnly: false,
      restrictedWrites: true,
      outputPath: '/tmp/redteam.json',
    },
  },
  builder: {
    facts: { readOnly: false, docsOnly: false, restrictedWrites: false, outputPath: null },
  },
  verifier: {
    facts: { readOnly: true, docsOnly: false, restrictedWrites: false, outputPath: null },
  },
  inspector: {
    facts: {
      readOnly: true,
      docsOnly: false,
      restrictedWrites: true,
      outputPath: '/tmp/findings.json',
    },
  },
  scribe: {
    facts: { readOnly: false, docsOnly: true, restrictedWrites: false, outputPath: null },
  },
}

function newService(): AgentService {
  return createAgentService({
    connect: createConnector(() => ({ default: 'claude', custom: [] })),
    listAgents: () => [],
    defaultAgentId: () => 'claude',
    log: createAgentLog({ directory: makeTempDir('foundry-live-log-'), now: Date.now }),
    scratchDirectory: makeTempDir('foundry-live-scratch-'),
    scrollbackLimit: () => 1000,
    broadcast: () => undefined,
    recordTab: () => undefined,
    now: Date.now,
  })
}

function gitRepo(): string {
  const dir = makeTempDir('foundry-live-repo-')
  execFileSync('git', ['init', '-q'], { cwd: dir })
  writeFileSync(join(dir, 'README.md'), 'live test\n')
  return dir
}

const services: AgentService[] = []
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.disposeAll()))
  removeTempDirs()
})

describe('Foundry roles start against the real Claude adapter', () => {
  it.each(Object.entries(ROLES))('%s', async (title, { facts, outputSchema }) => {
    const { permissionMode, settings } = roleSettings({
      ...NOTHING_ELSE,
      ...facts,
    } as RoleFacts)
    const start = {
      worktreePath: gitRepo(),
      title,
      model: 'haiku',
      mode: permissionMode,
      settings,
      outputSchema,
    } as unknown as StartSupervisedRunOptions
    const service = newService()
    services.push(service)

    const started = await service.start(agentStartInput(start, 'live-project'))

    expect(started, `${title} (mode ${permissionMode}) did not start`).not.toBeNull()
    await service.close(started!.sessionId)
  })
})
