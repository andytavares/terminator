import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

// Hand-off is the operator's. A clean red-team round used to agree the order
// and start the Line on its own; the operator found work already building
// that they had not released. A run starts from the channel the Forge's Hand
// off button calls, or again for an order the operator already released that
// a defect sent back — `readyToHandOff` refuses anything never agreed
// (tests/forge/release-again.spec.ts).

const here = path.dirname(fileURLToPath(import.meta.url))
const src = fs.readFileSync(path.join(here, '..', 'src', 'forge', 'forge-loop.ts'), 'utf8')
const runChannels = fs.readFileSync(path.join(here, '..', 'src', 'ipc', 'run-channels.ts'), 'utf8')

describe('hand-off', () => {
  it('starts a run only from the operator\u2019s channel, or to restart one they released', () => {
    const starts = [...src.matchAll(/runs\.start\b/g)]
    expect(starts).toHaveLength(1)
    expect(runChannels).toContain("foundryChannel('foundry:run.start', StartPayload, runs.start)")
    // The one start is the release deps' `start`, and only `readyToHandOff` is handed those.
    const restart = src.indexOf('runs.start({')
    expect(src.lastIndexOf('function ', restart)).toBe(
      src.lastIndexOf('function startOrder(', restart)
    )
    expect([...src.matchAll(/\bstartOrder\(/g)]).toHaveLength(2)
    expect(src.indexOf('start: (o) => startOrder(forge, o)')).toBeGreaterThan(
      src.indexOf('function releaseDepsFor(')
    )
    expect([...src.matchAll(/\breleaseDepsFor\(/g)]).toHaveLength(2)
    expect(src).toContain('await readyToHandOff(order, releaseDepsFor(forge))')
  })

  it('has no setting that would hand off on its own', () => {
    expect(src).not.toMatch(/autoHandOff|auto-hand-off/)
  })
})
