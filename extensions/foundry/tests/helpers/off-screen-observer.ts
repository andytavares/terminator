import { vi } from 'vitest'

/** jsdom has no IntersectionObserver; Electron does. A card behind this one never scrolls into
 *  view, so a `HallThumbnail` fetches nothing. The root config unstubs globals after each test. */
export function stubOffScreenObserver(): void {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    }
  )
}
