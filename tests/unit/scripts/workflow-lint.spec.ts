import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import {
  TOOLS,
  actionlintArguments,
  checkedArchive,
  policyFindings,
  readWorkflows,
  releaseFor,
} from '../../../scripts/workflow-lint.mjs'

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

// The workflows are linted by the same pinned binaries in CI and here (ADR 123): whatever happens
// to be on a machine's PATH never decides the result.
describe('the tools that lint the workflows', () => {
  it('are pinned to one version each, with the archive checksum', () => {
    expect(TOOLS.actionlint).toMatchObject({ version: '1.7.12' })
    expect(TOOLS.shellcheck).toMatchObject({ version: '0.11.0' })
    for (const tool of Object.values(TOOLS))
      for (const release of Object.values(tool.releases))
        expect(release.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  // A developer lints on a Mac, and CI's Ubuntu jobs run on ARM: one release of each tool for each.
  it('has a release for macOS on Apple silicon and for Linux on ARM', () => {
    expect(releaseFor('actionlint', 'darwin', 'arm64').url).toContain('darwin_arm64')
    expect(releaseFor('actionlint', 'linux', 'arm64').url).toContain('linux_arm64')
    expect(releaseFor('shellcheck', 'linux', 'arm64').url).toContain('linux.aarch64')
  })

  it('names the machine it has no release for', () => {
    expect(() => releaseFor('actionlint', 'win32', 'x64')).toThrow(/actionlint.*win32-x64/)
  })

  it('refuses an archive whose checksum is not the pinned one', () => {
    const bytes = Buffer.from('not the release')
    expect(() => checkedArchive(bytes, 'f'.repeat(64))).toThrow(/checksum/)
    expect(checkedArchive(bytes, sha256(bytes))).toBe(bytes)
  })

  it('runs actionlint with the pinned shellcheck and nothing else found on PATH', () => {
    const args = actionlintArguments('/cache/shellcheck')
    expect(args).toEqual(expect.arrayContaining(['-shellcheck', '/cache/shellcheck', '-pyflakes=']))
  })
})

type Workflows = ReturnType<typeof readWorkflows>
const workflows = () => readWorkflows(resolve(__dirname, '../../../.github/workflows'))

/** Each case breaks one policy in a copy of the repository's workflows. */
const BROKEN_POLICIES = [
  {
    broken: 'a job time limit',
    rule: /^No workflow sets timeout-minutes/,
    breaks: (copy: Workflows) => (copy.text['ci.yml'] += '\n    timeout-minutes: 5\n'),
  },
  {
    broken: 'a retried e2e run',
    rule: /^Nothing retries or repeats a test/,
    breaks: (copy: Workflows) => (copy.text['ci.yml'] += '\n  npx playwright test --retries=2\n'),
  },
  {
    broken: 'a job on macOS that runs on Ubuntu',
    rule: /^Only mac, release run on macos-26/,
    breaks: (copy: Workflows) => (copy.ci.jobs.check['runs-on'] = 'macos-26'),
  },
  {
    broken: 'the macOS job on a pull request',
    rule: /^Only mac, release run on macos-26/,
    breaks: (copy: Workflows) => (copy.ci.jobs.mac.if = 'always()'),
  },
  {
    broken: 'apt-get outside the e2e job',
    rule: /^Only the e2e job installs system packages/,
    breaks: (copy: Workflows) =>
      copy.ci.jobs.check.steps?.push({ run: 'sudo apt-get install -y jq' }),
  },
  {
    broken: 'a check the pre-commit hook runs and CI does not',
    rule: /^ci\.yml runs `npm run check:repo` and `npm run check:packages:ci`/,
    breaks: (copy: Workflows) =>
      (copy.text['ci.yml'] = copy.text['ci.yml'].replace('npm run check:repo', '')),
  },
  {
    broken: 'CI only on pull requests into main',
    rule: /^ci\.yml runs on a pull request into any branch/,
    breaks: (copy: Workflows) => (copy.ci.on = { pull_request: { branches: ['main'] } }),
  },
  {
    broken: 'a release workflow of its own',
    rule: /^No release\.yml/,
    breaks: (copy: Workflows) => copy.files.push('release.yml'),
  },
]

// The ADRs' workflow policies, which actionlint does not know, are checked first.
describe('the workflow policies', () => {
  it.each(BROKEN_POLICIES)('reports $broken by the rule it breaks', ({ rule, breaks }) => {
    const copy = workflows()
    breaks(copy)
    expect(policyFindings(copy)).toContainEqual(expect.stringMatching(rule))
  })

  it("finds nothing in the repository's own workflows", () => {
    expect(policyFindings(workflows())).toEqual([])
  })
})
