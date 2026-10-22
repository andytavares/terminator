import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { startLoad, underLoadArguments } from '../../../scripts/under-load.mjs'

const SCRIPT = resolve(__dirname, '../../../scripts/under-load.mjs')

// Load made with `yes > /dev/null &` outlived the shell that started it for four hours. The load
// here is threads of the process that runs the command, so it cannot outlive it.
describe('running a command under CPU load', () => {
  it('keeps the busy threads running until stopped, then ends every one', async () => {
    const load = startLoad(2)
    expect(load.threads).toHaveLength(2)
    await load.stop()
    expect(load.threads.every((thread) => thread.threadId === -1)).toBe(true)
  })

  it('runs the command, ends the load, and exits with the command’s own code', () => {
    const run = spawnSync(process.execPath, [SCRIPT, '--threads', '2', '--', 'sh', '-c', 'exit 3'])
    expect(run.status).toBe(3)
  })

  it('reads how many threads and which command', () => {
    expect(underLoadArguments(['--threads', '6', '--', 'npx', 'vitest', 'run'])).toEqual({
      threads: 6,
      command: ['npx', 'vitest', 'run'],
    })
    expect(underLoadArguments(['--', 'true']).threads).toBeGreaterThan(0)
  })
})
