import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSensor } from '../../src/sensors/schema.js'

// The built-in sensors ship inside the extension, so they resolve in a
// repository that has never enabled a sensor of its own. Both are inert by
// design — enabling one is a Settings action this unit does not add.

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const sensorsDir = path.join(root, 'sensors')

function read(file: string): string {
  return fs.readFileSync(path.join(sensorsDir, file), 'utf8')
}

describe('built-in sensors', () => {
  it('ships the two built-ins', () => {
    const files = fs.readdirSync(sensorsDir).filter((f) => f.endsWith('.yaml'))
    expect(files.sort()).toEqual(['ci-main-red.yaml', 'tracker-query.yaml'])
  })

  it('parses ci-main-red as a github-runs sensor on the base branch', () => {
    const parsed = parseSensor(read('ci-main-red.yaml'), 'ci-main-red.yaml')
    expect(parsed.ok, parsed.ok ? '' : parsed.reason).toBe(true)
    if (parsed.ok) {
      expect(parsed.value.source).toEqual({ kind: 'github-runs', branch: null, limit: 20 })
      expect(parsed.value.severity).toBe('high')
      expect(parsed.value.every).toBe('30m')
    }
  })

  it("parses tracker-query as a tracker sensor over the operator's own issues", () => {
    const parsed = parseSensor(read('tracker-query.yaml'), 'tracker-query.yaml')
    expect(parsed.ok, parsed.ok ? '' : parsed.reason).toBe(true)
    if (parsed.ok) {
      expect(parsed.value.source).toEqual({ kind: 'tracker', query: null, limit: 25 })
      expect(parsed.value.severity).toBe('medium')
      expect(parsed.value.every).toBe('60m')
    }
  })
})
