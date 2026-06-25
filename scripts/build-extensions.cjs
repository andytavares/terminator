'use strict'

const { build } = require('esbuild')
const { resolve } = require('path')
const { readdirSync, existsSync } = require('fs')
const { execSync } = require('child_process')

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
    ],
    logLevel: 'info',
  })

  // Build the renderer (webview bundle) when a vite renderer config is present.
  if (existsSync(resolve(extDir, 'vite.renderer.config.ts'))) {
    console.log(`Building renderer for ${name}...`)
    execSync('npm run build:renderer', { cwd: extDir, stdio: 'inherit' })
  }
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
