import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

// Hand-off is the operator's. A clean red-team round used to agree the order
// and start the Line on its own; the operator found work already building
// that they had not released. The only way a run starts is the channel the
// Forge's Hand off button calls.

const here = path.dirname(fileURLToPath(import.meta.url))
const src = fs.readFileSync(path.join(here, '..', 'src', 'index.ts'), 'utf8')

describe('hand-off', () => {
  it('starts a run only from the channel the operator presses', () => {
    const starts = [...src.matchAll(/runs\.start\(/g)]
    expect(starts).toHaveLength(1)
    expect(src).toContain("reg(api, 'foundry:run.start', (payload) => runs.start(payload))")
  })

  it('has no setting that would hand off on its own', () => {
    expect(src).not.toMatch(/autoHandOff|auto-hand-off/)
  })
})
