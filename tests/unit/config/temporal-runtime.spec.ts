import { describe, it, expect } from 'vitest'

// Task Vault's backend computes dates with Temporal (ADR 108). Electron 44 has
// it; Node 24, which runs these specs, only behind --harmony-temporal, which
// vitest.config.ts passes to every worker.
describe('Temporal under the unit-test runner', () => {
  it('exists, as it does in the extension host', () => {
    expect(Reflect.has(globalThis, 'Temporal')).toBe(true)
  })
})
