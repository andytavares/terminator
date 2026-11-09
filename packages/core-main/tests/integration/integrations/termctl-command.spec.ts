import { describe, it, expect, onTestFinished } from 'vitest'
import { chmodSync, lstatSync, mkdirSync, readlinkSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  installTermctl,
  termctlStatus,
  uninstallTermctl,
  writeLauncher,
} from '../../../src/integrations/termctl-command'
import { makeTempDir } from '../../../../test-support/src/temp-dir'

const launcherInput = {
  execPath: '/Applications/Terminator.app/Contents/MacOS/Terminator',
  scriptPath: '/Applications/Terminator.app/Contents/Resources/termctl/termctl.mjs',
  socketPath: '/tmp/terminator-mcp.sock',
}

/** Takes write access away from `directory`, and gives it back after the test so cleanup can remove it. */
function makeReadOnly(directory: string): void {
  chmodSync(directory, 0o555)
  onTestFinished(() => chmodSync(directory, 0o755))
}

/** A launcher in a private userData, and a bin directory that does not exist yet. */
async function setUp() {
  const root = makeTempDir('termctl-')
  const launcherPath = await writeLauncher(join(root, 'userData', 'termctl'), launcherInput)
  const binDirectory = join(root, 'usr-local-bin')
  const shellLines: string[] = []
  const runAsAdministrator = async (shellLine: string) => void shellLines.push(shellLine)
  return { launcherPath, binDirectory, runAsAdministrator, shellLines }
}

describe('the termctl launcher file', () => {
  it('is written as an executable termctl in the directory it is given', async () => {
    const { launcherPath } = await setUp()
    expect(launcherPath.endsWith(join('userData', 'termctl', 'termctl'))).toBe(true)
    expect(statSync(launcherPath).mode & 0o777).toBe(0o755)
  })
})

describe('installing termctl', () => {
  it('reads not installed, then installed once linked, with the link pointing at the launcher', async () => {
    const options = await setUp()
    const linkPath = join(options.binDirectory, 'termctl')
    expect(await termctlStatus(options)).toEqual({ state: 'not-installed', path: linkPath })

    await installTermctl(options)

    expect(readlinkSync(linkPath)).toBe(options.launcherPath)
    expect(await termctlStatus(options)).toEqual({ state: 'installed', path: linkPath })
  })

  it('asks for an administrator when the bin directory is not writable', async () => {
    const options = await setUp()
    mkdirSync(options.binDirectory)
    makeReadOnly(options.binDirectory)

    await installTermctl(options)

    expect(options.shellLines).toEqual([
      `mkdir -p '${options.binDirectory}' && ln -s '${options.launcherPath}' '${options.binDirectory}/termctl'`,
    ])
  })
})

describe('uninstalling termctl', () => {
  it('removes our link and reads not installed again', async () => {
    const options = await setUp()
    await installTermctl(options)

    await uninstallTermctl(options)

    expect(await termctlStatus(options)).toMatchObject({ state: 'not-installed' })
  })

  it('asks for an administrator when the bin directory is not writable', async () => {
    const options = await setUp()
    await installTermctl(options)
    makeReadOnly(options.binDirectory)

    await uninstallTermctl(options)

    expect(options.shellLines).toEqual([`rm '${options.binDirectory}/termctl'`])
  })
})

describe('a termctl that belongs to another program', () => {
  it('reads other, and uninstall leaves it in place', async () => {
    const options = await setUp()
    mkdirSync(options.binDirectory)
    const linkPath = join(options.binDirectory, 'termctl')
    writeFileSync(linkPath, '#!/bin/sh\n')

    await uninstallTermctl(options)

    expect(await termctlStatus(options)).toEqual({ state: 'other', path: linkPath })
    expect(lstatSync(linkPath).isFile()).toBe(true)
  })
})
