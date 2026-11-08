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

function readSensorFile(file: string): string {
  return fs.readFileSync(path.join(sensorsDir, file), 'utf8')
}

describe('built-in sensors', () => {
  it.each(fs.readdirSync(sensorsDir))(
    'parses the shipped %s, whose id is its file name',
    (file) => {
      expect(parseSensor(readSensorFile(file), file)).toMatchObject({
        ok: true,
        value: { id: path.basename(file, '.yaml') },
      })
    }
  )
})
