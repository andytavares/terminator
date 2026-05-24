import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import React from 'react'
import { MetricsBar } from '../../../../src/renderer/components/overview/MetricsBar'

describe('MetricsBar', () => {
  it('renders skeleton elements when system is null', () => {
    const { container } = render(<MetricsBar system={null} />)
    expect(container.querySelectorAll('.skeleton--metrics').length).toBeGreaterThan(0)
  })

  it('renders CPU percentage when metrics are provided', () => {
    render(
      <MetricsBar
        system={{
          cpuPercent: 42,
          memUsedBytes: 2 * 1024 ** 3,
          memTotalBytes: 8 * 1024 ** 3,
          netInBytesPerSec: 1024,
          netOutBytesPerSec: 512,
        }}
      />
    )
    expect(screen.getByText(/42%/)).toBeTruthy()
  })

  it('renders memory in GB format', () => {
    render(
      <MetricsBar
        system={{
          cpuPercent: 10,
          memUsedBytes: 2 * 1024 ** 3,
          memTotalBytes: 8 * 1024 ** 3,
          netInBytesPerSec: 0,
          netOutBytesPerSec: 0,
        }}
      />
    )
    expect(screen.getByText(/2\.0 \/ 8\.0 GB/)).toBeTruthy()
  })

  it('renders network rates', () => {
    render(
      <MetricsBar
        system={{
          cpuPercent: 0,
          memUsedBytes: 0,
          memTotalBytes: 1,
          netInBytesPerSec: 1024,
          netOutBytesPerSec: 512,
        }}
      />
    )
    expect(screen.getByText(/1 KB\/s/)).toBeTruthy()
  })

  it('renders network rates in MB/s for large values', () => {
    render(
      <MetricsBar
        system={{
          cpuPercent: 0,
          memUsedBytes: 0,
          memTotalBytes: 1,
          netInBytesPerSec: 2 * 1024 * 1024,
          netOutBytesPerSec: 0,
        }}
      />
    )
    expect(screen.getByText(/MB\/s/)).toBeTruthy()
  })

  it('renders network rates in B/s for tiny values', () => {
    render(
      <MetricsBar
        system={{
          cpuPercent: 0,
          memUsedBytes: 0,
          memTotalBytes: 1,
          netInBytesPerSec: 200,
          netOutBytesPerSec: 0,
        }}
      />
    )
    expect(screen.getByText(/200 B\/s/)).toBeTruthy()
  })

  it('applies red color at 90%+ CPU', () => {
    const { container } = render(
      <MetricsBar
        system={{
          cpuPercent: 95,
          memUsedBytes: 1,
          memTotalBytes: 8 * 1024 ** 3,
          netInBytesPerSec: 0,
          netOutBytesPerSec: 0,
        }}
      />
    )
    const fill = container.querySelector('.metrics-bar__bar-fill') as HTMLElement
    // Browser normalises #e03131 to rgb(224, 49, 49)
    expect(fill.style.background).toMatch(/e03131|224.*49.*49/)
  })

  it('applies orange color at 70–89% CPU', () => {
    const { container } = render(
      <MetricsBar
        system={{
          cpuPercent: 75,
          memUsedBytes: 1,
          memTotalBytes: 8 * 1024 ** 3,
          netInBytesPerSec: 0,
          netOutBytesPerSec: 0,
        }}
      />
    )
    const fill = container.querySelector('.metrics-bar__bar-fill') as HTMLElement
    // Browser normalises #f08c00 to rgb(240, 140, 0)
    expect(fill.style.background).toMatch(/f08c00|240.*140.*0/)
  })
})
