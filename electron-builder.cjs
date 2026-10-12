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
  // Nothing to rebuild: the one native module, node-pty, loads the N-API
  // prebuild it ships for the platform (node_modules/node-pty/lib/utils.js),
  // which does not depend on Electron's ABI. Rebuilding failed outright for
  // Electron 44: "Could not detect abi for version 44.7.0" (@electron/rebuild's node-abi).
  npmRebuild: false,
  files: [
    'out/**/*',
    // The bundled extensions, where main looks for them: app.asar/extensions
    // (join(__dirname, '../../extensions') from out/main). Everything an
    // extension reads at run time ships, its built backend and view and its
    // data (Foundry's roles, rules, recipes, skills, sensors, fonts); its
    // sources and tests do not.
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
    // The packages the extension backends require at run time. electron-builder
    // ships only the root package's dependencies, and these are the
    // extensions' own (Constitution II), so they go beside the extensions,
    // where Node finds them from extensions/<name>/src/index.js.
    {
      from: 'node_modules',
      to: 'extensions/node_modules',
      filter: extensionRuntimeModules(__dirname, EXTENSION_EXTERNALS).map((name) => `${name}/**/*`),
    },
  ],
  // Only the two binary assets need to be unpacked — they are read explicitly via
  // readFileSync when the one-time import opens app.pglite (ADR 099,
  // src/main/db/legacy-pglite-import.ts). Unpacking all of @electric-sql/pglite
  // breaks Electron's ESM dynamic import handler: when pglite's JS modules are in
  // app.asar.unpacked, `import("./fs/nodefs.js")` inside pglite fails to resolve
  // through the asar virtual path, so the NodeFS adapter never loads, and
  // pg_initdb aborts. Keeping JS inside the asar lets dynamic imports work
  // normally while readFileSync for the two binary files is redirected to
  // app.asar.unpacked by Electron's asar fs interception.
  // These entries go when PGlite is removed, one release after the import ships.
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
