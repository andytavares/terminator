import { describe, it, expect } from 'vitest'
import { execFile } from 'node:child_process'
import { readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { makeTempDir } from '../../../packages/test-support/src/temp-dir'

/** ADR 108: an extension's backend may use Temporal; its view, which also runs in the phone's
 * browser, may not. Each case type-checks one line that uses Temporal against the real tsconfig,
 * with tsc: TypeScript 7 has no compiler API to call in process (ADR 153). */

const repoRoot = path.resolve(__dirname, '../../..')
const TSC = path.join(repoRoot, 'node_modules/.bin/tsc')
const extensions = [
  { name: 'Task Vault', root: path.join(repoRoot, 'extensions/task-vault') },
  { name: 'git-integration', root: path.join(repoRoot, 'extensions/git-integration') },
]
const USES_TEMPORAL = 'export const today = Temporal.Now.plainDateISO().toString()\n'

async function tsc(args: string[]): Promise<string> {
  const run = promisify(execFile)(TSC, ['--pretty', 'false', ...args])
  const { stdout } = await run.catch((error: { stdout: string }) => ({ stdout: error.stdout }))
  return stdout
}

/** What tsc reports for a file using Temporal under `name`'s compiler options. */
async function errorsUsingTemporal(root: string, name: string): Promise<string[]> {
  const directory = makeTempDir('temporal-')
  writeFileSync(path.join(directory, 'uses-temporal.ts'), USES_TEMPORAL)
  // The config's `types` resolve from the probe's folder, as from the extension's.
  symlinkSync(path.join(repoRoot, 'node_modules'), path.join(directory, 'node_modules'))
  const config = { extends: path.join(root, name), files: ['uses-temporal.ts'], include: [] }
  writeFileSync(path.join(directory, 'tsconfig.json'), JSON.stringify(config))
  const output = await tsc(['--noEmit', '-p', directory])
  return [...output.matchAll(/error TS\d+: (.*)$/gm)].map((match) => match[1])
}

/** The root files `name` names, as tsc resolves them. */
async function rootFiles(root: string, name: string): Promise<string[]> {
  const { files } = JSON.parse(await tsc(['--showConfig', '-p', path.join(root, name)])) as {
    files: string[]
  }
  return files.map((file) => path.join(root, file))
}

/** The module the view's page loads, as index.html names it. */
function viewEntry(root: string): string {
  const html = readFileSync(path.join(root, 'index.html'), 'utf-8')
  const source = /<script type="module" src="\/([^"]+)">/.exec(html)?.[1]
  if (!source) throw new Error('index.html names no module script')
  return path.join(root, source)
}

describe.each(extensions)('Temporal in $name', ({ root }) => {
  it('is not a name the view can use', async () => {
    expect(await errorsUsingTemporal(root, 'tsconfig.view.json')).toEqual([
      "Cannot find name 'Temporal'.",
    ])
  })

  it('is checked from the module the view page loads, through everything it imports', async () => {
    expect(await rootFiles(root, 'tsconfig.view.json')).toEqual([viewEntry(root)])
  })

  it('type-checks in the backend', async () => {
    expect(await errorsUsingTemporal(root, 'tsconfig.json')).toEqual([])
  })

  it('type-checks in the specs', async () => {
    expect(await errorsUsingTemporal(root, 'tsconfig.test.json')).toEqual([])
  })
})
