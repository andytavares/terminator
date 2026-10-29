import React, { useEffect, useId, useState } from 'react'
import { Button, Chip, SegmentedControl } from '@terminator/extension-ui'
import type { ChipTone } from '@terminator/extension-ui'
import { AlertCircle, Check, Image, Minus, Package, Play, X } from 'lucide-react'
import {
  RUNG_GROUPS,
  failsOnMain,
  hasCommand,
  notMeasured,
  nothingFound,
  provenCounts,
  type CheckRowView,
  type CheckState,
  type CheckTarget,
} from '../forge/checks-view.js'
import type { Rung } from '../verify/ladder.js'
import { ReasonButton } from './ReasonButton.js'
import type { ChecksModel, Finished, LogTail, ProveOutcome } from './use-checks.js'

// The Checks step: every command Foundry runs in this repository, where it came
// from, and what running it on the base branch did. Every unknown has a move.

export interface ChecksActions {
  readonly checkAgain: () => void
  readonly askScout: () => void
  readonly openChecks: () => void
}

interface ChecksProps {
  readonly checks: ChecksModel
  readonly actions: ChecksActions
}

interface RowProps {
  readonly checks: ChecksModel
  readonly row: CheckRowView
}

const PILL: Record<CheckState, ChipTone> = {
  passed: 'good',
  failing: 'bad',
  untried: 'neutral',
  missing: 'neutral',
  notNeeded: 'neutral',
}

function RowGlyph({ row }: { readonly row: CheckRowView }): React.JSX.Element {
  if (row.state === 'passed') return <Check aria-hidden="true" />
  if (row.state === 'failing') return <X aria-hidden="true" />
  if (row.target.kind === 'prepare') return <Package aria-hidden="true" />
  if (row.target.kind === 'pictures') return <Image aria-hidden="true" />
  return <Minus aria-hidden="true" />
}

const TYPE_FIRST = 'Type the command first.'

/** Runs a command on a fresh checkout of the base branch, and keeps it once it passes. */
function useCommandRun(checks: ChecksModel, target: CheckTarget) {
  const [outcome, setOutcome] = useState<ProveOutcome | null>(null)
  const [kept, setKept] = useState(false)
  const run = async (command: string): Promise<void> => {
    setOutcome({ running: true })
    const result = await checks.prove(command)
    setOutcome(result)
    if ('exitCode' in result && result.exitCode === 0)
      setKept((await checks.saveCommand(target, command)) === null)
  }
  return { outcome, kept, run }
}

function Outcome({
  checks,
  done,
  kept,
}: {
  readonly checks: ChecksModel
  readonly done: Finished
  readonly kept: boolean
}) {
  const commit = done.commit === null ? '' : ` at ${done.commit.slice(0, 7)}`
  const code = done.exitCode === null ? 'Did not finish' : `Exit ${done.exitCode}`
  return (
    <div className="fdry-chk-result">
      <b>{`${code} on ${checks.base}${commit}`}</b>
      {done.logPath === null ? null : <LogView checks={checks} path={done.logPath} />}
      {kept ? <small>Saved to this repository’s checks for every future order.</small> : null}
    </div>
  )
}

interface ProveResultProps {
  readonly checks: ChecksModel
  readonly outcome: ProveOutcome | null
  readonly kept: boolean
}

function ProveResult({ checks, outcome, kept }: ProveResultProps) {
  if (outcome === null) return null
  if ('running' in outcome) {
    return (
      <p role="status" className="fdry-note">
        Running on {checks.base} in a fresh checkout…
      </p>
    )
  }
  if ('error' in outcome) return <p className="fdry-problem">{outcome.error}</p>
  return <Outcome checks={checks} done={outcome} kept={kept} />
}

interface EditMovesProps {
  readonly checks: ChecksModel
  readonly reason: string | null
  readonly run: () => void
  readonly saveOnly: () => void
}

function EditMoves({ checks, reason, run, saveOnly }: EditMovesProps) {
  return (
    <div className="fdry-chk-moves">
      <ReasonButton size="sm" variant="primary" reason={reason} onClick={run}>
        Run on main
      </ReasonButton>
      <ReasonButton size="sm" reason={reason} onClick={saveOnly}>
        Save without running
      </ReasonButton>
      <Button size="sm" variant="ghost" onClick={() => checks.edit(null)}>
        Cancel
      </Button>
    </div>
  )
}

function EditCheck({ checks, row }: RowProps) {
  const [draft, setDraft] = useState(row.command ?? '')
  const [problem, setProblem] = useState<string | null>(null)
  const { outcome, kept, run } = useCommandRun(checks, row.target)
  const command = draft.trim()
  const saveOnly = async (): Promise<void> => {
    const failed = await checks.saveCommand(row.target, command)
    if (failed === null) checks.edit(null)
    else setProblem(failed)
  }
  return (
    <>
      <input
        className="fdry-chk-field"
        aria-label={`Command for ${row.label}`}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <EditMoves
        checks={checks}
        reason={command === '' ? TYPE_FIRST : null}
        run={() => void run(command)}
        saveOnly={() => void saveOnly()}
      />
      {problem === null ? null : <p className="fdry-problem">{problem}</p>}
      <ProveResult checks={checks} outcome={outcome} kept={kept} />
    </>
  )
}

/** The last lines of a log, read through the records-only channel. */
function useLogTail(checks: ChecksModel, path: string): LogTail | null {
  const [tail, setTail] = useState<LogTail | null>(null)
  const { tailOf } = checks
  useEffect(() => {
    let current = true
    void tailOf(path).then((answer) => current && setTail(answer))
    return () => {
      current = false
    }
  }, [tailOf, path])
  return tail
}

function LogView({ checks, path }: { readonly checks: ChecksModel; readonly path: string }) {
  const tail = useLogTail(checks, path)
  return (
    <>
      <small>
        The log is at <code>{path}</code>
      </small>
      {tail !== null && 'error' in tail ? <small>{tail.error}</small> : null}
      {tail !== null && 'tail' in tail ? <pre className="fdry-chk-log">{tail.tail}</pre> : null}
    </>
  )
}

function LogLine({ checks, log }: { readonly checks: ChecksModel; readonly log: string | null }) {
  if (log === null) {
    return (
      <small>No log was kept for this command. Run every check on main again to make one.</small>
    )
  }
  return <LogView checks={checks} path={log} />
}

function FailureMoves({ checks, row }: RowProps) {
  const [shown, setShown] = useState(false)
  const { base } = checks
  return (
    <>
      <small>{`Failed on ${base}. Either ${base} fails this check or this is the wrong command.`}</small>
      <div className="fdry-chk-moves">
        <Button size="sm" onClick={() => checks.edit(row.key)}>
          Edit
        </Button>
        <Button size="sm" onClick={() => setShown(true)}>
          Show the log
        </Button>
        <Button size="sm" onClick={() => void checks.saveCommand(row.target, row.command)}>
          Use it anyway
        </Button>
        <RemoveMove checks={checks} row={row} />
      </div>
      {shown ? (
        <LogLine checks={checks} log={row.command === null ? null : checks.logOf(row.command)} />
      ) : null}
    </>
  )
}

function RemoveMove({ checks, row }: RowProps) {
  return (
    <Button size="sm" variant="ghost" onClick={() => void checks.removeRow(row)}>
      Remove
    </Button>
  )
}

function CommandMoves({ checks, row }: RowProps) {
  if (failsOnMain(row)) return <FailureMoves checks={checks} row={row} />
  return (
    <div className="fdry-chk-moves">
      <Button size="sm" onClick={() => checks.edit(row.key)}>
        Edit
      </Button>
      <RemoveMove checks={checks} row={row} />
    </div>
  )
}

function RowMoves({ checks, row }: RowProps) {
  if (row.state === 'notNeeded') return null
  if (hasCommand(row)) return <CommandMoves checks={checks} row={row} />
  return (
    <div className="fdry-chk-moves">
      <Button size="sm" onClick={() => checks.edit(row.key)}>
        Add a command
      </Button>
      {row.removed ? (
        <Button size="sm" variant="ghost" onClick={() => void checks.saveCommand(row.target, null)}>
          Restore
        </Button>
      ) : null}
    </div>
  )
}

function CheckLine({ checks, row }: RowProps) {
  return (
    <>
      <span className={`fdry-cmd${row.command === null ? ' fdry-cmd--none' : ''}`}>
        {row.command ?? 'No command'}
      </span>
      <small>{row.source}</small>
      <RowMoves checks={checks} row={row} />
    </>
  )
}

function CheckRow({ checks, row }: RowProps) {
  const editing = checks.editing === row.key
  return (
    <div
      role="group"
      aria-label={row.label}
      className={`fdry-chk${editing ? ' fdry-chk--work' : ''}`}
    >
      <span className={`fdry-chk-icon fdry-chk-icon--${row.state}`} aria-hidden="true">
        {editing ? <Play aria-hidden="true" /> : <RowGlyph row={row} />}
      </span>
      <div>
        <b>{row.label}</b>
        {editing ? (
          <EditCheck checks={checks} row={row} />
        ) : (
          <CheckLine checks={checks} row={row} />
        )}
      </div>
      <Chip tone={PILL[row.state]}>{row.proofWord}</Chip>
    </div>
  )
}

/** The name, command and group of a check being added, and the save that adds it. */
function useNewCheck(checks: ChecksModel) {
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [rung, setRung] = useState<Rung>('L1')
  const [problem, setProblem] = useState<string | null>(null)
  const addCheck = async (): Promise<void> => {
    const failed = await checks.addCheck({ name: name.trim(), command: command.trim(), rung })
    if (failed === null) checks.edit(null)
    else setProblem(failed)
  }
  const ready = name.trim() !== '' && command.trim() !== ''
  return { name, setName, command, setCommand, rung, setRung, problem, addCheck, ready }
}

function NewCheckFields({ form }: { readonly form: ReturnType<typeof useNewCheck> }) {
  return (
    <>
      <input
        className="fdry-chk-field"
        aria-label="Name of the check"
        placeholder="Name, for example Type check"
        value={form.name}
        onChange={(event) => form.setName(event.target.value)}
      />
      <input
        className="fdry-chk-field"
        aria-label="Command for the new check"
        placeholder="Command, for example ./glyph check"
        value={form.command}
        onChange={(event) => form.setCommand(event.target.value)}
      />
      <SegmentedControl
        label="Runs with"
        size="sm"
        options={RUNG_GROUPS.map((group) => ({ value: group.rung, label: group.words }))}
        value={form.rung}
        onChange={form.setRung}
      />
    </>
  )
}

function AddCheckForm({ checks }: { readonly checks: ChecksModel }) {
  const form = useNewCheck(checks)
  const reason = form.ready ? null : 'Give the check a name and a command first.'
  return (
    <div className="fdry-chk-add">
      <NewCheckFields form={form} />
      <div className="fdry-chk-moves">
        <ReasonButton
          size="sm"
          variant="primary"
          reason={reason}
          onClick={() => void form.addCheck()}
        >
          Add check
        </ReasonButton>
        <Button size="sm" variant="ghost" onClick={() => checks.edit(null)}>
          Cancel
        </Button>
      </div>
      {form.problem === null ? null : <p className="fdry-problem">{form.problem}</p>}
    </div>
  )
}

const NOTHING_FOUND =
  'Nothing in README.md, CONTRIBUTING.md, the CI files or the Makefile names a command. Without one, this order can be built but nothing it does can be proved by running it.'

function NothingFoundMoves({ checks, actions, ask }: ChecksProps & { readonly ask: TestsAsk }) {
  return (
    <div className="fdry-chk-moves">
      <ReasonButton size="sm" variant="primary" reason={ask.reason} onClick={ask.run}>
        Run on main
      </ReasonButton>
      <Button size="sm" onClick={() => checks.edit('new')}>
        Add another check
      </Button>
      <Button size="sm" onClick={actions.askScout}>
        Ask the scout to read again
      </Button>
      <Button size="sm" variant="ghost" onClick={() => checks.decide('unmeasured')}>
        Continue with nothing measured
      </Button>
    </div>
  )
}

interface TestsAsk {
  readonly command: string
  readonly setCommand: (command: string) => void
  readonly reason: string | null
  readonly run: () => void
  readonly outcome: ProveOutcome | null
  readonly kept: boolean
}

/** The one question the empty state asks, and running its answer on main. */
function useTestsAsk(checks: ChecksModel): TestsAsk {
  const [command, setCommand] = useState('')
  const { outcome, kept, run } = useCommandRun(checks, { kind: 'check', name: 'test' })
  const reason = command.trim() === '' ? TYPE_FIRST : null
  return { command, setCommand, reason, run: () => void run(command.trim()), outcome, kept }
}

function TestsField({ ask }: { readonly ask: TestsAsk }) {
  const fieldId = useId()
  return (
    <>
      <label className="fdry-field-h fdry-chk-ask" htmlFor={fieldId}>
        How do you run the tests?
      </label>
      <input
        id={fieldId}
        className="fdry-chk-field"
        placeholder="For example: ./glyph test"
        value={ask.command}
        onChange={(event) => ask.setCommand(event.target.value)}
      />
    </>
  )
}

function NothingFound({ checks, actions }: ChecksProps) {
  const ask = useTestsAsk(checks)
  return (
    <div className="fdry-checks">
      <div role="group" aria-label="No checks found" className="fdry-chk fdry-chk--you">
        <span className="fdry-chk-icon" aria-hidden="true">
          <Minus aria-hidden="true" />
        </span>
        <div>
          <b>Foundry found no way to check this repository</b>
          <small>{NOTHING_FOUND}</small>
          <TestsField ask={ask} />
          <NothingFoundMoves checks={checks} actions={actions} ask={ask} />
          <ProveResult checks={checks} outcome={ask.outcome} kept={ask.kept} />
          {checks.editing === 'new' ? <AddCheckForm checks={checks} /> : null}
        </div>
        <Chip tone="waiting">Your move</Chip>
      </div>
    </div>
  )
}

function ChecksList({ checks, actions }: ChecksProps) {
  return (
    <>
      <p className="fdry-step-intro">
        The commands that prove this change, run on <b>{checks.base}</b> before any work starts. A
        command is used only after it has run there. Edit any row; your command wins over what
        Foundry found.
      </p>
      <div className="fdry-checks">
        {checks.rows.map((row) => (
          <CheckRow key={row.key} checks={checks} row={row} />
        ))}
      </div>
      <div className="fdry-chk-moves fdry-chk-footer">
        <Button size="sm" onClick={() => checks.edit('new')}>
          Add another check
        </Button>
        <Button size="sm" onClick={actions.checkAgain}>
          Run every check on main again
        </Button>
      </div>
      {checks.editing === 'new' ? <AddCheckForm checks={checks} /> : null}
    </>
  )
}

export function ChecksStep({ checks, actions }: ChecksProps): React.JSX.Element {
  if (checks.profile === null) return <p className="fdry-note">Reading the repository…</p>
  if (nothingFound(checks.rows) && !checks.decided.includes('unmeasured')) {
    return <NothingFound checks={checks} actions={actions} />
  }
  return <ChecksList checks={checks} actions={actions} />
}

const namesOf = (rows: readonly CheckRowView[]): string => {
  const names = rows.map((row) => row.label)
  return names.length < 2
    ? names.join('')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

function provenSentence(checks: ChecksModel): string {
  const passed = checks.rows.filter((row) => row.state === 'passed')
  const failed = checks.rows.filter(failsOnMain)
  const missing = notMeasured(checks.rows)
  return [
    passed.length > 0 ? `${namesOf(passed)} passed on ${checks.base}.` : '',
    failed.length > 0 ? `${namesOf(failed)} failed on ${checks.base}.` : '',
    missing.length > 0
      ? `${namesOf(missing)} ${missing.length === 1 ? 'has' : 'have'} no command and will report “not measured”.`
      : '',
  ]
    .filter((part) => part !== '')
    .join(' ')
}

function ProvenRow({ checks, actions }: ChecksProps) {
  const { proven, total } = provenCounts(checks.rows)
  const failing = checks.rows.some(failsOnMain)
  return (
    <div role="group" aria-label="Checks proven on main" className="fdry-chk">
      <span
        className={`fdry-chk-icon fdry-chk-icon--${failing ? 'failing' : 'passed'}`}
        aria-hidden="true"
      >
        {failing ? <X aria-hidden="true" /> : <Check aria-hidden="true" />}
      </span>
      <div>
        <b>Checks proven on main</b>
        <small>{provenSentence(checks)}</small>
        <div className="fdry-chk-moves">
          <Button size="sm" onClick={actions.openChecks}>
            Open Checks
          </Button>
        </div>
      </div>
      <Chip tone={proven === total ? 'good' : 'neutral'}>{`${proven} of ${total}`}</Chip>
    </div>
  )
}

const PICTURES_WHY =
  'The plan changes something a person sees. The repository has no pictures command, so the pull request will carry none.'

function PicturesRow({ checks, actions }: ChecksProps) {
  const addPictures = (): void => {
    checks.edit('pictures')
    actions.openChecks()
  }
  return (
    <div
      role="group"
      aria-label="This order changes the interface"
      className="fdry-chk fdry-chk--you"
    >
      <span className="fdry-chk-icon" aria-hidden="true">
        <AlertCircle aria-hidden="true" />
      </span>
      <div>
        <b>This order changes the interface</b>
        <small>{PICTURES_WHY}</small>
        <div className="fdry-chk-moves">
          <Button size="sm" onClick={addPictures}>
            Add a pictures command
          </Button>
          <Button size="sm" onClick={() => checks.decide('noPictures')}>
            Ship without pictures
          </Button>
        </div>
      </div>
      <Chip tone="waiting">Your move</Chip>
    </div>
  )
}

/** The hand-off's account of the checks: how many were proven, and the pictures question. */
export function HandOffChecks({ checks, actions }: ChecksProps): React.JSX.Element | null {
  const { profile, interfaceChanged, decided } = checks
  if (profile === null) return null
  const askPictures =
    interfaceChanged && profile.pictures === null && !decided.includes('noPictures')
  return (
    <div className="fdry-checks">
      <ProvenRow checks={checks} actions={actions} />
      {askPictures ? <PicturesRow checks={checks} actions={actions} /> : null}
    </div>
  )
}
