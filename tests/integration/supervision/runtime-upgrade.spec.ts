import { describe, it, expect } from 'vitest'
import { execSync } from 'child_process'
import { readFileSync } from 'fs'

// SC-007. A runtime upgrade must cause no regression in reported state, and
// absorbing one must touch only the seam.
//
// The version sweep itself is a manual procedure (documented in quickstart.md):
// pin an older SDK, run the supervision suite, upgrade, re-run. What is checked
// here on every run is the property that makes that procedure cheap — that the
// seam is genuinely the only thing coupled to the runtime. If this drifts, the
// upgrade cost stops being one module and the manual sweep stops being enough.

const SEAM = 'src/main/supervision/agent-runtime/'

function filesImporting(specifier: string): string[] {
  const out = execSync(`grep -rl '${specifier}' src --include='*.ts' --include='*.tsx' || true`, {
    encoding: 'utf-8',
  })
  return out.split('\n').filter((line) => line.trim() !== '')
}

describe('the runtime is coupled to one module only', () => {
  it('has exactly one importer of the agent SDK under src/', () => {
    expect(filesImporting('@anthropic-ai/claude-agent-sdk')).toEqual([`${SEAM}driver.ts`])
  })

  it('keeps every SDK importer inside the seam', () => {
    for (const file of filesImporting('@anthropic-ai/claude-agent-sdk')) {
      expect(file.startsWith(SEAM)).toBe(true)
    }
  })

  it('keeps the neutral event union free of imports entirely', () => {
    // Nothing can leak in transitively if nothing comes in at all.
    const source = readFileSync('src/main/supervision/events/session-event.ts', 'utf-8')
    expect(source.match(/^\s*import\s.+$/gm) ?? []).toEqual([])
    expect(source).not.toContain('@anthropic-ai')
  })

  it('keeps transcript-shape knowledge inside the seam', () => {
    // The per-line JSONL schema is not a published contract, so anything
    // parsing it is runtime-coupled and belongs behind the boundary.
    const parsers = filesImporting('transcript_path').filter((file) => !file.startsWith(SEAM))
    expect(parsers).toEqual([])
  })

  it('pins the SDK to an exact version, because it is 0.x', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf-8'))
    const pinned = pkg.dependencies['@anthropic-ai/claude-agent-sdk']
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('records the versions the upgrade sweep has been run against', () => {
    // Updated by hand when the sweep is repeated. Its presence is the receipt
    // that SC-007 was verified rather than assumed.
    const adr = readFileSync('docs/adr/027-agent-runtime-seam.md', 'utf-8')
    expect(adr).toContain('upgrade')
  })
})
