import { describe, it, expect } from 'vitest'
import { confirmDestructive } from '../../src/confirm'

const deleteTask = { group: 'task', verb: 'delete' }

describe('confirmDestructive', () => {
  it('asks in a terminal and runs on yes', async () => {
    const questions: string[] = []
    const ask = async (question: string) => {
      questions.push(question)
      return 'y'
    }
    expect(await confirmDestructive(deleteTask, { yes: false, ask })).toBe('run')
    expect(questions).toEqual(['Delete task? [y/N] '])
  })

  it('declines on an empty answer', async () => {
    expect(await confirmDestructive(deleteTask, { yes: false, ask: async () => '' })).toBe(
      'declined'
    )
  })

  it('refuses without a terminal', async () => {
    expect(await confirmDestructive(deleteTask, { yes: false, ask: null })).toBe('refused')
  })

  it('runs without asking when --yes is given', async () => {
    expect(await confirmDestructive(deleteTask, { yes: true, ask: null })).toBe('run')
  })
})
