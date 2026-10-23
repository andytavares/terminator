#!/usr/bin/env node
// node scripts/check-single-copies.mjs [lockfile]: exits 1 if the lockfile installs a package that
// must exist once (editor state, React) more than once. A bump needing a newer peer than the root
// holds nests a second copy and the editor crashes at run time; this names the cause in Lint.

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { packageName } from './check-release-age.mjs'

export const SINGLE_COPIES = [
  '@codemirror/state',
  '@codemirror/view',
  '@codemirror/language',
  '@lezer/common',
  'react',
  'react-dom',
]

/** Each of `names` installed more than once, with the path and version of every copy. */
export function duplicateCopies(lock, names) {
  const copies = new Map(names.map((name) => [name, []]))
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path.includes('node_modules/') || entry.version === undefined) continue
    copies.get(packageName(path))?.push({ path, version: entry.version })
  }
  return [...copies]
    .filter(([, found]) => found.length > 1)
    .map(([name, found]) => ({ name, copies: found }))
}

function main(file) {
  const lock = JSON.parse(readFileSync(file, 'utf8'))
  const duplicates = duplicateCopies(lock, SINGLE_COPIES)
  for (const { name, copies } of duplicates) {
    console.error(`check-single-copies: ${name} has ${copies.length} copies`)
    for (const { path, version } of copies) console.error(`  ${path}  ${version}`)
  }
  if (duplicates.length === 0)
    console.log(`check-single-copies: one copy each of ${SINGLE_COPIES.length} packages`)
  return duplicates.length === 0 ? 0 : 1
}

if (import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = main(process.argv[2] ?? 'package-lock.json')
