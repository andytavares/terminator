import React from 'react'
import { SegmentedControl } from '@terminator/extension-ui'
import type { RunAs, RunAsOption } from './start-work'

interface RunAsChoicesProps {
  options: RunAsOption[]
  runAs: RunAs
  onPick: (value: RunAs) => void
}

/** The "Run it as" radio group: Claude agent, Terminal only, and each extension's option. */
export function RunAsChoices({ options, runAs, onPick }: RunAsChoicesProps): JSX.Element {
  return (
    <SegmentedControl
      label="Run it as"
      className="start-work__options"
      value={runAs}
      onChange={onPick}
      options={options.map((option) => ({
        value: option.value,
        accessibleName: option.label,
        label: (
          <>
            <span className="start-work__radio" aria-hidden="true" />
            <span>
              {option.label}
              <small>{option.hint}</small>
            </span>
          </>
        ),
      }))}
    />
  )
}
