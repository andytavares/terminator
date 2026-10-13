import React, { createElement, lazy, useEffect } from 'react'
import { House, LayoutGrid } from 'lucide-react'
import { useExtensionRegistry } from '../extensions/registry'
import { HomeScreen } from '../components/home/HomeScreen'

// Opened on demand, so it is its own chunk rather than part of the first
// script (https://react.dev/reference/react/lazy).
const OverviewScreen = lazy(() =>
  import('../components/overview/OverviewScreen').then((m) => ({ default: m.OverviewScreen }))
)

/**
 * Registers core's two app-level destinations, Home and Overview, and opens
 * on Home. Home is registered first so it sits first in the band.
 */
export function useCoreTabs(openQuickActions: () => void): void {
  useEffect(() => {
    return useExtensionRegistry.getState().registerGlobalTab({
      id: 'core.home',
      label: 'Home',
      icon: createElement(House),
      component: () => <HomeScreen onOpenQuickActions={openQuickActions} />,
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
