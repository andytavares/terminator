'use strict'

const { build } = require('esbuild')
const { resolve } = require('path')
const { readdirSync, existsSync } = require('fs')
const { spawn } = require('child_process')

const root = resolve(__dirname, '..')
const extensionsDir = resolve(root, 'extensions')

// Asynchronous so the extensions' renderer builds run side by side; execSync
// blocked the event loop and serialised them.
function run(command, args, cwd) {
  return new Promise((done, fail) => {
    spawn(command, args, { cwd, stdio: 'inherit' }).on('exit', (code) =>
      code === 0 ? done() : fail(new Error(`${command} ${args.join(' ')} exited ${code} in ${cwd}`))
    )
  })
}

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
      // Remote Control's server. Root dependencies, resolved from node_modules
      // at runtime; bundled, they made a 2.1 MB main-process file.
      'fastify',
      '@fastify/static',
      '@fastify/websocket',
      'bcryptjs',
    ],
    logLevel: 'info',
  })

  // Build the renderer (webview bundle) when a vite renderer config is present.
  if (existsSync(resolve(extDir, 'vite.renderer.config.ts'))) {
    console.log(`Building renderer for ${name}...`)
    await run('npm', ['run', 'build:renderer'], extDir)
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
