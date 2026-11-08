import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { makeTempDir } from '../../../../test-support/src/temp-dir'

let logs = ''
vi.mock('electron', () => ({ app: { getPath: () => logs } }))

beforeEach(() => {
  vi.resetModules()
  logs = makeTempDir('logger-')
})

afterEach(() => {
  rmSync(logs, { recursive: true, force: true })
})

describe('the log file', () => {
  it('has every line written before flushLogs settles', async () => {
    const { logger, flushLogs } = await import('../../../src/logger')
    logger.info('the app started')
    await flushLogs()
    expect(readFileSync(join(logs, 'terminator.log'), 'utf8')).toContain('[main] the app started')
  })

  it('survives its folder disappearing: no unhandled error, and the next line opens it again', async () => {
    const { logger, flushLogs } = await import('../../../src/logger')
    logger.info('written to a folder about to go')
    rmSync(logs, { recursive: true, force: true })
    await flushLogs()
    logs = makeTempDir('logger-again-')
    logger.info('written after')
    await flushLogs()
    expect(readFileSync(join(logs, 'terminator.log'), 'utf8')).toContain('written after')
  })

  it('settles flushLogs at once when nothing was written', async () => {
    const { flushLogs } = await import('../../../src/logger')
    await expect(flushLogs()).resolves.toBeUndefined()
  })
})
