import { describe, it, expect } from 'vitest'
import { build } from 'esbuild'
import { builtinModules } from 'node:module'
import { resolve } from 'node:path'

// Vite replaces a Node builtin in the renderer with an empty stub and only
// warns, so `path.basename` in a module the renderer reaches is undefined at
// runtime while the build stays green.
describe('the Foundry renderer bundle', () => {
  it('imports no Node builtin', async () => {
    const builtins = new Set(builtinModules)
    const reached: string[] = []

    await build({
      entryPoints: [resolve(__dirname, '../../src/renderer/main.tsx')],
      bundle: true,
      write: false,
      logLevel: 'silent',
      loader: { '.css': 'empty', '.svg': 'empty', '.png': 'empty', '.woff2': 'empty' },
      plugins: [
        {
          name: 'record-node-builtins',
          setup(b) {
            b.onResolve({ filter: /.*/ }, (args) => {
              const bare = args.path.replace(/^node:/, '')
              if (!args.path.startsWith('node:') && !builtins.has(bare)) return undefined
              reached.push(`${args.path} <- ${args.importer.split('/src/')[1]}`)
              return { path: args.path, external: true }
            })
          },
        },
      ],
    })

    expect(reached).toEqual([])
  }, 30_000)
})
