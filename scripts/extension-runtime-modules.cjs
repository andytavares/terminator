'use strict'

// The npm packages the bundled extensions need at run time in the packaged app, which
// electron-builder does not ship (docs/CONTRIBUTING.md, "Packaging"): the closure of their
// `externals`, resolved through package-lock.json as Node would, as node_modules directories.

const { existsSync, readFileSync, readdirSync } = require('fs')
const { join } = require('path')

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** `extensions/<name>` for each directory with a manifest. */
function extensionLocations(root) {
  return readdirSync(join(root, 'extensions'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `extensions/${entry.name}`)
    .filter((location) => existsSync(join(root, location, 'manifest.json')))
}

/** Where Node finds `name` from the package at `from`: its own node_modules, then each parent's. */
function resolveLocation(packages, from, name) {
  let base = from
  for (;;) {
    const candidate = `${base ? `${base}/` : ''}node_modules/${name}`
    if (packages[candidate]) return candidate
    if (!base) return null
    const parent = base.lastIndexOf('/node_modules/')
    base = parent === -1 ? '' : base.slice(0, parent)
  }
}

/** What a lockfile entry needs installed beside it: dependencies, and peers that are not optional. */
function requiredNames(entry) {
  const optionalPeers = entry.peerDependenciesMeta ?? {}
  const peers = Object.keys(entry.peerDependencies ?? {}).filter((n) => !optionalPeers[n]?.optional)
  return {
    names: [...Object.keys(entry.dependencies ?? {}), ...peers],
    optional: entry.optionalDependencies ?? {},
  }
}

function collect(packages, from, found) {
  const { names, optional } = requiredNames(packages[from])
  for (const name of [...names, ...Object.keys(optional)]) {
    const location = resolveLocation(packages, from, name)
    if (!location && name in optional) continue
    if (!location) throw new Error(`${name}, needed by ${from}, is not in package-lock.json`)
    if (found.has(location)) continue
    found.add(location)
    collect(packages, location, found)
  }
}

/** The top-level node_modules directory a lockfile location lives in, e.g. `@fastify/static`. */
function topLevelDirectory(location) {
  const [root, scopeOrName, name] = location.split('/')
  // Everything is hoisted today; a package installed under an extension would need its own copy rule.
  if (root !== 'node_modules') throw new Error(`${location} is not in the root node_modules`)
  return scopeOrName.startsWith('@') ? `${scopeOrName}/${name}` : scopeOrName
}

/** Every extension's dependencies that its backend requires, those in `externals`
 * except Electron itself, as a lockfile entry to walk from. */
function runtimeEntry(root, location, externals) {
  const declared = readJson(join(root, location, 'package.json')).dependencies ?? {}
  const required = Object.entries(declared).filter(
    ([name]) => externals.includes(name) && name !== 'electron'
  )
  return { dependencies: Object.fromEntries(required) }
}

function extensionRuntimeModules(root, externals) {
  const { packages } = readJson(join(root, 'package-lock.json'))
  const found = new Set()
  for (const location of extensionLocations(root)) {
    const entry = runtimeEntry(root, location, externals)
    collect({ ...packages, [location]: entry }, location, found)
  }
  return [...new Set([...found].map(topLevelDirectory))].sort()
}

module.exports = { extensionRuntimeModules }
