// jsdom 29 gives HTMLDialogElement no methods; happy-dom 20 has showModal() and close(); neither
// answers Escape with `cancel`. Neither has the Popover API, nor the :modal and :popover-open
// pseudo-classes. Only that is supplied here. Focus, the inert page and the top layer are a
// browser's: the stories (Popover, Menu, ModalShell) and visual/modal-keys.visual.ts prove those.

function openAsModal(this: HTMLDialogElement): void {
  this.setAttribute('open', '')
}

function closeDialog(this: HTMLDialogElement): void {
  if (!this.hasAttribute('open')) return
  this.removeAttribute('open')
  this.dispatchEvent(new Event('close'))
}

/** The attribute that stands for `:popover-open`, which these DOMs cannot match. */
const POPOVER_OPEN = 'data-popover-open'

function toggleEvent(newState: 'open' | 'closed'): Event {
  return Object.assign(new Event('toggle'), {
    newState,
    oldState: newState === 'open' ? 'closed' : 'open',
  })
}

/** What had focus when each popover opened, which a browser gives it back on close. */
const focusBeforePopover = new WeakMap<HTMLElement, Element | null>()

function showPopover(this: HTMLElement): void {
  if (this.hasAttribute(POPOVER_OPEN)) return
  focusBeforePopover.set(this, document.activeElement)
  this.setAttribute(POPOVER_OPEN, '')
  this.dispatchEvent(toggleEvent('open'))
}

function hidePopover(this: HTMLElement): void {
  if (!this.hasAttribute(POPOVER_OPEN)) return
  this.removeAttribute(POPOVER_OPEN)
  const opener = focusBeforePopover.get(this)
  if (this.contains(document.activeElement) && opener instanceof HTMLElement) opener.focus()
  this.dispatchEvent(toggleEvent('closed'))
}

function openPopovers(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(`[${POPOVER_OPEN}]`))
}

/** Light dismiss: a click outside every open popover closes them, as a browser does. */
function dismissOnOutsideClick(view: Window & typeof globalThis): void {
  view.addEventListener(
    'click',
    (event) => {
      for (const popover of openPopovers().reverse()) {
        const inside = event.target instanceof Node && popover.contains(event.target)
        if (!inside) popover.hidePopover()
      }
    },
    true
  )
}

/** The pseudo-classes written as the attributes that stand for them. */
function matchesWithoutPseudoClasses(selector: string): string {
  return selector.replaceAll(':popover-open', `[${POPOVER_OPEN}]`).replaceAll(':modal', '[open]')
}

/** The prototype in `instance`'s chain that defines `method`: a window's own `Element` and
 * `Document` classes are not always the ones its nodes are made from. */
function definerOf(instance: object, method: string): object | null {
  for (let at: object | null = instance; at; at = Object.getPrototypeOf(at)) {
    if (Object.prototype.hasOwnProperty.call(at, method)) return at
  }
  return null
}

function readPseudoClassesAsAttributes(view: Window & typeof globalThis): void {
  const methods = ['querySelector', 'querySelectorAll', 'matches', 'closest']
  for (const sample of [view.document, view.document.documentElement]) {
    for (const method of methods) {
      const definer = definerOf(sample, method)
      const original = definer && (definer as Record<string, unknown>)[method]
      if (!definer || typeof original !== 'function') continue
      Object.defineProperty(definer, method, {
        configurable: true,
        value(this: unknown, selector: string) {
          return original.call(this, matchesWithoutPseudoClasses(selector))
        },
      })
    }
  }
}

/** A close request, as Escape makes one: the popover opened last closes first; otherwise `cancel`
 * on the dialog opened last, then close() unless a listener prevented it. */
function requestCloseOfTopDialog(): void {
  const popover = openPopovers().pop()
  if (popover) {
    popover.hidePopover()
    return
  }
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
  if (typeof view.HTMLElement.prototype.showPopover !== 'function') {
    Object.assign(view.HTMLElement.prototype, { showPopover, hidePopover })
    // The user-agent sheet hides every popover its `:popover-open` does not match.
    const style = view.document.createElement('style')
    style.textContent = `[popover][${POPOVER_OPEN}] { display: block !important; }`
    view.document.head.prepend(style)
    readPseudoClassesAsAttributes(view)
    dismissOnOutsideClick(view)
  }
  requestCloseAfterEscape(view)
}
