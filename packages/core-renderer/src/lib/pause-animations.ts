const IDLE_ATTRIBUTE = 'data-window-idle'

/**
 * Marks the root while the window is hidden or out of focus; styles.css pauses every animation
 * under the mark, so a looping spinner costs no CPU or GPU while nobody looks at it. Focus moving
 * into an extension view blurs this window, yet the window is still in use.
 */
export function installAnimationPause(): () => void {
  const root = document.documentElement
  let focused = document.hasFocus()
  const update = (): void => void root.toggleAttribute(IDLE_ATTRIBUTE, document.hidden || !focused)
  const onFocus = (): void => {
    focused = true
    update()
  }
  const onBlur = (): void => {
    focused = document.activeElement instanceof HTMLIFrameElement
    update()
  }
  window.addEventListener('focus', onFocus)
  window.addEventListener('blur', onBlur)
  document.addEventListener('visibilitychange', update)
  update()
  return () => {
    window.removeEventListener('focus', onFocus)
    window.removeEventListener('blur', onBlur)
    document.removeEventListener('visibilitychange', update)
    root.removeAttribute(IDLE_ATTRIBUTE)
  }
}
