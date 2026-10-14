import { create } from 'zustand'

/** The extension views on screen now, by view key, each with its extension id. A shown view
 * covers the core's toast region, so that extension draws its own toasts (see useNotificationFeed). */
interface ShownExtensionViews {
  shown: Map<string, string>
  show(viewKey: string, extensionId: string): void
  hide(viewKey: string): void
}

export const useShownExtensionViews = create<ShownExtensionViews>((set) => ({
  shown: new Map(),
  show: (viewKey, extensionId) =>
    set((s) => ({ shown: new Map(s.shown).set(viewKey, extensionId) })),
  hide: (viewKey) =>
    set((s) => {
      const shown = new Map(s.shown)
      shown.delete(viewKey)
      return { shown }
    }),
}))

/** Whether a view of this extension is on screen. */
export function isExtensionViewShown(extensionId: string | undefined): boolean {
  return [...useShownExtensionViews.getState().shown.values()].includes(extensionId ?? '')
}
