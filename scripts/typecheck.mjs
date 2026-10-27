#!/usr/bin/env node
// `npm run typecheck`: tsc over every project, a few at a time, each incrementally.
// The build info files live in node_modules/.cache, which ci:local's `git clean -fdx -e node_modules`
// and CI's cache both keep, so a warm run only rechecks what changed. Output is buffered per project
// and printed once, only for a project that failed.

import { spawn } from 'node:child_process'
import { availableParallelism, totalmem } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { eachLimited, processesAtOnce } from './each-limited.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// Peak of the largest project (tsconfig.test.json) is 1.7 GB, measured with `/usr/bin/time -l`.
const MEMORY_PER_PROCESS = 2 * 2 ** 30
const MAX_PROCESSES = 4

const EXTENSION_PROJECTS = [
  'foundry/tsconfig.json',
  'foundry/tsconfig.test.json',
  'git-integration/tsconfig.json',
  'git-integration/tsconfig.view.json',
  'git-integration/tsconfig.test.json',
  'notepad/tsconfig.json',
  'notepad/tsconfig.test.json',
  'task-vault/tsconfig.json',
  'task-vault/tsconfig.view.json',
  'task-vault/tsconfig.test.json',
  'remote-control/tsconfig.json',
  'remote-control/tsconfig.test.json',
].map((project) => `extensions/${project}`)

export const typecheckProjects = [
  'tsconfig.main.json',
  'tsconfig.renderer.json',
  'tsconfig.shared.json',
  'tsconfig.test.json',
  'packages/extension-ui',
  'packages/extension-ui/tsconfig.test.json',
  'packages/extension-sdk',
  ...EXTENSION_PROJECTS,
]

/** tsc's arguments for one project; its build info file is named for the project's path. */
export function tscArguments(project) {
  const slug = project.replaceAll('/', '-')
  return [
    'tsc',
    '--noEmit',
    '--incremental',
    '--tsBuildInfoFile',
    `node_modules/.cache/typecheck/${slug}.tsbuildinfo`,
    '-p',
    project,
  ]
}

/** Checks every project, `limit` at a time. Prints each failing project's output once; resolves 1 if any failed, else 0. */
export async function runProjects(projects, check, { limit, print }) {
  const results = await eachLimited(projects, limit, check)
  const failed = results.filter((result) => result.status !== 0)
  failed.forEach((result) => print(result.output))
  return failed.length > 0 ? 1 : 0
}

function checkProject(project) {
  return new Promise((resolve) => {
    const tsc = spawn('npx', tscArguments(project), { cwd: REPO_ROOT })
    let output = ''
    tsc.stdout.on('data', (chunk) => (output += chunk))
    tsc.stderr.on('data', (chunk) => (output += chunk))
    tsc.on('error', (error) => resolve({ status: 1, output: `${project}: ${error.message}` }))
    tsc.on('close', (status) => resolve({ status: status ?? 1, output }))
  })
}

async function main() {
  const limit = processesAtOnce({
    cores: availableParallelism(),
    memory: totalmem(),
    bytesEach: MEMORY_PER_PROCESS,
    most: MAX_PROCESSES,
  })
  process.exit(await runProjects(typecheckProjects, checkProject, { limit, print: console.log }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
