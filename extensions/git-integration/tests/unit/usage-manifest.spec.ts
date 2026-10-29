import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import manifest from '../../manifest.json'

// An id the manifest does not declare is dropped by the core, so the count is silently lost.

const SOURCE = path.resolve(__dirname, '../../src')
const RECORDED = /(?:usage\.record|recordUsage)\(\s*'([a-z0-9-]+)'/g

function recordedIds(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) return recordedIds(file)
    if (!/\.tsx?$/.test(entry.name)) return []
    return [...fs.readFileSync(file, 'utf8').matchAll(RECORDED)].map((m) => m[1])
  })
}

describe('Git Integration usage ids', () => {
  it('declares every id the source records, and records every id it declares', () => {
    const declared = manifest.contributes.usage.map((entry) => entry.id).sort()
    const recorded = [...new Set(recordedIds(SOURCE))].sort()
    expect(recorded).toEqual(declared)
  })
})
