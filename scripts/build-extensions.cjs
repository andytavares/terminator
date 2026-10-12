'use strict'

const { build } = require('esbuild')
const { resolve } = require('path')
const { readdirSync, existsSync, readFileSync } = require('fs')
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

// esbuild has no `?raw` import; the design system reads its stylesheets that way.
const rawTextImports = {
  name: 'raw-text-imports',
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, (args) => ({
      path: resolve(args.resolveDir, args.path.slice(0, -'?raw'.length)),
      namespace: 'raw-text',
    }))
    build.onLoad({ filter: /.*/, namespace: 'raw-text' }, (args) => ({
      contents: readFileSync(args.path, 'utf8'),
      loader: 'text',
    }))
  },
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
    plugins: [rawTextImports],
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
      // Git Integration's parser. Loads its .wasm files relative to its own
      // module path, which a bundle would move.
      'web-tree-sitter',
      '@vscode/tree-sitter-wasm',
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
