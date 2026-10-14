import { describe, it, expect, beforeEach } from 'vitest'
import { spawnSync } from 'child_process'
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { runInNewContext } from 'vm'
import { makeTempDir } from '../../support/temp-dir'

const SCRIPT = join(process.cwd(), 'scripts', 'create-extension.cjs')

function run(args, opts = {}) {
  return spawnSync('node', [SCRIPT, ...args], {
    encoding: 'utf8',
    cwd: process.cwd(),
    ...opts,
  })
}

let tempDir

beforeEach(() => {
  tempDir = makeTempDir('terminator-test-')
})

describe('create-extension.js CLI', () => {
  it('exits 0 and creates extension directory', () => {
    const result = run(['my-ext', '--dir', join(tempDir, 'my-ext')])
    expect(result.status).toBe(0)
    expect(existsSync(join(tempDir, 'my-ext', 'manifest.json'))).toBe(true)
    expect(existsSync(join(tempDir, 'my-ext', 'src', 'index.js'))).toBe(true)
  })

  it('generates valid manifest.json', () => {
    run(['test-ext', '--dir', join(tempDir, 'test-ext')])
    const manifest = JSON.parse(readFileSync(join(tempDir, 'test-ext', 'manifest.json'), 'utf8'))
    expect(manifest.id).toBe('com.example.test-ext')
    expect(manifest.version).toBe('0.1.0')
    expect(manifest.main).toBe('src/index.js')
  })

  it('uses custom --id when provided', () => {
    run(['my-tool', '--id', 'com.acme.my-tool', '--dir', join(tempDir, 'my-tool')])
    const manifest = JSON.parse(readFileSync(join(tempDir, 'my-tool', 'manifest.json'), 'utf8'))
    expect(manifest.id).toBe('com.acme.my-tool')
  })
})

describe('create-extension.js CLI — collisions, bad names and the guide', () => {
  it('exits 2 on directory collision', () => {
    const dir = join(tempDir, 'existing-ext')
    mkdirSync(dir, { recursive: true })
    const result = run(['existing-ext', '--dir', dir])
    expect(result.status).toBe(2)
  })

  it('exits 1 for invalid name', () => {
    const result = run(['1-bad-name', '--dir', join(tempDir, 'bad')])
    expect(result.status).toBe(1)
  })

  it('points at the guide for a view, not at the removed renderer.tsx model', () => {
    const result = run(['view-ext', '--dir', join(tempDir, 'view-ext')])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('docs/EXTENSION-DEVELOPMENT.md')
    expect(result.stdout).not.toContain('renderer.tsx')
    expect(result.stdout).not.toContain('useExtensionRegistry')
    expect(result.stdout).not.toMatch(/v1\.\d\.\d/)
  })
})

describe('create-extension.js CLI — help and a runnable entry', () => {
  it('exits 0 with --help', () => {
    const result = run(['--help'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Usage')
  })

  it('writes a src/index.js that runs and exports activate and deactivate', () => {
    run(['hello-world', '--dir', join(tempDir, 'hello-world')])
    const index = readFileSync(join(tempDir, 'hello-world', 'src', 'index.js'), 'utf8')
    // Evaluated as CommonJS, with the SDK it requires standing in empty.
    const module = { exports: {} }
    runInNewContext(index, { module, exports: module.exports, require: () => ({}), console })
    expect(module.exports).toEqual({
      activate: expect.any(Function),
      deactivate: expect.any(Function),
    })
  })
})

describe('create-extension.js CLI — refusals', () => {
  it('exits 1 with the usage when no name is given', () => {
    const result = run([])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Error: Extension name is required.')
    expect(result.stdout).toContain('Usage: npm run create-extension -- <name> [options]')
  })

  it('exits 1 for an invalid --id', () => {
    const result = run(['my-ext', '--id', 'Bad', '--dir', join(tempDir, 'my-ext')])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Error: Invalid ID "Bad".')
    expect(existsSync(join(tempDir, 'my-ext'))).toBe(false)
  })

  it('exits 3 when the files cannot be written', () => {
    writeFileSync(join(tempDir, 'blocker'), '')
    const result = run(['my-ext', '--dir', join(tempDir, 'blocker', 'my-ext')])
    expect(result.status).toBe(3)
    expect(result.stderr).toContain('Error writing extension files:')
  })
})

describe('create-extension.js CLI — defaults and report', () => {
  it('writes to extensions/<name> under the working directory, as com.example.<name>', () => {
    const result = run(['my-ext'], { cwd: tempDir })
    const outDir = join(tempDir, 'extensions', 'my-ext')
    const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8'))
    expect(manifest.id).toBe('com.example.my-ext')
    expect(result.stdout).toBe(
      [
        `✓ Created extension "my-ext" at ${outDir}`,
        '  package.json  — workspace package (add npm deps here)',
        '  manifest.json — id: com.example.my-ext',
        '  src/index.js  — backend entry, run in the extension host, with commented API stubs',
        '',
        'To contribute UI (a tab, a sidebar panel), add a view: a "renderer" in manifest.json',
        'and its "contributes" surfaces (see "The view" in docs/EXTENSION-DEVELOPMENT.md).',
        '\nRun "npm install" then "npm run dev" to load the extension automatically.',
        '',
      ].join('\n')
    )
  })
})
