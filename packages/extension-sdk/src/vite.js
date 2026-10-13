import { resolve } from 'node:path'

// Plain JavaScript, typed by vite.d.ts: a Vite config file loads it through
// Node, which does not run TypeScript from a package.

/**
 * The Vite config of an extension's view: `index.html` in the extension's
 * directory, built to `dist/` with relative URLs. That is the file a manifest's
 * `renderer` names and the core loads from disk.
 *
 * `chunkSizeWarningLimit` replaces Vite's 500 kB download-size default with the
 * view's own budget, in kB; a chunk past it warns, and CI fails on a warning.
 *
 * @param {string} directory
 * @param {{ plugins: import('vite').PluginOption[], chunkSizeWarningLimit?: number }} options
 * @returns {import('vite').UserConfig}
 */
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
