import { resolve } from 'node:path'

// Plain JavaScript, typed by vite.d.ts: a Vite config file loads it through
// Node, which does not run TypeScript from a package.

/** The Vite config of an extension's view; vite.d.ts types and documents it. */
export function extensionViewConfig(directory, { plugins, chunkSizeWarningLimit }) {
  return {
    root: directory,
    base: './',
    plugins,
    build: {
      ...(chunkSizeWarningLimit === undefined ? {} : { chunkSizeWarningLimit }),
      outDir: resolve(directory, 'dist'),
      emptyOutDir: true,
      rollupOptions: { input: resolve(directory, 'index.html') },
    },
  }
}
