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
})

describe('MetricsBar — renders memory in GB format', () => {
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
})

describe('MetricsBar — network rates', () => {
  it.each([
    [200, '200 B/s'],
    [1024, '1 KB/s'],
    [2 * 1024 * 1024, '2.0 MB/s'],
  ])('renders %i bytes per second in as %s', (netInBytesPerSec, rate) => {
    render(
      <MetricsBar
        system={{
          cpuPercent: 0,
          memUsedBytes: 0,
          memTotalBytes: 1,
          netInBytesPerSec,
          netOutBytesPerSec: 0,
        }}
      />
    )
    expect(screen.getByText(`↓ ${rate} ↑ 0 B/s`)).toBeTruthy()
  })
})

describe('MetricsBar — CPU bar colour', () => {
  it.each([
    [95, /e03131|224.*49.*49/],
    [90, /e03131|224.*49.*49/],
    [75, /f08c00|240.*140.*0/],
    [50, /var\(--tm-accent\)/],
  ])('colours the CPU bar at %i%% as %s', (cpuPercent, colour) => {
    const { container } = render(
      <MetricsBar
        system={{
          cpuPercent,
          memUsedBytes: 1,
          memTotalBytes: 8 * 1024 ** 3,
          netInBytesPerSec: 0,
          netOutBytesPerSec: 0,
        }}
      />
    )
    const fill = container.querySelector('.metrics-bar__bar-fill') as HTMLElement
    // The browser normalises a hex colour to rgb().
    expect(fill.style.background).toMatch(colour)
  })
})
