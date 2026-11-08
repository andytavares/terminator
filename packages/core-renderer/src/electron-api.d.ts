import type { ElectronAPI } from '../../core-shared/src/electron-api/api-type'

// The type comes from packages/core-shared/src/electron-api/manifest.ts; declare methods there.
declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
