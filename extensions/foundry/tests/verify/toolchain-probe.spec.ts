import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { probeToolchain, CHECK_NAMES } from '../../src/verify/toolchain-probe.js'

// The probe is what makes "works in any repository, with nothing installed"
// true rather than a claim. It reads manifests and never executes them: FR-070
// forbids side effects in a target repository, and running an unfamiliar
// project's scripts during intake is exactly the surprise this design avoids.
//
// `null` is the important value. It is what makes FR-039's "not measured"
// reachable, and it is why every field is nullable rather than absent.

let repo: string

function write(rel: string, body: string): void {
  const full = path.join(repo, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, body)
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-probe-'))
})

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true })
})

describe('probeToolchain', () => {
  it('reports every check as null in a repository with nothing in it', () => {
    const t = probeToolchain(repo)
    for (const name of CHECK_NAMES) expect(t[name]).toBeNull()
  })

  it('never counts an absent command as anything but absent', () => {
    const t = probeToolchain(repo)
    expect(Object.values(t).every((v) => v === null)).toBe(true)
  })

  it('reads package.json scripts', () => {
    write(
      'package.json',
      JSON.stringify({ scripts: { test: 'vitest run', lint: 'eslint .', build: 'tsc' } })
    )
    const t = probeToolchain(repo)
    expect(t.test).toEqual({ command: 'npm run test', source: 'package.json' })
    expect(t.lint).toEqual({ command: 'npm run lint', source: 'package.json' })
    expect(t.build).toEqual({ command: 'npm run build', source: 'package.json' })
    expect(t.e2e).toBeNull()
  })

  it('survives an unreadable or malformed package.json rather than throwing', () => {
    write('package.json', '{{{ not json')
    expect(() => probeToolchain(repo)).not.toThrow()
    expect(probeToolchain(repo).test).toBeNull()
  })

  it('recognises a coverage script separately from the test script', () => {
    write(
      'package.json',
      JSON.stringify({ scripts: { test: 'vitest run', 'test:coverage': 'vitest run --coverage' } })
    )
    expect(probeToolchain(repo).coverage).toEqual({
      command: 'npm run test:coverage',
      source: 'package.json',
    })
  })

  it('falls back to a tool config when no script names the check', () => {
    write('package.json', JSON.stringify({ name: 'x' }))
    write('vitest.config.ts', 'export default {}')
    expect(probeToolchain(repo).test).toEqual({ command: 'npx vitest run', source: 'config' })
  })

  it('recognises a python project with no package.json at all', () => {
    write('pyproject.toml', '[tool.pytest.ini_options]\ntestpaths = ["tests"]\n')
    expect(probeToolchain(repo).test).toEqual({ command: 'pytest', source: 'config' })
  })

  it('recognises a rust project', () => {
    write('Cargo.toml', '[package]\nname = "x"\n')
    const t = probeToolchain(repo)
    expect(t.test).toEqual({ command: 'cargo test', source: 'config' })
    expect(t.build).toEqual({ command: 'cargo build', source: 'config' })
  })

  it('reads a Makefile target when nothing else supplies the check', () => {
    write('Makefile', 'test:\n\tgo test ./...\n\nlint:\n\tgolangci-lint run\n')
    const t = probeToolchain(repo)
    expect(t.test).toEqual({ command: 'make test', source: 'makefile' })
    expect(t.lint).toEqual({ command: 'make lint', source: 'makefile' })
  })

  it('falls back to the CI workflow last, since what CI runs is what the project gates on', () => {
    write('.github/workflows/ci.yml', 'jobs:\n  a:\n    steps:\n      - run: bun test\n')
    expect(probeToolchain(repo).test).toEqual({ command: 'bun test', source: 'ci' })
  })

  it('prefers package.json over a tool config over CI', () => {
    write('package.json', JSON.stringify({ scripts: { test: 'vitest run' } }))
    write('vitest.config.ts', 'export default {}')
    write('.github/workflows/ci.yml', 'jobs:\n  a:\n    steps:\n      - run: bun test\n')
    expect(probeToolchain(repo).test?.source).toBe('package.json')
  })

  it('finds an end-to-end command distinct from the unit test command', () => {
    write(
      'package.json',
      JSON.stringify({ scripts: { test: 'vitest run', 'test:e2e': 'playwright test' } })
    )
    const t = probeToolchain(repo)
    expect(t.test?.command).toBe('npm run test')
    expect(t.e2e).toEqual({ command: 'npm run test:e2e', source: 'package.json' })
  })

  it('does not execute anything it finds', () => {
    // A script that would leave a trace if it were ever run.
    write('package.json', JSON.stringify({ scripts: { test: `touch ${repo}/EXECUTED` } }))
    probeToolchain(repo)
    expect(fs.existsSync(path.join(repo, 'EXECUTED'))).toBe(false)
  })

  it('writes nothing into the repository it probes', () => {
    write('package.json', JSON.stringify({ scripts: { test: 'vitest run' } }))
    const before = fs.readdirSync(repo).sort()
    probeToolchain(repo)
    expect(fs.readdirSync(repo).sort()).toEqual(before)
  })
})
