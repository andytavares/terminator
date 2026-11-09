// Bundles termctl and its dependencies into one file the app ships (apps/termctl/dist/termctl.mjs).
// An argument names another output file; the specs build into their own temp folder.
import { build } from 'esbuild'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

// Ink loads React DevTools only when DEV=true and the package is installed. It is not installed,
// and esbuild bundles the import into the top of the file, so it resolves to an empty module.
const withoutDevtools = {
  name: 'without-react-devtools',
  setup(build) {
    build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
      path: 'empty',
      namespace: 'empty',
    }))
    build.onLoad({ filter: /.*/, namespace: 'empty' }, () => ({ contents: 'export default {}' }))
  },
}

await build({
  entryPoints: [resolve(root, 'apps/termctl/src/bin.ts')],
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  outfile: resolve(process.argv[2] ?? resolve(root, 'apps/termctl/dist/termctl.mjs')),
  // Ink's CommonJS dependencies, such as signal-exit, call require() on Node's own modules.
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire } from 'node:module'\nconst require = createRequire(import.meta.url)",
  },
  plugins: [withoutDevtools],
  logLevel: 'warning',
})
