// jsdom 29 gives HTMLDialogElement no methods; happy-dom 20 has showModal() and close(); neither
// answers Escape with `cancel`. Only that is supplied here. Focus, the inert page and the top
// layer are a browser's: the ModalShell stories and visual/modal-keys.visual.ts prove those.

function openAsModal(this: HTMLDialogElement): void {
  this.setAttribute('open', '')
}

function closeDialog(this: HTMLDialogElement): void {
  if (!this.hasAttribute('open')) return
  this.removeAttribute('open')
  this.dispatchEvent(new Event('close'))
}

/** A close request, as Escape makes one: `cancel` on the dialog opened last, then close() unless
 * a listener prevented it. */
function requestCloseOfTopDialog(): void {
  const open = document.querySelectorAll<HTMLDialogElement>('dialog[open]')
  const top = open[open.length - 1]
  if (top?.dispatchEvent(new Event('cancel', { cancelable: true }))) top.close()
}

/** A browser makes the close request once the keydown has been dispatched with its default not
 * prevented. The nearest a listener gets is to run last: one added to the window as the key
 * arrives. A handler that stops the key's propagation hides it; a browser would still ask. */
function requestCloseAfterEscape(view: Window & typeof globalThis): void {
  const armOnEscape = (pressed: KeyboardEvent): void => {
    if (pressed.key !== 'Escape') return
    const afterTheOthers = (event: KeyboardEvent): void => {
      if (event === pressed && !event.defaultPrevented) requestCloseOfTopDialog()
    }
    view.addEventListener('keydown', afterTheOthers, { once: true })
  }
  view.addEventListener('keydown', armOnEscape, true)
}

export function installNativeDialog(view: Window & typeof globalThis): void {
  const dialog = view.HTMLDialogElement.prototype
  if (typeof dialog.showModal !== 'function') {
    Object.assign(dialog, { showModal: openAsModal, close: closeDialog })
  }
  requestCloseAfterEscape(view)
}
