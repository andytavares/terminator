#!/usr/bin/env node
// node scripts/check-release-age.mjs: exits 1 if package-lock.json holds a version the registry
// published fewer than 14 days ago that the base branch's lockfile does not (GITHUB_BASE_REF in a
// pull request, main anywhere else, fetched here because CI checks out one commit).
// A version already on the base branch is not this change's to answer for. A new one that must stay
// is listed, with a reason, in .release-age-exceptions.json.
// `npm audit` sees known advisories only; this is the cooldown for what nobody has reported yet.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const COOLDOWN_DAYS = 14
const REGISTRY = 'https://registry.npmjs.org/'
const CONCURRENCY = 16

/** `name@version` of every registry package in the lockfile, once each. */
export function lockedVersions(lock) {
  const ids = new Set()
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (!String(entry.resolved ?? '').startsWith(REGISTRY)) continue
    const name = key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length)
    ids.add(`${name}@${entry.version}`)
  }
  return [...ids]
}

/** The branch a change is measured against. */
export function baseBranch(env) {
  return env.GITHUB_BASE_REF || 'main'
}

/** `name@version` in `head`'s lockfile that `base`'s does not hold. */
export function addedVersions(head, base) {
  const held = new Set(lockedVersions(base))
  return lockedVersions(head).filter((id) => !held.has(id))
}

/** Versions published inside the cooldown, or whose publish time is unknown, and not excepted. */
export function tooYoung({ published, exceptions, now }) {
  const cutoff = now - COOLDOWN_DAYS * 24 * 60 * 60 * 1000
  return Object.entries(published)
    .filter(
      ([id, publishedAt]) => !Object.hasOwn(exceptions, id) && !(Date.parse(publishedAt) <= cutoff)
    )
    .map(([id, publishedAt]) => ({ id, publishedAt }))
}

async function publishTimes(name) {
  const response = await fetch(`${REGISTRY}${encodeURIComponent(name)}`)
  if (!response.ok) throw new Error(`${name}: the registry answered ${response.status}`)
  return (await response.json()).time ?? {}
}

/** `name@version` to its publish time, or null where the registry has none. */
async function fetchPublished(ids) {
  const published = {}
  const queue = [...ids]
  const worker = async () => {
    for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
      const at = id.lastIndexOf('@')
      published[id] = (await publishTimes(id.slice(0, at)))[id.slice(at + 1)] ?? null
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  return published
}

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))

function baseLockfile(branch) {
  execFileSync('git', ['fetch', '--no-tags', '--depth=1', 'origin', branch], { stdio: 'ignore' })
  return JSON.parse(
    execFileSync('git', ['show', 'FETCH_HEAD:package-lock.json'], {
      encoding: 'utf8',
      maxBuffer: 1 << 28,
    })
  )
}

async function main(branch) {
  const ids = addedVersions(readJson('package-lock.json'), baseLockfile(branch))
  const exceptions = readJson('.release-age-exceptions.json')
  const young = tooYoung({ published: await fetchPublished(ids), exceptions, now: Date.now() })
  console.log(
    `check-release-age: ${ids.length} versions added since ${branch}, ${young.length} under ${COOLDOWN_DAYS} days old`
  )
  for (const { id, publishedAt } of young)
    console.error(`  ${id}  published ${publishedAt ?? 'at an unknown time'}`)
  return young.length === 0 ? 0 : 1
}

if (import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = await main(baseBranch(process.env))
