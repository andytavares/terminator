import { describe, it, expect } from 'vitest'
import { lintCases } from './oxlint-sandbox'

/** The rules .oxlintrc.json applies to core source: the pure layers (ADR-027), the theme's
 * colours and the word "branch" (ADR 032). */

async function rulesHit(code: string, file: string): Promise<string[]> {
  return ((await lintCases([{ file, code }])).get(file) ?? []).map(({ rule }) => rule)
}

const SIDEBAR = 'packages/core-renderer/src/sidebar/case.ts'
const HOME = 'packages/core-renderer/src/home/case.ts'

const REJECTED_IMPORTS: [string, string, string][] = [
  [
    'zustand in the sidebar layer',
    "import { create } from 'zustand'\nexport const c = create\n",
    SIDEBAR,
  ],
  [
    'the Desk store from the sidebar layer',
    "import { h } from '../home/focus-store'\nexport const c = h\n",
    SIDEBAR,
  ],
  [
    'React in the Desk layer',
    "import { useState } from 'react'\nexport const c = useState\n",
    HOME,
  ],
]

const ALLOWED_IMPORTS: [string, string, string][] = [
  ['a sibling', "import { a } from './order'\nexport const c = a\n", SIDEBAR],
  [
    'the shared types',
    "import { T } from '../../../core-shared/src/types/index'\nexport const c = T\n",
    SIDEBAR,
  ],
  [
    'a type from zustand',
    "import type { StoreApi } from 'zustand'\nexport type C = StoreApi<1>\n",
    SIDEBAR,
  ],
  [
    'the sidebar layer from the Desk',
    "import { a } from '../sidebar/order'\nexport const c = a\n",
    HOME,
  ],
]

describe('a pure layer and its imports', () => {
  it.each(REJECTED_IMPORTS)('rejects a value import of %s', async (_name, code, file) => {
    expect(await rulesHit(code, file)).toContain('eslint/no-restricted-imports')
  })

  it.each(ALLOWED_IMPORTS)('allows %s', async (_name, code, file) => {
    expect(await rulesHit(code, file)).toEqual([])
  })
})

describe('a pure layer and the clock', () => {
  it.each([
    ['Date.now()', 'export const c = Date.now()\n'],
    ['new Date()', 'export const c = new Date()\n'],
  ])('never reads the clock with %s', async (_name, code) => {
    expect(await rulesHit(code, SIDEBAR)).toEqual(['terminator/restricted-syntax'])
  })

  it('may build a date from a value it was given', async () => {
    expect(await rulesHit('export const c = (now: number) => new Date(now)\n', SIDEBAR)).toEqual([])
  })
})

describe('core renderer text', () => {
  const COMPONENT = 'packages/core-renderer/src/components/Case.tsx'

  it.each([
    ['visible text', 'export const A = () => <p>Open project</p>\n'],
    ['a menu label', "export const m = [{ label: 'New project' }]\n"],
    ['a tooltip', 'export const A = () => <button title="Close project" />\n'],
  ])('says branch, not project, in %s', async (_name, code) => {
    expect(await rulesHit(code, COMPONENT)).toEqual(['terminator/restricted-syntax'])
  })

  it('leaves an identifier named for the stored entity alone', async () => {
    expect(await rulesHit('export const projectId = 1\n', COMPONENT)).toEqual([])
  })
})

describe('one word per action', () => {
  const COMPONENT = 'packages/core-renderer/src/components/Case.tsx'
  const EXTENSION = 'extensions/task-vault/src/components/Case.tsx'
  const HOME_COMPONENT = 'packages/core-renderer/src/components/home/Case.tsx'
  const SIDEBAR_COMPONENT = 'packages/core-renderer/src/components/sidebar/Case.tsx'

  it.each([
    ['visible text', 'export const A = () => <b>Done today: 3</b>\n', COMPONENT],
    ['a menu label', "export const m = [{ label: 'Undo done' }]\n", COMPONENT],
    ['a ticket link', "export const m = [{ label: 'Link issue…' }]\n", COMPONENT],
    ['a tooltip', 'export const A = () => <button title="Complete" />\n', EXTENSION],
    ['an accessible name', 'export const A = () => <button aria-label="Unarchive" />\n', EXTENSION],
    [
      'a conditional label',
      "export const A = (on: boolean) => <b>{on ? 'Unarchive' : 'Archive'}</b>\n",
      EXTENSION,
    ],
  ])('rejects a retired word in %s', async (_name, code, file) => {
    expect(await rulesHit(code, file)).toEqual(['terminator/restricted-syntax'])
  })

  it.each([
    ['a Home row menu', "export const m = [{ label: 'Dismiss' }]\n", HOME_COMPONENT],
    ['a Home footer', 'export const A = () => <b>Dismissed (2)</b>\n', HOME_COMPONENT],
    [
      'an Inbox card',
      'export const A = () => <button aria-label="Dismiss" />\n',
      SIDEBAR_COMPONENT,
    ],
    ['a ticket dialog', 'export const A = () => <dialog title="Link an issue" />\n', COMPONENT],
    [
      'a session link dialog',
      'export const A = () => <dialog title="Link a work item" />\n',
      COMPONENT,
    ],
  ])('rejects Dismiss or an old link name on work in %s', async (_name, code, file) => {
    expect(await rulesHit(code, file)).toEqual(['terminator/restricted-syntax'])
  })

  it('allows Done that ends an edit on Home', async () => {
    const code = "export const A = (e: boolean) => <b>{e ? 'Done' : 'Edit'}</b>\n"
    expect(await rulesHit(code, HOME_COMPONENT)).toEqual([])
  })

  it.each([
    ['Dismiss on a notification', "export const m = [{ label: 'Dismiss' }]\n", COMPONENT],
    ['the one word', "export const m = [{ label: 'Settle' }]\n", COMPONENT],
    ['an identifier', 'export const linkIssue = 1\n', COMPONENT],
  ])('allows %s', async (_name, code, file) => {
    expect(await rulesHit(code, file)).toEqual([])
  })
})

describe('inline style colours', () => {
  it('rejects a hex colour in a style prop', async () => {
    const code = "export const A = () => <p style={{ color: '#fff' }} />\n"
    expect(await rulesHit(code, 'packages/core-renderer/src/Case.tsx')).toEqual([
      'terminator/restricted-syntax',
    ])
  })

  it('allows a theme token', async () => {
    const code = "export const A = () => <p style={{ color: 'var(--text-secondary)' }} />\n"
    expect(await rulesHit(code, 'packages/core-renderer/src/Case.tsx')).toEqual([])
  })
})
