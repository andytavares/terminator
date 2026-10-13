import React from 'react'
import { vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DailyLog } from '../../../src/components/DailyLog'
import { notify } from '../../../src/utils/notify'
import type { IndexedTask } from '../../../src/vault/types'

type Props = React.ComponentProps<typeof DailyLog>

/** Renders a daily log holding `one`, its callbacks spies; `overrides` replaces any prop. */
export function renderDailyLog(one: IndexedTask, overrides: Partial<Props> = {}) {
  const props: Props = {
    log: { date: '2026-01-05', filePath: 'daily/2026-01-05.md', tasks: [one], exists: true },
    onTaskComplete: vi.fn(async () => {}),
    onTaskMigrate: vi.fn(async () => {}),
    onRefresh: vi.fn(async () => {}),
    ...overrides,
  }
  const view = render(React.createElement(DailyLog, props))
  return { props, view }
}

/** The button with this accessible name. */
export const buttonNamed = (name: string) => screen.getByRole('button', { name })

/** The arguments of the latest notice; the spec must vi.mock '../../src/utils/notify'. */
export const lastNotice = () => vi.mocked(notify).mock.calls.at(-1)
