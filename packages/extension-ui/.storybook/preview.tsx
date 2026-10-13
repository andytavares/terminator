import React, { useLayoutEffect } from 'react'
import type { Decorator, Preview } from '@storybook/react-vite'
import '../src/fonts'
import '../src/tokens.css'
import '../src/extension-base.css'
import '../src/controls.css'

type Theme = 'dark' | 'light'

/** Stamps the theme on the document the way the app does for an extension view: dark is the
 * default and carries no attribute, light sets `data-theme`. */
function ThemeFrame({ theme, children }: { theme: Theme; children: React.ReactNode }): JSX.Element {
  useLayoutEffect(() => {
    const root = document.documentElement
    if (theme === 'light') root.setAttribute('data-theme', 'light')
    else root.removeAttribute('data-theme')
  }, [theme])

  return (
    <div
      style={{
        minHeight: '100vh',
        padding: 'var(--tm-space-4)',
        background: 'var(--tm-bg-base)',
        color: 'var(--tm-text-primary)',
        fontFamily: 'var(--tm-font-ui)',
      }}
    >
      {children}
    </div>
  )
}

const withTheme: Decorator = (Story, context) => (
  <ThemeFrame theme={context.globals.theme === 'light' ? 'light' : 'dark'}>
    <Story />
  </ThemeFrame>
)

const preview: Preview = {
  decorators: [withTheme],
  initialGlobals: { theme: 'dark' },
  globalTypes: {
    theme: {
      description: 'Colour theme',
      toolbar: {
        title: 'Theme',
        icon: 'circlehollow',
        dynamicTitle: true,
        items: [
          { value: 'dark', title: 'Dark' },
          { value: 'light', title: 'Light' },
        ],
      },
    },
  },
  parameters: { layout: 'fullscreen' },
}

export default preview
