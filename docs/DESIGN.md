# LB's: design system

Written in the format Impeccable (impeccable.style) reads, so its checks and commands respect it. Plain CSS, no
Tailwind. Guest site styles: `web/src/styles.css`. Admin: `web/src/admin/admin.css`.

## Brand

Ink (#0b0b0b), paper (#fbfaf5), lime (#d0ff00) and cyan (#00bcc8). Lime is a highlighter: a fill behind the
one thing that matters, never body text on a light surface. Fonts: Archivo for everything, with the display
face only for the LB's wordmark and big page titles on the guest site.

## Guest site

Tokens on `:root` in `styles.css` (`--ink`, `--paper`, `--lime`, `--cyan`, `--t-sm` to `--t-display`,
`--radius`, `--radius-sm`). Light only (`color-scheme: only light`). Retro music gear illustrations in ink line
with lime/cyan accents. 2px ink borders, ink drop shadows on primary buttons.

## Admin (an operate tool, phones first)

Follows the phone's light or dark setting. Tokens on `.admin-body`:

| Token | Light | Dark | Use |
|---|---|---|---|
| `--a-bg` | #f3f3ef | #0e0f11 | page |
| `--a-panel` | #ffffff | #17181b | cards, sheets, fields |
| `--a-raised` | #f8f8f5 | #1f2125 | wells, segmented controls |
| `--a-line` / `--a-line-strong` | #e1e1da / #c6c6bd | #2c2e33 / #43464d | dividers / control edges |
| `--a-ink` / `--a-muted` | #131313 / #5b5b55 | #f1f1ec / #a6a69e | text (muted passes 4.5:1) |
| `--a-lemon` + `--a-on-accent` | #d0ff00 + #111 | same | the main action, selected nav, the ready alert |
| `--a-accent-text` | #4b6b00 | #d0ff00 | links, focus rings, charts |
| `--a-amber` | #b25e00 | #ffb04d | preparing, waiting too long, needs a decision |
| `--a-good` | #1d8a4b | #4fcf88 | ready, paid, on |
| `--a-bad` | #c4302b | #ff7b74 | errors, cancel, unread badge |
| `--a-info` | #00808a | #4fd1da | a table is calling (bill, code, server) |

Rules:

- **One lime fill per area.** The action people take most on that screen (Start preparing, Take payment, Save).
  Selected tabs are ink, other buttons are white with a visible edge.
- **Status has its own colour**, never decoration: no side stripes, glows or gradients. A late order gets an
  amber edge and amber time; a calling table is a cyan notice.
- **No cards in cards.** Board columns are plain groups with a coloured dot; cards sit on the page.
- **Type:** 16px base on phones (15px on laptops), labels 13px semibold muted, page titles 1.6rem bold, numbers in
  tabular figures. Nothing below 11.5px (switch captions only).
- **Touch:** controls at least 44px tall on phones (small buttons 34px with room around them).
- **Phone layout:** slim top bar (logo, alerts on/off, live dot), screens in a bottom bar: the four most used
  (Orders, New order, Kitchen, Menu; Bookings for servers) and More for the rest, who's signed in, and sign out.
  Modals become bottom sheets. Laptops get a sidebar with everything.
- **Switches say what they do** with a caption (In stock, On Regular); no unlabelled controls.
- **Copy:** sentence case, plain, no ALL CAPS, no middle-dot strings, errors say what happened and how to fix it.
