// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SidebarSearch } from '../../../../src/renderer/components/sidebar/SidebarSearch'
import { ResumeButton } from '../../../../src/renderer/components/session/ResumeButton'
import { ChoiceButtons } from '../../../../src/renderer/components/session/ChoiceButtons'
import { ThemeChoices } from '../../../../src/renderer/components/settings/ThemeChoices'
import { SnoozeMenu } from '../../../../src/renderer/components/home/SnoozeMenu'
import { RunAsChoices } from '../../../../src/renderer/components/home/RunAsChoices'
import { NameTerminalDialog } from '../../../../src/renderer/components/NameTerminalDialog'
import { ErrorBoundary } from '../../../../src/renderer/components/ErrorBoundary'
import { useHomeView } from '../../../../src/renderer/components/home/home-view'
import { useInsightsWindow } from '../../../../src/renderer/components/home/insights-window'
import { fact } from '../sidebar/fixtures/facts'

const recordUse = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/usage/record', () => ({ recordUse }))

beforeEach(() => {
  recordUse.mockClear()
  useHomeView.setState({ view: 'desk' })
  useInsightsWindow.setState({ chosen: 'week' })
})

describe('feature usage: searches', () => {
  it('counts the first keystroke of a sidebar search, not each one', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<SidebarSearch query="" onChange={vi.fn()} onClear={vi.fn()} />)
    await user.type(screen.getByRole('textbox'), 'a')
    rerender(<SidebarSearch query="a" onChange={vi.fn()} onClear={vi.fn()} />)
    await user.type(screen.getByRole('textbox'), 'b')
    expect(recordUse.mock.calls).toEqual([['core.sidebar.search']])
  })
})

describe('feature usage: resumes', () => {
  it('counts a resume click as the resume action', async () => {
    const user = userEvent.setup()
    const exited = fact({
      name: 'claude',
      state: 'exited',
      resumable: true,
      agent: {
        agentId: 'claude',
        transport: 'tui',
        sessionId: 'b610a882',
        transcriptPath: '/t/b610a882.jsonl',
        cwd: '/code/repo',
        capturedAt: '2026-09-15T18:00:00.000Z',
      },
    })
    render(<ResumeButton facts={exited} onResume={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Resume claude' }))
    expect(recordUse).toHaveBeenCalledWith('core.resume', 'click', {
      declare: { label: 'Resume a session', kind: 'action', source: 'core' },
    })
  })
})

describe('feature usage: settings, snooze and run-as choices', () => {
  it('counts a pressed choice of an agent ask', async () => {
    const user = userEvent.setup()
    const prompt = {
      question: 'Proceed?',
      options: [{ number: 1, label: 'Yes' }],
    } as React.ComponentProps<typeof ChoiceButtons>['prompt']
    render(<ChoiceButtons prompt={prompt} onAnswer={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: '1. Yes' }))
    expect(recordUse.mock.calls).toEqual([['core.agent.answer-ask']])
  })

  it('counts a theme change', async () => {
    const user = userEvent.setup()
    render(<ThemeChoices checked="dark" onChange={vi.fn()} />)
    await user.click(screen.getByRole('radio', { name: 'Light' }))
    expect(recordUse.mock.calls).toEqual([['core.settings.theme']])
  })
})

describe('feature usage: Home choices', () => {
  it('counts a snooze when a time is picked', async () => {
    render(<SnoozeMenu now={Date.now()} onPick={vi.fn()} onClose={vi.fn()} />)
    await userEvent.click(screen.getAllByRole('menuitem')[0])
    expect(recordUse.mock.calls).toEqual([['core.home.snooze']])
  })

  it('counts a Run it as choice under the id of the choice, with its label', async () => {
    const options = [
      { value: 'agent', label: 'Claude agent', hint: '' },
      { value: 'foundry:order', label: 'Foundry order', hint: '' },
    ]
    render(<RunAsChoices options={options} runAs="agent" onPick={vi.fn()} />)
    await userEvent.click(screen.getByRole('radio', { name: 'Foundry order' }))
    expect(recordUse).toHaveBeenCalledWith('core.start-work.option.foundry:order', 'click', {
      declare: { label: 'Run as Foundry order', kind: 'control', source: 'core' },
    })
  })
})

describe('feature usage: failures and Home views', () => {
  it('counts a terminal rename only when a name is saved', async () => {
    const user = userEvent.setup()
    const { unmount } = render(
      <NameTerminalDialog defaultName="zsh" onConfirm={vi.fn()} onCancel={vi.fn()} />
    )
    await user.click(screen.getByRole('button', { name: 'Open' }))
    expect(recordUse).not.toHaveBeenCalled()
    await user.clear(screen.getByLabelText('Terminal name'))
    await user.type(screen.getByLabelText('Terminal name'), 'build')
    await user.click(screen.getByRole('button', { name: 'Open' }))
    expect(recordUse.mock.calls).toEqual([['core.terminal.rename']])
    unmount()
  })
})

describe('feature usage: failures', () => {
  it('counts a screen that failed to draw as a failure', () => {
    const Thrower = (): React.JSX.Element => {
      throw new Error('boom')
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary>
        <Thrower />
      </ErrorBoundary>
    )
    expect(recordUse).toHaveBeenCalledWith('core.app.render-error', 'app', { failed: true })
  })

  it('counts a Home view only when it becomes the view', () => {
    act(() => useHomeView.getState().show('desk'))
    act(() => useHomeView.getState().show('insights'))
    act(() => useInsightsWindow.getState().choose('week'))
    act(() => useInsightsWindow.getState().choose('30d'))
    expect(recordUse.mock.calls).toEqual([
      ['core.home.view.insights'],
      ['core.home.insights-window'],
    ])
  })
})
