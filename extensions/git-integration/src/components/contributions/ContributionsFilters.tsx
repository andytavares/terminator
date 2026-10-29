import React, { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button, Popover } from '@terminator/extension-ui'
import {
  PERIOD_PRESETS,
  customRange,
  periodLabel,
  type PeriodPreset,
  type PeriodSelection,
} from './period-presets'

const REPO_FILTER_MIN = 8
const CUSTOM_ERROR = 'Pick a from on or before to, both today or earlier.'

/** The two pickers the header bar holds: the period and the repository. */
export function ContributionsFilters(props: {
  period: PeriodSelection
  repo: string | null
  repos: string[]
  onPeriod: (selection: PeriodSelection) => void
  onRepo: (repo: string | null) => void
}): React.JSX.Element {
  return (
    <>
      <PeriodPicker period={props.period} onPeriod={props.onPeriod} />
      <RepositoryFilter repo={props.repo} repos={props.repos} onRepo={props.onRepo} />
    </>
  )
}

function PeriodPicker(props: {
  period: PeriodSelection
  onPeriod: (selection: PeriodSelection) => void
}): React.JSX.Element {
  return (
    <PickerMenu label="Period" buttonText={periodLabel(props.period)}>
      {(close) => <PeriodOptions {...props} close={close} />}
    </PickerMenu>
  )
}

/** A button that opens a popover holding `children`, which is given a function that closes it. */
function PickerMenu(props: {
  label: string
  buttonText: string
  children: (close: () => void) => React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <span className="ct-picker">
      <Button
        size="sm"
        icon={ChevronDown}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        {props.buttonText}
      </Button>
      {open && (
        <Popover label={props.label} onDismiss={() => setOpen(false)}>
          {props.children(() => setOpen(false))}
        </Popover>
      )}
    </span>
  )
}

function PeriodOptions(props: {
  period: PeriodSelection
  onPeriod: (selection: PeriodSelection) => void
  close: () => void
}): React.JSX.Element {
  const [customOpen, setCustomOpen] = useState(props.period.kind === 'custom')
  const chosen = props.period.kind === 'preset' ? props.period.preset : null
  return (
    <>
      {PERIOD_PRESETS.map((preset) => (
        <PickerOption
          key={preset.preset}
          label={preset.label}
          chosen={chosen === preset.preset}
          onChoose={() => choosePreset(props, preset.preset)}
        />
      ))}
      <PickerOption
        label="Custom range…"
        chosen={props.period.kind === 'custom'}
        onChoose={() => setCustomOpen(true)}
      />
      {customOpen && <CustomDates onPeriod={props.onPeriod} close={props.close} />}
    </>
  )
}

function PickerOption(props: {
  label: string
  chosen: boolean
  onChoose: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={props.chosen}
      className="ct-option"
      onClick={props.onChoose}
    >
      {props.label}
    </button>
  )
}

function choosePreset(
  props: { onPeriod: (selection: PeriodSelection) => void; close: () => void },
  preset: PeriodPreset
): void {
  props.onPeriod({ kind: 'preset', preset })
  props.close()
}

function CustomDates(props: {
  onPeriod: (selection: PeriodSelection) => void
  close: () => void
}): React.JSX.Element {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [invalid, setInvalid] = useState(false)
  const apply = () => {
    const range = customRange(from, to, new Date())
    if (!range) return setInvalid(true)
    props.onPeriod({ kind: 'custom', ...range })
    props.close()
  }
  return (
    <div className="ct-custom">
      <input type="date" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} />
      <input type="date" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} />
      <Button size="sm" variant="primary" onClick={apply}>
        Apply
      </Button>
      {invalid && (
        <span className="ct-custom-error" role="alert">
          {CUSTOM_ERROR}
        </span>
      )}
    </div>
  )
}

function RepositoryFilter(props: {
  repo: string | null
  repos: string[]
  onRepo: (repo: string | null) => void
}): React.JSX.Element {
  return (
    <PickerMenu label="Repository" buttonText={props.repo ?? 'All repositories'}>
      {(close) => <RepositoryOptions {...props} close={close} />}
    </PickerMenu>
  )
}

function RepositoryOptions(props: {
  repo: string | null
  repos: string[]
  onRepo: (repo: string | null) => void
  close: () => void
}): React.JSX.Element {
  const [filter, setFilter] = useState('')
  const shown = props.repos.filter((repo) => repo.toLowerCase().includes(filter.toLowerCase()))
  const chooseOne = (repo: string | null) => chooseRepo(props, repo)
  return (
    <>
      {props.repos.length >= REPO_FILTER_MIN && <RepoSearch value={filter} onChange={setFilter} />}
      <RepoOption
        label="All repositories"
        chosen={props.repo === null}
        onChoose={() => chooseOne(null)}
      />
      {shown.map((repo) => (
        <RepoOption
          key={repo}
          label={repo}
          chosen={props.repo === repo}
          onChoose={() => chooseOne(repo)}
        />
      ))}
    </>
  )
}

function RepoSearch(props: {
  value: string
  onChange: (filter: string) => void
}): React.JSX.Element {
  return (
    <input
      aria-label="Filter repositories"
      placeholder="Filter repositories"
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
    />
  )
}

function chooseRepo(
  props: { onRepo: (repo: string | null) => void; close: () => void },
  repo: string | null
): void {
  props.onRepo(repo)
  props.close()
}

function RepoOption(props: {
  label: string
  chosen: boolean
  onChoose: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={props.chosen}
      className="ct-option"
      onClick={props.onChoose}
    >
      {props.label}
    </button>
  )
}
