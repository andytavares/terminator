# Principle XII debt in the extensions

**Recorded**: 2026-09-05, by feature 036 (extension UX remediation).
**Status**: open. Not fixed here, and deliberately not swept in silently.

Constitution Principle XII (NON-NEGOTIABLE) says extension icons are lucide,
flat, inheriting `currentColor`, sized in CSS — never with a `size` prop — and
that unicode characters are not used as visual elements.

Feature 036 found the extensions in wide violation and fixed only what it was
already rewriting. The position is recorded in that feature's plan under
Complexity Tracking: sweeping all of it would have put ~185 unrelated line
changes into a PR about dialogs and screens, breaking Constitution V's rule that
every changed line traces to the request, and making the review unreadable.

This file is the rest of it, so the number is a known quantity rather than a
thing someone rediscovers.

## `size={n}` on lucide icons

Measured after 036, in `extensions/*/src`:

| Extension         | Remaining |
| ----------------- | --------- |
| `task-vault`      | 111       |
| `speckit-pilot`   | 31        |
| `notepad`         | 22        |
| `git-integration` | 1         |
| `remote-control`  | 1         |
| **Total**         | **166**   |

Two of those five are not violations and should be left alone when this is
picked up:

- `git-integration/src/components/PrDialog.tsx` — `<select size={6}>` is the
  HTML attribute for how many rows a list box shows. Not an icon.
- `remote-control/src/components/RemoteControlView.tsx` — `QRCodeSVG size={112}`
  is a generator's prop. A QR code's module grid is computed from that number;
  it is not CSS-sizable.

So the real figure is **164**.

The conversion is mechanical but not blind: removing `size={n}` without adding a
CSS rule does not leave the icon at its old size — it falls back to lucide's
24px default, which is how a check meant for a 10px status dot ends up
overflowing it. Every removal needs a matching `width`/`height` on a selector
that actually reaches the SVG. Note also that `font-size` on the container does
nothing; several of these icons were previously text glyphs and inherited
sizing that way.

## Unicode as a visual element

Eight files, all in `git-integration`:

- `merge-flow/ConflictHeader.tsx`
- `pr-review/ChapterFileList.tsx`
- `pr-review/ChapterNav.tsx`
- `pr-review/PrOverviewPanel.tsx`
- `pr-review/PrReviewView.tsx`
- `pr-review/ReviewDiffPane.tsx`
- `pr-review/StatusChecksBar.tsx`
- `task-vault/src/components/WeeklyReviewStep1GetClear.tsx`

When converting, keep the characters that are typography rather than iconography.
036 hit this repeatedly and the distinction is worth stating: the `×` in "3×
Ours" is a multiplication sign, the `−` before a deletion count is a minus, the
`·` in "Modified by X · Y" is punctuation, and `⌘` `↵` `⇧` in a shortcut hint are
the glyphs printed on the keys. None of those are icons. `✓ ✗ ⚠ ✕ → ↺ ▸ ▾` used
to stand for a state or an action are.

## Why it is not enforced by lint yet

A `no-restricted-syntax` selector for `size={n}` on a JSX identifier that
resolves to a lucide import is straightforward to write, and 036 wrote the
equivalent for raw `z-index` and for vocabulary. It was not added here because a
rule that fires 164 times on day one gets switched off, and the honest order is
to clear the debt and then close the door behind it.

**Suggested sequence**: convert per extension, starting with `git-integration`
(1 remaining, trivial) to establish the CSS pattern, then `notepad`, then
`speckit-pilot`, then `task-vault`. Add the lint rule in the same PR as the last
conversion.
