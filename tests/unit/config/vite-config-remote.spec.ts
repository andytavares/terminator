import { describe, it, expect } from 'vitest'

describe('vite.config.remote', () => {
  it('exports a valid vite config with the expected build structure', async () => {
    const mod = await import('../../../vite.config.remote')
    const config = mod.default
    expect(config).toBeDefined()
    expect(typeof config).toBe('object')
  })

  it('config has a build section with rollupOptions', async () => {
    const mod = await import('../../../vite.config.remote')
    const config = mod.default as {
      build?: { rollupOptions?: { output?: { entryFileNames?: unknown } } }
    }
    expect(config.build).toBeDefined()
    expect(config.build?.rollupOptions).toBeDefined()
  })

  it('entryFileNames returns remote-shim.js for shim chunk', async () => {
    const mod = await import('../../../vite.config.remote')
    const config = mod.default as {
      build: { rollupOptions: { output: { entryFileNames: (chunk: { name: string }) => string } } }
    }
    const namer = config.build.rollupOptions.output.entryFileNames
    expect(namer({ name: 'shim' })).toBe('remote-shim.js')
  })

  it('entryFileNames returns hashed path for non-shim chunks', async () => {
    const mod = await import('../../../vite.config.remote')
    const config = mod.default as {
      build: { rollupOptions: { output: { entryFileNames: (chunk: { name: string }) => string } } }
    }
    const namer = config.build.rollupOptions.output.entryFileNames
    expect(namer({ name: 'index' })).toContain('assets/')
  })
})
