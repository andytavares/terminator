# Contract: UI surfaces

End-to-end tests address these by role and accessible name, never by CSS class (`feedback_e2e_address_ui_by_role_not_class`). Changing a name here is a contract change.

## App band

- Home: `button` named `Home`. When sessions need input, the button has a badge with that count (`9+` above 9), and the accessible name becomes `Home, 2 need you`.
- Overview: `button` named `Overview` (unchanged).

## Home (`core.home`)

- Layout switch: `radiogroup` named `Layout`, with `radio`s `Ledger` and `Logbook`.
- Filter: `searchbox` named `Filter sessions`.
- Needs you filter: `button` named `Needs you`, with `aria-pressed`.
- Home is a `region` named `Home`; its controls are addressed inside it, because the sidebar has its own `Display`.
- Display menu (Ledger only): `button` named `Display` opens a `menu` named `Display options`, in the shape of the sidebar's Display menu. Inside:
  - `menuitemradio`s `Repo, then branch`, `Branch`, `None` (group by) and `Needs you first`, `Recent activity` (sort), which close the menu
  - `menuitemcheckbox`es `Branch`, `Work item or description`, `Tags`, `Latest output`, `Age`, `Preview the selected row`, `Hide exited sessions`, which leave it open
- Empty filter result: text `No sessions match`, and `button` `Clear filters`.
- No sessions at all: text `No terminals are open`, and `button` `Go to terminals`.

### Ledger

- `grid` named `Sessions`.
- One `rowgroup` per group, named by its label (e.g. `Northwind / northwind-api`, `No branch`, `Closed`).
- One `row` per session, named by the session name.
- Selected row: `aria-selected="true"`. The expanded region is a `region` named `Preview of <name>`.

### Logbook

- `listbox` named `Sessions`, with one `group` per state section.
- Detail: `region` named `Session details`. Inside:
  - `textbox` named `What is this session doing?`
  - `button` `Save description`
  - `button` `Link a work item`
  - `list` named `Suggested work items`, whose items are `button`s named `<KEY> <title>`

## Monitor wall (`core.overview`)

- Toolbar:
  - `radiogroup` `Tile size` with `radio`s `Small`, `Medium`, `Large`
  - `switch` `Pin sessions that need you`
  - `combobox` `Then by`
  - `searchbox` `Filter sessions`
- Needs you band heading: `heading` `Needs you`. It is absent when the band is empty.
- Tile: `article` named `<workspace> / <project> / <branch>, <name>`. It contains a `button` named `Open <name>` that switches to the terminal.

## Shared controls (every surface)

- Describe field: `textbox` named `What is this session doing?`. Enter saves, Escape reverts.
- Link control: `button` named `Link a work item`.
- Edit description: `button` named `Edit description`.
- Choice buttons: a `group` named by the prompt's question, containing one `button` per option named `<n>. <label>`.
- Link: `dialog` named `Link a work item`, with `button`s `Link issue` (or `Link <KEY>` once chosen), `Cancel`, and `Remove session link` when the session has its own link.
- No tracker connected: inside that dialog, `alert` `No issue tracker is connected. Connect Linear or Jira in Settings → Integrations.`

## Icons

- State icons come from `sidebar/state-icons.tsx` (`Pause` / `Play` / `Circle` / `CircleX`), sized in CSS and differentiated only by `--state-op-*` opacity.
- New icons are lucide only: `House`, `Pencil`, `Link`, `Pin`, `SlidersHorizontal`, `Search`, `SquareArrowOutUpRight`.
