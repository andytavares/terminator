import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { writeClaudeSettings } from '../../../src/main/integrations/claude-settings'
import { makeTempDir } from '../../support/temp-dir'

// Two Terminators starting together each write ~/.claude/settings.json. Written in place, a short
// copy landed over a long one and left the operator's file ending in a stray `}`: Claude Code then
// could not read their settings at all.
describe('writeClaudeSettings', () => {
  it('leaves one whole copy, never a mix, when writes overlap', async () => {
    const file = path.join(makeTempDir('claude-settings-'), '.claude', 'settings.json')
    const long = { model: 'opus', notes: 'x'.repeat(20_000) }
    const short = { model: 'opus' }
    await Promise.all(
      Array.from({ length: 40 }, (_, index) => writeClaudeSettings(file, index % 2 ? short : long))
    )
    expect([long, short]).toContainEqual(JSON.parse(fs.readFileSync(file, 'utf8')))
    expect(fs.readdirSync(path.dirname(file))).toEqual(['settings.json'])
  })
})
