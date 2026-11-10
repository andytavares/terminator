import { describe, it, expect, vi, afterEach } from 'vitest'
import { z } from 'zod'
import { noPayload } from '@terminator/extension-sdk'

vi.mock('../../../src/logger', () => ({ logger: { warn: vi.fn() } }))

import { manifestTools } from '../../../src/mcp/manifest-tools'
import { ipcInvokeRegistry } from '../../../src/remote/ipc-registry'
import { mcpToolSpecs } from '../../../../core-shared/src/electron-api/manifest'

const spec = mcpToolSpecs()[0]

afterEach(() => {
  ipcInvokeRegistry.clear()
})

function registerFake(schema: z.ZodType, row = spec) {
  const handler = vi.fn(async (_event: never, payload: unknown) => ({ got: payload }))
  ipcInvokeRegistry.set(row.channel, { handler, remoteAccessible: false, schema })
  const [tool] = manifestTools.tools()
  return { handler, tool }
}

const caller = { sessionId: 's1', claudePid: 1, projectDir: '/repo', terminalId: null }

describe('manifestTools', () => {
  it('lists the manifest tool name, description and an object schema as it is', async () => {
    const { handler, tool } = registerFake(z.object({ id: z.string() }))
    expect(tool.name).toBe(spec.tool)
    expect(tool.description).toBe(spec.description)
    expect(tool.inputSchema).toMatchObject({
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    })
    expect(await tool.call({ id: 'w1' }, caller)).toEqual({ got: { id: 'w1' } })
    expect(handler).toHaveBeenCalledWith(undefined, { id: 'w1' })
  })
})

describe('manifestTools — payloads that are not objects', () => {
  it('lists noPayload as an empty object and calls with {}', async () => {
    const { handler, tool } = registerFake(noPayload)
    expect(tool.inputSchema).toEqual({ type: 'object', properties: {} })
    await tool.call({}, caller)
    expect(handler).toHaveBeenCalledWith(undefined, {})
  })

  it('wraps a string schema in payload and unwraps it on call', async () => {
    const { handler, tool } = registerFake(z.string())
    expect(tool.inputSchema).toMatchObject({
      type: 'object',
      properties: { payload: { type: 'string' } },
      required: ['payload'],
    })
    await tool.call({ payload: '/repo/a' }, caller)
    expect(handler).toHaveBeenCalledWith(undefined, '/repo/a')
  })
})

describe('manifestTools — the list', () => {
  it('skips a manifest tool whose channel is not registered', () => {
    expect(manifestTools.tools()).toEqual([])
  })

  it('marks a destructive manifest tool so Claude Code asks', () => {
    const destructive = mcpToolSpecs().find((row) => row.destructive)!
    const { tool } = registerFake(noPayload, destructive)
    expect(tool.annotations).toEqual({ destructiveHint: true })
    expect(tool._meta).toEqual({ 'anthropic/requiresUserInteraction': true })
  })
})
