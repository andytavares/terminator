import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  bundledExtensionIds,
  electronMainPid,
  errorLines,
  launchEnvironment,
  mainLogPath,
  startCommand,
  startupProblems,
} from '../../../scripts/smoke-start.mjs'
import { makeTempDir } from '../../support/temp-dir'

const REPO_ROOT = resolve(__dirname, '../../..')
const IDS = ['terminator.notepad', 'terminator.task-vault']

// Lines as src/main/logger.ts writes them.
const READY = '2026-10-12T14:00:00.000Z INFO  [main] App ready {"version":"0.1.144"}'
const activated = (id: string) =>
  `2026-10-12T14:00:01.000Z INFO  [extension-host] Extension ${id} activated`

describe('bundledExtensionIds', () => {
  it('reads the id of every extension directory that has a manifest', () => {
    const directory = makeTempDir('smoke-extensions-')
    for (const [name, id] of [
      ['b', 'com.b'],
      ['a', 'com.a'],
    ]) {
      mkdirSync(join(directory, name))
      writeFileSync(join(directory, name, 'manifest.json'), JSON.stringify({ id }))
    }
    mkdirSync(join(directory, 'no-manifest'))

    expect(bundledExtensionIds(directory)).toEqual(['com.a', 'com.b'])
  })

  it('finds the five built-in extensions in this repository', () => {
    expect(bundledExtensionIds(join(REPO_ROOT, 'extensions'))).toEqual([
      'terminator.foundry',
      'terminator.git-integration',
      'terminator.notepad',
      'terminator.remote-control',
      'terminator.task-vault',
    ])
  })
})

describe('startupProblems', () => {
  it('passes a run where main is ready and every extension activated', () => {
    const output = [READY, ...IDS.map(activated)].join('\n')
    expect(startupProblems(output, IDS)).toEqual([])
  })

  it('reports a missing App ready and each extension that never activated', () => {
    expect(startupProblems(activated('terminator.notepad'), IDS)).toEqual([
      'the main process never logged "App ready"',
      'extension terminator.task-vault never logged that it activated',
    ])
  })

  it('reports the run that died before Electron started, as before the predev fix', () => {
    const output = 'Error: Electron uninstall\n    at getElectronPath (lib.js:1:1)'
    expect(startupProblems(output, IDS)).toHaveLength(1 + IDS.length)
  })

  it('reports an error even when every extension activated', () => {
    const failure =
      '2026-10-12T14:00:02.000Z ERROR [extension-host] Extension terminator.foundry failed to load: boom'
    const output = [READY, ...IDS.map(activated), failure].join('\n')
    expect(startupProblems(output, IDS)).toEqual([`error: ${failure}`])
  })
})

describe('errorLines', () => {
  it('finds an uncaught exception in main and in a renderer', () => {
    const output = [
      'Uncaught Exception:',
      '[123:1012/140000.1:INFO:CONSOLE(4)] "Uncaught TypeError: x is not a function", source: index.js (4)',
      '[123:1012/140000.2:INFO:CONSOLE(9)] "rendered", source: index.js (9)',
    ].join('\n')
    expect(errorLines(output)).toEqual([
      'Uncaught Exception:',
      '[123:1012/140000.1:INFO:CONSOLE(4)] "Uncaught TypeError: x is not a function", source: index.js (4)',
    ])
  })

  it('ignores INFO and WARN log lines', () => {
    expect(errorLines(`${READY}\n2026-10-12T14:00:00.000Z WARN  [main] slow`)).toEqual([])
  })
})

describe('startCommand', () => {
  const profile = '/tmp/profile'

  it('turns the sandbox off through electron-vite on Linux only', () => {
    const linux = startCommand({ mode: 'dev', platform: 'linux', userDataDirectory: profile })
    const mac = startCommand({ mode: 'dev', platform: 'darwin', userDataDirectory: profile })
    expect(linux).toEqual([
      'npm',
      ['run', 'dev', '--', '--noSandbox', '--', `--user-data-dir=${profile}`],
    ])
    expect(mac).toEqual(['npm', ['run', 'dev', '--', '--', `--user-data-dir=${profile}`]])
  })

  it('runs a packaged executable directly', () => {
    const command = { mode: 'exec', platform: 'linux', userDataDirectory: profile }
    expect(startCommand({ ...command, executable: '/app/terminator' })).toEqual([
      '/app/terminator',
      [`--user-data-dir=${profile}`, '--no-sandbox'],
    ])
  })
})

describe('electronMainPid', () => {
  const electron = '/repo/node_modules/electron/dist/electron'
  // npm -> sh -> electron-vite -> Electron main -> its helpers, beside an unrelated Electron.
  const table = [
    '  100     1 npm run dev',
    '  101   100 sh -c electron-vite dev',
    '  102   101 node /repo/node_modules/.bin/electron-vite dev',
    `  103   102 ${electron} . --no-sandbox`,
    `  104   103 ${electron} --type=zygote --no-sandbox`,
    `  105   103 ${electron} --type=utility --utility-sub-type=node.mojom.NodeService`,
    `  900     1 ${electron} .`,
  ].join('\n')

  it('finds the main process of the Electron the command started, not its helpers', () => {
    expect(electronMainPid(table, 100, electron)).toBe(103)
  })

  it('follows the tree when pids wrapped and a child has a lower pid than its parent', () => {
    const wrapped = [
      `   40 32700 ${electron} . --no-sandbox`,
      '32690     1 npm run dev',
      '32695 32690 sh -c electron-vite dev',
      '32700 32695 node /repo/node_modules/.bin/electron-vite dev',
    ].join('\n')
    expect(electronMainPid(wrapped, 32690, electron)).toBe(40)
  })

  it('is the command itself when it is the packaged app', () => {
    expect(electronMainPid(table, 103, electron)).toBe(103)
  })

  it('is undefined once Electron has gone', () => {
    expect(electronMainPid('  100     1 npm run dev', 100, electron)).toBeUndefined()
  })
})

describe('mainLogPath', () => {
  it('is inside the profile on Linux and under ~/Library/Logs on macOS', () => {
    const where = { userDataDirectory: '/tmp/profile', appName: 'Terminator' }
    expect(mainLogPath({ ...where, platform: 'linux' })).toBe('/tmp/profile/logs/terminator.log')
    expect(mainLogPath({ ...where, platform: 'darwin' })).toBe(
      join(homedir(), 'Library/Logs/Terminator/terminator.log')
    )
  })
})

describe('the app the smoke test starts', () => {
  it('runs in the background, with Electron logging on and the rest of the environment kept', () => {
    expect(launchEnvironment({ PATH: '/bin' })).toEqual({
      PATH: '/bin',
      ELECTRON_ENABLE_LOGGING: '1',
      TERMINATOR_RUN_IN_BACKGROUND: '1',
    })
  })
})
