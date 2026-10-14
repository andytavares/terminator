'use strict'

// electron-builder configuration (https://www.electron.build/configuration).
// JavaScript rather than YAML because the extensions' run-time packages are
// computed from package-lock.json at packaging time.

const { EXTENSION_EXTERNALS } = require('./scripts/extension-externals.cjs')
const { extensionRuntimeModules } = require('./scripts/extension-runtime-modules.cjs')

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.terminator.app',
  productName: 'Terminator',
  directories: { output: 'dist' },
  // node-pty loads the N-API prebuild it ships, which needs no rebuild for
  // Electron's ABI. Why: docs/CONTRIBUTING.md, "Packaging".
  npmRebuild: false,
  files: [
    'out/**/*',
    // The bundled extensions, at app.asar/extensions where main looks for them.
    // What they read at run time ships (built code, data, fonts); sources and tests do not.
    {
      from: 'extensions',
      to: 'extensions',
      filter: [
        '**/*',
        '!*/node_modules{,/**}',
        '!*/tests{,/**}',
        '!**/*.{ts,tsx,map}',
        '!*/tsconfig.json',
        // Vite's input; the built page is dist/index.html.
        '!*/index.html',
      ],
    },
    // The extensions' own run-time packages (Constitution II), which electron-builder
    // does not ship by itself; Node finds them here from extensions/<name>/src/index.js.
    {
      from: 'node_modules',
      to: 'extensions/node_modules',
      filter: extensionRuntimeModules(__dirname, EXTENSION_EXTERNALS).map((name) => `${name}/**/*`),
    },
  ],
  // Only PGlite's two binaries, never its JS: unpacked JS breaks its dynamic
  // imports (docs/CONTRIBUTING.md, "Packaging"). They go with PGlite (ADR 099).
  asarUnpack: [
    '**/node_modules/@electric-sql/pglite/dist/postgres.wasm',
    '**/node_modules/@electric-sql/pglite/dist/postgres.data',
  ],
  mac: {
    icon: 'resources/icon.png',
    target: [{ target: 'dmg', arch: 'arm64' }],
    category: 'public.app-category.developer-tools',
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'resources/entitlements.mac.plist',
    entitlementsInherit: 'resources/entitlements.mac.plist',
    notarize: true,
  },
}
