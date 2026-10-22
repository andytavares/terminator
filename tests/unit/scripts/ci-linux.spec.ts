import { describe, it, expect } from 'vitest'
import { containerArguments, imageTag, stepArguments } from '../../../scripts/ci-linux.mjs'

// CI runs every job but the app's own on Ubuntu on ARM; ci:local runs those steps in a container
// of the same, so a failure only Linux has shows on the Mac before the push (ADR 123).
const checkout = '/Users/dev/repo/.worktrees/.ci-local'
const gitCommonDir = '/Users/dev/repo/.git'

describe('the Linux image', () => {
  it('is named for the Dockerfile and the Node it installs, so a change to either builds anew', () => {
    const tag = imageTag('FROM ubuntu:24.04', '24.11.0')
    expect(tag).toMatch(/^terminator-ci-linux:[0-9a-f]{12}$/)
    expect(imageTag('FROM ubuntu:24.04', '24.12.0')).not.toBe(tag)
    expect(imageTag('FROM ubuntu:24.10', '24.11.0')).not.toBe(tag)
  })
})

describe('the container', () => {
  const args = containerArguments({ name: 'ci', image: 'img', checkout, gitCommonDir })
  const mounts = args.flatMap((arg, index) => (args[index - 1] === '-v' ? [arg] : []))

  it("mounts the checkout and the repository's git at their own paths, so the worktree's gitdir resolves", () => {
    expect(mounts).toContain(`${checkout}:${checkout}`)
    expect(mounts).toContain(`${gitCommonDir}:${gitCommonDir}`)
  })

  it("keeps Linux installs in volumes over the Mac's node_modules, which hold macOS binaries", () => {
    expect(mounts).toContain(`terminator-ci-linux-modules:${checkout}/node_modules`)
    expect(mounts).toContain(
      `terminator-ci-linux-ui-modules:${checkout}/packages/extension-ui/node_modules`
    )
    expect(mounts).toContain('terminator-ci-linux-cache:/home/runner/.cache')
  })

  it('runs as the arm64 Linux CI runs on, from the checkout', () => {
    expect(args).toEqual(expect.arrayContaining(['--platform', 'linux/arm64', '-w', checkout]))
  })
})

describe('a step in the container', () => {
  const step = { script: 'npm run lint', env: { TEST_ALL: '1' } }
  const args = stepArguments('ci', step, checkout)

  it('runs its script in bash as CI does, from the checkout', () => {
    expect(args.slice(args.indexOf('ci') + 1)).toEqual([
      'bash',
      '-e',
      '-o',
      'pipefail',
      '-c',
      'npm run lint',
    ])
    expect(args).toEqual(expect.arrayContaining(['-w', checkout]))
  })

  // CI's runner is the user `runner` with sudo, not root: root writes where a spec expects a
  // refusal, so a container step as root passed and failed different specs than CI.
  it('runs as the runner user, as CI does', () => {
    expect(args.slice(0, args.indexOf('ci'))).toEqual(expect.arrayContaining(['-u', 'runner']))
  })

  it("passes the step's own environment and CI's, and nothing from the Mac", () => {
    const docker = args.slice(0, args.indexOf('ci'))
    const env = docker.flatMap((arg, index) => (docker[index - 1] === '-e' ? [arg] : []))
    expect(env).toEqual(['CI=true', 'TEST_ALL=1'])
  })
})
