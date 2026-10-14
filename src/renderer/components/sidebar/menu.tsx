import React, { useEffect, useRef, useState, type ReactNode } from 'react'
import { closeAllContextMenus } from '../ContextMenu'
import { useMenuPlacement } from '../use-menu-placement'

/** One drop-down menu's state: open or not, where its panel sits, and closing on any click
 * outside it or when another context menu opens. */
function useMenu() {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const placement = useMenuPlacement(open, buttonRef, panelRef)

  useEffect(() => {
    if (!open) return
    const closeDropdown = (): void => setOpen(false)
    window.addEventListener('click', closeDropdown)
    window.addEventListener('close-context-menus', closeDropdown)
    return () => {
      window.removeEventListener('click', closeDropdown)
      window.removeEventListener('close-context-menus', closeDropdown)
    }
  }, [open])

  const toggleDropdown = (): void => {
    closeAllContextMenus()
    setOpen((v) => !v)
  }

  return {
    open,
    close: () => setOpen(false),
    toggle: toggleDropdown,
    buttonRef,
    panelRef,
    placement,
  }
}

interface MenuButtonProps {
  /** Shown beside the icon, and the button's name unless `ariaLabel` says otherwise. */
  label: string
  icon: ReactNode
  ariaLabel?: string
  /** Marks the button on: always, never, or while its menu is open. */
  on?: boolean | 'when-open'
  /** A count beside the label, such as how many rows a filter hides. */
  badge?: ReactNode
}

interface DropdownMenuProps extends MenuButtonProps {
  /** Added to the wrapper and, suffixed `__panel`, to the panel (e.g. `home-menu`). */
  variant?: string
  panelLabel?: string
  /** The panel's items, given the function that closes the menu. */
  children: (close: () => void) => ReactNode
}

/** A sidebar-style drop-down: its button, and its panel placed against the viewport. */
export function DropdownMenu({
  variant,
  panelLabel,
  children,
  ...button
}: DropdownMenuProps): JSX.Element {
  const { open, close, toggle, buttonRef, panelRef, placement } = useMenu()
  const suffix = variant ? ` ${variant}` : ''
  return (
    <div className={`sidebar-menu${suffix}`} onClick={(e) => e.stopPropagation()}>
      <MenuButton {...button} control={{ open, toggle, buttonRef }} />
      {open && (
        <div
          ref={panelRef}
          className={`sidebar-menu__panel${variant ? ` ${variant}__panel` : ''}`}
          role="menu"
          aria-label={panelLabel}
          style={placement}
        >
          {children(close)}
        </div>
      )}
    </div>
  )
}

interface MenuControl {
  open: boolean
  toggle: () => void
  buttonRef: React.RefObject<HTMLButtonElement>
}

function MenuButton({
  label,
  icon,
  ariaLabel = label,
  on = false,
  badge,
  control: { open, toggle, buttonRef },
}: MenuButtonProps & { control: MenuControl }): JSX.Element {
  const marked = on === 'when-open' ? open : on
  return (
    <button
      ref={buttonRef}
      type="button"
      className={`sidebar-menu__button${marked ? ' sidebar-menu__button--on' : ''}`}
      aria-expanded={open}
      aria-label={ariaLabel}
      onClick={toggle}
    >
      {icon}
      <span className="sidebar-menu__label">{label}</span>
      {badge}
    </button>
  )
}

interface RadioChoicesProps<K extends string> {
  /** Each choice's key and label, in menu order. */
  choices: ReadonlyArray<readonly [K, string]>
  current: K
  onPick: (key: K) => void
}

/** A run of radio rows, one per choice, with the current one checked. */
export function RadioChoices<K extends string>({
  choices,
  current,
  onPick,
}: RadioChoicesProps<K>): JSX.Element {
  return (
    <>
      {choices.map(([key, label]) => (
        <MenuChoice key={key} checked={current === key} onSelect={() => onPick(key)}>
          {label}
        </MenuChoice>
      ))}
    </>
  )
}

interface MenuChoiceProps {
  checked: boolean
  onSelect: () => void
  kind?: 'radio' | 'checkbox'
  children: ReactNode
}

/** One radio or checkbox row in a sidebar menu, marked on when checked. */
export function MenuChoice({
  checked,
  onSelect,
  kind = 'radio',
  children,
}: MenuChoiceProps): JSX.Element {
  return (
    <button
      type="button"
      role={kind === 'radio' ? 'menuitemradio' : 'menuitemcheckbox'}
      aria-checked={checked}
      className={`sidebar-menu__item${checked ? ' sidebar-menu__item--on' : ''}`}
      onClick={onSelect}
    >
      {children}
    </button>
  )
}
