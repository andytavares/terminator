#!/usr/bin/env node
// node scripts/affected.mjs <package> [--all]: prints true when the change reaches the package, as
// `turbo query affected --packages` sees it against TURBO_SCM_BASE (ADR 154); --all prints true.
// It runs before npm ci, so it starts the turbo version package.json pins through npx.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** npx's arguments for the pinned turbo's list of affected packages. */
export function turboCommand(manifest) {
  return ['--yes', `turbo@${manifest.devDependencies.turbo}`, 'query', 'affected', '--packages']
}

export function reaches(name, affected) {
  return affected.includes(name)
}

/** The names of the packages the change reaches. */
export function affectedPackages() {
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'))
  const output = execFileSync('npx', turboCommand(manifest), { cwd: REPO_ROOT, encoding: 'utf8' })
  return JSON.parse(output).data.affectedPackages.items.map((item) => item.name)
}

function main() {
  const [name, flag] = process.argv.slice(2)
  console.log(flag === '--all' || reaches(name, affectedPackages()))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
