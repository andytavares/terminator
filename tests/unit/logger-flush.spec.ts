import { describe, it, expect, vi } from 'vitest'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { makeTempDir } from '../support/temp-dir'

const paths = vi.hoisted(() => ({ logs: '' }))
vi.mock('electron', () => ({ app: { getPath: () => paths.logs } }))

import { flushLogs, makeLogger } from '../../src/main/logger'

describe('flushLogs', () => {
  it('settles after a line written just before it has landed in the file', async () => {
    paths.logs = makeTempDir('logger-flush-')
    makeLogger('flush-spec').info('written just before teardown')
    await flushLogs()
    expect(readFileSync(join(paths.logs, 'terminator.log'), 'utf8')).toContain(
      'written just before teardown'
    )
  })

  it('leaves nothing to write into a directory that is removed straight after', async () => {
    paths.logs = makeTempDir('logger-flush-')
    makeLogger('flush-spec').info('last line')
    await flushLogs()
    rmSync(paths.logs, { recursive: true })
    expect(existsSync(paths.logs)).toBe(false)
    // Opens a new stream, in the directory that exists now, rather than writing to the old one.
    paths.logs = makeTempDir('logger-flush-')
    makeLogger('flush-spec').info('next test')
    await flushLogs()
    expect(readFileSync(join(paths.logs, 'terminator.log'), 'utf8')).toContain('next test')
  })

  it('settles at once when nothing was written', async () => {
    await expect(flushLogs()).resolves.toBeUndefined()
  })
})
