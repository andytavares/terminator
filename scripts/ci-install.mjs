// The install ci:local runs before its checks, on the Mac and in its Linux container: again only
// when package-lock.json differs from the one the last install was made from.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const lockHash = (lockfile) => createHash('sha256').update(lockfile).digest('hex')

/** Whether the lockfile differs from the one the last install in node_modules was made from. */
export const needsInstall = (currentHash, recordedHash) =>
  recordedHash === null || recordedHash.trim() !== currentHash

/** Installs in `where` when the lockfile changed. `recorded()` is the last install's hash or
 * null; `install(hash)` installs, records `hash`, and says whether it succeeded. */
export function installIfLockChanged(checkout, { where, recorded, install }) {
  const current = lockHash(readFileSync(join(checkout, 'package-lock.json')))
  if (!needsInstall(current, recorded()))
    return console.log(`Install (${where}): package-lock.json unchanged, keeping node_modules.`)
  console.log(`Install (${where}): package-lock.json changed, running npm ci.`)
  if (!install(current)) throw new Error(`ci:local could not install (${where}).`)
}
