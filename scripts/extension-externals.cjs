'use strict'

// Packages an extension backend requires at run time instead of bundling: the
// esbuild `external` list (scripts/build-extensions.cjs), and so what the
// packaged app ships beside the extensions (electron-builder.cjs).
const EXTENSION_EXTERNALS = [
  'electron',
  'electron-store',
  'zod',
  'node-pty',
  'chokidar',
  'fsevents',
  'gray-matter',
  'node-ical',
  '@modelcontextprotocol/sdk',
  // Remote Control's server. Resolved from node_modules at runtime; bundled,
  // they made a 2.1 MB main-process file.
  'fastify',
  '@fastify/static',
  '@fastify/websocket',
  // Git Integration's parser. Loads its .wasm files relative to its own
  // module path, which a bundle would move.
  'web-tree-sitter',
  '@vscode/tree-sitter-wasm',
]

module.exports = { EXTENSION_EXTERNALS }
