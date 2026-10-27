// The steps CI runs on Ubuntu, run by ci:local in a container of the same: Ubuntu 24.04 on
// arm64, as CI's ubuntu-24.04-arm runner, with the Node of .nvmrc (ADR 123). The checkout is
// its own worktree, apart from the Mac's, so both lanes run at once; its node_modules are volumes of Linux installs, kept between runs.

import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { installIfLockChanged } from './ci-install.mjs'

const DOCKERFILE = join(dirname(fileURLToPath(import.meta.url)), 'ci-linux.Dockerfile')
const CONTAINER = 'terminator-ci-linux'
const PLATFORM = 'linux/arm64'
const RUNNER = 'runner'
const RUNNER_HOME = '/home/runner'

/** The image's tag: a hash of the Dockerfile and the Node it installs. */
export function imageTag(dockerfile, nodeVersion) {
  const hash = createHash('sha256').update(`${dockerfile}\n${nodeVersion}`).digest('hex')
  return `terminator-ci-linux:${hash.slice(0, 12)}`
}

/** `docker` arguments that start the container the steps run in. */
export function containerArguments(container) {
  const { name, image, checkout, gitCommonDir } = container
  const mounts = [
    `${checkout}:${checkout}`,
    `${gitCommonDir}:${gitCommonDir}`,
    `terminator-ci-linux-modules:${checkout}/node_modules`,
    `terminator-ci-linux-ui-modules:${checkout}/packages/extension-ui/node_modules`,
    `terminator-ci-linux-cache:${RUNNER_HOME}/.cache`,
  ]
  const volumes = mounts.flatMap((mount) => ['-v', mount])
  const where = ['--platform', PLATFORM, '-w', checkout]
  return ['run', '-d', '--rm', '--name', name, ...where, ...volumes, image, 'sleep', 'infinity']
}

/** `docker` arguments that run one step in the container: its script in bash, as CI does, with
 * its own environment and CI's, and nothing from the Mac's. It starts in the checkout, the
 * container's working directory (containerArguments), so no path goes into the command. */
export function stepArguments(name, step) {
  const variables = Object.entries({ CI: 'true', ...step.env }).flatMap(([key, value]) => [
    '-e',
    `${key}=${value}`,
  ])
  const bash = ['bash', '-e', '-o', 'pipefail', '-c', step.script]
  return ['exec', '-u', RUNNER, ...variables, name, ...bash]
}

/** Runs a command, giving each chunk of its stdout and stderr to `options.write`; resolves its exit status. */
export function spawnToSink(command, args, sinkOptions) {
  const { write, ...options } = sinkOptions
  return new Promise((resolve) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', write)
    child.stderr.on('data', write)
    child.on('error', (error) => {
      write(`${error.message}\n`)
      resolve(1)
    })
    child.on('close', (status) => resolve(status ?? 1))
  })
}

const docker = (args, options = {}) => spawnSync('docker', args, { stdio: 'inherit', ...options })

function buildImage(nodeVersion) {
  const dockerfile = readFileSync(DOCKERFILE, 'utf8')
  const image = imageTag(dockerfile, nodeVersion)
  if (docker(['image', 'inspect', image], { stdio: 'ignore' }).status === 0) return image
  const build = ['build', '--platform', PLATFORM, '--build-arg', `NODE_VERSION=${nodeVersion}`]
  const built = docker([...build, '-t', image, '-f', DOCKERFILE, dirname(DOCKERFILE)])
  if (built.status !== 0) throw new Error('ci:local could not build its Linux image.')
  return image
}

/** The container's install, in its node_modules volume. */
function installInContainer(checkout) {
  installIfLockChanged(checkout, {
    where: 'Linux',
    recorded: () => {
      const hashFile = `${checkout}/node_modules/.lock-hash`
      const read = docker(['exec', CONTAINER, 'cat', hashFile], { stdio: 'pipe', encoding: 'utf8' })
      return read.status === 0 ? read.stdout : null
    },
    install: (hash) => {
      const script = `npm ci && echo ${hash} > node_modules/.lock-hash`
      return docker(stepArguments(CONTAINER, { script })).status === 0
    },
  })
}

/** Docker makes a new volume root's; the runner user installs into them. */
function givesVolumesToRunner(checkout) {
  const volumes = [
    `${checkout}/node_modules`,
    `${checkout}/packages/extension-ui/node_modules`,
    `${RUNNER_HOME}/.cache`,
  ]
  const chown = ['exec', CONTAINER, 'chown', '-R', `${RUNNER}:${RUNNER}`, ...volumes]
  if (docker(chown).status !== 0) throw new Error('ci:local could not hand its volumes to runner.')
}

/** Starts the container on `checkout`, installed; returns how to run a step in it and stop it. */
export function startLinux(setup) {
  const { checkout, gitCommonDir, nodeVersion } = setup
  const image = buildImage(nodeVersion)
  docker(['rm', '-f', CONTAINER], { stdio: 'ignore' })
  const started = docker(containerArguments({ name: CONTAINER, image, checkout, gitCommonDir }))
  if (started.status !== 0) throw new Error('ci:local could not start its Linux container.')
  givesVolumesToRunner(checkout)
  installInContainer(checkout)
  return {
    run: (step, write) => spawnToSink('docker', stepArguments(CONTAINER, step), { write }),
    stop: () => execFileSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' }),
  }
}
