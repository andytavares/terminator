import { describe, it, expect } from 'vitest'
import { LAUNCH_STEPS, createLaunchSteps } from '../../support/launch-steps'

describe('the launch steps record', () => {
  it('names the step still waited on and what was reached', () => {
    const steps = createLaunchSteps()
    steps.reached('firstWindow')
    steps.reached('size')
    steps.reached('drawn')
    expect(steps.describe()).toBe('waiting on: focused (reached: firstWindow, size, drawn)')
  })

  it('names the first step when nothing was reached', () => {
    expect(createLaunchSteps().describe()).toBe('waiting on: firstWindow (reached: nothing)')
  })

  it('keeps the order of the steps when drawn settles after focused', () => {
    const steps = createLaunchSteps()
    for (const step of ['firstWindow', 'size', 'focused']) steps.reached(step as never)
    expect(steps.describe()).toBe('waiting on: drawn (reached: firstWindow, size, focused)')
  })

  it('says every step was reached once the last one settles', () => {
    const steps = createLaunchSteps()
    for (const step of LAUNCH_STEPS) steps.reached(step)
    expect(steps.describe()).toBe(
      'every step was reached (firstWindow, size, drawn, focused, sidebar)'
    )
  })
})
