import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')

// We import the pure functions from create-extension.cjs
// The script uses CommonJS; vitest handles the transform
let generateManifest, generateIndex, generatePackageJson, validateName, validateId

beforeEach(async () => {
  const mod = await import('../../../scripts/create-extension.cjs')
  generateManifest = mod.generateManifest
  generateIndex = mod.generateIndex
  generatePackageJson = mod.generatePackageJson
  validateName = mod.validateName
  validateId = mod.validateId
})

describe('validateName()', () => {
  it('accepts valid kebab-case names', () => {
    expect(validateName('my-extension')).toBe(null)
    expect(validateName('git-tools')).toBe(null)
    expect(validateName('hello-world-ext')).toBe(null)
  })

  it('rejects names starting with a number', () => {
    expect(validateName('1-bad')).not.toBe(null)
  })

  it('rejects uppercase letters', () => {
    expect(validateName('My-Extension')).not.toBe(null)
  })

  it('rejects names shorter than 3 characters', () => {
    expect(validateName('ab')).not.toBe(null)
  })

  it('rejects names with spaces', () => {
    expect(validateName('my extension')).not.toBe(null)
  })
})

describe('validateId()', () => {
  it('accepts valid reverse-domain IDs', () => {
    expect(validateId('com.example.my-ext')).toBe(null)
    expect(validateId('io.github.acme.tool')).toBe(null)
  })

  it('rejects IDs without dots', () => {
    expect(validateId('myextension')).not.toBe(null)
  })

  it('rejects IDs with uppercase', () => {
    expect(validateId('Com.example.ext')).not.toBe(null)
  })
})

describe('generateManifest()', () => {
  it('generates valid JSON manifest with correct fields', () => {
    expect(JSON.parse(generateManifest('my-ext', 'com.example.my-ext'))).toEqual({
      id: 'com.example.my-ext',
      name: 'My Ext',
      version: '0.1.0',
      description: 'My Ext extension for Terminator.',
      main: 'src/index.js',
      minAppVersion: '0.1.0',
    })
  })
})

describe('generatePackageJson()', () => {
  it('depends on the Extension SDK it is typed against', () => {
    const pkg = JSON.parse(generatePackageJson('my-ext'))
    const sdk = JSON.parse(readFileSync(join(ROOT, 'packages/extension-sdk/package.json'), 'utf8'))
    expect(pkg.devDependencies).toEqual({ '@terminator/extension-sdk': sdk.version })
  })
})

describe('generateIndex()', () => {
  it('names the SDK version of this repository', () => {
    const index = generateIndex('my-ext', 'com.example.my-ext')
    const sdk = JSON.parse(readFileSync(join(ROOT, 'packages/extension-sdk/package.json'), 'utf8'))
    expect(index).toContain(`// Extension SDK: ${sdk.version}\n`)
  })

  it('shows a channel registered as a spec with a schema, the only form the core accepts', () => {
    const index = generateIndex('my-ext', 'com.example.my-ext')
    expect(index).toContain('api.ipc.registerHandler({')
    expect(index).toContain("channel: 'com.example.my-ext:my-action'")
    expect(index).toMatch(/schema: z\./)
    expect(index).toContain('invalid:')
    expect(index).toContain('run:')
    expect(index).not.toMatch(/registerHandler\('/)
  })

  it("says zod goes in the extension's own package.json", () => {
    const index = generateIndex('my-ext', 'com.example.my-ext')
    expect(index).toMatch(/zod[^\n]*package\.json/)
  })

  it('labels no stub with an API version that no longer describes it', () => {
    const index = generateIndex('my-ext', 'com.example.my-ext')
    expect(index).not.toMatch(/v1\.\d\.\d/)
  })
})

describe('generateIndex() — commands, API members, imports and stubs', () => {
  it('registers a command and shows a toast', () => {
    const index = generateIndex('my-ext', 'com.example.my-ext')
    expect(index).toContain('commands.register')
    expect(index).toContain('showToast')
  })

  it('calls no API member the Extension API no longer has', () => {
    const index = generateIndex('my-ext', 'com.example.my-ext')
    expect(index).not.toContain('api.keyboard')
  })

  it('imports nothing but the Extension SDK and, in its channel example, zod', () => {
    const index = generateIndex('my-ext', 'com.example.my-ext')
    const specifiers = [...index.matchAll(/(?:require\(|import\(|from )'([^']+)'/g)].map(
      (m) => m[1]
    )
    expect(specifiers).toEqual(['@terminator/extension-sdk', 'zod'])
  })

  it('includes a commented-out stub for the shell', () => {
    const index = generateIndex('my-ext', 'com.example.my-ext')
    expect(index).toContain('shell.exec')
  })

  it('shows no top-bar stub, because the SDK has no top bar', () => {
    expect(generateIndex('my-ext', 'com.example.my-ext')).not.toContain('topBar')
  })
})
