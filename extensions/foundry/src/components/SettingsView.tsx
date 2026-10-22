import React, { useCallback, useEffect, useState } from 'react'
import { Button } from '@terminator/extension-ui'
import { getFoundryAPI, type ModelChoiceView } from '../types/electron.js'
import { rungInWords } from '../recipe/rung.js'
import type { Rung } from '../recipe/rung.js'
import { invoke } from '@terminator/extension-sdk/renderer'
import { RepositoryChecks } from './SettingsProfiles.js'

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

const ASK_MODEL_CHOICES = [
  { id: 'sonnet', label: 'Sonnet (latest)', note: 'default — an amendment is a narrow change' },
  { id: 'opus', label: 'Opus (latest)', note: 'for an ask that needs deeper reasoning' },
] as const

async function readSensors(): Promise<SensorRow[]> {
  const answer = (await invoke('foundry:sensors.list')) as { sensors?: SensorRow[] }
  return answer.sensors ?? []
}

export function SettingsView(): JSX.Element {
  const saver = useSaver()
  const models = useModels(saver)
  const ask = useAskModel(saver)
  return (
    <div className="fdry-settings">
      <ModelSection models={models} saving={saver.saving} />
      <AskModelSection ask={ask} saving={saver.saving} />
      {saver.problem !== null ? <p className="fdry-problem">{saver.problem}</p> : null}
      <SensorsSection />
      <RepositoryChecks />
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

/** One save at a time for the model pickers, and what the last one refused. */
interface Saver {
  readonly saving: boolean
  readonly problem: string | null
  readonly setProblem: (problem: string | null) => void
  /** Writes a choice; `write` answers with a refusal, or null when it took. */
  readonly save: (write: () => Promise<string | null>, onSaved: () => void) => Promise<void>
}

function useSaver(): Saver {
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const save = useCallback(async (write: () => Promise<string | null>, onSaved: () => void) => {
    setSaving(true)
    setProblem(null)
    try {
      const error = await write()
      if (error !== null) {
        setProblem(error)
        return
      }
      onSaved()
    } finally {
      setSaving(false)
    }
  }, [])
  return { saving, problem, setProblem, save }
}

/** The models on offer, the one chosen, and a way to choose another. */
function useModels({ save, setProblem }: Saver) {
  const [models, setModels] = useState<ModelChoiceView[]>([])
  const [selected, setSelected] = useState<string>('')
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
  }, [setProblem])
  const choose = useCallback(
    (id: string) =>
      save(
        async () => {
          const result = await getFoundryAPI().modelSet({ model: id })
          return 'error' in result ? result.error : null
        },
        () => setSelected(id)
      ),
    [save]
  )
  return { models, selected, choose }
}

/** The model the architect amends a plan on, and a way to choose another. */
function useAskModel({ save }: Saver) {
  const [askModel, setAskModel] = useState<string>('sonnet')
  useEffect(() => {
    void (async () => {
      const answer = (await invoke('foundry:ask-model')) as { selected?: unknown }
      if (typeof answer?.selected === 'string') setAskModel(answer.selected)
    })()
  }, [])
  const chooseAskModel = useCallback(
    (id: string) =>
      save(
        async () => {
          const result = (await invoke('foundry:ask-model-set', { model: id })) as {
            error?: string
          }
          return result.error !== undefined ? result.error : null
        },
        () => setAskModel(id)
      ),
    [save]
  )
  return { askModel, chooseAskModel }
}

interface ModelSectionProps {
  readonly models: ReturnType<typeof useModels>
  readonly saving: boolean
}

function ModelSection({ models: { models, selected, choose }, saving }: ModelSectionProps) {
  return (
    <>
      <h2 className="fdry-panel-h">Model</h2>
      <p className="fdry-note">
        What every agent runs on, unless its role asks for the fast tier — the scribe and the scout
        do. An alias never goes stale the way a pinned identifier does.
      </p>

      <ul className="fdry-models">
        {models.map((model) => (
          <li key={model.id || 'inherit'}>
            <ChoiceButton
              on={model.id === selected}
              saving={saving}
              onChoose={() => void choose(model.id)}
            >
              <b>{model.label}</b>
              <small>
                {model.floating ? 'alias — follows the latest of its family' : model.id}
              </small>
            </ChoiceButton>
          </li>
        ))}
      </ul>
    </>
  )
}

/** One choice of a picker: pressed when it is the one chosen. */
function ChoiceButton({
  on,
  saving,
  onChoose,
  children,
}: {
  readonly on: boolean
  readonly saving: boolean
  readonly onChoose: () => void
  readonly children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      className={on ? 'is-on' : ''}
      disabled={saving}
      onClick={onChoose}
    >
      {children}
    </button>
  )
}

interface AskModelSectionProps {
  readonly ask: ReturnType<typeof useAskModel>
  readonly saving: boolean
}

function AskModelSection({ ask: { askModel, chooseAskModel }, saving }: AskModelSectionProps) {
  return (
    <>
      <h2 className="fdry-panel-h" style={{ marginTop: 20 }}>
        Answering asks
      </h2>
      <p className="fdry-note">
        What the architect runs on when it amends a drafted plan: an ask, an answer, or a failing
        check it closes on its own. The first draft stays on the model above.
      </p>

      <ul className="fdry-models">
        {ASK_MODEL_CHOICES.map((choice) => (
          <li key={choice.id}>
            <ChoiceButton
              on={choice.id === askModel}
              saving={saving}
              onChoose={() => void chooseAskModel(choice.id)}
            >
              <b>{choice.label}</b>
              <small>{choice.note}</small>
            </ChoiceButton>
          </li>
        ))}
      </ul>
    </>
  )
}

/** The sensors, each with the repository typed for it and what its last run said. */
function useSensorRows() {
  const [sensors, setSensors] = useState<SensorRow[]>([])
  const [repoDrafts, setRepoDrafts] = useState<Record<string, string>>({})
  const showSensors = useCallback((rows: SensorRow[]): void => {
    setSensors(rows)
    setRepoDrafts((current) => {
      const next = { ...current }
      for (const row of rows) {
        if (next[row.def.id] === undefined) next[row.def.id] = row.state.repoPath ?? ''
      }
      return next
    })
  }, [])
  const refreshSensors = useCallback(() => readSensors().then(showSensors), [showSensors])
  useEffect(() => {
    void readSensors().then(showSensors)
  }, [showSensors])
  return { sensors, repoDrafts, setRepoDrafts, refreshSensors }
}

/** What a sensor's controls do: enable it, save its repository, run it now. */
function useSensorActions({
  repoDrafts,
  refreshSensors,
}: Pick<ReturnType<typeof useSensorRows>, 'repoDrafts' | 'refreshSensors'>) {
  const [sensorProblems, setSensorProblems] = useState<Record<string, string>>({})
  const [runNotes, setRunNotes] = useState<Record<string, string>>({})
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
  const repoOf = (id: string): string | null => (repoDrafts[id] ?? '').trim() || null
  const toggleSensor = (id: string, enabled: boolean) =>
    void setSensor(id, { enabled, repoPath: repoOf(id) })
  const saveRepo = (id: string) => void setSensor(id, { repoPath: repoOf(id) })
  const runNow = useRunNow(setRunNotes, refreshSensors)
  return { sensorProblems, runNotes, toggleSensor, saveRepo, runNow }
}

/** Runs a sensor at once, noting what it recorded or why it could not. */
function useRunNow(
  setRunNotes: React.Dispatch<React.SetStateAction<Record<string, string>>>,
  refreshSensors: () => Promise<void>
) {
  return useCallback(
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
    [setRunNotes, refreshSensors]
  )
}

function SensorsSection() {
  const rows = useSensorRows()
  const actions = useSensorActions(rows)
  return (
    <>
      <h2 className="fdry-panel-h" style={{ marginTop: 20 }}>
        Sensors
      </h2>
      <p className="fdry-note">
        What reads the product&rsquo;s own signals back into the factory. A sensor proposes nothing
        by itself — the signals it finds show up in the Inbox, to promote or dismiss.
      </p>

      <ul className="fdry-sensors">
        {rows.sensors.map((row) => (
          <SensorItem
            key={row.def.id}
            row={row}
            repoDraft={rows.repoDrafts[row.def.id] ?? ''}
            onRepoDraft={(text) =>
              rows.setRepoDrafts((current) => ({ ...current, [row.def.id]: text }))
            }
            actions={actions}
          />
        ))}
      </ul>
    </>
  )
}

interface SensorItemProps {
  readonly row: SensorRow
  readonly repoDraft: string
  readonly onRepoDraft: (text: string) => void
  readonly actions: ReturnType<typeof useSensorActions>
}

function SensorItem({ row, repoDraft, onRepoDraft, actions }: SensorItemProps) {
  const id = row.def.id
  return (
    <li className="fdry-sensor">
      <SensorHead row={row} onToggle={(enabled) => actions.toggleSensor(id, enabled)} />

      <label className="fdry-sensor-repo">
        Repository
        <input
          type="text"
          aria-label={`Repository for ${row.def.description}`}
          value={repoDraft}
          placeholder="/path/to/repo"
          onChange={(event) => onRepoDraft(event.target.value)}
          onBlur={() => actions.saveRepo(id)}
        />
      </label>

      {actions.sensorProblems[id] ? (
        <p className="fdry-problem">{actions.sensorProblems[id]}</p>
      ) : null}

      <SensorMeta row={row} />

      <div className="fdry-sensor-actions">
        <Button size="sm" onClick={() => void actions.runNow(id)}>
          Run now
        </Button>
        {actions.runNotes[id] !== undefined ? <span>{actions.runNotes[id]}</span> : null}
      </div>
    </li>
  )
}

function SensorHead({
  row,
  onToggle,
}: {
  readonly row: SensorRow
  readonly onToggle: (enabled: boolean) => void
}) {
  return (
    <div className="fdry-sensor-head">
      <b>{row.def.description}</b>
      <span className="fdry-sensor-rung">{rungInWords(row.rung as Rung)}</span>
      <label className="fdry-sensor-toggle">
        <input
          type="checkbox"
          aria-label={`Enable ${row.def.description}`}
          checked={row.state.enabled}
          onChange={(event) => onToggle(event.target.checked)}
        />
        Enabled
      </label>
    </div>
  )
}

function SensorMeta({ row }: { readonly row: SensorRow }) {
  return (
    <div className="fdry-sensor-meta">
      <span>Last run: {row.state.lastRunAt ?? 'never'}</span>
      <span>Next due: {row.nextDueAt ?? '—'}</span>
      {row.state.lastProblem !== null ? <span>Last problem: {row.state.lastProblem}</span> : null}
    </div>
  )
}
