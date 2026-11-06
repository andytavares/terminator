import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useScheduledRuns } from '../../../../src/renderer/components/home/start-work-schedule'
import { installElectronApi } from '../../../support/electron-api'

describe('useScheduledRuns', () => {
  it('does nothing in the remote browser client, which has no schedules API', () => {
    installElectronApi({})
    expect(() => renderHook(() => useScheduledRuns())).not.toThrow()
  })
})
