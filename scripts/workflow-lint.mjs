#!/usr/bin/env node
// Lints .github/workflows with actionlint and, for their `run:` scripts, shellcheck: both pinned
// here by version and checksum, so CI and a laptop run the same binaries (ADR 123). Each is
// downloaded once into node_modules/.cache and checked before it is used.

import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = join(REPO_ROOT, 'node_modules', '.cache', 'workflow-lint')

const ACTIONLINT = 'https://github.com/rhysd/actionlint/releases/download/v1.7.12'
const SHELLCHECK = 'https://github.com/koalaman/shellcheck/releases/download/v0.11.0'

/** Each tool's release for each machine that lints: the Mac, and Linux on ARM, which CI's Ubuntu
 * jobs and ci:local's container run on. actionlint's checksums are its release's own
 * actionlint_1.7.12_checksums.txt; shellcheck publishes none, so its are the archives' when pinned. */
export const TOOLS = {
  actionlint: {
    version: '1.7.12',
    binary: 'actionlint',
    releases: {
      'darwin-arm64': {
        url: `${ACTIONLINT}/actionlint_1.7.12_darwin_arm64.tar.gz`,
        sha256: 'aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f',
      },
      'linux-arm64': {
        url: `${ACTIONLINT}/actionlint_1.7.12_linux_arm64.tar.gz`,
        sha256: '325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6',
      },
    },
  },
  shellcheck: {
    version: '0.11.0',
    binary: 'shellcheck-v0.11.0/shellcheck',
    releases: {
      'darwin-arm64': {
        url: `${SHELLCHECK}/shellcheck-v0.11.0.darwin.aarch64.tar.gz`,
        sha256: '339b930feb1ea764467013cc1f72d09cd6b869ebf1013296ba9055ab2ffbd26f',
      },
      'linux-arm64': {
        url: `${SHELLCHECK}/shellcheck-v0.11.0.linux.aarch64.tar.gz`,
        sha256: '68a8133197a50beb8803f8d42f9908d1af1c5540d4bb05fdfca8c1fa47decefc',
      },
    },
  },
}

/** The tool's pinned release for this machine, or an error naming the machine. */
export function releaseFor(name, platform, arch) {
  const release = TOOLS[name].releases[`${platform}-${arch}`]
  if (!release) throw new Error(`${name} is pinned for no ${platform}-${arch} release.`)
  return release
}

/** `bytes`, when they are the archive pinned; otherwise an error naming both checksums. */
export function checkedArchive(bytes, sha256) {
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== sha256) {
    throw new Error(`Downloaded archive has checksum ${actual}, expected ${sha256}.`)
  }
  return bytes
}

/** actionlint's arguments: the pinned shellcheck, and no pyflakes whatever PATH holds. */
export function actionlintArguments(shellcheck) {
  return ['-color', '-shellcheck', shellcheck, '-pyflakes=']
}

/** The tool's binary, downloaded, checked and unpacked on first use. */
async function installed(name) {
  const tool = TOOLS[name]
  const release = releaseFor(name, process.platform, process.arch)
  const dir = join(CACHE, `${name}-${tool.version}-${process.platform}-${process.arch}`)
  const binary = join(dir, tool.binary)
  if (existsSync(binary)) return binary
  const response = await fetch(release.url)
  if (!response.ok) throw new Error(`Could not download ${name}: HTTP ${response.status}`)
  const archive = join(dir, 'release.tar.gz')
  mkdirSync(dir, { recursive: true })
  writeFileSync(archive, checkedArchive(Buffer.from(await response.arrayBuffer()), release.sha256))
  execFileSync('tar', ['-xzf', archive, '-C', dir])
  chmodSync(binary, 0o755)
  return binary
}

async function main() {
  const actionlint = await installed('actionlint')
  const shellcheck = await installed('shellcheck')
  const args = [...actionlintArguments(shellcheck), ...process.argv.slice(2)]
  const run = spawnSync(actionlint, args, { cwd: REPO_ROOT, stdio: 'inherit' })
  process.exit(run.status ?? 1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
