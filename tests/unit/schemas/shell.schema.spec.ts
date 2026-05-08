import { describe, it, expect } from 'vitest'
import { ShellExecOptionsSchema, ShellResultSchema } from '../../../src/shared/schemas/shell.schema'

describe('ShellExecOptionsSchema', () => {
  it('accepts git command', () => {
    const result = ShellExecOptionsSchema.safeParse({
      command: 'git',
      args: ['status'],
      cwd: '/tmp/repo',
    })
    expect(result.success).toBe(true)
  })

  it('accepts gh command', () => {
    const result = ShellExecOptionsSchema.safeParse({
      command: 'gh',
      args: ['pr', 'create'],
      cwd: '/tmp/repo',
    })
    expect(result.success).toBe(true)
  })

  it('rejects non-allowlisted command', () => {
    const result = ShellExecOptionsSchema.safeParse({
      command: 'bash',
      args: ['-c', 'rm -rf /'],
      cwd: '/tmp/repo',
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty cwd', () => {
    const result = ShellExecOptionsSchema.safeParse({
      command: 'git',
      args: ['status'],
      cwd: '',
    })
    expect(result.success).toBe(false)
  })

  it('defaults timeoutMs to 10000', () => {
    const result = ShellExecOptionsSchema.safeParse({
      command: 'git',
      args: [],
      cwd: '/tmp',
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.timeoutMs).toBe(10000)
  })

  it('accepts custom timeoutMs', () => {
    const result = ShellExecOptionsSchema.safeParse({
      command: 'git',
      args: ['log'],
      cwd: '/tmp',
      timeoutMs: 5000,
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.timeoutMs).toBe(5000)
  })

  it('rejects negative timeoutMs', () => {
    const result = ShellExecOptionsSchema.safeParse({
      command: 'git',
      args: [],
      cwd: '/tmp',
      timeoutMs: -1,
    })
    expect(result.success).toBe(false)
  })
})

describe('ShellResultSchema', () => {
  it('parses a successful result', () => {
    const result = ShellResultSchema.safeParse({
      exitCode: 0,
      stdout: 'output',
      stderr: '',
      timedOut: false,
    })
    expect(result.success).toBe(true)
  })

  it('parses a timed-out result', () => {
    const result = ShellResultSchema.safeParse({
      exitCode: -1,
      stdout: '',
      stderr: 'killed',
      timedOut: true,
    })
    expect(result.success).toBe(true)
  })
})
