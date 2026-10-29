#!/usr/bin/env node
// node scripts/bump-extension-versions.mjs: the release runs it before packaging. Each extension
// with a changed file since the last release tag gets a patch bump in package.json and manifest.json.

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** The extension folders that hold at least one of `changedFiles`. */
export function changedExtensions(names, changedFiles) {
  return names.filter((name) => changedFiles.some((file) => file.startsWith(`extensions/${name}/`)))
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

function bump(name) {
  const workspace = join('extensions', name)
  execFileSync('npm', ['version', 'patch', '--no-git-tag-version', `--workspace=${workspace}`], {
    stdio: 'inherit',
  })
  const { version } = JSON.parse(readFileSync(join(workspace, 'package.json'), 'utf8'))
  const manifestPath = join(workspace, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, version }, null, 2)}\n`)
  console.log(`${manifest.id} ${manifest.version} -> ${version}`)
}

function main() {
  const lastTag = git('describe', '--tags', '--abbrev=0')
  const changedFiles = git('diff', '--name-only', lastTag, 'HEAD', '--', 'extensions').split('\n')
  const names = readdirSync('extensions', { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && existsSync(join('extensions', entry.name, 'manifest.json'))
    )
    .map((entry) => entry.name)
  for (const name of changedExtensions(names, changedFiles)) bump(name)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main()
