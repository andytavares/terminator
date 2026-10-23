#!/usr/bin/env node
// node scripts/check-release-age.mjs: exits 1 if package-lock.json holds a version the registry
// published fewer than 14 days ago that the base branch's lockfile does not (GITHUB_BASE_REF in a
// pull request, main anywhere else, fetched here because CI checks out one commit).
// A version already on the base branch is not this change's to answer for. A new one that must stay
// is listed, with a reason, in .release-age-exceptions.json.
// `npm audit` sees known advisories only; this is the cooldown for what nobody has reported yet.
// A version that fixes a reported advisory does not wait: Dependabot's cooldown skips security updates.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const COOLDOWN_DAYS = 14
const REGISTRY = 'https://registry.npmjs.org/'
const CONCURRENCY = 16

/** The package a lockfile key installs: `node_modules/a/node_modules/@b/c` → `@b/c`. */
export const packageName = (key) =>
  key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length)

/** `name@version` of every registry package in the lockfile, once each. */
export function lockedVersions(lock) {
  const ids = new Set()
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (!String(entry.resolved ?? '').startsWith(REGISTRY)) continue
    const name = packageName(key)
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

/** Advisory id to the audited package names that carry it, from `npm audit --json`; none when the
 * report is missing or not an audit. */
function advisoryCarriers(audit) {
  const carriers = new Map()
  for (const [name, entry] of Object.entries(audit?.vulnerabilities ?? {}))
    for (const via of entry.via ?? []) {
      if (typeof via !== 'object') continue
      carriers.set(via.url, [...(carriers.get(via.url) ?? []), name])
    }
  return carriers
}

/** Advisories the base report holds and the head report no longer does; none unless both are audits. */
export function fixedAdvisories(baseAudit, headAudit) {
  if (!baseAudit?.vulnerabilities || !headAudit?.vulnerabilities) return []
  const onHead = advisoryCarriers(headAudit)
  return [...advisoryCarriers(baseAudit).keys()].filter((id) => !onHead.has(id))
}

/** `names` plus every package they affect, transitively, in the audit's `effects`. */
function withEffects(names, audit) {
  const reached = new Set()
  const queue = [...names]
  for (let name = queue.pop(); name !== undefined; name = queue.pop()) {
    if (reached.has(name)) continue
    reached.add(name)
    queue.push(...(audit.vulnerabilities[name]?.effects ?? []))
  }
  return reached
}

/** Added `name@version` to the fixed advisories that excuse it from the cooldown: the vulnerable
 * package and whatever depends on it through the base report's `effects`. */
export function exemptByAdvisory(added, baseAudit, headAudit) {
  const carriers = advisoryCarriers(baseAudit)
  const exempt = new Map()
  for (const advisory of fixedAdvisories(baseAudit, headAudit)) {
    const names = withEffects(carriers.get(advisory), baseAudit)
    for (const id of added.filter((added) => names.has(added.slice(0, added.lastIndexOf('@'))))) {
      exempt.set(id, [...(exempt.get(id) ?? []), advisory.split('/').pop()])
    }
  }
  return exempt
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

/** The base branch's lockfile as last fetched. It fetches nothing: CI checks out every branch
 * and ci:local fetches main first; a --depth=1 fetch here made the shared repository shallow. */
export function baseLockfile(branch, cwd = process.cwd()) {
  return JSON.parse(
    execFileSync('git', ['show', `origin/${branch}:package-lock.json`], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 1 << 28,
    })
  )
}

/** The parsed `npm audit` report for the lockfile in `cwd`, or null. npm exits non-zero when it
 * finds vulnerabilities, so stdout is read whatever the exit code. */
export function auditReport(cwd) {
  try {
    let stdout
    try {
      stdout = execFileSync('npm', ['audit', '--package-lock-only', '--json'], {
        cwd,
        encoding: 'utf8',
        maxBuffer: 1 << 28,
      })
    } catch (error) {
      stdout = error.stdout
    }
    return JSON.parse(stdout)
  } catch {
    return null
  }
}

/** The audit of the base branch's package.json and lockfile, in a temporary directory. */
function baseAuditReport(branch) {
  const dir = mkdtempSync(join(tmpdir(), 'release-age-base-'))
  try {
    for (const file of ['package.json', 'package-lock.json'])
      writeFileSync(
        join(dir, file),
        execFileSync('git', ['show', `origin/${branch}:${file}`], {
          encoding: 'utf8',
          maxBuffer: 1 << 28,
        })
      )
    return auditReport(dir)
  } catch {
    return null
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function main(branch) {
  const all = addedVersions(readJson('package-lock.json'), baseLockfile(branch))
  const exempt = exemptByAdvisory(all, baseAuditReport(branch), auditReport(process.cwd()))
  const ids = all.filter((id) => !exempt.has(id))
  const exceptions = readJson('.release-age-exceptions.json')
  const young = tooYoung({ published: await fetchPublished(ids), exceptions, now: Date.now() })
  console.log(
    `check-release-age: ${all.length} versions added since ${branch}, ${young.length} under ${COOLDOWN_DAYS} days old`
  )
  for (const [id, advisories] of exempt)
    console.log(`  ${id}  exempt: fixes ${advisories.join(', ')}`)
  for (const { id, publishedAt } of young)
    console.error(`  ${id}  published ${publishedAt ?? 'at an unknown time'}`)
  return young.length === 0 ? 0 : 1
}

if (import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = await main(baseBranch(process.env))
