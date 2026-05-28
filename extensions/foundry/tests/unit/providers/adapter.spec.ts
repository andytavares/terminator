import { describe, it, expect } from 'vitest'
import type { RunEvent, RunRequest } from '../../../src/providers/adapter.js'

describe('RunRequest type contract', () => {
  it('requires mode, providerId, model, and prompt fields', () => {
    const req: RunRequest = {
      mode: 'spec-to-code',
      providerId: 'p1',
      model: 'claude-sonnet',
      prompt: 'Build auth middleware',
      workspaceRoot: '/workspace',
      agentsMdContent: '# Agents',
      iterationLimit: 3,
    }
    expect(req.mode).toBe('spec-to-code')
    expect(req.prompt).toBeTruthy()
  })
})

describe('RunEvent discriminated union', () => {
  it('covers token event', () => {
    const ev: RunEvent = { type: 'token', token: 'hello' }
    expect(ev.type).toBe('token')
    if (ev.type === 'token') expect(ev.token).toBe('hello')
  })

  it('covers done event with token counts', () => {
    const ev: RunEvent = { type: 'done', tokenCountIn: 100, tokenCountOut: 50 }
    expect(ev.type).toBe('done')
    if (ev.type === 'done') {
      expect(ev.tokenCountIn).toBe(100)
      expect(ev.tokenCountOut).toBe(50)
    }
  })

  it('covers error event', () => {
    const ev: RunEvent = { type: 'error', message: 'rate limit exceeded' }
    expect(ev.type).toBe('error')
  })

  it('covers file-changed event', () => {
    const ev: RunEvent = {
      type: 'file-changed',
      filePath: 'src/foo.ts',
      change: {
        filePath: 'src/foo.ts',
        status: 'new',
        linesAdded: 10,
        linesRemoved: 0,
        unifiedDiff: '+new content',
      },
    }
    expect(ev.type).toBe('file-changed')
  })
})
