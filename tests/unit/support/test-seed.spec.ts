import { describe, it, expect, vi } from 'vitest'
import { testSeed } from '../../support/test-seed'

async function loadedSeed(): Promise<unknown> {
  vi.resetModules()
  const { default: config } = await import('../../../vitest.config')
  return config.test?.sequence?.seed
}

describe('the seed of the test order', () => {
  it('differs between two loads of the config when TEST_SEED is not set', async () => {
    vi.stubEnv('TEST_SEED', '')
    expect(await loadedSeed()).not.toBe(await loadedSeed())
  })

  it('is TEST_SEED when it is set, so a failing order can be rerun', async () => {
    vi.stubEnv('TEST_SEED', '12345')
    expect(await loadedSeed()).toBe(12345)
    expect(testSeed({ TEST_SEED: '7' })).toBe(7)
  })

  it('shuffles files and the tests inside them', async () => {
    const { default: config } = await import('../../../vitest.config')
    expect(config.test?.sequence?.shuffle).toEqual({ files: true, tests: true })
  })

  it('ignores a TEST_SEED that is not an integer', () => {
    expect(Number.isInteger(testSeed({ TEST_SEED: 'abc' }))).toBe(true)
  })
})
