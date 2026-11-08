import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDataRoot, untrackedNotice } from '../src/data-root.js'

// The footprint promise, held by a test rather than by good intentions.
//
// Foundry creates or modifies exactly one thing in a repository it works on:
// the change the order asked for. Everything it writes for itself goes under
// the data root — never beside the code, never into a config file, and
// explicitly never into a .gitignore.

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src')

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [full] : []
  })
}

const files = sourceFiles(srcDir)

describe('the repository footprint', () => {
  describe('dotfiles', dotfilesTests)
})

function dotfilesTests() {
  // Naming .gitignore in prose is fine — several comments explain precisely
  // that Foundry will not touch one. What must not exist is a write whose
  // target is an ignore file, so that is what this looks for.
  const WRITE =
    /\b(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|copyFile|rename|unlink)\b/

  const DOTFILE = /\.(?:gitignore|gitattributes|npmrc|editorconfig)\b/

  it('never writes to a .gitignore or any other repository dotfile', () => {
    const offenders = files.flatMap((file) =>
      fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => WRITE.test(line) && DOTFILE.test(line))
        .map((line) => `${path.relative(srcDir, file)}: ${line.trim()}`)
    )
    expect(offenders).toEqual([])
  })
}

describe('untrackedNotice', () => {
  it('warns once when the default location is used', () => {
    const notice = untrackedNotice(resolveDataRoot('', '/repos/terminator'))
    expect(notice).toContain('/repos/terminator/.foundry')
    expect(notice).toMatch(/will not add to your \.gitignore/)
  })

  it('says what avoids the problem rather than only naming it', () => {
    expect(untrackedNotice(resolveDataRoot('', '/repos/x'))).toMatch(/Setting one folder/)
  })

  it('says nothing when a location is configured', () => {
    expect(untrackedNotice(resolveDataRoot('/var/foundry', '/repos/x'))).toBeNull()
  })
})
