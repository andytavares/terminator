import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseChoicePrompt, samePrompt } from '../../../../src/renderer/sidebar/choice-prompt'

// Captured from Claude Code 2.1.273 running in the app's own terminal
// (tests/e2e/live/choice-prompt.spec.ts), blank rows below it included.
const LIVE = readFileSync(join(__dirname, 'fixtures/claude-prompt-1.txt'), 'utf8').split('\n')

const screen = (...lines: string[]): string[] => [...lines, '', '', '']

describe('parseChoicePrompt — a real Claude Code permission prompt', () => {
  it('reads the question and every option in order', () => {
    expect(parseChoicePrompt(LIVE)).toEqual({
      question: 'Do you want to create a.txt?',
      options: [
        { number: 1, label: 'Yes' },
        {
          number: 2,
          label:
            'Yes, and switch to accept edits (auto-approve file edits and common file commands) for this session (shift+tab)',
        },
        { number: 3, label: 'No' },
      ],
    })
  })

  it('reads it wherever the cursor sits', () => {
    const moved = LIVE.map((row) =>
      row.replace(' ❯ 1. Yes', '   1. Yes').replace('   3. No', ' ❯ 3. No')
    )
    expect(parseChoicePrompt(moved)?.options.map((o) => o.number)).toEqual([1, 2, 3])
  })
})

describe('parseChoicePrompt — shapes it accepts', () => {
  it('joins an option label that wrapped onto the next row', () => {
    const prompt = parseChoicePrompt(
      screen(
        ' Which test runner should I set up?',
        ' ❯ 1. Vitest',
        '   2. Playwright, for the checkout flow end to end, which needs a',
        '      browser installed',
        '   3. Both'
      )
    )
    expect(prompt?.options[1].label).toBe(
      'Playwright, for the checkout flow end to end, which needs a browser installed'
    )
  })

  it('strips box-drawing edges from a boxed prompt', () => {
    expect(
      parseChoicePrompt(
        screen(
          '│ Do you trust the files in this folder? │',
          '│ ❯ 1. Yes, proceed        │',
          '│   2. No, exit            │'
        )
      )
    ).toEqual({
      question: 'Do you trust the files in this folder?',
      options: [
        { number: 1, label: 'Yes, proceed' },
        { number: 2, label: 'No, exit' },
      ],
    })
  })
})

describe('parseChoicePrompt — shapes it refuses', () => {
  it('ignores a numbered list in ordinary output, which has no cursor', () => {
    expect(parseChoicePrompt(screen('Next steps:', '1. Run the tests', '2. Open a PR'))).toBeNull()
  })

  it('ignores a prompt that has scrolled up under newer output', () => {
    expect(
      parseChoicePrompt(
        screen(
          ' Proceed?',
          ' ❯ 1. Yes',
          '   2. No',
          '',
          '⏺ Wrote 1 line to a.txt',
          '⏺ Done.',
          '> ',
          '$ ls'
        )
      )
    ).toBeNull()
  })

  it('needs at least two options', () => {
    expect(parseChoicePrompt(screen(' Proceed?', ' ❯ 1. Yes'))).toBeNull()
  })

  it('needs the options numbered 1 to n without gaps', () => {
    expect(
      parseChoicePrompt(screen(' Proceed?', ' ❯ 1. Yes', '   2. Maybe', '   4. No'))
    ).toBeNull()
    expect(parseChoicePrompt(screen(' Proceed?', ' ❯ 2. Yes', '   3. No'))).toBeNull()
  })

  it('needs exactly one cursor', () => {
    expect(parseChoicePrompt(screen(' Proceed?', ' ❯ 1. Yes', ' ❯ 2. No'))).toBeNull()
  })

  it('needs a question above the options', () => {
    expect(parseChoicePrompt(screen(' ❯ 1. Yes', '   2. No'))).toBeNull()
  })

  it('is null for an empty screen', () => {
    expect(parseChoicePrompt([])).toBeNull()
    expect(parseChoicePrompt(['', ''])).toBeNull()
  })
})

describe('samePrompt', () => {
  const a = {
    question: 'Proceed?',
    options: [
      { number: 1, label: 'Yes' },
      { number: 2, label: 'No' },
    ],
  }

  it('is true for the same options, whatever the question says', () => {
    expect(samePrompt(a, { ...a, question: 'Continue?' })).toBe(true)
  })

  it('is false when an option changed or moved', () => {
    expect(samePrompt(a, { ...a, options: [a.options[1], a.options[0]] })).toBe(false)
    expect(samePrompt(a, { ...a, options: [a.options[0], { number: 2, label: 'Never' }] })).toBe(
      false
    )
    expect(samePrompt(a, { ...a, options: [a.options[0]] })).toBe(false)
  })

  it('is false when either side has no prompt', () => {
    expect(samePrompt(a, null)).toBe(false)
    expect(samePrompt(null, null)).toBe(false)
  })
})
