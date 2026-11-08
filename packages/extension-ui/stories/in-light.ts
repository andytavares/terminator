/**
 * The same story in the light theme, for its screenshot.
 *
 * The toolbar switches theme while browsing; a story that must be shown in
 * both themes by the test run needs a light twin of its own, because the run
 * renders each story once, in the theme its globals name. The twin drops the
 * story's play: behavior does not change with the theme, so the dark story
 * checks it once.
 */
export function inLight<Story extends object>(story: Story): Story {
  return { ...story, play: undefined, globals: { theme: 'light' } }
}
