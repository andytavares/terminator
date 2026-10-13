import type { PluginOption, UserConfig } from 'vite'

/** The Vite config of an extension's view; see vite.js. */
export function extensionViewConfig(
  directory: string,
  options: { plugins: PluginOption[]; chunkSizeWarningLimit?: number }
): UserConfig
