import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { putHook } from '../../../src/main/integrations/claude-settings'
import { makeTempDir } from '../../support/temp-dir'

let file: string
beforeEach(() => {
  file = path.join(makeTempDir('put-hook-'), '.claude', 'settings.json')
})

const hookEntry = (command: string) => ({ matcher: '*', hooks: [{ type: 'command', command }] })
type HookEntry = { hooks: Array<{ command: string; type?: string; timeout?: number }> }
const read = () =>
  JSON.parse(fs.readFileSync(file, 'utf8')) as { hooks: Record<string, HookEntry[]> }

describe('putHook — a fresh file', () => {
  it('writes one entry for the event into a file that does not exist', async () => {
    await putHook(file, 'Notification', {
      marker: 'agent-ask-hook.cjs',
      command: 'run agent-ask-hook.cjs',
    })
    expect(read().hooks.Notification).toHaveLength(1)
    expect(read().hooks.Notification[0].hooks[0]).toMatchObject({
      type: 'command',
      command: 'run agent-ask-hook.cjs',
      timeout: 10,
    })
  })
})

describe('putHook — a file with other hooks', () => {
  it('keeps other people’s entries and other events, and collapses every entry of ours', async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(
      file,
      JSON.stringify({
        model: 'opus',
        hooks: {
          Stop: [
            hookEntry('/p1/agent-ask-hook.cjs'),
            hookEntry('theirs.sh'),
            hookEntry('/p2/agent-ask-hook.cjs'),
          ],
          Notification: [hookEntry('other.sh')],
        },
      })
    )
    await putHook(file, 'Stop', {
      marker: 'agent-ask-hook.cjs',
      command: 'ours /p3/agent-ask-hook.cjs',
    })
    const settings = read() as { model?: string; hooks: Record<string, HookEntry[]> }
    expect(settings.model).toBe('opus')
    expect(settings.hooks.Notification).toEqual([hookEntry('other.sh')])
    expect(settings.hooks.Stop.map((e) => e.hooks[0].command)).toEqual([
      'theirs.sh',
      'ours /p3/agent-ask-hook.cjs',
    ])
  })
})

describe('putHook — unreadable settings', () => {
  it('leaves unparsable settings alone', async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '{ nope')
    await expect(putHook(file, 'Stop', { marker: 'm', command: 'c' })).rejects.toThrow()
    expect(fs.readFileSync(file, 'utf8')).toBe('{ nope')
  })
})
