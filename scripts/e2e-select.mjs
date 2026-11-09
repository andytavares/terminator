#!/usr/bin/env node
// node scripts/e2e-select.mjs [--all]: prints the e2e spec files the change reaches, one per line,
// from `turbo query affected --packages` (ADR 154); --all prints every spec. A core or shared package reaches every spec; an
// extension reaches the specs named for it. termctl is not part of the app, so it reaches none.
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { affectedPackages } from './affected.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const EXTENSION_SPECS = {
  '@terminator/extension-foundry': /^foundry-/,
  '@terminator/extension-git-integration': /^(git-|merge-flow|pr-review-|review-agent)/,
  '@terminator/extension-notepad': /^notepad-/,
  '@terminator/extension-task-vault': /^task-vault-/,
  '@terminator/extension-remote-control': /^remote-control/,
}
const NO_SPECS = new Set(['@terminator/termctl'])

/** The specs of `specs` that a change affecting the packages `affected` reaches. */
export function selectSpecs(affected, specs) {
  const everything = affected.some((name) => !EXTENSION_SPECS[name] && !NO_SPECS.has(name))
  if (everything) return specs
  const patterns = affected.map((name) => EXTENSION_SPECS[name]).filter(Boolean)
  return specs.filter((spec) => patterns.some((pattern) => pattern.test(spec)))
}

function main() {
  const specs = readdirSync(join(REPO_ROOT, 'tests', 'e2e')).filter((f) => f.endsWith('.spec.ts'))
  const selected = process.argv.includes('--all') ? specs : selectSpecs(affectedPackages(), specs)
  for (const spec of selected) console.log(`tests/e2e/${spec}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
