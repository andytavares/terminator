import { createRequire, syncBuiltinESMExports } from 'node:module'
import type ChildProcess from 'node:child_process'
import type Fs from 'node:fs'
import type Net from 'node:net'
import type Sqlite from 'node:sqlite'

// A unit test is one behaviour in one process with no I/O (T-TIER). A spec that starts a process,
// watches files, listens on a socket or opens a database belongs in tests/integration.
const require = createRequire(import.meta.url)
const PROCESS_STARTS = [
  'spawn',
  'spawnSync',
  'exec',
  'execSync',
  'execFile',
  'execFileSync',
  'fork',
]

function refuse(what: string): never {
  throw new Error(`A unit test may not ${what} (T-TIER): move the spec to tests/integration`)
}

/** Makes the I/O a unit test may not do throw, for the ESM and CommonJS views of each module. */
export function installUnitIoGuard(): void {
  const childProcess = require('node:child_process') as Record<string, unknown> &
    typeof ChildProcess
  for (const name of PROCESS_STARTS) childProcess[name] = () => refuse('start a process')
  const fs = require('node:fs') as typeof Fs
  fs.watch = (() => refuse('watch files')) as typeof fs.watch
  const net = require('node:net') as typeof Net
  net.Server.prototype.listen = function refuseListen() {
    return refuse('listen on a socket')
  } as typeof net.Server.prototype.listen
  const sqlite = require('node:sqlite') as { DatabaseSync: typeof Sqlite.DatabaseSync }
  sqlite.DatabaseSync = class RefusedDatabase {
    constructor() {
      refuse('open a database')
    }
  } as unknown as typeof Sqlite.DatabaseSync
  syncBuiltinESMExports()
}
