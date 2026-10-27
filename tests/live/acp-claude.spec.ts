import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentPermissionAsk } from '@terminator/extension-sdk'
import { createAgentLog } from '../../src/main/agents/acp/agent-log'
import { createConnector } from '../../src/main/agents/acp/agent-connection'
import { createAgentService, type AgentService } from '../../src/main/agents/acp/agent-service'
import { makeTempDir, removeTempDirs } from '../support/temp-dir'

// The real Claude Code adapter and the user's own `claude`, signed in. Run with `npm run test:live`.
// Costs a few cents: the model is haiku.

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('../../src/main/logger', () => ({
  makeLogger: () => ({ error: console.error, warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}))
vi.mock('../../src/main/agents/ask-watcher', () => ({ raiseAsk: vi.fn(), clearAsk: vi.fn() }))

const META = { claudeCode: { options: { model: 'haiku' } } }

function serviceFor(): AgentService {
  return createAgentService({
    connect: createConnector(() => ({ default: 'claude', custom: [] })),
    listAgents: () => [],
    defaultAgentId: () => 'claude',
    log: createAgentLog({ directory: makeTempDir('acp-live-log-'), now: Date.now }),
    scratchDirectory: makeTempDir('acp-live-scratch-'),
    scrollbackLimit: () => 1000,
    broadcast: () => undefined,
    recordTab: () => undefined,
    now: Date.now,
  })
}

function gitRepo(): string {
  const dir = makeTempDir('acp-live-repo-')
  execFileSync('git', ['init', '-q'], { cwd: dir })
  writeFileSync(join(dir, 'README.md'), 'live test\n')
  return dir
}

const services: AgentService[] = []
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.disposeAll()))
  removeTempDirs()
})

function newService(): AgentService {
  const service = serviceFor()
  services.push(service)
  return service
}

async function startedIn(
  service: AgentService,
  input: { cwd: string; mode: string; resume?: string }
) {
  const started = await service.start({ ...input, agentMeta: META })
  if (!started) throw new Error('Claude did not start; is `claude` installed and signed in?')
  return started
}

describe('Claude Code over ACP', () => {
  it('asks before an edit, and a rejected edit writes nothing', async () => {
    const service = newService()
    const cwd = gitRepo()
    const { sessionId } = await startedIn(service, { cwd, mode: 'default' })
    const asked = new Promise<AgentPermissionAsk>((resolve) =>
      service.onPermission(sessionId, resolve)
    )
    const turn = service.prompt(
      sessionId,
      'Create a file named note.txt containing "hi". Use the Write tool.'
    )
    const ask = await asked
    expect(ask.kind).toBe('edit')
    const reject = ask.options.find((option) => option.kind === 'reject_once')
    expect(await service.answer(sessionId, ask.requestId, reject!.optionId)).toBe(true)
    await turn
    expect(existsSync(join(cwd, 'note.txt'))).toBe(false)
  })
})

describe('Claude Code over ACP — cancel and resume', () => {
  it('cancels a running command', async () => {
    const service = newService()
    const { sessionId } = await startedIn(service, { cwd: gitRepo(), mode: 'auto' })
    const running = new Promise<void>((resolve) => {
      service.onUpdate(sessionId, (update) => update.sessionUpdate === 'tool_call' && resolve())
    })
    const turn = service.prompt(sessionId, 'Run `sleep 20` with the Bash tool and wait for it.')
    await running
    service.cancel(sessionId)
    expect(await turn).toEqual({ stopReason: 'cancelled' })
  })

  it('resumes a closed session with its memory', async () => {
    const service = newService()
    const cwd = gitRepo()
    const first = await startedIn(service, { cwd, mode: 'auto' })
    await service.prompt(first.sessionId, 'Remember the codeword "pelican". Reply with OK only.')
    await service.close(first.sessionId)

    const second = await startedIn(service, { cwd, mode: 'auto', resume: first.sessionId })
    const text: string[] = []
    service.onUpdate(second.sessionId, (update) => {
      const content = update.content as { text?: string } | undefined
      if (update.sessionUpdate === 'agent_message_chunk') text.push(content?.text ?? '')
    })
    await service.prompt(second.sessionId, 'What was the codeword? Reply with the word only.')
    expect(text.join('').toLowerCase()).toContain('pelican')
  })
})
