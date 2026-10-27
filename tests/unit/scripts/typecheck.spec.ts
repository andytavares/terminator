import { describe, it, expect } from 'vitest'
import { typecheckProjects, tscArguments, runProjects } from '../../../scripts/typecheck.mjs'

describe('the typecheck projects', () => {
  it('lists the core, the packages and every extension, in the order the old npm scripts ran them', () => {
    expect(typecheckProjects).toEqual([
      'tsconfig.main.json',
      'tsconfig.renderer.json',
      'tsconfig.shared.json',
      'tsconfig.test.json',
      'packages/extension-ui',
      'packages/extension-ui/tsconfig.test.json',
      'packages/extension-sdk',
      'extensions/foundry/tsconfig.json',
      'extensions/foundry/tsconfig.test.json',
      'extensions/git-integration/tsconfig.json',
      'extensions/git-integration/tsconfig.view.json',
      'extensions/git-integration/tsconfig.test.json',
      'extensions/notepad/tsconfig.json',
      'extensions/notepad/tsconfig.test.json',
      'extensions/task-vault/tsconfig.json',
      'extensions/task-vault/tsconfig.view.json',
      'extensions/task-vault/tsconfig.test.json',
      'extensions/remote-control/tsconfig.json',
      'extensions/remote-control/tsconfig.test.json',
    ])
  })
})

describe('the tsc arguments', () => {
  it('checks incrementally, with a build info file named for the project path', () => {
    expect(tscArguments('extensions/foundry/tsconfig.test.json')).toEqual([
      'tsc',
      '--noEmit',
      '--incremental',
      '--tsBuildInfoFile',
      'node_modules/.cache/typecheck/extensions-foundry-tsconfig.test.json.tsbuildinfo',
      '-p',
      'extensions/foundry/tsconfig.test.json',
    ])
  })
})

describe('running every project', () => {
  const projects = ['a', 'b', 'c']

  it('exits 1 when one project fails, after running the others, and prints only the failing output', async () => {
    const started: string[] = []
    const printed: string[] = []
    const check = async (project: string) => {
      started.push(project)
      return project === 'b'
        ? { status: 2, output: 'b: error TS2322' }
        : { status: 0, output: 'noise' }
    }
    expect(
      await runProjects(projects, check, { limit: 2, print: (text: string) => printed.push(text) })
    ).toBe(1)
    expect(started).toEqual(['a', 'b', 'c'])
    expect(printed).toEqual(['b: error TS2322'])
  })

  it('exits 0 and prints nothing when every project passes', async () => {
    const printed: string[] = []
    const check = async () => ({ status: 0, output: '' })
    expect(
      await runProjects(projects, check, { limit: 2, print: (text: string) => printed.push(text) })
    ).toBe(0)
    expect(printed).toEqual([])
  })
})
