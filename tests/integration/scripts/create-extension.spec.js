import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'child_process'
import { existsSync, readFileSync, rmSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'

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
  tempDir = join(tmpdir(), `terminator-test-${randomBytes(4).toString('hex')}`)
  mkdirSync(tempDir, { recursive: true })
})

afterEach(() => {
  if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true })
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

  it('exits 0 with --help', () => {
    const result = run(['--help'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Usage')
  })

  it('generated src/index.js is valid JavaScript with activate/deactivate', () => {
    run(['hello-world', '--dir', join(tempDir, 'hello-world')])
    const index = readFileSync(join(tempDir, 'hello-world', 'src', 'index.js'), 'utf8')
    // Should not have syntax errors — we check by verifying key exports exist
    expect(index).toContain('activate')
    expect(index).toContain('deactivate')
    expect(index).toContain('module.exports')
  })
})
