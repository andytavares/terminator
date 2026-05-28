import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { runSensor, runAllSensors } from '../../../src/core/sensors.js'

// Mock child_process spawn
vi.mock('node:child_process', () => {
  function createMockProcess(exitCode: number, stdout: string, stderr: string) {
    const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter }
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    setTimeout(() => {
      proc.stdout.emit('data', Buffer.from(stdout))
      proc.stderr.emit('data', Buffer.from(stderr))
      proc.emit('close', exitCode)
    }, 5)
    return proc
  }
  return {
    spawn: vi.fn((cmd: string) => {
      if (cmd === 'pass-cmd') return createMockProcess(0, 'all good', '')
      if (cmd === 'fail-cmd') return createMockProcess(1, '', 'lint error on line 5')
      return createMockProcess(0, '', '')
    }),
  }
})

describe('runSensor()', () => {
  it('returns pass: true for exit code 0', async () => {
    const result = await runSensor({ name: 'lint', command: 'pass-cmd' }, '/workspace')
    expect(result.pass).toBe(true)
    expect(result.exitCode).toBe(0)
    expect(result.sensorName).toBe('lint')
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('returns pass: false for non-zero exit code', async () => {
    const result = await runSensor({ name: 'lint', command: 'fail-cmd' }, '/workspace')
    expect(result.pass).toBe(false)
    expect(result.exitCode).toBe(1)
  })

  it('captures stderr excerpt (up to 20 lines)', async () => {
    const result = await runSensor({ name: 'lint', command: 'fail-cmd' }, '/workspace')
    expect(result.stderrExcerpt).toContain('lint error')
  })

  it('records durationMs', async () => {
    const result = await runSensor({ name: 'test', command: 'pass-cmd' }, '/workspace')
    expect(typeof result.durationMs).toBe('number')
  })
})

describe('runAllSensors()', () => {
  it('runs all sensors and returns results array', async () => {
    const sensors = [
      { name: 'lint', command: 'pass-cmd' },
      { name: 'test', command: 'fail-cmd' },
    ]
    const results = await runAllSensors(sensors, '/workspace')
    expect(results).toHaveLength(2)
    expect(results[0].sensorName).toBe('lint')
    expect(results[0].pass).toBe(true)
    expect(results[1].sensorName).toBe('test')
    expect(results[1].pass).toBe(false)
  })

  it('returns empty array for no sensors', async () => {
    const results = await runAllSensors([], '/workspace')
    expect(results).toHaveLength(0)
  })
})
