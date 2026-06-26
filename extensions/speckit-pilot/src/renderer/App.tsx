import React, { useEffect, useState } from 'react'
import { SpecKitPilotView } from '../components/SpecKitPilotView'

export function App(): JSX.Element {
  const [repoRoot, setRepoRoot] = useState<string | null>(
    new URLSearchParams(window.location.search).get('repoRoot')
  )

  useEffect(() => {
    return window.electronAPI.extensionBridge.on('workspace:changed', (data: unknown) => {
      const d = data as { repoRoot?: string | null }
      setRepoRoot(d.repoRoot ?? null)
    })
  }, [])

  return <SpecKitPilotView repoRoot={repoRoot} />
}
