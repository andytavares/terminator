import React from 'react'
import type { RunAs, RunAsOption } from './start-work'

interface RunAsChoicesProps {
  options: RunAsOption[]
  runAs: RunAs
  onPick: (value: RunAs) => void
}

/** The "Run it as" radio group: Claude agent, Terminal only, and each extension's option. */
export function RunAsChoices({ options, runAs, onPick }: RunAsChoicesProps): JSX.Element {
  return (
    <div role="radiogroup" aria-label="Run it as" className="start-work__options">
      {options.map((option) => (
        <div
          key={option.value}
          role="radio"
          aria-checked={runAs === option.value}
          aria-label={option.label}
          className="start-work__option"
          onClick={() => onPick(option.value)}
        >
          <span className="start-work__radio" aria-hidden="true" />
          <span>
            {option.label}
            <small>{option.hint}</small>
          </span>
        </div>
      ))}
    </div>
  )
}
