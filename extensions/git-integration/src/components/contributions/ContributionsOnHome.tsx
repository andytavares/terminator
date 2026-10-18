import React, { useEffect, useState } from 'react'
import { ContributionsSection } from './ContributionsSection'

export const SHOW_CONTRIBUTIONS_KEY = 'terminator.git-integration.home.showContributions'

/** Home's Contributions section, while "Show contributions on Home" is on; follows the switch live. */
export function ContributionsOnHome(): JSX.Element | null {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const read = () =>
      void window.electronAPI.extension
        .getSettingsValues()
        .then(({ values }) => setShown(values[SHOW_CONTRIBUTIONS_KEY] !== false))
        .catch(() => setShown(true))
    read()
    return window.electronAPI.extension.onSettingsChanged(read)
  }, [])
  return shown ? <ContributionsSection /> : null
}
