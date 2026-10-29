import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const extensionDir = join(__dirname, '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(join(dir, entry.name))
      : /\.tsx?$/.test(entry.name)
        ? [join(dir, entry.name)]
        : []
  )
}

describe('usage ids', () => {
  it('declares every id the source records in contributes.usage', () => {
    const manifest = JSON.parse(readFileSync(join(extensionDir, 'manifest.json'), 'utf8'))
    const declared = manifest.contributes.usage.map((entry: { id: string }) => entry.id)
    const recorded = sourceFiles(join(extensionDir, 'src')).flatMap((file) =>
      [
        ...readFileSync(file, 'utf8').matchAll(
          /(?:usage\.record|recordUsage|useRecordUsageOnMount)\('([^']+)'/g
        ),
      ].map((m) => m[1])
    )
    expect(recorded.length).toBeGreaterThan(0)
    expect([...new Set(recorded)].sort()).toEqual([...declared].sort())
  })
})
