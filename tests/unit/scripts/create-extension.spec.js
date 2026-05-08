import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'

// We import the pure functions from create-extension.js
// The script uses CommonJS; vitest handles the transform
let generateManifest, generateIndex, validateName, validateId

beforeEach(async () => {
  const mod = await import('../../../scripts/create-extension.js')
  generateManifest = mod.generateManifest
  generateIndex = mod.generateIndex
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
    const manifest = generateManifest('my-ext', 'com.example.my-ext')
    const parsed = JSON.parse(manifest)
    expect(parsed.id).toBe('com.example.my-ext')
    expect(parsed.name).toBeTruthy() // human-readable display name
    expect(parsed.version).toBe('0.1.0')
    expect(parsed.main).toBe('src/index.js')
    expect(parsed.minAppVersion).toBeDefined()
  })
})

describe('generateIndex()', () => {
  it('generates index with activate and deactivate exports', () => {
    const index = generateIndex('my-ext', 'com.example.my-ext')
    expect(index).toContain('activate')
    expect(index).toContain('deactivate')
  })

  it('includes all v1.1.0 API surface stubs', () => {
    const index = generateIndex('my-ext', 'com.example.my-ext')
    expect(index).toContain('sidebar')
    expect(index).toContain('keyboard')
    expect(index).toContain('showToast')
  })

  it('includes commented-out stubs for v1.1.0 surfaces', () => {
    const index = generateIndex('my-ext', 'com.example.my-ext')
    expect(index).toContain('registerPanel')
    expect(index).toContain('shell.exec')
    expect(index).toContain('fs.watch')
  })
})
