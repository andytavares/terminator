import type { PluginOption, UserConfig } from 'vite'

/** The Vite config of an extension's view: `index.html` built to `dist/` with relative URLs, the
 * file a manifest's `renderer` names. `chunkSizeWarningLimit` (kB) replaces Vite's 500 kB default;
 * a chunk past it warns, and CI fails on a warning. */
export function extensionViewConfig(
  directory: string,
  options: { plugins: PluginOption[]; chunkSizeWarningLimit?: number }
): UserConfig
