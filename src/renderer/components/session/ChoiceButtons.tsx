import React from 'react'
import type { ChoicePrompt } from '../../../shared/types/index'
import './ChoiceButtons.css'

interface Props {
  prompt: ChoicePrompt
  onAnswer: (number: number) => void
}

/** A waiting agent's numbered choices, answerable without opening its terminal. */
export function ChoiceButtons({ prompt, onAnswer }: Props): JSX.Element {
  return (
    <div
      role="group"
      aria-label={prompt.question}
      className="choice-buttons"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {prompt.options.map((option, i) => (
        <button
          key={option.number}
          type="button"
          aria-label={`${option.number}. ${option.label}`}
          title={option.label}
          className={`choice-buttons__option${i === 0 ? ' choice-buttons__option--first' : ''}`}
          onClick={() => onAnswer(option.number)}
        >
          <span className="choice-buttons__number">{option.number}</span>
          <span className="choice-buttons__label">{option.label}</span>
        </button>
      ))}
    </div>
  )
}
