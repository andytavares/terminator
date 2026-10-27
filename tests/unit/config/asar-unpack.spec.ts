import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { asarUnpack } = require('../../../electron-builder.cjs') as { asarUnpack: string[] }

const ADAPTER = '@agentclientprotocol/claude-agent-acp'

interface LockEntry {
  dependencies?: Record<string, string>
}

/** Every package the adapter loads. Peers are left out: the SDK declares
 * `@modelcontextprotocol/sdk` and `@anthropic-ai/sdk`, and no path the adapter runs imports them. */
function adapterClosure(): string[] {
  const lock = JSON.parse(readFileSync(resolve(__dirname, '../../../package-lock.json'), 'utf8'))
  const packages = lock.packages as Record<string, LockEntry>
  const found = new Set<string>()
  const visit = (name: string): void => {
    const entry = packages[`node_modules/${name}`]
    if (entry === undefined || found.has(name)) return
    found.add(name)
    for (const dependency of Object.keys(entry.dependencies ?? {})) visit(dependency)
  }
  visit(ADAPTER)
  return [...found]
}

const unpacked = (name: string): boolean =>
  asarUnpack.includes(`**/node_modules/${name}/**`) ||
  asarUnpack.includes(`**/node_modules/${name.split('/')[0]}/**`)

describe('the Claude adapter in the packaged app', () => {
  // It runs as a child process, which resolves its imports on disk, never inside app.asar.
  it('unpacks every package the adapter imports', () => {
    const closure = adapterClosure()
    expect(closure).toContain('zod')
    expect(closure.filter((name) => !unpacked(name))).toEqual([])
  })
})
