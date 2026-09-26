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
//
// Sensors stay here too, for the same reason as the model picker: enabling
// one needs a repository picked before the channel will take it, and a
// bespoke row is where "here is why it refused" gets shown next to the
// control that caused it.

interface SensorState {
  readonly enabled: boolean
  readonly repoPath: string | null
  readonly lastRunAt: string | null
  readonly lastProblem: string | null
}

interface SensorRow {
  readonly def: { readonly id: string; readonly description: string }
  readonly rung: string
  readonly state: SensorState
  readonly nextDueAt: string | null
}

function invoke(channel: string, payload: unknown = {}): Promise<unknown> {
  return window.electronAPI.extensionBridge.invoke(channel, payload)
}

export function SettingsView(): JSX.Element {
  const [models, setModels] = useState<ModelChoiceView[]>([])
  const [selected, setSelected] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const [sensors, setSensors] = useState<SensorRow[]>([])
  const [repoDrafts, setRepoDrafts] = useState<Record<string, string>>({})
  const [sensorProblems, setSensorProblems] = useState<Record<string, string>>({})
  const [runNotes, setRunNotes] = useState<Record<string, string>>({})

  const refreshSensors = useCallback(async () => {
    const answer = (await invoke('foundry:sensors.list')) as { sensors?: SensorRow[] }
    const rows = answer.sensors ?? []
    setSensors(rows)
    setRepoDrafts((current) => {
      const next = { ...current }
      for (const row of rows) {
        if (next[row.def.id] === undefined) next[row.def.id] = row.state.repoPath ?? ''
      }
      return next
    })
  }, [])

  useEffect(() => {
    void refreshSensors()
  }, [refreshSensors])

  const setSensor = useCallback(
    async (id: string, patch: { enabled?: boolean; repoPath?: string | null }) => {
      setSensorProblems((current) => ({ ...current, [id]: '' }))
      const result = (await invoke('foundry:sensors.set', { id, ...patch })) as {
        error?: string
      }
      if (result.error !== undefined) {
        setSensorProblems((current) => ({ ...current, [id]: result.error as string }))
      }
      await refreshSensors()
    },
    [refreshSensors]
  )

  const toggleSensor = useCallback(
    (id: string, enabled: boolean) => {
      const repoPath = (repoDrafts[id] ?? '').trim() || null
      void setSensor(id, { enabled, repoPath })
    },
    [repoDrafts, setSensor]
  )

  const saveRepo = useCallback(
    (id: string) => {
      const repoPath = (repoDrafts[id] ?? '').trim() || null
      void setSensor(id, { repoPath })
    },
    [repoDrafts, setSensor]
  )

  const runNow = useCallback(
    async (id: string) => {
      const result = (await invoke('foundry:sensors.run-now', { id })) as {
        recorded?: number
        problem?: string | null
      }
      setRunNotes((current) => ({
        ...current,
        [id]:
          result.problem !== undefined && result.problem !== null
            ? result.problem
            : `Recorded ${result.recorded ?? 0}.`,
      }))
      await refreshSensors()
    },
    [refreshSensors]
  )

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
        What every agent runs on, unless its role asks for the fast tier — the scribe and the scout
        do. An alias never goes stale the way a pinned identifier does.
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
        Sensors
      </h2>
      <p className="fdry-note">
        What reads the product&rsquo;s own signals back into the factory. A sensor proposes nothing
        by itself — the signals it finds show up in the Inbox, to promote or dismiss.
      </p>

      <ul className="fdry-sensors">
        {sensors.map((row) => (
          <li key={row.def.id} className="fdry-sensor">
            <div className="fdry-sensor-head">
              <b>{row.def.description}</b>
              <span className="fdry-sensor-rung">{row.rung}</span>
              <label className="fdry-sensor-toggle">
                <input
                  type="checkbox"
                  aria-label={`Enable ${row.def.description}`}
                  checked={row.state.enabled}
                  onChange={(event) => toggleSensor(row.def.id, event.target.checked)}
                />
                Enabled
              </label>
            </div>

            <label className="fdry-sensor-repo">
              Repository
              <input
                type="text"
                aria-label={`Repository for ${row.def.description}`}
                value={repoDrafts[row.def.id] ?? ''}
                placeholder="/path/to/repo"
                onChange={(event) =>
                  setRepoDrafts((current) => ({ ...current, [row.def.id]: event.target.value }))
                }
                onBlur={() => saveRepo(row.def.id)}
              />
            </label>

            {sensorProblems[row.def.id] ? (
              <p className="fdry-problem">{sensorProblems[row.def.id]}</p>
            ) : null}

            <div className="fdry-sensor-meta">
              <span>Last run: {row.state.lastRunAt ?? 'never'}</span>
              <span>Next due: {row.nextDueAt ?? '—'}</span>
              {row.state.lastProblem !== null ? (
                <span>Last problem: {row.state.lastProblem}</span>
              ) : null}
            </div>

            <div className="fdry-sensor-actions">
              <button type="button" onClick={() => void runNow(row.def.id)}>
                Run now
              </button>
              {runNotes[row.def.id] !== undefined ? <span>{runNotes[row.def.id]}</span> : null}
            </div>
          </li>
        ))}
      </ul>

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
