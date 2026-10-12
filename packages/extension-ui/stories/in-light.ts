/**
 * The same story in the light theme.
 *
 * The toolbar switches theme while browsing; a story that must be checked in
 * both themes by the test run needs a light twin of its own, because the run
 * renders each story once, in the theme its globals name.
 */
export function inLight<Story extends object>(story: Story): Story {
  return { ...story, globals: { theme: 'light' } }
}
