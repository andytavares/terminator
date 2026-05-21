'use strict'

const { build } = require('esbuild')
const { resolve } = require('path')
const { readdirSync, existsSync } = require('fs')

const root = resolve(__dirname, '..')
const extensionsDir = resolve(root, 'extensions')

async function buildExtension(name) {
  const extDir = resolve(extensionsDir, name)
  const entry = resolve(extDir, 'src', 'index.ts')
  const manifest = resolve(extDir, 'manifest.json')

  if (!existsSync(entry) || !existsSync(manifest)) return

  const { main } = require(manifest)
  const outfile = resolve(extDir, main)

  await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outfile,
    external: [
      'electron',
      'electron-store',
      'zod',
      'node-pty',
      'chokidar',
      'fsevents',
      'gray-matter',
      'node-ical',
      '@modelcontextprotocol/sdk',
      'better-sqlite3',
    ],
    logLevel: 'info',
  })
}

async function main() {
  const names = readdirSync(extensionsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)

  await Promise.all(names.map(buildExtension))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
