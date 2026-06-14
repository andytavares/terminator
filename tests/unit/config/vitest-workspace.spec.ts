import { describe, it, expect } from 'vitest'

describe('vitest.workspace', () => {
  it('exports an array of workspace configurations', async () => {
    const mod = await import('../../../vitest.workspace')
    const workspaces = mod.default
    expect(Array.isArray(workspaces)).toBe(true)
    expect(workspaces.length).toBeGreaterThan(0)
  })

  it('each workspace has a test.name property', async () => {
    const mod = await import('../../../vitest.workspace')
    const workspaces = mod.default as Array<{ test?: { name?: string } }>
    for (const ws of workspaces) {
      expect(ws.test?.name).toBeDefined()
    }
  })

  it('includes a core workspace', async () => {
    const mod = await import('../../../vitest.workspace')
    const workspaces = mod.default as Array<{ test?: { name?: string } }>
    expect(workspaces.some((ws) => ws.test?.name === 'core')).toBe(true)
  })
})
