import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GateEvidence } from '../../src/components/GateEvidence'

describe('GateEvidence', () => {
  it('shows the failed step’s last lines, labelled in words', () => {
    render(
      <GateEvidence
        evidence={[
          {
            kind: 'stdout',
            exitCode: 1,
            path: '/data/orders/WO-1/runs/final-integration.1.log',
            excerpt: 'Error: Process failed to launch!',
          },
        ]}
      />
    )
    expect(screen.getByText('Last lines of the output')).toBeTruthy()
    expect(screen.getByText('Error: Process failed to launch!')).toBeTruthy()
    expect(screen.getByText(/final-integration\.1\.log/)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/\bstdout\b/)
  })

  it('names evidence without an excerpt in words, never by its kind code', () => {
    render(
      <GateEvidence evidence={[{ kind: 'exit_code', exitCode: 2 }, { kind: 'report_file' }]} />
    )
    expect(screen.getByText('Exit code 2')).toBeTruthy()
    expect(screen.getByText('A report file')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/exit_code|report_file/)
  })

  it('renders nothing when there is no evidence', () => {
    const { container } = render(<GateEvidence evidence={[]} />)
    expect(container.textContent).toBe('')
  })
})
