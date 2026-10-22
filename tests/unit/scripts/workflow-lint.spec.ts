import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import {
  TOOLS,
  actionlintArguments,
  checkedArchive,
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

  // The Mac runs ci:local's Ubuntu steps in a Linux container (ADR 123), and CI's Ubuntu jobs run
  // on ARM: one release of each tool for each.
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
