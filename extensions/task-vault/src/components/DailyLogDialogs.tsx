import React, { useState } from 'react'
import { Button, IconButton, ModalShell } from '@terminator/extension-ui'
import { OctagonAlert, Repeat, X } from 'lucide-react'
import { DateTimePicker } from './DateTimePicker'
import {
  INTERVAL_LABELS,
  QUICK_INTERVALS,
  RECURRENCE_INTERVALS,
  WEEKDAY_LABELS,
  defaultCustomDate,
  definedFields,
  localDateMin,
  modifier,
} from './daily-log-format'
import type { EndType, ExistingRecurrence, RecurrenceDraft } from './daily-log-format'

interface FrameProps {
  icon: React.ReactNode
  title: string
  onClose: () => void
  children: React.ReactNode
}

interface IntervalPickerProps {
  value: string
  onChange: (v: string) => void
}

interface BlockModalProps {
  onConfirm: (reason: string, checkInterval: string) => void
  onClose: () => void
}

interface RecurrenceModalProps {
  existing?: ExistingRecurrence
  onConfirm: (draft: RecurrenceDraft) => void
  onClear: () => void
  onClose: () => void
}

interface DraftProps {
  form: RecurrenceForm
}

type RecurrenceForm = ReturnType<typeof useRecurrenceForm>

type CustomInterval = ReturnType<typeof useCustomInterval>

const END_TYPES: { value: EndType; label: string }[] = [
  { value: 'none', label: 'Never' },
  { value: 'on_date', label: 'On date' },
  { value: 'after_count', label: 'After' },
]

/** The chrome both task dialogs share: the modal shell, the card and its header. */
function ModalFrame(props: FrameProps): React.JSX.Element {
  return (
    <ModalShell label={props.title} className="daily-log__block-modal" onDismiss={props.onClose}>
      <div className="daily-log__block-modal-header">
        {props.icon}
        <span>{props.title}</span>
        <IconButton icon={X} label="Close" size="sm" onClick={props.onClose} />
      </div>
      {props.children}
    </ModalShell>
  )
}

function intervalButtonClass(active: boolean): string {
  return `interval-picker__btn${modifier(active, 'interval-picker__btn--active')}`
}

/** A custom check-in: a date and time, reported together as they change. */
function useCustomInterval(onChange: (v: string) => void) {
  const [customDate, setCustomDate] = useState(defaultCustomDate)
  const [customTime, setCustomTime] = useState('09:00')
  return {
    customDate,
    customTime,
    select: () => onChange(`${customDate}T${customTime}`),
    changeDate: (d: string) => {
      setCustomDate(d)
      onChange(`${d}T${customTime}`)
    },
    changeTime: (t: string) => {
      setCustomTime(t)
      onChange(`${customDate}T${t}`)
    },
  }
}

function QuickIntervals(
  props: IntervalPickerProps & { custom: CustomInterval }
): React.JSX.Element {
  const { value, onChange } = props
  const isCustom = !INTERVAL_LABELS[value]
  return (
    <div className="interval-picker__grid">
      {QUICK_INTERVALS.map((q) => (
        <button
          key={q.value}
          type="button"
          className={intervalButtonClass(!isCustom && value === q.value)}
          onClick={() => onChange(q.value)}
        >
          {q.label}
        </button>
      ))}
      <button
        type="button"
        className={`interval-picker__btn interval-picker__btn--custom${modifier(isCustom, 'interval-picker__btn--active')}`}
        onClick={props.custom.select}
      >
        Custom…
      </button>
    </div>
  )
}

function CustomIntervalRow({ custom }: { custom: CustomInterval }): React.JSX.Element {
  return (
    <div className="interval-picker__custom-row">
      <DateTimePicker
        mode="date"
        value={custom.customDate}
        min={localDateMin()}
        onChange={custom.changeDate}
      />
      <DateTimePicker mode="time" value={custom.customTime} onChange={custom.changeTime} />
    </div>
  )
}

function IntervalPicker(props: IntervalPickerProps): React.JSX.Element {
  const custom = useCustomInterval(props.onChange)
  return (
    <div className="interval-picker">
      <QuickIntervals value={props.value} onChange={props.onChange} custom={custom} />
      {!INTERVAL_LABELS[props.value] && <CustomIntervalRow custom={custom} />}
    </div>
  )
}

/** The block form's reason and check-in, and whether it may be submitted. */
function useBlockForm(onConfirm: BlockModalProps['onConfirm']) {
  const [reason, setReason] = useState('')
  const [checkInterval, setCheckInterval] = useState('1-day')
  const isCustom = !INTERVAL_LABELS[checkInterval]
  function submitBlock() {
    if (!reason.trim()) return
    if (!checkInterval) return
    onConfirm(reason.trim(), checkInterval)
  }
  const disabled = !reason.trim() || (isCustom && !checkInterval)
  return { reason, setReason, checkInterval, setCheckInterval, submit: submitBlock, disabled }
}

function ReasonField({ form }: { form: ReturnType<typeof useBlockForm> }): React.JSX.Element {
  return (
    <label className="daily-log__block-modal-label">
      Why is this blocked?
      <textarea
        autoFocus
        className="daily-log__block-modal-textarea"
        value={form.reason}
        onChange={(e) => form.setReason(e.target.value)}
        placeholder="Waiting on design review, blocked by dependency…"
        rows={3}
      />
    </label>
  )
}

export function BlockModal(props: BlockModalProps): React.JSX.Element {
  const form = useBlockForm(props.onConfirm)
  const icon = <OctagonAlert className="task-status task-status--blocked tm-icon-lg" />
  return (
    <ModalFrame icon={icon} title="Mark as Blocked" onClose={props.onClose}>
      <ReasonField form={form} />
      <div className="daily-log__block-modal-label">
        Check back in
        <IntervalPicker value={form.checkInterval} onChange={form.setCheckInterval} />
      </div>
      <div className="daily-log__block-modal-actions">
        <Button variant="ghost" onClick={props.onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={form.submit} disabled={form.disabled}>
          Mark blocked
        </Button>
      </div>
    </ModalFrame>
  )
}

const DEFAULT_DRAFT: RecurrenceDraft = {
  interval: 'weekly',
  days: [1, 3, 5],
  time: '09:00',
  endType: 'none',
  endDate: '',
  endCount: 10,
}

function recurrenceDraftFrom(existing?: ExistingRecurrence): RecurrenceDraft {
  return { ...DEFAULT_DRAFT, ...definedFields(existing ?? {}) }
}

/** A weekly rule needs a day, and an end date needs the date. */
function canSave(draft: RecurrenceDraft): boolean {
  const hasDays = draft.interval !== 'weekly' || draft.days.length > 0
  return hasDays && (draft.endType !== 'on_date' || draft.endDate.length > 0)
}

/** The recurrence being edited, with a setter per field. */
function useRecurrenceForm(existing?: ExistingRecurrence) {
  const [draft, setDraft] = useState(() => recurrenceDraftFrom(existing))
  const set =
    <K extends keyof RecurrenceDraft>(key: K) =>
    (value: RecurrenceDraft[K]) =>
      setDraft((d) => ({ ...d, [key]: value }))
  const toggleDay = (day: number) =>
    setDraft((d) => {
      const days = d.days.includes(day) ? d.days.filter((x) => x !== day) : [...d.days, day]
      return { ...d, days }
    })
  return { draft, set, toggleDay }
}

function IntervalChoice({ form }: DraftProps): React.JSX.Element {
  return (
    <div className="daily-log__block-modal-label">
      Repeats
      <div className="recurrence-modal__interval-row">
        {RECURRENCE_INTERVALS.map((r) => (
          <button
            key={r.value}
            type="button"
            className={intervalButtonClass(form.draft.interval === r.value)}
            onClick={() => form.set('interval')(r.value)}
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function WeekdayChoice({ form }: DraftProps): React.JSX.Element {
  return (
    <div className="daily-log__block-modal-label">
      On days
      <div className="recurrence-modal__days-row">
        {WEEKDAY_LABELS.map((w) => (
          <button
            key={w.value}
            type="button"
            className={`recurrence-modal__day-btn${modifier(form.draft.days.includes(w.value), 'recurrence-modal__day-btn--active')}`}
            onClick={() => form.toggleDay(w.value)}
          >
            {w.short}
          </button>
        ))}
      </div>
    </div>
  )
}

function EndCount({ form }: DraftProps): React.JSX.Element {
  return (
    <div className="recurrence-modal__count-row">
      <input
        type="number"
        className="recurrence-modal__count-input"
        min={1}
        max={999}
        value={form.draft.endCount}
        onChange={(e) => form.set('endCount')(Math.max(1, parseInt(e.target.value) || 1))}
      />
      <span className="recurrence-modal__count-label">completions</span>
    </div>
  )
}

function EndChoice({ form }: DraftProps): React.JSX.Element {
  const { endType, endDate } = form.draft
  return (
    <div className="daily-log__block-modal-label">
      Ends
      <div className="recurrence-modal__end-row">
        {END_TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            className={intervalButtonClass(endType === t.value)}
            onClick={() => form.set('endType')(t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {endType === 'on_date' && (
        <DateTimePicker mode="date" value={endDate} onChange={form.set('endDate')} />
      )}
      {endType === 'after_count' && <EndCount form={form} />}
    </div>
  )
}

function RecurrenceActions(props: RecurrenceModalProps & DraftProps): React.JSX.Element {
  const { draft } = props.form
  const saveRecurrence = () =>
    props.onConfirm({ ...draft, days: draft.interval === 'weekly' ? draft.days : [] })
  return (
    <div className="daily-log__block-modal-actions">
      {props.existing && (
        <Button variant="danger" onClick={props.onClear} style={{ marginRight: 'auto' }}>
          Remove
        </Button>
      )}
      <Button variant="ghost" onClick={props.onClose}>
        Cancel
      </Button>
      <Button variant="primary" onClick={saveRecurrence} disabled={!canSave(draft)}>
        Save
      </Button>
    </div>
  )
}

function recurrenceDialogTitle(existing?: ExistingRecurrence): string {
  if (existing) return 'Edit Recurrence'
  return 'Set Recurrence'
}

export function RecurrenceModal(props: RecurrenceModalProps): React.JSX.Element {
  const form = useRecurrenceForm(props.existing)
  const title = recurrenceDialogTitle(props.existing)
  return (
    <ModalFrame icon={<Repeat className="tm-icon-lg" />} title={title} onClose={props.onClose}>
      <IntervalChoice form={form} />
      {form.draft.interval === 'weekly' && <WeekdayChoice form={form} />}
      <div className="daily-log__block-modal-label">
        Notify at
        <DateTimePicker mode="time" value={form.draft.time} onChange={form.set('time')} />
      </div>
      <EndChoice form={form} />
      <RecurrenceActions
        existing={props.existing}
        onConfirm={props.onConfirm}
        onClear={props.onClear}
        onClose={props.onClose}
        form={form}
      />
    </ModalFrame>
  )
}
