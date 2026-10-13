import { vi } from 'vitest'

/** A disposable whose dispose is a spy, as the host's registrations return. */
export const disposableSpy = () => ({ dispose: vi.fn() })
