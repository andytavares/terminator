import React, { useCallback, useEffect, useState } from 'react'
import { getFoundryAPI, type ModelChoiceView } from '../types/electron.js'

// What is left for a bespoke settings surface.
//
// Everything Foundry can be configured with is registered through the
// application's own settings API, which renders it — the data root, the
// autonomy dial, the budgets, the write-backs, the critical paths. That is
// where they belong: one settings surface, not two.
//
// The model picker stays here because the list and the current choice must not
// drift apart, and the list is fetched rather than hardcoded: the last one that
// was hardcoded sat naming a superseded generation until somebody noticed.

export function SettingsView(): JSX.Element {
  const [models, setModels] = useState<ModelChoiceView[]>([])
  const [selected, setSelected] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const answer = await getFoundryAPI().modelsList()
        // Defensive on purpose: a channel that answers oddly should cost the
        // operator a message, not a blank settings page.
        setModels(Array.isArray(answer?.models) ? answer.models : [])
        setSelected(typeof answer?.selected === 'string' ? answer.selected : '')
      } catch {
        setProblem('Could not read the model list.')
      }
    })()
  }, [])

  const choose = useCallback(async (id: string) => {
    setSaving(true)
    setProblem(null)
    try {
      const result = await getFoundryAPI().modelSet({ model: id })
      if ('error' in result) {
        setProblem(result.error)
        return
      }
      setSelected(id)
    } finally {
      setSaving(false)
    }
  }, [])

  return (
    <div className="fdry-settings">
      <h2 className="fdry-panel-h">Model</h2>
      <p className="fdry-note">
        What every agent runs on unless a role asks for something else. An alias never goes stale
        the way a pinned identifier does.
      </p>

      <ul className="fdry-models">
        {models.map((model) => (
          <li key={model.id || 'inherit'}>
            <button
              type="button"
              aria-pressed={model.id === selected}
              className={model.id === selected ? 'is-on' : ''}
              disabled={saving}
              onClick={() => void choose(model.id)}
            >
              <b>{model.label}</b>
              <small>
                {model.floating ? 'alias — follows the latest of its family' : model.id}
              </small>
            </button>
          </li>
        ))}
      </ul>

      {problem !== null ? <p className="fdry-problem">{problem}</p> : null}

      <h2 className="fdry-panel-h" style={{ marginTop: 20 }}>
        Everything else
      </h2>
      <p className="fdry-note">
        The records location, the autonomy dial, the budgets, tracker write-backs and your critical
        paths are in the application&rsquo;s own settings, under Foundry.
      </p>
    </div>
  )
}
