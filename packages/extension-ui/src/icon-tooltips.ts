import './extension-ui.css'

/** How long the pointer rests on a control before its name shows.
 * @internal */
export const TOOLTIP_DELAY_MS = 500

const CONTROL = 'button, a[href], [role="button"]'
const GAP_PX = 6

/** A control whose visible content does not say its name, and that name; null for anything else.
 * An icon with a badge count is one: the count is not the name. */
function namedIcon(target: EventTarget | null): { control: HTMLElement; text: string } | null {
  if (!(target instanceof Element)) return null
  const control = target.closest<HTMLElement>(CONTROL)
  const text = control?.getAttribute('title') ?? control?.getAttribute('aria-label')
  if (!control || !text || control.textContent?.includes(text)) return null
  return { control, text }
}

/** Below the control, or above it when there is no room below; never past the window's sides. */
function place(tip: HTMLElement, control: HTMLElement): void {
  const box = control.getBoundingClientRect()
  const { innerWidth, innerHeight } = tip.ownerDocument.defaultView ?? window
  const below = box.bottom + GAP_PX
  const top = below + tip.offsetHeight > innerHeight ? box.top - GAP_PX - tip.offsetHeight : below
  const centred = box.left + box.width / 2 - tip.offsetWidth / 2
  const left = Math.min(Math.max(GAP_PX, centred), innerWidth - tip.offsetWidth - GAP_PX)
  tip.style.top = `${Math.max(GAP_PX, top)}px`
  tip.style.left = `${left}px`
}

/** The one tooltip element, shown in the top layer so a modal dialog cannot cover it. */
function createTip(doc: Document): HTMLElement {
  const tip = doc.createElement('div')
  tip.className = 'tmui-tooltip'
  // The control already carries this name; a screen reader would hear it twice.
  tip.setAttribute('aria-hidden', 'true')
  tip.popover = 'manual'
  tip.hidden = true
  doc.body.appendChild(tip)
  return tip
}

/** Shows and hides the tooltip for one control at a time. */
function tooltipController(doc: Document) {
  const tip = createTip(doc)
  let current: HTMLElement | null = null
  let heldTitle: string | null = null
  let timer: ReturnType<typeof setTimeout> | undefined

  const hide = (): void => {
    clearTimeout(timer)
    if (current && heldTitle !== null) current.setAttribute('title', heldTitle)
    current = null
    heldTitle = null
    tip.hidden = true
    tip.hidePopover()
  }
  const show = ({ control, text }: { control: HTMLElement; text: string }): void => {
    hide()
    current = control
    // The native tooltip would draw the same name a second time, late.
    heldTitle = control.getAttribute('title')
    control.removeAttribute('title')
    tip.textContent = text
    tip.hidden = false
    tip.showPopover()
    place(tip, control)
  }
  const showLater = (named: { control: HTMLElement; text: string }): void => {
    hide()
    timer = setTimeout(() => show(named), TOOLTIP_DELAY_MS)
  }
  return { tip, show, showLater, hide, isOn: (control: Element) => control === current }
}

type Tips = ReturnType<typeof tooltipController>
type Listeners = [string, (e: Event) => void][]

/** The pointer resting on a control, and leaving it. */
function pointerListeners(tips: Tips): Listeners {
  const onOver = (e: Event): void => {
    const named = namedIcon(e.target)
    if (named && !tips.isOn(named.control)) tips.showLater(named)
  }
  const onOut = (e: Event): void => {
    const next = (e as PointerEvent).relatedTarget
    if (!(next instanceof Node && namedIcon(e.target)?.control.contains(next))) tips.hide()
  }
  return [
    ['pointerover', onOver],
    ['pointerout', onOut],
  ]
}

/** Keyboard focus reaching a control and leaving it; a click's focus does not count. */
function focusListeners(tips: Tips): Listeners {
  // Focus that follows a click is not a keyboard user arriving; the tooltip would linger.
  let pointerLast = false
  const showOnFocus = (e: Event): void => {
    const named = namedIcon(e.target)
    if (named && !pointerLast) tips.show(named)
  }
  const hideOnBlur = (e: Event): void => {
    if (e.target instanceof Element && tips.isOn(e.target)) tips.hide()
  }
  const noteKey = (e: Event): void => {
    pointerLast = false
    if ((e as KeyboardEvent).key === 'Escape') tips.hide()
  }
  const notePointerDown = (): void => {
    pointerLast = true
    tips.hide()
  }
  return [
    ['focusin', showOnFocus],
    ['focusout', hideOnBlur],
    ['keydown', noteKey],
    ['pointerdown', notePointerDown],
  ]
}

/** Names each icon-only control on hover or focus, from its title or aria-label; drawn, because no
 * native tooltip appeared in an extension's overlaid view. Returns the uninstaller. */
export function installIconTooltips(doc: Document = document): () => void {
  const tips = tooltipController(doc)
  const listeners = [...pointerListeners(tips), ...focusListeners(tips)]
  for (const [type, listener] of listeners) doc.addEventListener(type, listener, true)
  return () => {
    for (const [type, listener] of listeners) doc.removeEventListener(type, listener, true)
    tips.hide()
    tips.tip.remove()
  }
}
