import { describe, it, expect, vi } from 'vitest'
import { dispatchChannel } from '@terminator/extension-sdk'

vi.mock('electron-store', () => ({
  default: class {
    store = {}
    get() {
      return undefined
    }
    set() {}
    delete() {}
  },
}))

import { activateCapturingChannels } from './support/activate'

// ADR 096: whether a channel rejects bad input is its schema's job, so this
// checks once, for every channel git-integration registers, that one is declared.
describe('every git-integration channel', () => {
  it('declares a schema that keeps a malformed payload from reaching run', async () => {
    const specs = activateCapturingChannels().channels.map((c) => c.spec)

    expect(specs.map((spec) => spec.channel)).toContain('git:commit')
    expect(new Set(specs.map((spec) => spec.channel)).size).toBe(specs.length)
    for (const spec of specs) {
      expect(spec.schema, `${spec.channel} has no schema`).toBeDefined()
      const run = vi.fn()
      await dispatchChannel({ ...spec, run }, 42)
      expect(run, `${spec.channel} ran a malformed payload`).not.toHaveBeenCalled()
    }
  })
})
