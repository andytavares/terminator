import { describe, it, expect, vi } from 'vitest'
import { createBranchNamer, NAMING_TIMEOUT_MS } from '../../../src/main/home/branch-name'

describe('createBranchNamer', () => {
  it('waits for the agent to be findable, then asks with a short timeout and no tools', async () => {
    const order: string[] = []
    const runOnce = vi.fn(async () => {
      order.push('run')
      return { text: 'feat/retry-uploads', stopReason: 'end_turn', sessionId: 's' }
    })
    const name = createBranchNamer({ runOnce, ready: async () => void order.push('ready') })
    expect(await name('Retry failed uploads')).toEqual({ text: 'feat/retry-uploads' })
    expect(order).toEqual(['ready', 'run'])
    const input = (runOnce.mock.calls[0] as unknown[])[0] as {
      prompt: string
      timeoutMs: number
      agentMeta: { claudeCode: { options: { tools: unknown[] } } }
    }
    expect(input.prompt).toContain('Retry failed uploads')
    expect(input.timeoutMs).toBe(NAMING_TIMEOUT_MS)
    expect(input.agentMeta.claudeCode.options.tools).toEqual([])
  })

  it('answers the error when the agent timed out', async () => {
    const name = createBranchNamer({
      runOnce: async () => ({ error: 'TIMEOUT', message: 'too slow' }),
      ready: async () => {},
    })
    expect(await name('x')).toEqual({ error: 'TIMEOUT' })
  })
})
