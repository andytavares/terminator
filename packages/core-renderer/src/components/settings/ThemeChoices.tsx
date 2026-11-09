import React from 'react'
import { recordUse } from '../../usage/record'

type Theme = 'dark' | 'light'

interface ThemeChoicesProps {
  checked: Theme | undefined
  onChange: (theme: Theme) => void
}

/** The Dark and Light radios of a settings section's theme field. */
export function ThemeChoices({ checked, onChange }: ThemeChoicesProps): React.JSX.Element {
  return (
    <>
      {(['dark', 'light'] as const).map((t) => (
        <label key={t} className="settings-section__radio">
          <input
            type="radio"
            value={t}
            checked={checked === t}
            onChange={() => {
              recordUse('core.settings.theme')
              onChange(t)
            }}
          />
          {t.charAt(0).toUpperCase() + t.slice(1)}
        </label>
      ))}
    </>
  )
}
