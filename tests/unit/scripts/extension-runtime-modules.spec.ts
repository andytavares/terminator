import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { makeTempDir } from '../../support/temp-dir'

const require = createRequire(import.meta.url)
const { extensionRuntimeModules } = require('../../../scripts/extension-runtime-modules.cjs')

const REPO_ROOT = resolve(__dirname, '../../..')

/** A repository with one extension and the lockfile npm would write for it. */
function lockfileFixture(
  dependencies: Record<string, string>,
  packages: Record<string, object>
): string {
  const root = makeTempDir('runtime-modules-')
  mkdirSync(join(root, 'extensions', 'server'), { recursive: true })
  writeFileSync(join(root, 'extensions', 'server', 'manifest.json'), '{"id":"com.server"}')
  writeFileSync(
    join(root, 'extensions', 'server', 'package.json'),
    JSON.stringify({ name: 'server', dependencies })
  )
  const lock = { packages: { '': {}, 'extensions/server': { dependencies }, ...packages } }
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify(lock))
  return root
}

describe('extensionRuntimeModules', () => {
  it('is what the backend leaves external and everything that needs, not what its view bundles', () => {
    const root = lockfileFixture(
      { fastify: '5.0.0', react: '18.3.1' },
      {
        'node_modules/fastify': { dependencies: { avvio: '9.0.0', 'fast-json': '6.0.0' } },
        // Nested under fastify, so it ships inside fastify's own directory.
        'node_modules/fastify/node_modules/fast-json': { dependencies: { '@scope/util': '1.0.0' } },
        'node_modules/avvio': { optionalDependencies: { gone: '1.0.0' } },
        'node_modules/@scope/util': { peerDependencies: { avvio: '9.0.0' } },
        'node_modules/react': {},
      }
    )
    expect(extensionRuntimeModules(root, ['fastify'])).toEqual(['@scope/util', 'avvio', 'fastify'])
  })

  it('fails loudly when a dependency is missing from the lockfile', () => {
    const root = lockfileFixture({ fastify: '5.0.0' }, {})
    expect(() => extensionRuntimeModules(root, ['fastify'])).toThrow(
      'fastify, needed by extensions/server, is not in package-lock.json'
    )
  })
})

describe('extensionRuntimeModules — the built-in backends', () => {
  it('ships the server, parser and validation modules the built-in backends require', () => {
    const { EXTENSION_EXTERNALS } = require('../../../scripts/extension-externals.cjs')
    const modules = extensionRuntimeModules(REPO_ROOT, EXTENSION_EXTERNALS)
    for (const name of [
      'fastify',
      '@fastify/static',
      '@fastify/websocket',
      'web-tree-sitter',
      '@vscode/tree-sitter-wasm',
      'zod',
      'electron-store',
      // fastify's own dependencies.
      'avvio',
      'find-my-way',
    ]) {
      expect(modules).toContain(name)
    }
    expect(modules).not.toContain('react')
    expect(modules).not.toContain('electron')
  })
})
