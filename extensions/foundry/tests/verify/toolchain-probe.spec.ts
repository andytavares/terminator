import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { probeToolchain, installCommandFor } from '../../src/verify/toolchain-probe.js'
import { CHECK_NAMES } from '../../src/verify/check-names.js'
import { makeTempDir } from '../../../../tests/support/temp-dir'

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
  repo = makeTempDir('foundry-probe-')
})

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true })
})

describe('probeToolchain', () => {
  describe('empty repositories', emptyRepositoriesTests)
  describe('package.json', packageJsonTests)
  describe('coverage and configs', coverageAndConfigsTests)
  describe('other languages', otherLanguagesTests)
  describe('tool configs', toolConfigsTests)
  describe('python tools', pythonToolsTests)
  describe('go', goTests)
  describe('makefiles and CI', makefilesAndCiTests)
  describe('precedence and e2e', precedenceAndE2eTests)
  describe('nothing executed or written', nothingExecutedOrWrittenTests)
})

function emptyRepositoriesTests() {
  it('reports every check as null in a repository with nothing in it', () => {
    const t = probeToolchain(repo)
    for (const name of CHECK_NAMES) expect(t[name]).toBeNull()
  })

  it('never counts an absent command as anything but absent', () => {
    const t = probeToolchain(repo)
    expect(Object.values(t).every((v) => v === null)).toBe(true)
  })
}

function packageJsonTests() {
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
}

function coverageAndConfigsTests() {
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
}

function otherLanguagesTests() {
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
}

function toolConfigsTests() {
  it('falls back to jest, eslint, prettier and playwright by their configs', () => {
    write('jest.config.js', 'module.exports = {}')
    write('eslint.config.mjs', 'export default []')
    write('.prettierrc', '{}')
    write('playwright.config.ts', 'export default {}')
    const t = probeToolchain(repo)
    expect(t.test).toEqual({ command: 'npx jest', source: 'config' })
    expect(t.lint).toEqual({ command: 'npx eslint .', source: 'config' })
    expect(t.format).toEqual({ command: 'npx prettier --check .', source: 'config' })
    expect(t.e2e).toEqual({ command: 'npx playwright test', source: 'config' })
  })

  it('prefers vitest to jest when a repository has both configs', () => {
    write('jest.config.js', 'module.exports = {}')
    write('vitest.config.ts', 'export default {}')
    expect(probeToolchain(repo).test?.command).toBe('npx vitest run')
  })

  it('does not read a pyproject that names no pytest as a test command', () => {
    write('pyproject.toml', '[project]\nname = "x"\n')
    expect(probeToolchain(repo).test).toBeNull()
  })

  it('never infers a coverage command from a tool being present', () => {
    write('vitest.config.ts', 'export default {}')
    write('Cargo.toml', '[package]\nname = "x"\n')
    expect(probeToolchain(repo).coverage).toBeNull()
  })
}

function pythonToolsTests() {
  it('reads pytest and ruff from their own config files, not only from a pyproject', () => {
    write('pytest.ini', '[pytest]\ntestpaths = tests/\n')
    write('ruff.toml', 'line-length = 100\n')
    const t = probeToolchain(repo)
    expect(t.test).toEqual({ command: 'pytest', source: 'config' })
    expect(t.lint).toEqual({ command: 'ruff check .', source: 'config' })
    expect(t.format).toEqual({ command: 'ruff format --check .', source: 'config' })
  })

  it('reads pytest from setup.cfg and tox.ini only where they have a pytest section', () => {
    write('setup.cfg', '[tool:pytest]\naddopts = -q\n')
    expect(probeToolchain(repo).test?.command).toBe('pytest')
    fs.rmSync(path.join(repo, 'setup.cfg'))
    write('tox.ini', '[flake8]\nmax-line-length = 100\n')
    expect(probeToolchain(repo).test).toBeNull()
    write('tox.ini', '[pytest]\naddopts = -q\n')
    expect(probeToolchain(repo).test?.command).toBe('pytest')
  })

  it('reads ruff from a pyproject that configures it', () => {
    write('pyproject.toml', '[tool.ruff]\nline-length = 100\n')
    expect(probeToolchain(repo).lint?.command).toBe('ruff check .')
  })
}

function goTests() {
  it('recognises a go module, and nothing for the checks go has no stock tool for', () => {
    write('go.mod', 'module example.com/x\n')
    const t = probeToolchain(repo)
    expect(t.test).toEqual({ command: 'go test ./...', source: 'config' })
    expect(t.build).toEqual({ command: 'go build ./...', source: 'config' })
    expect(t.lint).toBeNull()
    expect(t.format).toBeNull()
  })

  it('takes cargo over go in a repository with both manifests', () => {
    write('go.mod', 'module example.com/x\n')
    write('Cargo.toml', '[package]\nname = "x"\n')
    const t = probeToolchain(repo)
    expect(t.test?.command).toBe('cargo test')
    expect(t.build?.command).toBe('cargo build')
    expect(t.lint?.command).toBe('cargo clippy')
    expect(t.format?.command).toBe('cargo fmt --check')
  })
}

function makefilesAndCiTests() {
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
}

function precedenceAndE2eTests() {
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
}

function nothingExecutedOrWrittenTests() {
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
}

// Read from the lockfile, like every other command here: a reinstall that
// ignores the lockfile installs something other than what the project pinned.
describe('installCommandFor', () => {
  it('installs from each lockfile with the tool that wrote it', () => {
    write('package-lock.json', '{}')
    expect(installCommandFor(repo)).toBe('npm ci')
  })

  it('prefers pnpm and yarn lockfiles to a stray npm one', () => {
    write('pnpm-lock.yaml', '')
    expect(installCommandFor(repo)).toBe('pnpm install --frozen-lockfile')
    fs.rmSync(path.join(repo, 'pnpm-lock.yaml'))
    write('yarn.lock', '')
    expect(installCommandFor(repo)).toBe('yarn install --frozen-lockfile')
  })

  it('has nothing to offer without a lockfile', () => {
    write('package.json', '{}')
    expect(installCommandFor(repo)).toBeNull()
  })
})
