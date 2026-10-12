import { describe, it, expect } from 'vitest'

type Namer = (chunk: { name: string }) => string

async function entryFileNames(): Promise<Namer> {
  const mod = await import('../../../vite.config.remote')
  const config = mod.default as { build: { rollupOptions: { output: { entryFileNames: Namer } } } }
  return config.build.rollupOptions.output.entryFileNames
}

describe('vite.config.remote', () => {
  it('names the shim chunk remote-shim.js, the name the server serves it by', async () => {
    expect((await entryFileNames())({ name: 'shim' })).toBe('remote-shim.js')
  })

  it('gives every other chunk a hashed name under assets/', async () => {
    expect((await entryFileNames())({ name: 'index' })).toBe('assets/[name]-[hash].js')
  })
})
