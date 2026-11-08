import { describe, it, expect } from 'vitest'
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import { DatabaseSync } from 'node:sqlite'

// packages/test-support/setup.ts installs the guard in the unit projects: a spec that does real I/O belongs in
// tests/integration, where a private instance of the boundary is allowed (T-TIER).
describe('the I/O guard in a unit test', () => {
  it.each([
    ['spawn', () => spawn('git', ['--version'])],
    ['spawnSync', () => spawnSync('git', ['--version'])],
    ['execFileSync', () => execFileSync('git', ['--version'])],
  ])('refuses child_process %s', (_name, start) => {
    expect(start).toThrow('A unit test may not start a process (T-TIER)')
  })

  it('refuses fs.watch', () => {
    expect(() => fs.watch('.')).toThrow('A unit test may not watch files (T-TIER)')
  })

  it('refuses a listening server, on loopback too', () => {
    expect(() => net.createServer().listen(0, '127.0.0.1')).toThrow(
      'A unit test may not listen on a socket (T-TIER)'
    )
  })

  it('refuses a SQLite database, in memory too', () => {
    expect(() => new DatabaseSync(':memory:')).toThrow(
      'A unit test may not open a database (T-TIER)'
    )
  })
})
