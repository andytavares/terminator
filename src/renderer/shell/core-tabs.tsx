import React, { Suspense, createElement, lazy, useEffect } from 'react'
import { ChartLine, House, LayoutGrid } from 'lucide-react'
import { useExtensionRegistry } from '../extensions/registry'
import { recordUse } from '../usage/record'

// Opened on demand, so it is its own chunk rather than part of the first
// script (https://react.dev/reference/react/lazy).
const OverviewScreen = lazy(() =>
  import('../components/overview/OverviewScreen').then((m) => ({ default: m.OverviewScreen }))
)
const HomeScreen = lazy(() =>
  import('../components/home/HomeScreen').then((m) => ({ default: m.HomeScreen }))
)
const UsageScreen = lazy(() =>
  import('../components/usage/UsageScreen').then((m) => ({ default: m.UsageScreen }))
)

/** Registers core's app-level destinations, Home, Overview and Usage, and opens on Home. Home
 * is registered first so it sits first in the band. */
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

  useUsageTab()
}

/** Usage is a review screen: it takes no place in the app band, so a menu item and a quick
 * action open it. The remote window has no menu events. */
function useUsageTab(): void {
  useEffect(() => {
    const unregister = useExtensionRegistry.getState().registerGlobalTab({
      id: 'core.usage',
      label: 'Usage',
      icon: createElement(ChartLine),
      component: () => (
        <Suspense fallback={null}>
          <UsageScreen />
        </Suspense>
      ),
      hidden: true,
    })
    const unsubscribe = window.electronAPI.extensionEvents?.onMenuOpenUsage?.(() => {
      useExtensionRegistry.getState().setActiveGlobalTab('core.usage')
      recordUse('core.open-usage', 'menu')
    })
    return () => {
      unregister()
      unsubscribe?.()
    }
  }, [])
}
