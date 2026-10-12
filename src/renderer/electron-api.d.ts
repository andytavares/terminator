import type { ElectronAPI } from '../shared/electron-api/api-type'

// The type comes from src/shared/electron-api/manifest.ts; declare methods there.
declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
