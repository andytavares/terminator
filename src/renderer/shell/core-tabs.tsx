import React, { Suspense, createElement, lazy, useEffect } from 'react'
import { House, LayoutGrid } from 'lucide-react'
import { useExtensionRegistry } from '../extensions/registry'

// Opened on demand, so it is its own chunk rather than part of the first
// script (https://react.dev/reference/react/lazy).
const OverviewScreen = lazy(() =>
  import('../components/overview/OverviewScreen').then((m) => ({ default: m.OverviewScreen }))
)
const HomeScreen = lazy(() =>
  import('../components/home/HomeScreen').then((m) => ({ default: m.HomeScreen }))
)

/** Registers core's two app-level destinations, Home and Overview, and opens on Home. Home is
 * registered first so it sits first in the band. */
export function useCoreTabs(openQuickActions: () => void): void {
  useEffect(() => {
    return useExtensionRegistry.getState().registerGlobalTab({
      id: 'core.home',
      label: 'Home',
      icon: createElement(House),
      component: () => (
        <Suspense fallback={null}>
          <HomeScreen onOpenQuickActions={openQuickActions} />
        </Suspense>
      ),
      permanent: true,
    })
  }, [openQuickActions])

  // Home is where the app opens.
  useEffect(() => {
    useExtensionRegistry.getState().setActiveGlobalTab('core.home')
  }, [])

  useEffect(() => {
    return useExtensionRegistry.getState().registerGlobalTab({
      id: 'core.overview',
      label: 'Overview',
      icon: createElement(LayoutGrid),
      component: OverviewScreen,
      permanent: true,
    })
  }, [])
}
