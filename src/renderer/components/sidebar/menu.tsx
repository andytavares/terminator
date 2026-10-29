import React, { useState, type ReactNode } from 'react'
import { Menu } from '@terminator/extension-ui'

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

/** A sidebar-style drop-down: its button, and its menu opened under it. */
export function DropdownMenu({
  variant,
  panelLabel,
  children,
  ...button
}: DropdownMenuProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const close = (): void => setOpen(false)
  const suffix = variant ? ` ${variant}` : ''
  return (
    <div className={`sidebar-menu${suffix}`} onClick={(e) => e.stopPropagation()}>
      <MenuButton {...button} control={{ open, toggle: () => setOpen((v) => !v) }} />
      {open && (
        <Menu
          className={`sidebar-menu__panel${variant ? ` ${variant}__panel` : ''}`}
          label={panelLabel ?? button.ariaLabel ?? button.label}
          onDismiss={close}
        >
          {children(close)}
        </Menu>
      )}
    </div>
  )
}

interface MenuControl {
  open: boolean
  toggle: () => void
}

function MenuButton({
  label,
  icon,
  ariaLabel = label,
  on = false,
  badge,
  control: { open, toggle },
}: MenuButtonProps & { control: MenuControl }): React.JSX.Element {
  const marked = on === 'when-open' ? open : on
  return (
    <button
      type="button"
      className={`sidebar-menu__button${marked ? ' sidebar-menu__button--on' : ''}`}
      aria-haspopup="menu"
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
}: RadioChoicesProps<K>): React.JSX.Element {
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
}: MenuChoiceProps): React.JSX.Element {
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
