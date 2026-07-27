import { describe, it, expect } from 'vitest'
import { execSync } from 'child_process'
import { readdirSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'

// SC-011. With every extension removed, core still builds, starts, and delivers
// every capability in the specification except work-item intake and gate
// actions, which state that no producer is installed.
//
// The build half of that is verified by running it (T199, recorded in
// quickstart.md). What runs here on every commit is the structural half: core
// must contain nothing that would break if extensions/ vanished.

const SRC = 'src'

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(entry.name) ? [full] : []
  })
}

describe('core does not depend on any extension (FR-065)', () => {
  it('has no file under src/ importing from the extensions workspace', () => {
    const offenders = sourceFiles(SRC).filter((file) => {
      const source = readFileSync(file, 'utf-8')
      return [...source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)].some((match) => {
        const target = join(file, '..', match[1])
        return target.startsWith('extensions/') || target.includes('/extensions/')
          ? // src/main/extensions and src/renderer/extensions are the extension
            // HOST — core plumbing. Only the repo-root workspace counts.
            !target.startsWith('src/')
          : false
      })
    })
    expect(offenders).toEqual([])
  })

  it('imports no extension by package name either', () => {
    const byName = execSync(
      `grep -rl '@terminator/extension' src --include='*.ts' --include='*.tsx' || true`,
      { encoding: 'utf-8' }
    )
      .split('\n')
      .filter((line) => line.trim() !== '')
    expect(byName).toEqual([])
  })

  it('builds extensions defensively, so an absent directory is not a build failure', () => {
    // This crashed the build the first time SC-011 was run by hand.
    const script = readFileSync('scripts/build-extensions.cjs', 'utf-8')
    expect(script).toContain('existsSync(extensionsDir)')
  })

  it('does not name a specific producer anywhere in the supervision subsystem (FR-080)', () => {
    const named = sourceFiles('src/main/supervision').filter((file) =>
      /speckit-pilot|git-integration|task-vault|notepad|remote-control/.test(
        readFileSync(file, 'utf-8')
      )
    )
    expect(named).toEqual([])
  })

  it('keeps the supervision surfaces in core, not in an extension (FR-064)', () => {
    expect(existsSync('src/renderer/components/supervision')).toBe(true)
    const surfaces = readdirSync('src/renderer/components/supervision').filter((f) =>
      f.endsWith('.tsx')
    )
    // All seven concepts plus the shared indicator and controls.
    expect(surfaces.length).toBeGreaterThanOrEqual(10)
  })
})
