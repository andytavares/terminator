import React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'
import { inLight } from './in-light'

const GROUPS: Record<string, string[]> = {
  Surfaces: ['bg-base', 'bg-surface', 'bg-elevated', 'bg-card', 'bg-card-hover', 'bg-input'],
  Text: ['text-primary', 'text-secondary', 'text-muted', 'accent-text'],
  Accent: ['accent', 'accent-hover', 'accent-dim', 'accent-glow', 'on-accent'],
  Meaning: ['danger', 'success', 'warning', 'agent'],
  Lines: ['border', 'border-strong', 'overlay-subtle', 'overlay-soft', 'overlay', 'overlay-strong'],
}

function Swatch({ name }: { name: string }): JSX.Element {
  return (
    <div style={{ display: 'grid', gap: 4, justifyItems: 'start' }}>
      <div
        style={{
          width: 72,
          height: 36,
          background: `var(--tm-${name})`,
          border: '1px solid var(--tm-border-strong)',
          borderRadius: 'var(--tm-radius-sm)',
        }}
      />
      <code style={{ fontFamily: 'var(--tm-font-mono)', fontSize: 11 }}>--tm-{name}</code>
    </div>
  )
}

function Tokens(): JSX.Element {
  return (
    <div style={{ display: 'grid', gap: 'var(--tm-space-5)' }}>
      {Object.entries(GROUPS).map(([group, names]) => (
        <section key={group}>
          <h3 style={{ margin: '0 0 var(--tm-space-2)', fontSize: 13 }}>{group}</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--tm-space-4)' }}>
            {names.map((name) => (
              <Swatch key={name} name={name} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

const meta = { title: 'Foundations/Tokens', component: Tokens } satisfies Meta<typeof Tokens>

export default meta
type Story = StoryObj<typeof meta>

const tokenValue = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim()

export const Dark: Story = {
  play: async () => {
    await expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    await expect(tokenValue('--tm-bg-base')).toBe('#0c0c0f')
  },
}

export const Light: Story = inLight({
  play: async () => {
    await expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    await expect(tokenValue('--tm-bg-base')).toBe('#f0f0f5')
  },
} satisfies Story)
