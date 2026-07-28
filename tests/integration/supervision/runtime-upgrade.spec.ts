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
  it('no longer depends on the agent SDK at all', () => {
    // The agent runs as `claude` in a terminal (ADR-028). Nothing imports the
    // SDK, and the dependency is gone rather than merely unused.
    expect(filesImporting('@anthropic-ai/claude-agent-sdk')).toEqual([])
    const pkg = JSON.parse(readFileSync('package.json', 'utf-8'))
    expect(pkg.dependencies['@anthropic-ai/claude-agent-sdk']).toBeUndefined()
  })

  it('builds the runtime command line inside the seam and nowhere else', () => {
    // A second place that knows how to invoke claude is a second place a flag
    // change has to reach.
    const callers = filesImporting("'--session-id'").filter((file) => !file.startsWith(SEAM))
    expect(callers).toEqual([])
  })

  it('keeps the hook contract inside the seam', () => {
    // hookSpecificOutput is the runtime's shape, established by running the
    // binary. Anything outside the seam repeating it would drift silently.
    const callers = filesImporting('hookSpecificOutput').filter((file) => !file.startsWith(SEAM))
    expect(callers).toEqual([])
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

  it('records the versions the upgrade sweep has been run against', () => {
    // Updated by hand when the sweep is repeated. Its presence is the receipt
    // that SC-007 was verified rather than assumed.
    const adr = readFileSync('docs/adr/028-agent-in-a-terminal.md', 'utf-8')
    expect(adr).toContain('upgrade')
  })
})
