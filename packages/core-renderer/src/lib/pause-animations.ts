const IDLE_ATTRIBUTE = 'data-window-idle'

/** Marks the root while the window is hidden or out of focus; styles.css pauses every animation
 * under the mark. Focus moving into an extension view blurs this window, yet it is still in use. */
export function installAnimationPause(): () => void {
  const root = document.documentElement
  let focused = document.hasFocus()
  const update = (): void => void root.toggleAttribute(IDLE_ATTRIBUTE, document.hidden || !focused)
  const markFocused = (): void => {
    focused = true
    update()
  }
  const markBlurred = (): void => {
    focused = document.activeElement instanceof HTMLIFrameElement
    update()
  }
  window.addEventListener('focus', markFocused)
  window.addEventListener('blur', markBlurred)
  document.addEventListener('visibilitychange', update)
  update()
  return () => {
    window.removeEventListener('focus', markFocused)
    window.removeEventListener('blur', markBlurred)
    document.removeEventListener('visibilitychange', update)
    root.removeAttribute(IDLE_ATTRIBUTE)
  }
}
