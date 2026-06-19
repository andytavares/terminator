// Global test setup — runs before every test file regardless of environment.
// CSS modules are not processed in tests; mock them to return an empty object.
import { vi } from 'vitest'

vi.mock('*.css', () => ({}))
vi.mock('*.module.css', () => ({ default: {} }))

// JSDOM does not fully implement the Selection API; patch it to prevent React DOM
// from crashing with "Right-hand side of 'instanceof' is not an object" when
// rendering components with form elements (inputs, checkboxes).
if (typeof window !== 'undefined' && !window.getSelection) {
  window.getSelection = (): Selection | null => null
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
