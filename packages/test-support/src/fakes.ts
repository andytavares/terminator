/**
 * A stand-in for an object the code under test reaches through a few members
 * only, typed as the real thing: a class with private state (ExtensionHost) or
 * one that runs in neither jsdom nor node (xterm's TerminalInstance). A member
 * left out fails at run time, so `parts` holds every member the code calls.
 */
export function partialFake<T extends object>(parts: Partial<T>): T {
  return parts as T
}
