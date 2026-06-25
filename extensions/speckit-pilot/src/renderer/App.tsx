import React from 'react'
import { SpecKitPilotView } from '../components/SpecKitPilotView'

export function App(): JSX.Element {
  const repoRoot = new URLSearchParams(window.location.search).get('repoRoot')
  return <SpecKitPilotView repoRoot={repoRoot} />
}
